/**
 * Le module deck — ce que le joueur veut jouer.
 *
 * Il ne touche ni aux tables du catalogue, ni à celles de la collection : il
 * demande à `referential` ce qu'est une carte, et à `collection` combien on en
 * possède. C'est la frontière qu'ATEM-old n'avait pas — trois modules y
 * écrivaient dans le catalogue, chacun avec sa logique.
 *
 * **Deux identités, comme partout (ADR-009)** : `ownerId` pour lire, `viewerId`
 * pour écrire. Une lecture est ouverte à toute session ; une écriture n'est
 * jamais faite au nom d'autrui.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  checkDeckAdd, DECK_MAX_COPIES, DECK_ZONE_LIMITS, isExtraDeckCard, missingCopies,
  type DeckBlockReason, type DeckZone,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { ownedByPasscode } from "../collection/index.js";
import { cardsByPasscode } from "../referential/index.js";
import { deckCards, decks, type DeckRow } from "./schema.js";

export type DeckSummary = {
  id: string;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  /** Exemplaires par zone — ce que la liste montre sans ouvrir le deck. */
  counts: { main: number; extra: number; side: number };
  /**
   * Combien d'exemplaires manquent pour que le deck soit jouable.
   *
   * Zéro presque toujours : un deck est borné par la collection au moment où on
   * le construit. Il ne dérive que si l'on vend une carte ensuite.
   */
  missing: number;
};

export type DeckCardEntry = {
  passcode: number;
  name: string;
  type: string | null;
  frameType: string | null;
  banlistTcg: string | null;
  imageUrlSmall: string | null;
  main: number;
  extra: number;
  side: number;
  owned: number;
  /** Ce qui manque pour cette carte-là, et rien si rien ne manque. */
  missing: number;
};

export type DeckDetail = DeckSummary & { cards: DeckCardEntry[] };

const toSummary = (row: DeckRow, counts: DeckSummary["counts"], missing: number): DeckSummary => ({
  id: row.id,
  name: row.name,
  notes: row.notes,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  counts,
  missing,
});

/** Le deck et ses lignes, sans rien du catalogue ni de la collection. */
async function loadDeck(db: Database, ownerId: string, deckId: string) {
  requireUuid(deckId);
  const [row] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, ownerId)))
    .limit(1);
  // Le filtre est **dans** la requête : le deck d'un inconnu est introuvable, et
  // non interdit. Un 403 dirait qu'il existe.
  if (!row) throw notFound("Deck introuvable.");

  const lignes = await db.select().from(deckCards).where(eq(deckCards.deckId, deckId));
  return { row, lignes };
}

/**
 * Les decks d'une personne, du plus récemment touché au plus ancien.
 *
 * Le manque est calculé ici aussi : c'est la seule chose qu'on cherche du
 * regard en parcourant la liste — lesquels sont prêts à emporter.
 */
export async function listDecks(db: Database, ownerId: string): Promise<DeckSummary[]> {
  const rows = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, ownerId))
    .orderBy(desc(decks.updatedAt));
  if (rows.length === 0) return [];

  const lignes = await db
    .select()
    .from(deckCards)
    .where(inArray(deckCards.deckId, rows.map((row) => row.id)));

  const possédés = await ownedByPasscode(db, ownerId, [
    ...new Set(lignes.map((ligne) => ligne.passcode)),
  ]);

  return rows.map((row) => {
    const siennes = lignes.filter((ligne) => ligne.deckId === row.id);
    const counts = { main: 0, extra: 0, side: 0 };
    let missing = 0;
    for (const ligne of siennes) {
      counts.main += ligne.mainQty;
      counts.extra += ligne.extraQty;
      counts.side += ligne.sideQty;
      missing += missingCopies(
        ligne.mainQty + ligne.extraQty + ligne.sideQty,
        possédés.get(ligne.passcode) ?? 0,
      );
    }
    return toSummary(row, counts, missing);
  });
}

