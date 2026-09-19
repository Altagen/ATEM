/**
 * Duels — `docs/ref-duels.md` is the reference, rule by rule.
 *
 * ATEM records a duel played in person; it does not referee one. The row holds
 * **where the duel is** — turn, phase, life totals — because two people follow
 * one duel from two devices and each must find it as the other left it. It holds
 * no rule of the game: no legality, no effects, no timer.
 *
 * Every function takes the session's identity and refuses anything that is not
 * about the caller's own duels (ADR-009).
 */
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { DUEL_PHASES, LIFE_BOUNDS, LIMITS, nextPhase, STARTING_LIFE, type DuelPhase } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, forbidden, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { deckNameOf } from "../deck/index.js";
import { listProfiles, type Duellist } from "../identity/index.js";
import { notify, withdraw } from "../inbox/index.js";
import { friendStatusWith } from "../social/index.js";
import { duelEvents, duels } from "./schema.js";

export type DuelStatus = "proposed" | "accepted" | "playing" | "recorded";

/** One side of a duel, as the screens read it. */
export type DuelSide = {
  player: Duellist | null;
  deck: { id: string | null; name: string | null };
  life: number;
};

export type DuelEvent = {
  id: string;
  seq: number;
  kind: "start" | "phase" | "turn" | "life";
  turnNumber: number;
  phase: DuelPhase;
  authorId: string;
  playerId: string | null;
  delta: number | null;
  hostLife: number;
  guestLife: number;
  note: string | null;
  createdAt: Date;
};

export type Duel = {
  id: string;
  status: DuelStatus;
  playedOn: Date;
  host: DuelSide;
  guest: DuelSide;
  /** Where the duel is, once the coin has been flipped. */
  turnNumber: number | null;
  phase: DuelPhase | null;
  currentPlayerId: string | null;
  note: string | null;
  /** Who won. `null` until the duel is recorded. */
  winnerId: string | null;
  /** The caller invited: it is theirs to cancel rather than to answer. */
  isHost: boolean;
  createdAt: Date;
  recordedAt: Date | null;
};

export type DuelDetail = Duel & { events: DuelEvent[] };

const EVENT_NOTE_MAX = 280;

type DuelRow = typeof duels.$inferSelect;

function toDuel(row: DuelRow, viewerId: string, players: Map<string, Duellist>): Duel {
  return {
    id: row.id,
    status: row.status as DuelStatus,
    playedOn: row.playedOn,
    host: {
      player: players.get(row.hostId) ?? null,
      deck: { id: row.hostDeckId, name: row.hostDeckName },
      life: row.hostLife,
    },
    guest: {
      player: players.get(row.guestId) ?? null,
      deck: { id: row.guestDeckId, name: row.guestDeckName },
      life: row.guestLife,
    },
    turnNumber: row.turnNumber,
    phase: row.phase as DuelPhase | null,
    currentPlayerId: row.currentPlayerId,
    note: row.note,
    winnerId: row.winnerId,
    isHost: row.hostId === viewerId,
    createdAt: row.createdAt,
    recordedAt: row.recordedAt,
  };
}

async function playersOf(db: Database, rows: DuelRow[]): Promise<Map<string, Duellist>> {
  const ids = [...new Set(rows.flatMap((row) => [row.hostId, row.guestId]))];
  const profiles = await listProfiles(db, { ids });
  return new Map(profiles.map((profile) => [profile.id, profile]));
}

/** A duel of the caller's, or nothing — never someone else's. */
async function own(db: Database, viewerId: string, duelId: string): Promise<DuelRow> {
  const [row] = await db
    .select()
    .from(duels)
    .where(and(
      eq(duels.id, requireUuid(duelId)),
      or(eq(duels.hostId, viewerId), eq(duels.guestId, viewerId)),
    ))
    .limit(1);
  if (!row) throw notFound("Duel not found.");
  return row;
}

/** A duel being played, of the caller's. */
async function playing(db: Database, viewerId: string, duelId: string): Promise<DuelRow> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "recorded") throw conflict("A recorded duel stays.");
  if (row.status !== "playing") throw conflict("This duel has not started yet.");
  return row;
}

/**
 * The turn belongs to the one playing it.
 *
 * Ange, on 2026-09-19: nobody advances someone else's turn at the table, so no
 * screen may do it either. Life points are the other half of the same rule —
 * each declares their own — and both are refused here rather than merely hidden.
 */
