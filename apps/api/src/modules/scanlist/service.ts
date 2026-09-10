/**
 * Le module scanlist — inventorier sans verser à la collection.
 *
 * Il n'écrit ni dans `cards`, ni dans `card_prints`, ni dans `owned_cards` :
 * verser passe par `collection`, qui passe lui-même par `referential`. C'est la
 * même règle que partout ici, et elle vaut surtout au versement — l'endroit
 * exact où ATEM-old aurait été tenté d'écrire directement.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { LIMITS, normalizeSetCode, type PourResult, type ScanlistDetail, type ScanlistLine, type ScanlistSummary } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, invalidInput, notFound } from "../../platform/errors.js";
import { adjustQuantity } from "../collection/index.js";
import { scanlistLines, scanlists, type ScanlistRow } from "./schema.js";

const toSummary = (
  row: ScanlistRow,
  counts: { lineCount: number; copyCount: number },
): ScanlistSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  pouredAt: row.pouredAt?.toISOString() ?? null,
  lineCount: counts.lineCount,
  copyCount: counts.copyCount,
});

/**
 * Les lots d'une personne, du plus récent au plus ancien.
 *
 * Les deux compteurs sont calculés en SQL plutôt que sur les lignes chargées :
 * la liste des lots n'a pas à charger deux mille lignes pour afficher « 47
 * références · 63 ex. ».
 */
export async function listScanlists(db: Database, userId: string): Promise<ScanlistSummary[]> {
  const rows = await db
    .select({
      scanlist: scanlists,
      lineCount: sql<number>`count(${scanlistLines.id})::int`,
      copyCount: sql<number>`coalesce(sum(${scanlistLines.quantity}), 0)::int`,
    })
    .from(scanlists)
    .leftJoin(scanlistLines, eq(scanlistLines.scanlistId, scanlists.id))
    .where(eq(scanlists.userId, userId))
    .groupBy(scanlists.id)
    .orderBy(desc(scanlists.createdAt));

  return rows.map((row) => toSummary(row.scanlist, row));
}

/**
 * Un lot et ses lignes.
 *
 * Le filtre sur `userId` est **dans** la requête : le lot de quelqu'un d'autre
 * est introuvable, et non interdit. Un 403 dirait qu'il existe.
 */
export async function getScanlist(
  db: Database,
  userId: string,
  id: string,
): Promise<ScanlistDetail> {
  const [row] = await db
    .select()
    .from(scanlists)
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Scanliste introuvable.");

  const lines = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, id))
    .orderBy(scanlistLines.setCode);

  return {
    ...toSummary(row, {
      lineCount: lines.length,
      copyCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }),
    lines: lines.map((line) => ({
      setCode: line.setCode,
      name: line.name,
      passcode: line.passcode,
      quantity: line.quantity,
    })),
  };
}

/**
 * Enregistre un lot scanné.
 *
 * Le lot arrive entier, en une fois : tant qu'on scanne, il ne quitte pas le
 * navigateur. C'est ce qui rend le « −1 » du scanner incapable de toucher la
 * collection — il n'y a pas de chemin — et c'est aussi ce qui fait qu'un lot
 * non enregistré **meurt avec l'onglet**. Le choix est délibéré : rien ne
 * survit sans validation explicite, plutôt qu'un demi-état persisté qu'on
 * retrouve sans savoir ce qu'il contient.
 */