export async function getDeck(
  db: Database,
  ownerId: string,
  deckId: string,
): Promise<DeckDetail> {
  const { row, lignes } = await loadDeck(db, ownerId, deckId);

  const passcodes = [...new Set(lignes.map((ligne) => ligne.passcode))];
  const [possédés, fiches] = await Promise.all([
    ownedByPasscode(db, ownerId, passcodes),
    cardsByPasscode(db, passcodes),
  ]);
  const parPasscode = fiches;

  const counts = { main: 0, extra: 0, side: 0 };
  let missing = 0;
  const entries: DeckCardEntry[] = [];

  for (const ligne of lignes) {
    const fiche = parPasscode.get(ligne.passcode);
    const owned = possédés.get(ligne.passcode) ?? 0;
    const total = ligne.mainQty + ligne.extraQty + ligne.sideQty;
    const manque = missingCopies(total, owned);

    counts.main += ligne.mainQty;
    counts.extra += ligne.extraQty;
    counts.side += ligne.sideQty;
    missing += manque;

    entries.push({
      passcode: ligne.passcode,
      // Le nom imprimé suit la carte, pas l'interface : c'est la règle du
      // référentiel, et un deck se relit comme on l'a construit.
      name: fiche?.nameFr ?? fiche?.nameEn ?? String(ligne.passcode),
      type: fiche?.type ?? null,
      frameType: fiche?.frameType ?? null,
      banlistTcg: fiche?.banlistTcg ?? null,
      imageUrlSmall: fiche?.imageUrlSmall ?? null,
      main: ligne.mainQty,
      extra: ligne.extraQty,
      side: ligne.sideQty,
      owned,
      missing: manque,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { ...toSummary(row, counts, missing), cards: entries };
}

export async function createDeck(
  db: Database,
  viewerId: string,
  name: string,
): Promise<DeckSummary> {
  const propre = name.trim();
  if (!propre) throw invalidInput("Donnez un nom au deck.");

  try {
    const [row] = await db.insert(decks).values({ userId: viewerId, name: propre }).returning();
    if (!row) throw new Error("insertion sans résultat");
    return toSummary(row, { main: 0, extra: 0, side: 0 }, 0);
  } catch (err) {
    /**
     * Le nom de la contrainte vit dans la **cause**, pas dans le message.
     *
     * Drizzle enveloppe l'erreur du pilote : son `message` porte la requête qui
     * a échoué, jamais le nom de l'index. Chercher dedans ne trouvait rien, et
     * le conflit ressortait en erreur interne — un 500 pour un nom déjà pris.
     *
     * Deux decks du même nom sont impossibles à distinguer dans une liste, et
     * la confirmation de suppression se tape au nom.
     */
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    if (cause?.constraint_name === "decks_user_name_uidx") {
      throw conflict("Vous avez déjà un deck de ce nom.");
    }
    throw err;
  }
}

export async function renameDeck(
  db: Database,
  viewerId: string,
  deckId: string,
  input: { name?: string; notes?: string | null },
): Promise<void> {
  const valeurs: { name?: string; notes?: string | null; updatedAt: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const propre = input.name.trim();
    if (!propre) throw invalidInput("Donnez un nom au deck.");
    valeurs.name = propre;
  }
  if (input.notes !== undefined) valeurs.notes = input.notes?.trim() || null;

  requireUuid(deckId);
  const touchés = await db
    .update(decks)
    .set(valeurs)
    .where(and(eq(decks.id, deckId), eq(decks.userId, viewerId)))
    .returning({ id: decks.id });
  if (touchés.length === 0) throw notFound("Deck introuvable.");
}

export async function deleteDeck(db: Database, viewerId: string, deckId: string): Promise<void> {
  requireUuid(deckId);
  const effacés = await db
    .delete(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, viewerId)))
    .returning({ id: decks.id });
  if (effacés.length === 0) throw notFound("Deck introuvable.");
}

/**
 * Pose la quantité d'une carte dans une zone.
 *
 * **Tout se décide ici, et une seule fois.** ATEM-old avait le bon calcul —
 * `checkDeckAdd` — et ne l'appelait jamais côté serveur : c'était un utilitaire
 * d'affichage. L'écran grisait un bouton, rien n'empêchait la requête.
 *
 * Trois bornes se superposent, et la plus basse décide : la règle du jeu (trois
 * par deck, garantie en base par une contrainte), la banlist (qui bouge avec le
 * catalogue, donc ici), et la collection — décision d'Ange : on ne met pas dans
 * un deck une carte qu'on n'a pas.
 */
export async function setDeckCard(
  db: Database,
  viewerId: string,
  deckId: string,
  input: { passcode: number; zone: DeckZone; quantity: number },
): Promise<DeckDetail> {
  const quantity = Math.trunc(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > DECK_MAX_COPIES) {
    // Écrit en toutes lettres : une phrase construite n'a pas de clé de
    // traduction, et le contrôle ne la verrait pas.
    throw invalidInput("Une zone ne porte pas plus de 3 exemplaires.");
  }

  const { lignes } = await loadDeck(db, viewerId, deckId);

  const fiche = (await cardsByPasscode(db, [input.passcode])).get(input.passcode);
  if (!fiche) throw notFound("Carte inconnue.");

  /**
   * L'Extra Deck n'accepte que ce qui lui revient, et réciproquement.
   *
   * Une Fusion dans le Main Deck est une main morte ; un monstre à effet dans
   * l'Extra est simplement illégal. Le refus est plus utile que le silence.
   */
  const extra = isExtraDeckCard({ type: fiche.type, frameType: fiche.frameType });
  if (input.zone === "extra" && !extra) {
    throw invalidInput("Cette carte ne va pas à l'Extra Deck.");
  }
  if (input.zone === "main" && extra) {
    throw invalidInput("Cette carte va à l'Extra Deck, pas au Main Deck.");
  }

  const existante = lignes.find((ligne) => ligne.passcode === input.passcode);
  const autresZones =
    (existante ? existante.mainQty + existante.extraQty + existante.sideQty : 0) -
    (existante ? existante[`${input.zone}Qty`] : 0);

  if (quantity > 0) {
    const possédés = await ownedByPasscode(db, viewerId, [input.passcode]);
    const issue = checkDeckAdd({
      banlistTcg: fiche.banlistTcg,
      owned: possédés.get(input.passcode) ?? 0,
      // Ce qui est déjà là **hors de la zone qu'on écrit** : on remplace cette
      // zone, on ne s'ajoute pas à elle.
      inDeck: autresZones,
      wanted: quantity,
    });

    if (issue.blockedBy) {
      throw invalidInput(REFUS_LABELS[issue.blockedBy], {
        reason: issue.blockedBy,
        remainingLegal: issue.remainingLegal,
        owned: issue.hardCap,
      });
    }
  }

  /**
   * La zone ne déborde pas.
   *
   * Une soixante-et-unième carte au Main n'est légale dans aucune situation ;
   * un deck à douze cartes, en revanche, est un deck en cours. On refuse donc
   * le maximum et on laisse le minimum se dire ailleurs.
   */
  const totalZone =
    lignes.reduce((somme, ligne) => somme + ligne[`${input.zone}Qty`], 0) -
    (existante?.[`${input.zone}Qty`] ?? 0) +
    quantity;
  if (totalZone > DECK_ZONE_LIMITS[input.zone].max) {
    throw invalidInput(ZONE_PLEINE_LABELS[input.zone]);
  }

  const zones = {
    mainQty: input.zone === "main" ? quantity : (existante?.mainQty ?? 0),
    extraQty: input.zone === "extra" ? quantity : (existante?.extraQty ?? 0),
    sideQty: input.zone === "side" ? quantity : (existante?.sideQty ?? 0),
  };

  await db.transaction(async (tx) => {
    if (zones.mainQty + zones.extraQty + zones.sideQty === 0) {
      // Une carte à zéro partout n'est pas dans le deck : on ne garde pas une
      // ligne vide qui ferait nombre dans les décomptes.
      await tx
        .delete(deckCards)
        .where(and(eq(deckCards.deckId, deckId), eq(deckCards.passcode, input.passcode)));
    } else {
      await tx
        .insert(deckCards)
        .values({ deckId, passcode: input.passcode, ...zones })
        .onConflictDoUpdate({
          target: [deckCards.deckId, deckCards.passcode],
          set: zones,
        });
    }
    await tx.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, deckId));
  });

  return getDeck(db, viewerId, deckId);
}

