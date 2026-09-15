/**
 * The deck module — what the player wants to play.
 *
 * It touches neither the catalogue tables nor the collection's: it asks
 * `referential` what a card is, and `collection` how many are owned. That is
 * the boundary ATEM-old did not have — three of its modules wrote into the
 * catalogue, each with its own logic.
 *
 * **Two identities, as everywhere (ADR-009)**: `ownerId` to read, `viewerId` to
 * write. A read is open to any session; a write is never made on someone else's
 * behalf.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  checkDeckAdd, DECK_MAX_COPIES, DECK_ZONE_LIMITS, isExtraDeckCard, missingCopies,
  type DeckBlockReason, type DeckZone,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, forbidden, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { ownedByPasscode } from "../collection/index.js";
import { cardsByPasscode } from "../referential/index.js";
import { assertFolderOwned } from "./folders.js";
import { deckCards, decks, type DeckRow } from "./schema.js";

export type DeckSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Copies per zone — what the list shows without opening the deck. */
  counts: { main: number; extra: number; side: number };
  /**
   * How many copies are missing for the deck to be playable.
   *
   * Zero almost always: a deck is bounded by the collection at the moment it is
   * built. It only drifts if a card is sold afterwards.
   */
  missing: number;
  /**
   * The artwork that stands for the deck, or nothing.
   *
   * A cover chosen by hand would ask for a column, a picker, and a fix-up when
   * that card leaves the deck. This one is deduced: it is the card the deck
   * holds **the most copies of in the Main** — its identity, in practice —
   * tie-broken by passcode so the artwork does not change from one refresh to
   * the next.
   *
   * We return **the image address and nothing else**: that card's name and
   * passcode travelled with the answer without anything reading them. A deck
   * whose leading card has no artwork falls back to `null` here, like an empty
   * deck — the screen shows the card back in both cases, so it has no reason to
   * tell them apart.
   */
  coverImage: string | null;
  /** The folder that files it, or `null` at the root. */
  folderId: string | null;
};

/**
 * A card of a deck, as the workshop displays it.
 *
 * `type` and `frameType` used to be part of it without anything reading them:
 * the question “is this an Extra Deck card?” is asked when **adding**, on the
 * card sheet coming from the collection, and the server settles it on its own
 * side. Sending them for every row of every deck only served to send them.
 */
export type DeckCardEntry = {
  passcode: number;
  name: string;
  banlistTcg: string | null;
  imageUrlSmall: string | null;
  main: number;
  extra: number;
  side: number;
  owned: number;
  /** What is missing for that card, and nothing when nothing is. */
  missing: number;
};

export type DeckDetail = DeckSummary & { cards: DeckCardEntry[] };

const toSummary = (
  row: DeckRow,
  counts: DeckSummary["counts"],
  missing: number,
  coverImage: string | null = null,
): DeckSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  counts,
  missing,
  coverImage,
  folderId: row.folderId,
});

/**
 * The card that stands for a deck.
 *
 * The Main first, because that is what gets played; the Extra and the Side
 * next, so that a deck under construction is not left faceless. The passcode
 * breaks ties: without it, two cards at three copies would give a different
 * cover on every request, row order not being guaranteed.
 */
function coverPasscode(rows: { passcode: number; mainQty: number; extraQty: number; sideQty: number }[]): number | null {
  let best: { passcode: number; main: number; total: number } | null = null;
  for (const row of rows) {
    const total = row.mainQty + row.extraQty + row.sideQty;
    if (total === 0) continue;
    const candidate = { passcode: row.passcode, main: row.mainQty, total };
    if (
      best === null ||
      candidate.main > best.main ||
      (candidate.main === best.main && candidate.total > best.total) ||
      (candidate.main === best.main &&
        candidate.total === best.total &&
        candidate.passcode < best.passcode)
    ) {
      best = candidate;
    }
  }
  return best?.passcode ?? null;
}

/** The deck and its rows, with nothing from the catalogue or the collection. */
async function loadDeck(db: Database, ownerId: string, deckId: string) {
  requireUuid(deckId);
  const [row] = await db
    .select()
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, ownerId)))
    .limit(1);
  // The filter is **in** the query: a stranger's deck is not found, rather than
  // forbidden. A 403 would say it exists.
  if (!row) throw notFound("Deck not found.");

  const rows = await db.select().from(deckCards).where(eq(deckCards.deckId, deckId));
  return { row, rows };
}

