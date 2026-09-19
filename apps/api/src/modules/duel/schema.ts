import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { DUEL_PHASES, LIFE_BOUNDS, STARTING_LIFE } from "@atem/shared";
import { users } from "../identity/schema.js";
import { decks } from "../deck/schema.js";

const vocabulary = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A duel played in person, as its two players follow it.
 *
 * `docs/ref-duels.md` is the reference. The row carries **where the duel is** —
 * turn, phase, life totals — because two people share one duel from two devices,
 * and each must find it as the other left it. It carries no rule of the game:
 * ATEM is the notebook beside the mat.
 */
export const duels = pgTable(
  "duels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Who invited, and who was invited. Both are participants, equal afterwards. */
    hostId: uuid("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** `proposed` → `accepted` → `playing` → `recorded`. Refusing deletes the row. */
    status: text("status").notNull().default("proposed"),
    /** The day it is played — chosen, not the row's creation: one records it in the evening. */
    playedOn: timestamp("played_on", { withTimezone: true }).defaultNow().notNull(),
    /**
     * The decks, by identifier **and** by name.
     *
     * The identifier keeps the link while the deck exists; the name is copied so
     * the history still reads after a deck is deleted — “played with Blue-Eyes”
     * stays true when that deck is gone. See `docs/ref-duels.md`.
     */
    hostDeckId: uuid("host_deck_id").references(() => decks.id, { onDelete: "set null" }),
    hostDeckName: text("host_deck_name"),
    guestDeckId: uuid("guest_deck_id").references(() => decks.id, { onDelete: "set null" }),
    guestDeckName: text("guest_deck_name"),

    /** Where the duel is. `null` until the coin is flipped. */
    turnNumber: integer("turn_number"),
    phase: text("phase"),
    currentPlayerId: uuid("current_player_id").references(() => users.id, { onDelete: "set null" }),
    hostLife: integer("host_life").notNull().default(STARTING_LIFE),
    guestLife: integer("guest_life").notNull().default(STARTING_LIFE),
    startedAt: timestamp("started_at", { withTimezone: true }),

    /**
     * Who won. `null` until the duel is recorded.
     *
     * Not a score: a score counts games won, so `2–0` would need two duels.
     * Counting an evening is the players' business (`docs/ref-duels.md`).
     */
    winnerId: uuid("winner_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
  },
  (t) => [
    check("duels_status_vocab", sql`${t.status} in (${sql.raw(vocabulary(["proposed", "accepted", "playing", "recorded"]))})`),
    // Nobody duels themselves: the whole point is two people at one table.
    check("duels_two_players", sql`${t.hostId} <> ${t.guestId}`),
    check("duels_phase_vocab", sql`${t.phase} is null or ${t.phase} in (${sql.raw(vocabulary(DUEL_PHASES))})`),
    check("duels_turn_number", sql`${t.turnNumber} is null or ${t.turnNumber} between 1 and 999`),
    check(
      "duels_life_bounds",
      sql`${t.hostLife} between ${sql.raw(String(LIFE_BOUNDS.min))} and ${sql.raw(String(LIFE_BOUNDS.max))}
        and ${t.guestLife} between ${sql.raw(String(LIFE_BOUNDS.min))} and ${sql.raw(String(LIFE_BOUNDS.max))}`,
    ),
    // The winner is one of the two who played, or nobody yet.
    check(
      "duels_winner_played",
      sql`${t.winnerId} is null or ${t.winnerId} in (${t.hostId}, ${t.guestId})`,
    ),
    // A recorded duel has its winner, and only a recorded one has it.
    check("duels_recorded_has_winner", sql`(${t.status} = 'recorded') = (${t.winnerId} is not null)`),
    // A duel being played is somewhere: on a turn, in a phase, with someone to play it.
    check(
      "duels_playing_has_place",
      sql`(${t.status} = 'playing') = (${t.turnNumber} is not null and ${t.phase} is not null)`,
    ),
    index("duels_host_idx").on(t.hostId, t.playedOn.desc()),
    index("duels_guest_idx").on(t.guestId, t.playedOn.desc()),
  ],
);

/**
 * Everything that happened, in the order it happened.
 *
 * One row per event — the start, a phase, a turn, a life change — rather than one
 * row per turn: a turn holds several things, and “turn 4, Battle Phase, −1800” is
 * the sentence a duel is actually read in.
 *
 * `authorId` is kept because both players write into the same history: one phone
 * often lies between the two, and a disagreement must be visible, not silently
 * overwritten.
 */
export const duelEvents = pgTable(
  "duel_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    duelId: uuid("duel_id").notNull().references(() => duels.id, { onDelete: "cascade" }),
    /** 1, 2, 3… in the order written: the history reads in it. */
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    turnNumber: integer("turn_number").notNull(),
    phase: text("phase").notNull(),
    /** Who wrote it. */
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Who it is about: the turn's player, or whoever lost the life points. */
    playerId: uuid("player_id").references(() => users.id, { onDelete: "set null" }),
    /** Life points taken (negative) or given back (positive), on a `life` event. */
    delta: integer("delta"),
    /** Both totals after the event, so the history reads without replaying it. */
    hostLife: integer("host_life").notNull(),
    guestLife: integer("guest_life").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("duel_events_kind_vocab", sql`${t.kind} in ('start', 'phase', 'turn', 'life')`),
    check("duel_events_phase_vocab", sql`${t.phase} in (${sql.raw(vocabulary(DUEL_PHASES))})`),
    check("duel_events_life_has_delta", sql`(${t.kind} = 'life') = (${t.delta} is not null)`),
    uniqueIndex("duel_events_seq_uidx").on(t.duelId, t.seq),
  ],
);