function theirTurn(row: DuelRow, viewerId: string): void {
  if (row.currentPlayerId !== viewerId) {
    throw forbidden("Only the duellist playing this turn can move it on.");
  }
}

/**
 * Writes one event, numbered after the last.
 *
 * The number comes from the duel's own count rather than from a shared
 * sequence: two devices writing at the same instant collide on the unique
 * index, and the loser is told to read and try again — which is truer than
 * silently interleaving.
 */
async function writeEvent(
  db: Database,
  row: DuelRow,
  event: {
    kind: DuelEvent["kind"];
    authorId: string;
    turnNumber: number;
    phase: DuelPhase;
    playerId?: string | null;
    delta?: number | null;
    hostLife: number;
    guestLife: number;
    note?: string | null;
  },
): Promise<void> {
  const [last] = await db
    .select({ seq: duelEvents.seq })
    .from(duelEvents)
    .where(eq(duelEvents.duelId, row.id))
    .orderBy(desc(duelEvents.seq))
    .limit(1);

  await db.insert(duelEvents).values({
    duelId: row.id,
    seq: (last?.seq ?? 0) + 1,
    kind: event.kind,
    turnNumber: event.turnNumber,
    phase: event.phase,
    authorId: event.authorId,
    playerId: event.playerId ?? null,
    delta: event.delta ?? null,
    hostLife: event.hostLife,
    guestLife: event.guestLife,
    note: event.note ?? null,
  });
}

/**
 * The life points of one duellist, in one phase — **one event, not one per tap**.
 *
 * Taking 3000 means tapping −1000 three times, and three rows saying “−1000”
 * tell nobody anything; they only make the table grow. Ange, on 2026-09-19:
 * “le mieux serait de faire un événement de dommage à chaque phase”. So the taps
 * of a phase add up into that phase's event, and the history reads “turn 4,
 * Battle Phase, −3000”.
 *
 * A gain cancelling a loss within the same phase leaves **no** event: nothing
 * happened that phase, and a row saying “0” would be noise with a timestamp.
 */
async function recordLife(
  db: Database,
  row: DuelRow,
  event: { authorId: string; turnNumber: number; phase: DuelPhase; delta: number; note: string | null },
): Promise<void> {
  const [held] = await db
    .select()
    .from(duelEvents)
    .where(and(
      eq(duelEvents.duelId, row.id),
      eq(duelEvents.kind, "life"),
      eq(duelEvents.playerId, event.authorId),
      eq(duelEvents.turnNumber, event.turnNumber),
      eq(duelEvents.phase, event.phase),
    ))
    .limit(1);

  if (!held) {
    await writeEvent(db, row, {
      kind: "life",
      authorId: event.authorId,
      turnNumber: event.turnNumber,
      phase: event.phase,
      playerId: event.authorId,
      delta: event.delta,
      hostLife: row.hostLife,
      guestLife: row.guestLife,
      note: event.note,
    });
    return;
  }

  const total = (held.delta ?? 0) + event.delta;
  if (total === 0) {
    await db.delete(duelEvents).where(eq(duelEvents.id, held.id));
    return;
  }

  await db
    .update(duelEvents)
    .set({
      delta: total,
      hostLife: row.hostLife,
      guestLife: row.guestLife,
      // The latest word about the phase wins; silence does not erase the last one.
      note: event.note ?? held.note,
      authorId: event.authorId,
    })
    .where(eq(duelEvents.id, held.id));
}

async function listEvents(db: Database, duelId: string): Promise<DuelEvent[]> {
  const rows = await db
    .select()
    .from(duelEvents)
    .where(eq(duelEvents.duelId, duelId))
    .orderBy(asc(duelEvents.seq));
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    kind: row.kind as DuelEvent["kind"],
    turnNumber: row.turnNumber,
    phase: row.phase as DuelPhase,
    authorId: row.authorId,
    playerId: row.playerId,
    delta: row.delta,
    hostLife: row.hostLife,
    guestLife: row.guestLife,
    note: row.note,
    createdAt: row.createdAt,
  }));
}

const detailOf = async (db: Database, row: DuelRow, viewerId: string): Promise<DuelDetail> => ({
  ...toDuel(row, viewerId, await playersOf(db, [row])),
  events: await listEvents(db, row.id),
});

/**
 * The deck a player brings, checked to be theirs.
 *
 * Its name is copied into the duel so the history still reads once the deck is
 * gone; `deckNameOf` refuses a deck belonging to someone else, which is what
 * stops a duel from naming a deck its player never had.
 */
