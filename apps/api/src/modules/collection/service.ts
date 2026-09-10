/**
 * Le module collection — ce que le joueur possède.
 *
 * Il n'écrit jamais dans `cards` ni dans `card_prints` : il appelle le module
 * `referential`. C'est la correction du défaut le plus profond d'ATEM-old, où
 * `collection` et `decks` créaient chacun leurs propres lignes de catalogue,
 * avec trois logiques concurrentes qui s'ignoraient.
 */
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { LIMITS, normalizeSetCode } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput, notFound } from "../../platform/errors.js";
import {
  ensurePlaceholderPrint, printIndex, resolvePrintBySetCode, type CardDetail, type PrintIndex,
} from "../referential/index.js";
import { enqueueResolve } from "./resolve-queue.js";
import { ownedCards } from "./schema.js";

export type CollectionItem = {
  id: number;
  setCode: string;
  quantity: number;
  isFavorite: boolean;
  notes: string | null;
  print: {
    id: number;
    setCode: string;
    setName: string | null;
    rarity: string;
    language: string;
    resolveStatus: string;
  };
  card: CardDetail | null;
};

export type CollectionFilters = {
  /** Cherche dans le nom de la carte comme dans le set code. */
  query?: string;
  type?: string[];
  /** Le type d'invocation : normal, effect, fusion, synchro, xyz, link, pendulum. */
  frameType?: string[];
  race?: string[];
  attribute?: string[];
  /**
   * Niveau, rang et valeur de Lien — trois listes distinctes.
   *
   * L'API range les trois dans le même champ `level` (et `link_value` pour le
   * dernier), mais ce ne sont pas la même chose : un Xyz de rang 4 n'est pas un
   * monstre de niveau 4, et les mélanger produirait un filtre qui ne veut rien
   * dire. ATEM-old en faisait trois blocs de puces ; on les reprend.
   */
  levels?: string[];
  ranks?: string[];
  links?: string[];
  atk?: { min?: number; max?: number };
  archetype?: string;
  language?: string;
  rarity?: string;
  favoritesOnly?: boolean;
  /** Ne montrer que ce qui n'a pas encore été identifié. */
  unresolvedOnly?: boolean;
  /**
   * La grande famille : monstre, magie, piège.
   *
   * « Monstre » n'est pas un type unique côté API — il y en a vingt et un. On
   * l'exprime par exclusion, ce qui reste juste au premier type que Konami
   * ajoutera. Ce filtre était appliqué côté écran, **après** la pagination :
   * sur une collection dont les soixante premières lignes sont des magies, la
   * grille se vidait et le reste devenait inatteignable.
   */
  kind?: "monster" | "spell" | "trap";
  sort?: "name" | "recent" | "quantity" | "setCode";
  /** Le sens du tri. ATEM-old le proposait ; s'en passer force à trier à l'envers. */
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/**
 * Une ligne possédée, enrichie par la vue du référentiel.
 *
 * Le nom imprimé, les attributs de la carte et ceux de l'impression viennent
 * de `printIndex` : `collection` ne connaît ni `cards` ni `card_prints`, et ne
 * peut donc ni les lire ni les écrire par erreur.
 */
type IndexRow = Awaited<ReturnType<typeof rowsQuery>>[number];

function toItem(row: IndexRow): CollectionItem {
  const hasCard = row.passcode !== null;
  return {
    id: row.owned.id,
    setCode: row.owned.setCode,
    quantity: row.owned.quantity,
    isFavorite: row.owned.isFavorite,
    notes: row.owned.notes,
    print: {
      id: row.printId,
      setCode: row.printSetCode,
      setName: row.setName,
      rarity: row.rarity,
      language: row.language,
      resolveStatus: row.resolveStatus,
    },
    card: hasCard
      ? {
          passcode: row.passcode!,
          // Le nom imprimé est calculé par le référentiel, en SQL : c'est sa
          // règle, et la garder là permet de trier et de chercher dessus.
          name: row.name,
          desc: (row.language === "fr" ? row.descFr : null) ?? row.descEn,
          frenchPending: row.language === "fr" && !row.nameFr,
          type: row.type,
          frameType: row.frameType,
          race: row.race,
          attribute: row.attribute,
          atk: row.atk,
          def: row.def,
          level: row.level,
          scale: row.scale,
          linkValue: row.linkValue,
          linkMarkers: row.linkMarkers,
          archetype: row.archetype,
          banlistTcg: row.banlistTcg,
          imageUrl: row.imageUrl,
          imageUrlSmall: row.imageUrlSmall,
        }
      : null,
  };
}

function buildFilters(
  userId: string,
  filters: CollectionFilters,
  idx: PrintIndex,
): SQL[] {
  const clauses: SQL[] = [eq(ownedCards.userId, userId), gt(ownedCards.quantity, 0)];

  if (filters.query?.trim()) {
    const term = `%${filters.query.trim()}%`;
    /**
     * On cherche dans le nom imprimé, dans les deux langues, dans le set code
     * **et dans le passcode**.
     *
     * Le passcode est les huit chiffres imprimés en bas à gauche de la carte :
     * quand le set code est illisible, c'est ce qui reste à lire. ATEM-old le
     * comparait déjà ; l'oublier privait d'un recours.
     */
    const matched = or(
      ilike(idx.name, term),
      ilike(idx.nameEn, term),
      ilike(idx.nameFr, term),
      ilike(ownedCards.setCode, term),
      sql`${idx.passcode}::text like ${term}`,
    );
    if (matched) clauses.push(matched);
  }
  if (filters.type?.length) clauses.push(inArray(idx.type, filters.type));
  if (filters.race?.length) clauses.push(inArray(idx.race, filters.race));
  if (filters.attribute?.length) clauses.push(inArray(idx.attribute, filters.attribute));
  if (filters.frameType?.length) clauses.push(inArray(idx.frameType, filters.frameType));
  if (filters.archetype) clauses.push(eq(idx.archetype, filters.archetype));
  if (filters.language) clauses.push(eq(idx.language, filters.language));
  if (filters.rarity) clauses.push(eq(idx.rarity, filters.rarity));
  if (filters.favoritesOnly) clauses.push(eq(ownedCards.isFavorite, true));
  if (filters.unresolvedOnly) clauses.push(isNull(idx.passcode));

  if (filters.kind === "spell") clauses.push(eq(idx.type, "Spell Card"));
  else if (filters.kind === "trap") clauses.push(eq(idx.type, "Trap Card"));
  else if (filters.kind === "monster") {
    clauses.push(
      sql`${idx.passcode} is not null and ${idx.type} not in ('Spell Card', 'Trap Card')`,
    );
  }

  /**
   * Une liste de nombres, débarrassée de ce qui n'en est pas.
   *
   * Le résultat peut être **vide** — `?level=abc` — et c'est ce cas qui
   * comptait : le gabarit écrivait alors `in ()`, que PostgreSQL refuse, et la
   * requête entière partait en 500 avec une trace. Une valeur de filtre
   * illisible est une demande à laquelle rien ne correspond, pas une panne du
   * serveur ; on rend donc une clause toujours fausse, comme le fait déjà
   * `inArray` pour les marqueurs de Lien.
   */
  const numbers = (values: string[]) => values.map(Number).filter(Number.isFinite);
  const anyOf = (column: PrintIndex["level"], values: number[]) =>
    values.length > 0 ? sql`${column} in ${values}` : sql`false`;

  if (filters.levels?.length) {
    // Le niveau, à l'exclusion des Xyz : eux ont un rang.
    clauses.push(
      sql`${anyOf(idx.level, numbers(filters.levels))} and ${idx.type} not like '%XYZ%'`,
    );
  }
  if (filters.ranks?.length) {
    clauses.push(sql`${anyOf(idx.level, numbers(filters.ranks))} and ${idx.type} like '%XYZ%'`);
  }
  if (filters.links?.length) {
    clauses.push(inArray(idx.linkValue, numbers(filters.links)));
  }
  if (filters.atk?.min !== undefined) clauses.push(sql`${idx.atk} >= ${filters.atk.min}`);
  if (filters.atk?.max !== undefined) clauses.push(sql`${idx.atk} <= ${filters.atk.max}`);

  return clauses;
}

const ordering = (
  idx: PrintIndex,
  sort: CollectionFilters["sort"],
  direction: CollectionFilters["sortDir"],
) => {
  // Chaque critère a un sens naturel : le plus récent d'abord, mais le nom de A
  // à Z. `sortDir` renverse ce que l'on a choisi, il ne le redéfinit pas.
  const natural = sort === "name" || sort === "setCode" ? "asc" : "desc";
  const wanted = direction ?? natural;
  const order = wanted === "asc" ? asc : desc;

  switch (sort) {
    case "name":
      return order(idx.name);
    case "quantity":
      return order(ownedCards.quantity);
    case "setCode":
      return order(ownedCards.setCode);
    default:
      return order(ownedCards.updatedAt);
  }
};

/**
 * La requête de base, dont `IndexRow` tire sa forme.
 *
 * Les colonnes de la vue sont nommées une par une : Drizzle refuse qu'on
 * sélectionne une sous-requête entière comme un objet imbriqué. C'est un peu
 * verbeux, et ça a l'avantage de rendre visible ce que `collection` consomme
 * réellement du référentiel.
 */
function rowsQuery(db: Database, idx: PrintIndex) {
  return db
    .select({
      owned: ownedCards,
      printId: idx.printId,
      printSetCode: idx.setCode,
      setName: idx.setName,
      rarity: idx.rarity,
      language: idx.language,
      resolveStatus: idx.resolveStatus,
      passcode: idx.passcode,
      name: idx.name,
      nameFr: idx.nameFr,
      descEn: idx.descEn,
      descFr: idx.descFr,
      type: idx.type,
      frameType: idx.frameType,
      race: idx.race,
      attribute: idx.attribute,
      atk: idx.atk,
      def: idx.def,
      level: idx.level,
      scale: idx.scale,
      linkValue: idx.linkValue,
      linkMarkers: idx.linkMarkers,
      archetype: idx.archetype,
      banlistTcg: idx.banlistTcg,
      imageUrl: idx.imageUrl,
      imageUrlSmall: idx.imageUrlSmall,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId));
}

export async function listCollection(
  db: Database,
  userId: string,
  filters: CollectionFilters = {},
): Promise<{ items: CollectionItem[]; total: number }> {
  const idx = printIndex(db);
  const clauses = buildFilters(userId, filters, idx);
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await rowsQuery(db, idx)
    .where(and(...clauses))
    .orderBy(ordering(idx, filters.sort, filters.sortDir))
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(...clauses));

  return { items: rows.map(toItem), total: counted?.total ?? 0 };
}