/**
 * Ce qu'on dit quand on refuse — la raison, pas « invalide ».
 *
 * Un refus qui n'explique pas envoie chercher la panne dans l'application. Ici
 * chacune des quatre bornes a sa phrase, et `details.reason` la rend lisible par
 * l'écran, qui grise le bouton avec la même information.
 *
 * Le suffixe `_LABELS` n'est pas décoratif : c'est ce à quoi
 * `check-translations.mjs` reconnaît une table de libellés affichés. Sans lui,
 * ces phrases seraient parties au front sans traduction, invisibles au
 * contrôle — elles ne passent pas par `invalidInput("…")` mais par une clé.
 *
 * Quatre entrées, quatre raisons atteignables. Il y en avait une cinquième —
 * « ok » — que le type exigeait et qu'aucun chemin n'atteignait : la faire
 * disparaître demandait de poser au contrôle la vraie question du premier
 * coup, ce que `wanted` permet.
 */
const REFUS_LABELS: Record<DeckBlockReason, string> = {
  forbidden: "Cette carte est interdite par la banlist.",
  banlist: "La banlist n'en autorise pas autant.",
  not_owned: "Vous ne possédez pas assez d'exemplaires de cette carte.",
  max_copies: "Un deck ne porte pas plus de 3 exemplaires d'une carte.",
};

/** Une zone pleine se dit par son nom : « le Main Deck » parle, « main » non. */
const ZONE_PLEINE_LABELS: Record<DeckZone, string> = {
  main: "Le Main Deck est plein — 60 cartes au maximum.",
  extra: "L'Extra Deck est plein — 15 cartes au maximum.",
  side: "Le Side Deck est plein — 15 cartes au maximum.",
};