async function deckBrought(
  db: Database,
  ownerId: string,
  deckId: string | null | undefined,
): Promise<{ id: string | null; name: string | null }> {
  if (!deckId) return { id: null, name: null };
  const name = await deckNameOf(db, ownerId, requireUuid(deckId));
  if (name === null) throw notFound("Deck not found.");
  return { id: deckId, name };
}

/**
 * The duel a duellist is in the middle of, if any.
 *
 * Accepted or being played — an invitation is not one: it waits in the inbox
 * and costs nothing until it is answered (`docs/ref-duels.md`).
 */
async function duelUnderWay(db: Database, userId: string): Promise<DuelRow | null> {
  const [row] = await db
    .select()
    .from(duels)
    .where(and(
      inArray(duels.status, ["accepted", "playing"]),
      or(eq(duels.hostId, userId), eq(duels.guestId, userId)),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * Inviting a friend to a duel.
 *
 * Friends only, through `social`'s single checkpoint: an invitation open to
 * anyone would be a way to reach strangers, which is what blocking exists to
 * stop. Someone who is not a friend answers like someone who does not exist.
 */
export async function proposeDuel(
  db: Database,
  viewerId: string,
  input: { guestId: string; playedOn?: Date; deckId?: string | null },
): Promise<Duel> {
  const guestId = requireUuid(input.guestId);
  if (guestId === viewerId) throw invalidInput("A duel needs two duellists.");
  if ((await friendStatusWith(db, viewerId, guestId)) !== "friends") {
    throw notFound("Player not found.");
  }

  if (await duelUnderWay(db, viewerId)) throw conflict("You already have a duel under way.");

  const deck = await deckBrought(db, viewerId, input.deckId);
  const [row] = await db
    .insert(duels)
    .values({
      hostId: viewerId,
      guestId,
      playedOn: input.playedOn ?? new Date(),
      hostDeckId: deck.id,
      hostDeckName: deck.name,
    })
    .returning();
  if (!row) throw new Error("insert returned nothing");

  await notify(db, { userId: guestId, kind: "duel_invite", actorId: viewerId, subjectId: row.id });
  return toDuel(row, viewerId, await playersOf(db, [row]));
}

/** Accepting: only the invited player, and only while it is an invitation. */
export async function acceptDuel(db: Database, viewerId: string, duelId: string): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.guestId !== viewerId) throw forbidden("Only the invited duellist can accept.");
  if (row.status !== "proposed") throw conflict("This duel is no longer an invitation.");
  // One duel at a time, on both sides of the table.
  if (await duelUnderWay(db, viewerId)) throw conflict("You already have a duel under way.");
  if (await duelUnderWay(db, row.hostId)) {
    throw conflict("This duellist has started another duel in the meantime.");
  }

  const [updated] = await db
    .update(duels)
    .set({ status: "accepted" })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await withdraw(db, { userId: viewerId, kind: "duel_invite", actorId: row.hostId });
  await notify(db, { userId: row.hostId, kind: "duel_accepted", actorId: viewerId, subjectId: row.id });
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
}

/** The deck one brings, chosen among one's own before the duel starts. */
export async function setDuelDeck(
  db: Database,
  viewerId: string,
  duelId: string,
  deckId: string | null,
): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "recorded") throw conflict("A recorded duel stays.");
  if (row.status === "playing") throw conflict("The duel has started: the decks are set.");
  const deck = await deckBrought(db, viewerId, deckId);
  const mine = row.hostId === viewerId;

  const [updated] = await db
    .update(duels)
    .set(mine
      ? { hostDeckId: deck.id, hostDeckName: deck.name }
      : { guestDeckId: deck.id, guestDeckName: deck.name })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
}

/**
 * Starting: the decks are set, and **the server flips the coin**.
 *
 * Drawn here rather than in the browser: on the client it would be a number the
 * other player has to take on trust, which is the one thing a coin flip must not
 * be. Either player may start the duel — both are at the table.
 */
export async function startDuel(db: Database, viewerId: string, duelId: string): Promise<DuelDetail> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "proposed") throw conflict("This duel has not been accepted yet.");
  if (row.status !== "accepted") throw conflict("This duel has already started.");
  if (!row.hostDeckId || !row.guestDeckId) {
    throw conflict("Both duellists choose a deck before the coin is flipped.");
  }

  const first = Math.random() < 0.5 ? row.hostId : row.guestId;
  const [updated] = await db
    .update(duels)
    .set({
      status: "playing",
      turnNumber: 1,
      phase: "draw",
      currentPlayerId: first,
      hostLife: STARTING_LIFE,
      guestLife: STARTING_LIFE,
      startedAt: new Date(),
    })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await writeEvent(db, updated, {
    kind: "start",
    authorId: viewerId,
    turnNumber: 1,
    phase: "draw",
    playerId: first,
    hostLife: STARTING_LIFE,
    guestLife: STARTING_LIFE,
  });
  return detailOf(db, updated, viewerId);
}