/**
 * Ajoute ou retire des exemplaires d'un set code.
 *
 * **Aucun appel réseau ici.** Le joueur vient de scanner sa carte et attend son
 * « +1 » : la ligne est écrite tout de suite, sur une impression provisoire si
 * le code est inconnu, et la résolution part en tâche de fond — mais seulement
 * **après** la validation de la transaction, sinon la résolution course une
 * écriture qui n'est pas encore visible.
 */
export async function adjustQuantity(
  db: Database,
  userId: string,
  input: {
    setCode: string;
    delta: number;
    language?: string | null;
    passcode?: number | null;
  },
): Promise<CollectionItem> {
  const setCode = normalizeSetCode(input.setCode);
  if (!setCode) throw invalidInput("Set code vide.");
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw invalidInput("La variation doit être un entier non nul.");
  }

  const print = await ensurePlaceholderPrint(db, setCode, {
    language: input.language ?? null,
    passcode: input.passcode ?? null,
  });

  const needsResolution = print.resolveStatus !== "resolved";

  /**
   * Une seule écriture, pas un lire-puis-écrire.
   *
   * La version précédente lisait la ligne puis la mettait à jour, sans verrou.
   * Deux « +1 » simultanés — un double appui, ou le « +1 » du scanner pressé
   * deux fois — lisaient la même quantité et écrivaient la même somme : un
   * incrément perdu. Sur une ligne inexistante, les deux insertions se
   * couraient dessus et l'une mourait sur l'index unique, en 500.
   *
   * PostgreSQL fait désormais l'addition lui-même. Les bornes sont vérifiées
   * **après** l'écriture, à l'intérieur de la transaction : dépasser les fait
   * annuler, et l'utilisateur reçoit un message qui dit ce qui n'allait pas
   * plutôt qu'une quantité rabotée en silence.
   */
  const item = await db.transaction(async (tx) => {
    const [written] = await tx
      .insert(ownedCards)
      .values({ userId, printId: print.id, setCode, quantity: input.delta })
      .onConflictDoUpdate({
        target: [ownedCards.userId, ownedCards.printId],
        set: {
          quantity: sql`${ownedCards.quantity} + ${input.delta}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!written) throw invalidInput("L'ajustement n'a rien écrit.");
    if (written.quantity < 0) {
      throw invalidInput("On ne peut pas posséder moins de zéro exemplaire.");
    }
    if (written.quantity > LIMITS.quantity.max) {
      throw invalidInput(`Au plus ${LIMITS.quantity.max} exemplaires d'une même édition.`);
    }
    return written;
  });

  if (needsResolution) enqueueResolve(userId, setCode);

  const idx = printIndex(db);
  const [row] = await rowsQuery(db, idx).where(eq(ownedCards.id, item.id)).limit(1);
  if (!row) throw notFound("Ligne de collection introuvable après écriture.");
  return toItem(row);
}

/**
 * La note libre d'une ligne.
 *
 * ATEM-old la proposait au bas de la fiche : l'état de l'exemplaire, sa
 * provenance, ce qu'on en a payé. Elle voyage aussi dans l'export CSV, où elle
 * occupe la colonne `notes`.
 */
export async function setNotes(
  db: Database,
  userId: string,
  ownedId: number,
  notes: string | null,
): Promise<void> {
  const result = await db
    .update(ownedCards)
    .set({ notes: notes?.trim() || null, updatedAt: new Date() })
    .where(and(eq(ownedCards.id, ownedId), eq(ownedCards.userId, userId)))
    .returning({ id: ownedCards.id });

  if (result.length === 0) throw notFound("Ligne de collection introuvable.");
}

export async function setFavorite(
  db: Database,
  userId: string,
  ownedId: number,
  isFavorite: boolean,
): Promise<void> {
  const result = await db
    .update(ownedCards)
    .set({ isFavorite, updatedAt: new Date() })
    .where(and(eq(ownedCards.id, ownedId), eq(ownedCards.userId, userId)))
    .returning({ id: ownedCards.id });

  // Le filtre sur `userId` est **dans** la requête, pas après : une ligne qui
  // n'appartient pas à l'appelant est introuvable, et non interdite. Un 403
  // révélerait qu'elle existe.
  if (result.length === 0) throw notFound("Ligne de collection introuvable.");
}

/** Combien de lignes attendent encore d'être identifiées. */
export async function resolveStatus(
  db: Database,
  userId: string,
): Promise<{ pending: number; unidentified: number }> {
  const idx = printIndex(db);
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${idx.resolveStatus} = 'pending')::int`,
      unidentified: sql<number>`count(*) filter (where ${idx.resolveStatus} = 'unidentified')::int`,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(eq(ownedCards.userId, userId), gt(ownedCards.quantity, 0)));

  return { pending: row?.pending ?? 0, unidentified: row?.unidentified ?? 0 };
}

/**
 * Remet en file tout ce qui attendait encore, au démarrage.
 *
 * Une ligne entre en collection immédiatement, en `pending`, et la file
 * l'identifie ensuite. Si le processus s'arrête entre les deux — un
 * redéploiement, un `docker compose down`, une coupure — la file meurt avec
 * lui : elle ne vit qu'en mémoire. **Rien ne reprenait ce travail**, et la
 * ligne restait « en attente d'identification » pour toujours, sans que rien
 * ne le signale. Le commentaire de `resolve-queue.ts` promettait pourtant
 * qu'elle serait « reprise au démarrage suivant ».
 *
 * Les codes déjà déclarés `unidentified` sont laissés où ils sont : on sait
 * qu'ils n'existent pas, et les redemander à chaque démarrage saturerait pour
 * rien l'API qu'on prend soin de ménager.
 */
export async function requeuePendingResolves(db: Database): Promise<number> {
  const idx = printIndex(db);
  const rows = await db
    .selectDistinct({ userId: ownedCards.userId, setCode: ownedCards.setCode })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(
      and(
        gt(ownedCards.quantity, 0),
        eq(idx.resolveStatus, "pending"),
      ),
    );

  for (const row of rows) enqueueResolve(row.userId, row.setCode);
  return rows.length;
}

/**
 * Reprend une impression restée provisoire, et raccroche à la vraie édition les
 * lignes qui pointaient vers elle.
 *
 * **Tout tient dans une transaction.** ATEM-old avait vécu la panne : entre la
 * suppression de la ligne provisoire et l'écriture de la ligne consolidée, une
 * interruption perdait des exemplaires. Ce n'est pas un cas rare — c'est le
 * chemin normal de chaque carte scannée : « sur un import de huit cents cartes,
 * la fenêtre s'ouvre huit cents fois ».
 */
export async function reresolve(
  db: Database,
  userId: string,
  rawSetCode: string,
): Promise<boolean> {
  const setCode = normalizeSetCode(rawSetCode);
  const resolved = await resolvePrintBySetCode(db, setCode);
  if (!resolved || resolved.cardPasscode === null) return false;

  const pendingPrintIds = printIndex(db);

  await db.transaction(async (tx) => {
    /**
     * Les lignes à consolider sont celles du même set code **encore en
     * attente**, et pas seulement celles qui pointent une autre impression.
     *
     * Sans cette restriction, un joueur possédant déjà `LOB-EN001` en Ultra
     * Rare voyait sa ligne Secret Rare, scannée ensuite, fondue dans la
     * première : l'exemplaire n'était pas perdu, son édition si. Or l'unité de
     * l'inventaire est bien `(set_code, rareté, langue)` — consolider par-dessus
     * la rareté contredit la raison d'être du module.
     *
     * On ne fusionne donc que ce qui n'a pas encore d'identité : les lignes
     * provisoires.
     */
    const pendingPrints = tx
      .select({ id: pendingPrintIds.printId })
      .from(pendingPrintIds)
      .where(eq(pendingPrintIds.resolveStatus, "pending"));

    const lines = await tx
      .select()
      .from(ownedCards)
      .where(
        and(
          eq(ownedCards.userId, userId),
          eq(ownedCards.setCode, setCode),
          sql`${ownedCards.printId} <> ${resolved.id}`,
          inArray(ownedCards.printId, pendingPrints),
        ),
      );
    if (lines.length === 0) return;

    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    const favorite = lines.some((line) => line.isFavorite);

    await tx.delete(ownedCards).where(inArray(ownedCards.id, lines.map((line) => line.id)));

    const [existing] = await tx
      .select()
      .from(ownedCards)
      .where(and(eq(ownedCards.userId, userId), eq(ownedCards.printId, resolved.id)))
      .limit(1);

    if (existing) {
      await tx
        .update(ownedCards)
        .set({
          quantity: Math.min(existing.quantity + total, LIMITS.quantity.max),
          isFavorite: existing.isFavorite || favorite,
          updatedAt: new Date(),
        })
        .where(eq(ownedCards.id, existing.id));
    } else {
      await tx.insert(ownedCards).values({
        userId,
        printId: resolved.id,
        setCode,
        quantity: Math.min(total, LIMITS.quantity.max),
        isFavorite: favorite,
      });
    }
  });

  return true;
}

/**
 * Les valeurs réellement présentes dans la collection, pour peupler les filtres.
 *
 * On ne propose que ce que le joueur possède : offrir « Dragon » à quelqu'un
 * qui n'en a aucun ne produit qu'un écran vide.
 *
 * `race` est séparé en deux listes, parce que l'API en fait un seul champ pour
 * deux notions : le type d'un monstre (Dragon, Guerrier) et la propriété d'une
 * Magie ou d'un Piège (Continue, Équipement). Un Piège « Normal » n'est pas un
 * monstre Normal — les mélanger produirait un filtre qui ne veut rien dire.
 */
export async function collectionFacets(db: Database, userId: string) {
  const idx = printIndex(db);
  const rows = await db
    .selectDistinct({
      type: idx.type,
      frameType: idx.frameType,
      race: idx.race,
      attribute: idx.attribute,
      rarity: idx.rarity,
      language: idx.language,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(eq(ownedCards.userId, userId), gt(ownedCards.quantity, 0)));

  const collect = (pick: (row: (typeof rows)[number]) => string | null) =>
    [...new Set(rows.map(pick).filter((value): value is string => Boolean(value)))].sort();

  const isSpellTrap = (type: string | null) =>
    type === "Spell Card" || type === "Trap Card";

  return {
    types: collect((row) => row.type),
    frameTypes: collect((row) => row.frameType),
    races: collect((row) => (isSpellTrap(row.type) ? null : row.race)),
    properties: collect((row) => (isSpellTrap(row.type) ? row.race : null)),
    attributes: collect((row) => row.attribute),
    rarities: collect((row) => row.rarity),
    languages: collect((row) => row.language),
  };
}