/**
 * Loads a deck **to write on it**, and tells the two refusals apart.
 *
 * Not found and forbidden are not the same answer. A read can afford to blur
 * them — answering “not found” for a stranger's deck avoids confirming that it
 * exists. A **write** cannot: the day we look at another player's deck, it is
 * in front of us, and answering “not found” when trying to modify it would be a
 * lie nothing explains.
 *
 * Asked by Ange: “even if someone forces the route to modify it, in the end
 * they get a 403”. The guarantee lives **here**, in the service, and not in the
 * screen that hides the pencil: a screen guards nothing.
 */
async function deckForWrite(db: Database, viewerId: string, deckId: string) {
  requireUuid(deckId);
  const [row] = await db.select().from(decks).where(eq(decks.id, deckId)).limit(1);
  if (!row) throw notFound("Deck not found.");
  if (row.userId !== viewerId) throw forbidden("This deck is not yours.");
  return row;
}

/**
 * One person's decks, from the most recently touched to the oldest.
 *
 * The shortfall is computed here too: it is the one thing the eye looks for
 * when scanning the list — which ones are ready to take along.
 */
export async function listDecks(db: Database, ownerId: string): Promise<DeckSummary[]> {
  const deckRows = await db
    .select()
    .from(decks)
    .where(eq(decks.userId, ownerId))
    .orderBy(desc(decks.updatedAt));
  if (deckRows.length === 0) return [];

  const cardRows = await db
    .select()
    .from(deckCards)
    .where(inArray(deckCards.deckId, deckRows.map((row) => row.id)));

  const owned = await ownedByPasscode(db, ownerId, [
    ...new Set(cardRows.map((row) => row.passcode)),
  ]);

  /**
   * The covers in **one** query.
   *
   * One per deck would be twenty queries for twenty decks: that is the flaw the
   * collection list once had, and one we do not repeat.
   */
  const covers = new Map<string, number | null>(
    deckRows.map((row) => [row.id, coverPasscode(cardRows.filter((c) => c.deckId === row.id))]),
  );
  const cardsByCode = await cardsByPasscode(db, [
    ...new Set([...covers.values()].filter((pc): pc is number => pc !== null)),
  ]);

  return deckRows.map((deck) => {
    const its = cardRows.filter((card) => card.deckId === deck.id);
    const counts = { main: 0, extra: 0, side: 0 };
    let missing = 0;
    for (const card of its) {
      counts.main += card.mainQty;
      counts.extra += card.extraQty;
      counts.side += card.sideQty;
      missing += missingCopies(
        card.mainQty + card.extraQty + card.sideQty,
        owned.get(card.passcode) ?? 0,
      );
    }
    const pc = covers.get(deck.id) ?? null;
    return toSummary(
      deck,
      counts,
      missing,
      (pc === null ? null : cardsByCode.get(pc)?.imageUrlSmall) ?? null,
    );
  });
}