/** The next phase, one at a time, never backwards — by the player whose turn it is. */
export async function advancePhase(
  db: Database,
  viewerId: string,
  duelId: string,
): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
  theirTurn(row, viewerId);
  const phase = nextPhase(row.phase as DuelPhase);
  if (!phase) throw conflict("The End Phase is the last: end the turn.");

  const [updated] = await db
    .update(duels)
    .set({ phase })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await writeEvent(db, updated, {
    kind: "phase",
    authorId: viewerId,
    turnNumber: updated.turnNumber ?? 1,
    phase,
    playerId: updated.currentPlayerId,
    hostLife: updated.hostLife,
    guestLife: updated.guestLife,
  });
  return detailOf(db, updated, viewerId);
}

/**
 * Ending the turn: the other player, a new turn, back to the Draw Phase.
 *
 * From any phase — a duel ends its turn when its player says so, not when the
 * application decides.
 */
export async function endTurn(db: Database, viewerId: string, duelId: string): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
  theirTurn(row, viewerId);
  const turnNumber = (row.turnNumber ?? 1) + 1;
  if (turnNumber > 999) throw conflict("This duel has run out of turns.");
  const currentPlayerId = row.currentPlayerId === row.hostId ? row.guestId : row.hostId;

  const [updated] = await db
    .update(duels)
    .set({ turnNumber, phase: "draw", currentPlayerId })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await writeEvent(db, updated, {
    kind: "turn",
    authorId: viewerId,
    turnNumber,
    phase: "draw",
    playerId: currentPlayerId,
    hostLife: updated.hostLife,
    guestLife: updated.guestLife,
  });
  return detailOf(db, updated, viewerId);
}

/**
 * Life points, **declared by the one who takes them**, in the phase under way.
 *
 * Asked for by Ange on 2026-09-19: the player who loses the points is the one
 * who says so. It is how it goes at the table — nobody reaches across to move
 * the other's counter — and it removes the one gesture a duel could argue
 * about. A change aimed at the other player is refused here, whatever a screen
 * might offer.
 *
 * The phase is not asked for: it is where the duel is. That is what makes the
 * history read like a duel — “turn 4, Battle Phase, −1800”.
 */
export async function changeLife(
  db: Database,
  viewerId: string,
  duelId: string,
  input: { playerId?: string; delta: number; note?: string | null },
): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
  const playerId = input.playerId === undefined ? viewerId : requireUuid(input.playerId);
  if (playerId !== viewerId) {
    throw forbidden("Each duellist declares their own life points.");
  }
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw invalidInput("Life points are a whole number.");
  }
  const note = input.note?.trim() ?? null;
  if (note && note.length > EVENT_NOTE_MAX) throw invalidInput("The note is too long.");

  const mine = viewerId === row.hostId;
  const current = mine ? row.hostLife : row.guestLife;
  // Clamped rather than refused: a player brought to zero by more damage than
  // they had left is the normal end of a duel, not a mistake to reject.
  const after = Math.min(LIFE_BOUNDS.max, Math.max(LIFE_BOUNDS.min, current + input.delta));

  const [updated] = await db
    .update(duels)
    .set(mine ? { hostLife: after } : { guestLife: after })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await recordLife(db, updated, {
    authorId: viewerId,
    turnNumber: updated.turnNumber ?? 1,
    phase: updated.phase as DuelPhase,
    delta: after - current,
    note,
  });
  return detailOf(db, updated, viewerId);
}

/**
 * Declining an invitation, or calling off a duel that has not been recorded.
 *
 * One gesture, because it ends the same way: the row goes. A duel that did not
 * happen leaves no trace, and a refusal left in place is an invitation that can
 * never be sent again. A recorded duel is not touched: a history one can rewrite
 * is not a history.
 */
export async function dropDuel(db: Database, viewerId: string, duelId: string): Promise<void> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "recorded") throw conflict("A recorded duel stays.");

  await db.delete(duels).where(eq(duels.id, row.id));
  await withdraw(db, { userId: row.guestId, kind: "duel_invite", actorId: row.hostId });
}

