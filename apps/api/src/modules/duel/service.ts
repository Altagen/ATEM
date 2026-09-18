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
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
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
  score: number | null;
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
  /** `null` on a draw or before the result — the score decides, nothing else. */
  winnerId: string | null;
  /** The caller invited: it is theirs to cancel rather than to answer. */
  isHost: boolean;
  createdAt: Date;
  recordedAt: Date | null;
};

export type DuelDetail = Duel & { events: DuelEvent[] };

const SCORE_MAX = 99;
const EVENT_NOTE_MAX = 280;

type DuelRow = typeof duels.$inferSelect;

function winnerOf(row: DuelRow): string | null {
  if (row.hostScore === null || row.guestScore === null) return null;
  if (row.hostScore === row.guestScore) return null;
  return row.hostScore > row.guestScore ? row.hostId : row.guestId;
}

function toDuel(row: DuelRow, viewerId: string, players: Map<string, Duellist>): Duel {
  return {
    id: row.id,
    status: row.status as DuelStatus,
    playedOn: row.playedOn,
    host: {
      player: players.get(row.hostId) ?? null,
      deck: { id: row.hostDeckId, name: row.hostDeckName },
      life: row.hostLife,
      score: row.hostScore,
    },
    guest: {
      player: players.get(row.guestId) ?? null,
      deck: { id: row.guestDeckId, name: row.guestDeckName },
      life: row.guestLife,
      score: row.guestScore,
    },
    turnNumber: row.turnNumber,
    phase: row.phase as DuelPhase | null,
    currentPlayerId: row.currentPlayerId,
    note: row.note,
    winnerId: winnerOf(row),
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

  await notify(db, { userId: guestId, kind: "duel_invite", actorId: viewerId });
  return toDuel(row, viewerId, await playersOf(db, [row]));
}

/** Accepting: only the invited player, and only while it is an invitation. */
export async function acceptDuel(db: Database, viewerId: string, duelId: string): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.guestId !== viewerId) throw forbidden("Only the invited duellist can accept.");
  if (row.status !== "proposed") throw conflict("This duel is no longer an invitation.");

  const [updated] = await db
    .update(duels)
    .set({ status: "accepted" })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await withdraw(db, { userId: viewerId, kind: "duel_invite", actorId: row.hostId });
  await notify(db, { userId: row.hostId, kind: "duel_accepted", actorId: viewerId });
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

/** The next phase, one at a time, never backwards. */
export async function advancePhase(
  db: Database,
  viewerId: string,
  duelId: string,
): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
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
 * From any phase — a duel ends its turn when the players say so, not when the
 * application decides.
 */
export async function endTurn(db: Database, viewerId: string, duelId: string): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
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
 * Life points taken or given back, to either player, in the phase under way.
 *
 * The phase is not asked for: it is where the duel is. That is what makes the
 * history read like a duel — “turn 4, Battle Phase, −1800”.
 */
export async function changeLife(
  db: Database,
  viewerId: string,
  duelId: string,
  input: { playerId: string; delta: number; note?: string | null },
): Promise<DuelDetail> {
  const row = await playing(db, viewerId, duelId);
  const playerId = requireUuid(input.playerId);
  if (playerId !== row.hostId && playerId !== row.guestId) {
    throw invalidInput("Life points belong to one of the two duellists.");
  }
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw invalidInput("Life points are a whole number.");
  }
  const note = input.note?.trim() ?? null;
  if (note && note.length > EVENT_NOTE_MAX) throw invalidInput("The note is too long.");

  const mine = playerId === row.hostId;
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

  await writeEvent(db, updated, {
    kind: "life",
    authorId: viewerId,
    turnNumber: updated.turnNumber ?? 1,
    phase: updated.phase as DuelPhase,
    playerId,
    delta: after - current,
    hostLife: updated.hostLife,
    guestLife: updated.guestLife,
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
 * The score says who won; equal scores are a draw. The format is not policed:
 * `2–1`, `1–0` and `3–2` are all somebody's evening.
 */
export async function recordDuel(
  db: Database,
  viewerId: string,
  duelId: string,
  input: { hostScore: number; guestScore: number; note?: string | null },
): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "proposed") throw conflict("This duel has not been accepted yet.");
  if (row.status === "recorded") throw conflict("This duel already has its result.");

  for (const score of [input.hostScore, input.guestScore]) {
    if (!Number.isInteger(score) || score < 0 || score > SCORE_MAX) {
      throw invalidInput("A score is a whole number of wins.");
    }
  }
  const note = input.note?.trim() ?? null;
  if (note && note.length > LIMITS.note.max) throw invalidInput("The note is too long.");

  const [updated] = await db
    .update(duels)
    .set({
      status: "recorded",
      recordedAt: new Date(),
      hostScore: input.hostScore,
      guestScore: input.guestScore,
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
  await notify(db, { userId: other, kind: "duel_recorded", actorId: viewerId });
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
}

/** The duels one is in, newest first. */
export async function listDuels(db: Database, viewerId: string): Promise<Duel[]> {
  const rows = await db
    .select()
    .from(duels)
    .where(or(eq(duels.hostId, viewerId), eq(duels.guestId, viewerId)))
    .orderBy(desc(duels.playedOn))
    .limit(200);
  const players = await playersOf(db, rows);
  return rows.map((row) => toDuel(row, viewerId, players));
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
      won: sql<number>`count(*) filter (where
        (${duels.hostId} = ${ownerId} and ${duels.hostScore} > ${duels.guestScore})
        or (${duels.guestId} = ${ownerId} and ${duels.guestScore} > ${duels.hostScore}))::int`,
    })
    .from(duels)
    .where(and(
      eq(duels.status, "recorded"),
      or(eq(duels.hostId, ownerId), eq(duels.guestId, ownerId)),
    ));
  return { played: row?.played ?? 0, won: row?.won ?? 0 };
}

export { DUEL_PHASES };