export async function getDeck(
  db: Database,
  ownerId: string,
  deckId: string,
): Promise<DeckDetail> {
  const { row: deck, rows: cardRows } = await loadDeck(db, ownerId, deckId);

  const passcodes = [...new Set(cardRows.map((card) => card.passcode))];
  const [ownedByCode, catalogue] = await Promise.all([
    ownedByPasscode(db, ownerId, passcodes),
    cardsByPasscode(db, passcodes),
  ]);

  const counts = { main: 0, extra: 0, side: 0 };
  let missing = 0;
  const entries: DeckCardEntry[] = [];

  for (const line of cardRows) {
    const card = catalogue.get(line.passcode);
    const owned = ownedByCode.get(line.passcode) ?? 0;
    const total = line.mainQty + line.extraQty + line.sideQty;
    const shortfall = missingCopies(total, owned);

    counts.main += line.mainQty;
    counts.extra += line.extraQty;
    counts.side += line.sideQty;
    missing += shortfall;

    entries.push({
      passcode: line.passcode,
      // The printed name follows the card, not the interface: that is the
      // referential's rule, and a deck reads back as it was built.
      name: card?.nameFr ?? card?.nameEn ?? String(line.passcode),
      banlistTcg: card?.banlistTcg ?? null,
      imageUrlSmall: card?.imageUrlSmall ?? null,
      main: line.mainQty,
      extra: line.extraQty,
      side: line.sideQty,
      owned,
      missing: shortfall,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const pc = coverPasscode(cardRows);
  const cover = (pc === null ? null : catalogue.get(pc)?.imageUrlSmall) ?? null;

  return { ...toSummary(deck, counts, missing, cover), cards: entries };
}

export async function createDeck(
  db: Database,
  viewerId: string,
  name: string,
  folderId: string | null = null,
): Promise<DeckSummary> {
  const clean = name.trim();
  if (!clean) throw invalidInput("Give the deck a name.");
  // Creating then moving would be two writes and a flicker: a deck is born
  // where you are looking.
  await assertFolderOwned(db, viewerId, folderId);

  try {
    const [row] = await db
      .insert(decks)
      .values({ userId: viewerId, name: clean, folderId })
      .returning();
    if (!row) throw new Error("insert returned nothing");
    return toSummary(row, { main: 0, extra: 0, side: 0 }, 0);
  } catch (err) {
    /**
     * The constraint's name lives in the **cause**, not in the message.
     *
     * Drizzle wraps the driver's error: its `message` carries the query that
     * failed, never the index name. Searching in it found nothing, and the
     * conflict surfaced as an internal error — a 500 for a name already taken.
     *
     * Two decks with the same name are impossible to tell apart in a list, and
     * the delete confirmation is typed by name.
     */
    const cause = (err as { cause?: { constraint_name?: string } }).cause;
    if (cause?.constraint_name === "decks_user_name_uidx") {
      throw conflict("You already have a deck with that name.");
    }
    throw err;
  }
}

/**
 * Renaming a deck, or filing it elsewhere.
 *
 * Both in the same gesture because the database writes them on the same row. It
 * was called `renameDeck` while it only touched the name; the folder made that
 * a lie.
 */
export async function updateDeck(
  db: Database,
  viewerId: string,
  deckId: string,
  input: { name?: string; folderId?: string | null },
): Promise<void> {
  const values: { name?: string; folderId?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) {
    const clean = input.name.trim();
    if (!clean) throw invalidInput("Give the deck a name.");
    values.name = clean;
  }
  if (input.folderId !== undefined) {
    // Without this check, one could file a deck into a stranger's folder by
    // guessing a UUID — and it would show up in that person's explorer.
    await assertFolderOwned(db, viewerId, input.folderId);
    values.folderId = input.folderId;
  }

  await deckForWrite(db, viewerId, deckId);
  await db.update(decks).set(values).where(eq(decks.id, deckId));
}

export async function deleteDeck(db: Database, viewerId: string, deckId: string): Promise<void> {
  await deckForWrite(db, viewerId, deckId);
  await db.delete(decks).where(eq(decks.id, deckId));
}

/**
 * Sets the quantity of a card in a zone.
 *
 * **Everything is decided here, once.** ATEM-old had the right computation —
 * `checkDeckAdd` — and never called it server-side: it was a display helper.
 * The screen greyed a button out, nothing stopped the request.
 *
 * Three bounds overlap, and the lowest decides: the rule of the game (three per
 * deck, guaranteed in the database by a constraint), the banlist (which moves
 * with the catalogue, hence here), and the collection — Ange's decision: you do
 * not put in a deck a card you do not have.
 */
export async function setDeckCard(
  db: Database,
  viewerId: string,
  deckId: string,
  input: { passcode: number; zone: DeckZone; quantity: number },
): Promise<DeckDetail> {
  const quantity = Math.trunc(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > DECK_MAX_COPIES) {
    // Spelled out in full: a sentence built at runtime has no translation key,
    // and the gate would not see it.
    throw invalidInput("A zone holds no more than 3 copies.");
  }

  await deckForWrite(db, viewerId, deckId);
  const rows = await db.select().from(deckCards).where(eq(deckCards.deckId, deckId));

  const card = (await cardsByPasscode(db, [input.passcode])).get(input.passcode);
  if (!card) throw notFound("Unknown card.");

  /**
   * The Extra Deck accepts only what belongs to it, and vice versa.
   *
   * A Fusion in the Main Deck is a dead hand; an Effect monster in the Extra is
   * simply illegal. A refusal is more useful than silence.
   */
  const extra = isExtraDeckCard({ type: card.type, frameType: card.frameType });
  if (input.zone === "extra" && !extra) {
    throw invalidInput("This card does not belong in the Extra Deck.");
  }
  if (input.zone === "main" && extra) {
    throw invalidInput("This card belongs in the Extra Deck, not the Main Deck.");
  }

  const existingRow = rows.find((row) => row.passcode === input.passcode);
  const otherZones =
    (existingRow ? existingRow.mainQty + existingRow.extraQty + existingRow.sideQty : 0) -
    (existingRow ? existingRow[`${input.zone}Qty`] : 0);

  if (quantity > 0) {
    const owned = await ownedByPasscode(db, viewerId, [input.passcode]);
    const issue = checkDeckAdd({
      banlistTcg: card.banlistTcg,
      owned: owned.get(input.passcode) ?? 0,
      // What is already there **outside the zone being written**: we replace
      // that zone, we do not add to it.
      inDeck: otherZones,
      wanted: quantity,
    });

    if (issue.blockedBy) {
      throw invalidInput(BLOCKED_LABELS[issue.blockedBy], {
        reason: issue.blockedBy,
        remainingLegal: issue.remainingLegal,
        owned: issue.hardCap,
      });
    }
  }

  /**
   * The zone does not overflow.
   *
   * A sixty-first card in the Main is legal in no situation; a twelve-card
   * deck, on the other hand, is a deck in progress. So we refuse the maximum
   * and let the minimum be said elsewhere.
   */
  const zoneTotal =
    rows.reduce((sum, row) => sum + row[`${input.zone}Qty`], 0) -
    (existingRow?.[`${input.zone}Qty`] ?? 0) +
    quantity;
  if (zoneTotal > DECK_ZONE_LIMITS[input.zone].max) {
    throw invalidInput(ZONE_FULL_LABELS[input.zone]);
  }

  const zones = {
    mainQty: input.zone === "main" ? quantity : (existingRow?.mainQty ?? 0),
    extraQty: input.zone === "extra" ? quantity : (existingRow?.extraQty ?? 0),
    sideQty: input.zone === "side" ? quantity : (existingRow?.sideQty ?? 0),
  };

  await db.transaction(async (tx) => {
    if (zones.mainQty + zones.extraQty + zones.sideQty === 0) {
      // A card at zero everywhere is not in the deck: we do not keep an empty
      // row that would count towards the totals.
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
 * What we say when we refuse — the reason, not “invalid”.
 *
 * A refusal that does not explain sends people hunting for a bug in the
 * application. Here each of the four bounds has its sentence, and
 * `details.reason` makes it readable by the screen, which greys the button out
 * with the same information.
 *
 * The `_LABELS` suffix is not decoration: it is how `check-translations.mjs`
 * recognises a table of displayed labels. Without it, these sentences would go
 * to the front untranslated, invisible to the gate — they do not go through
 * `invalidInput("…")` but through a key.
 *
 * Four entries, four reachable reasons. There was a fifth — “ok” — that the
 * type demanded and no path reached: making it disappear meant asking the check
 * the real question the first time, which `wanted` allows.
 */
const BLOCKED_LABELS: Record<DeckBlockReason, string> = {
  forbidden: "This card is forbidden by the banlist.",
  banlist: "The banlist does not allow that many.",
  not_owned: "You do not own enough copies of this card.",
  max_copies: "A deck may hold no more than 3 copies of a card.",
};

/** A full zone is named: “the Main Deck” speaks, “main” does not. */
const ZONE_FULL_LABELS: Record<DeckZone, string> = {
  main: "The Main Deck is full — 60 cards maximum.",
  extra: "The Extra Deck is full — 15 cards maximum.",
  side: "The Side Deck is full — 15 cards maximum.",
};