/**
 * Recording the result — by either player, once.
 *
 * **A winner, not a score.** A score counts games won, so `2–0` would need two
 * duels; counting an evening is the players' business, and the list of past
 * duels is what they count from (Ange, 2026-09-19).
 */
export async function recordDuel(
  db: Database,
  viewerId: string,
  duelId: string,
  input: { winnerId: string; note?: string | null },
): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "proposed") throw conflict("This duel has not been accepted yet.");
  if (row.status === "recorded") throw conflict("This duel already has its result.");

  const winnerId = requireUuid(input.winnerId);
  if (winnerId !== row.hostId && winnerId !== row.guestId) {
    throw invalidInput("The winner is one of the two duellists.");
  }
  const note = input.note?.trim() ?? null;
  if (note && note.length > LIMITS.note.max) throw invalidInput("The note is too long.");

  const [updated] = await db
    .update(duels)
    .set({
      status: "recorded",
      recordedAt: new Date(),
      winnerId,
      note,
      // Where the duel was has no meaning once it is over, and the history keeps
      // every turn it went through.
      turnNumber: null,
      phase: null,
      currentPlayerId: null,
    })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  const other = row.hostId === viewerId ? row.guestId : row.hostId;
  await notify(db, { userId: other, kind: "duel_recorded", actorId: viewerId, subjectId: row.id });
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
}

/**
 * The duels one is in, newest first — **a page at a time**.
 *
 * A duel under way is one at most, but the ones played accumulate for as long
 * as one plays: they are paged through rather than answered in full. The cursor
 * is the last duel's date and identifier, which orders them without missing one
 * when two share a day.
 */
const DUELS_PAGE = 20;

export type DuelPage = { items: Duel[]; nextCursor: string | null };

export async function listDuels(
  db: Database,
  viewerId: string,
  options: { past?: boolean; cursor?: string; limit?: number } = {},
): Promise<DuelPage> {
  const limit = Math.min(Math.max(options.limit ?? DUELS_PAGE, 1), 100);
  const mine = or(eq(duels.hostId, viewerId), eq(duels.guestId, viewerId));
  const before = options.cursor ? parseCursor(options.cursor) : null;

  const rows = await db
    .select()
    .from(duels)
    .where(and(
      mine,
      options.past === undefined
        ? undefined
        : options.past
          ? eq(duels.status, "recorded")
          : ne(duels.status, "recorded"),
      // The types are spelled out: a row comparison against two parameters
      // leaves PostgreSQL with nothing to infer them from, and it refuses.
      before
        ? sql`(${duels.playedOn}, ${duels.id}) < (${before.playedOn}::timestamptz, ${before.id}::uuid)`
        : undefined,
    ))
    .orderBy(desc(duels.playedOn), desc(duels.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const players = await playersOf(db, page);
  const last = page.at(-1);
  return {
    items: page.map((row) => toDuel(row, viewerId, players)),
    nextCursor: rows.length > limit && last ? `${last.playedOn.toISOString()}|${last.id}` : null,
  };
}

/**
 * A cursor is a date and an identifier; anything else is simply no cursor.
 *
 * The date travels as the text it came in: inside a hand-written fragment the
 * driver has no column to infer a `Date` from, and refuses it — measured on
 * 2026-09-19, as a 500 on the second page.
 */
function parseCursor(cursor: string): { playedOn: string; id: string } | null {
  const [when, id] = cursor.split("|");
  if (!when || !id) return null;
  if (Number.isNaN(new Date(when).getTime())) return null;
  return { playedOn: when, id: requireUuid(id) };
}

export async function getDuel(db: Database, viewerId: string, duelId: string): Promise<DuelDetail> {
  return detailOf(db, await own(db, viewerId, duelId), viewerId);
}

/** How many duels one has recorded, and how many of those one won. */
export async function duelTally(
  db: Database,
  ownerId: string,
): Promise<{ played: number; won: number }> {
  const [row] = await db
    .select({
      played: sql<number>`count(*)::int`,
      won: sql<number>`count(*) filter (where ${duels.winnerId} = ${ownerId})::int`,
    })
    .from(duels)
    .where(and(
      eq(duels.status, "recorded"),
      or(eq(duels.hostId, ownerId), eq(duels.guestId, ownerId)),
    ));
  return { played: row?.played ?? 0, won: row?.won ?? 0 };
}

export { DUEL_PHASES };
