import { sql } from "drizzle-orm";
import {
  check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { users } from "../identity/schema.js";
import { decks } from "../deck/schema.js";

/**
 * A duel played in person, as its two players record it.
 *
 * `docs/ref-duels.md` is the reference, and this follows it: the row is a
 * testimony, not a game state — the application never knows more about the game
 * than the two tell it.
 */
export const duels = pgTable(
  "duels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Who invited, and who was invited. Both are participants, equal afterwards. */
    hostId: uuid("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** `proposed` → `open` → `recorded`. A refusal or a cancellation deletes the row. */
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
    /** Wins each, `2–1` and the like. `null` until the result is recorded. */
    hostScore: integer("host_score"),
    guestScore: integer("guest_score"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
  },
  (t) => [
    check("duels_status_vocab", sql`${t.status} in ('proposed', 'open', 'recorded')`),
    // Nobody duels themselves: the whole point is two people at one table.
    check("duels_two_players", sql`${t.hostId} <> ${t.guestId}`),
    // A score exists on both sides or on neither: half a result is not a result.
    check(
      "duels_score_pair",
      sql`(${t.hostScore} is null) = (${t.guestScore} is null)`,
    ),
    check("duels_score_bounds", sql`${t.hostScore} is null or (${t.hostScore} between 0 and 99 and ${t.guestScore} between 0 and 99)`),
    // A recorded duel has its score, and only a recorded one has it.
    check(
      "duels_recorded_has_score",
      sql`(${t.status} = 'recorded') = (${t.hostScore} is not null)`,
    ),
    index("duels_host_idx").on(t.hostId, t.playedOn.desc()),
    index("duels_guest_idx").on(t.guestId, t.playedOn.desc()),
  ],
);

/**
 * One turn of a duel, as one of the two wrote it.
 *
 * `authorId` is kept because both players write into the same history: a
 * disagreement must be visible, not silently overwritten.
 */
export const duelTurns = pgTable(
  "duel_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    duelId: uuid("duel_id").notNull().references(() => duels.id, { onDelete: "cascade" }),
    /** 1, 2, 3… unique within the duel: two turns cannot share a number. */
    number: integer("number").notNull(),
    /** Whose turn it was — one of the two players. */
    playerId: uuid("player_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Life totals after the turn. Bounded, never checked against the rules. */
    hostLife: integer("host_life").notNull(),
    guestLife: integer("guest_life").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("duel_turns_number", sql`${t.number} between 1 and 999`),
    check(
      "duel_turns_life_bounds",
      sql`${t.hostLife} between 0 and 99999 and ${t.guestLife} between 0 and 99999`,
    ),
    // Unique: two turns cannot share a number, and the list reads in that order.
    uniqueIndex("duel_turns_number_uidx").on(t.duelId, t.number),
  ],
);
