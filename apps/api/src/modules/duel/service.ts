/**
 * Duels — `docs/ref-duels.md` is the reference, rule by rule.
 *
 * ATEM records a duel played in person; it does not referee one. Every function
 * here takes the session's identity and refuses anything that is not about the
 * caller's own duels (ADR-009).
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { LIMITS } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, forbidden, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { deckNameOf } from "../deck/index.js";
import { listProfiles, type Duellist } from "../identity/index.js";
import { notify, withdraw } from "../inbox/index.js";
import { friendStatusWith } from "../social/index.js";
import { duels, duelTurns } from "./schema.js";

export type DuelStatus = "proposed" | "open" | "recorded";

/** One side of a duel, as the screens read it. */
export type DuelSide = {
  player: Duellist | null;
  deck: { id: string | null; name: string | null };
  score: number | null;
};

export type DuelTurn = {
  id: string;
  number: number;
  playerId: string;
  authorId: string;
  hostLife: number;
  guestLife: number;
  note: string | null;
};

export type Duel = {
  id: string;
  status: DuelStatus;
  playedOn: Date;
  host: DuelSide;
  guest: DuelSide;
  note: string | null;
  /** `null` on a draw or before the result — the score decides, nothing else. */
  winnerId: string | null;
  /** The caller invited: it is theirs to cancel rather than to answer. */
  isHost: boolean;
  createdAt: Date;
  recordedAt: Date | null;
};

export type DuelDetail = Duel & { turns: DuelTurn[] };

/** Life totals are bounded, never checked against the rules of any format. */
const LIFE_MAX = 99_999;
const SCORE_MAX = 99;
const TURN_MAX = 999;
const TURN_NOTE_MAX = 280;

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
      score: row.hostScore,
    },
    guest: {
      player: players.get(row.guestId) ?? null,
      deck: { id: row.guestDeckId, name: row.guestDeckName },
      score: row.guestScore,
    },
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

/** Accepting: only the invited player, and only while it is proposed. */
export async function acceptDuel(db: Database, viewerId: string, duelId: string): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.guestId !== viewerId) throw forbidden("Only the invited duellist can accept.");
  if (row.status !== "proposed") throw conflict("This duel is no longer an invitation.");

  const [updated] = await db
    .update(duels)
    .set({ status: "open" })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  await withdraw(db, { userId: viewerId, kind: "duel_invite", actorId: row.hostId });
  await notify(db, { userId: row.hostId, kind: "duel_accepted", actorId: viewerId });
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
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
  input: { hostScore: number; guestScore: number; note?: string | null; deckId?: string | null },
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

  // The deck can still be named when recording: one does not always say
  // beforehand what will be played.
  const deck = input.deckId === undefined
    ? null
    : await deckBrought(db, viewerId, input.deckId);
  const mine = row.hostId === viewerId;

  const [updated] = await db
    .update(duels)
    .set({
      status: "recorded",
      recordedAt: new Date(),
      hostScore: input.hostScore,
      guestScore: input.guestScore,
      note,
      ...(deck === null
        ? {}
        : mine
          ? { hostDeckId: deck.id, hostDeckName: deck.name }
          : { guestDeckId: deck.id, guestDeckName: deck.name }),
    })
    .where(eq(duels.id, row.id))
    .returning();
  if (!updated) throw notFound("Duel not found.");

  const other = mine ? row.guestId : row.hostId;
  await notify(db, { userId: other, kind: "duel_recorded", actorId: viewerId });
  return toDuel(updated, viewerId, await playersOf(db, [updated]));
}

/** The deck one brings, said or changed while the duel is open. */
export async function setDuelDeck(
  db: Database,
  viewerId: string,
  duelId: string,
  deckId: string | null,
): Promise<Duel> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "recorded") throw conflict("A recorded duel stays.");
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
 * Writing a turn.
 *
 * Append-only while the duel is open: correcting the **last** turn is allowed —
 * a mistyped life total is common — rewriting turn 3 after turn 12 is not.
 */
export async function writeTurn(
  db: Database,
  viewerId: string,
  duelId: string,
  input: { number: number; playerId: string; hostLife: number; guestLife: number; note?: string | null },
): Promise<DuelTurn[]> {
  const row = await own(db, viewerId, duelId);
  if (row.status === "proposed") throw conflict("This duel has not been accepted yet.");
  if (row.status === "recorded") throw conflict("A recorded duel stays.");

  const playerId = requireUuid(input.playerId);
  if (playerId !== row.hostId && playerId !== row.guestId) {
    throw invalidInput("A turn belongs to one of the two duellists.");
  }
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > TURN_MAX) {
    throw invalidInput("A turn number is between 1 and 999.");
  }
  for (const life of [input.hostLife, input.guestLife]) {
    if (!Number.isInteger(life) || life < 0 || life > LIFE_MAX) {
      throw invalidInput("Life points are a whole number.");
    }
  }
  const note = input.note?.trim() ?? null;
  if (note && note.length > TURN_NOTE_MAX) throw invalidInput("The turn note is too long.");

  const [last] = await db
    .select({ number: duelTurns.number })
    .from(duelTurns)
    .where(eq(duelTurns.duelId, row.id))
    .orderBy(desc(duelTurns.number))
    .limit(1);
  const highest = last?.number ?? 0;
  if (input.number !== highest && input.number !== highest + 1) {
    throw conflict("Only the last turn can be corrected.");
  }

  const values = {
    duelId: row.id,
    number: input.number,
    playerId,
    authorId: viewerId,
    hostLife: input.hostLife,
    guestLife: input.guestLife,
    note,
  };
  await db
    .insert(duelTurns)
    .values(values)
    .onConflictDoUpdate({
      target: [duelTurns.duelId, duelTurns.number],
      set: { playerId, authorId: viewerId, hostLife: input.hostLife, guestLife: input.guestLife, note },
    });

  return listTurns(db, row.id);
}

async function listTurns(db: Database, duelId: string): Promise<DuelTurn[]> {
  const rows = await db
    .select()
    .from(duelTurns)
    .where(eq(duelTurns.duelId, duelId))
    .orderBy(duelTurns.number);
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    playerId: row.playerId,
    authorId: row.authorId,
    hostLife: row.hostLife,
    guestLife: row.guestLife,
    note: row.note,
  }));
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
  const row = await own(db, viewerId, duelId);
  const players = await playersOf(db, [row]);
  return { ...toDuel(row, viewerId, players), turns: await listTurns(db, row.id) };
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