export async function createScanlist(
  db: Database,
  userId: string,
  input: { name: string; lines: ScanlistLine[] },
): Promise<ScanlistDetail> {
  const name = input.name.trim();
  if (!name) throw invalidInput("Donnez un nom au lot.");

  /**
   * Les codes sont normalisés **et regroupés** ici.
   *
   * Le navigateur tient déjà un compteur par code, mais rien ne garantit que
   * deux écritures d'un même code — `ltgy-fr008` et `LTGY-FR008` — n'y sont pas
   * arrivées séparément. L'index unique les refuserait au milieu de
   * l'insertion, et le lot serait perdu après le scan. On additionne.
   */
  const merged = new Map<string, ScanlistLine>();
  for (const line of input.lines) {
    const setCode = normalizeSetCode(line.setCode);
    if (!setCode) continue;
    if (line.quantity <= 0) continue;

    const existing = merged.get(setCode);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + line.quantity, LIMITS.quantity.max);
      existing.name ??= line.name;
      existing.passcode ??= line.passcode;
    } else {
      merged.set(setCode, {
        setCode,
        name: line.name ?? null,
        passcode: line.passcode ?? null,
        quantity: Math.min(line.quantity, LIMITS.quantity.max),
      });
    }
  }

  const lines = [...merged.values()];
  if (lines.length === 0) throw invalidInput("Aucune carte à enregistrer.");
  if (lines.length > LIMITS.scanlist.maxLines) {
    throw invalidInput(`Un lot ne porte pas plus de ${LIMITS.scanlist.maxLines} références.`);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.insert(scanlists).values({ userId, name }).returning();
    if (!row) throw new Error("insertion sans résultat");

    await tx.insert(scanlistLines).values(
      lines.map((line) => ({
        scanlistId: row.id,
        setCode: line.setCode,
        name: line.name,
        passcode: line.passcode,
        quantity: line.quantity,
      })),
    );

    return {
      ...toSummary(row, {
        lineCount: lines.length,
        copyCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      }),
      lines,
    };
  });
}

/**
 * Verse un lot dans la collection.
 *
 * **Ligne par ligne, et sans transaction d'ensemble.** C'est délibéré, et c'est
 * l'inverse du réflexe : chaque ligne peut demander une résolution réseau, et
 * tenir une transaction ouverte pendant deux mille appels à YGOPRODeck
 * verrouillerait la collection pendant plusieurs minutes. Une ligne qui échoue
 * est comptée et nommée dans le bilan ; les autres entrent.
 *
 * La date de versement est posée **avant** de verser, dans la même écriture qui
 * vérifie qu'elle était nulle. Deux appels simultanés — un double appui — ne
 * peuvent donc pas verser deux fois : le second ne trouve plus de lot à
 * réserver et repart en conflit.
 */
export async function pourScanlist(
  db: Database,
  userId: string,
  id: string,
): Promise<PourResult> {
  const [reserved] = await db
    .update(scanlists)
    .set({ pouredAt: new Date() })
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, userId), sql`${scanlists.pouredAt} is null`))
    .returning();

  if (!reserved) {
    // Distinguer les deux : un lot déjà versé n'est pas une erreur de demande,
    // c'est un état qui s'y oppose — et le dire évite de chercher une panne.
    const [exists] = await db
      .select({ pouredAt: scanlists.pouredAt })
      .from(scanlists)
      .where(and(eq(scanlists.id, id), eq(scanlists.userId, userId)))
      .limit(1);
    if (!exists) throw notFound("Scanliste introuvable.");
    throw conflict("Ce lot a déjà été versé.");
  }

  const lines = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, id))
    .orderBy(scanlistLines.setCode);

  let poured = 0;
  let failed = 0;
  const errors: PourResult["errors"] = [];

  for (const line of lines) {
    try {
      await adjustQuantity(db, userId, {
        setCode: line.setCode,
        delta: line.quantity,
        passcode: line.passcode,
      });
      poured += line.quantity;
    } catch (err) {
      failed += 1;
      errors.push({
        setCode: line.setCode,
        error: err instanceof Error ? err.message : "Échec inconnu.",
      });
    }
  }

  return {
    poured,
    failed,
    pouredAt: reserved.pouredAt!.toISOString(),
    errors,
  };
}

/** Jeter un lot. Ranger et détruire ne sont pas le même geste. */
export async function deleteScanlist(db: Database, userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(scanlists)
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, userId)))
    .returning({ id: scanlists.id });
  if (deleted.length === 0) throw notFound("Scanliste introuvable.");
}
