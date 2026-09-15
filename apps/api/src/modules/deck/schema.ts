import { sql } from "drizzle-orm";
import {
  bigint, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { DECK_MAX_COPIES } from "@atem/shared";
import { users } from "../identity/schema.js";
import { cards } from "../referential/schema.js";

/**
 * A deck folder.
 *
 * Taken from ATEM-old, **without its `sort_order` column**: it was written on
 * every creation and the screen sorted by name anyway. A column nobody reads is
 * a column that lies.
 *
 * The maximum depth is not here: a rule that speaks of a row's whole path
 * cannot be expressed in a column constraint. It lives in the service, along
 * with cycle detection, and its tests.
 */
export const deckFolders = pgTable(
  "deck_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /**
     * The parent folder, or `null` at the root.
     *
     * **No `cascade`, unlike ATEM-old.** Its schema cascaded while its service
     * re-attached children to the grandparent: two contradictory answers to the
     * same question, and the database is what wins as soon as a deletion goes
     * anywhere but through the service. Here the database answers nothing — the
     * service's transaction re-attaches, and it is the only thing that does.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => deckFolders.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("deck_folders_user_idx").on(t.userId, t.parentId),
    /**
     * Two sibling folders with the same name are indistinguishable in an
     * explorer.
     *
     * `nulls not distinct` because the root is a null `parent_id`: without it,
     * Postgres considers two nulls different and the rule would apply **to
     * subfolders only** — that is, not where people create the most.
     */
    unique("deck_folders_sibling_name_uidx").on(t.userId, t.parentId, t.name).nullsNotDistinct(),
  ],
);

/**
 * A deck.
 *
 * ATEM-old's shell, **without its `category` column**: it was marked
 * `@deprecated` there and recomputed on every write nonetheless. Debt that
 * works is worse than debt that sleeps.
 */
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * The folder that files it, or `null` at the root.
     *
     * `set null`: a folder deleted by a path that would not go through the
     * service leaves its decks at the root. Losing the filing is repairable,
     * losing the decks is not.
     */
    folderId: uuid("folder_id").references(() => deckFolders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("decks_user_idx").on(t.userId, t.updatedAt),
    index("decks_user_folder_idx").on(t.userId, t.folderId),
    // Two decks with the same name belonging to the same person are impossible
    // to tell apart in a list — and the delete confirmation is typed by name.
    uniqueIndex("decks_user_name_uidx").on(t.userId, t.name),
  ],
);

/**
 * A card in a deck — **one row per card, not per printing**.
 *
 * That is the rule of the game: three Blue-Eyes in three set codes remain three
 * Blue-Eyes. And it is what makes the ceiling expressible.
 *
 * ATEM-old identified its rows by `(deck, zone, passcode, set_code)`. The same
 * card therefore lived on several rows — different zones, different pinned
 * printing — and totalled six copies without any constraint aggregating them.
 * Its ceiling was checked **per row**, in Zod and in the service, which
 * guaranteed nothing.
 *
 * Here the three zones are three columns of the same row. The constraint
 * applies to their sum, and the database refuses the fourth copy whatever
 * happens — even if some day a service forgets to ask.
 */
export const deckCards = pgTable(
  "deck_cards",
  {
    deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
    /**
     * `restrict`: the catalogue does not vanish from under a deck that uses
     * it. It is imported wholesale and never cleaned up, so this gets in
     * nobody's way — but writing it says the dependency is intended.
     */
    passcode: bigint("passcode", { mode: "number" })
      .notNull()
      .references(() => cards.passcode, { onDelete: "restrict" }),
    mainQty: integer("main_qty").notNull().default(0),
    extraQty: integer("extra_qty").notNull().default(0),
    sideQty: integer("side_qty").notNull().default(0),
  },
  (t) => [
    uniqueIndex("deck_cards_identity_uidx").on(t.deckId, t.passcode),
    index("deck_cards_passcode_idx").on(t.passcode),
    /**
     * The three-copy ceiling, for the whole deck.
     *
     * It depends neither on the banlist nor on the date: it is the rule of the
     * game, and it will not change. That is why it lives here and not in code
     * someone could forget to call — the banlist, for its part, moves with the
     * catalogue and stays in the service.
     */
    check(
      "deck_cards_max_copies_ck",
      sql`${t.mainQty} + ${t.extraQty} + ${t.sideQty} between 0 and ${sql.raw(String(DECK_MAX_COPIES))}`,
    ),
    // No zone goes below zero: one “−1” too many does not fabricate a negative
    // quantity that would skew every total.
    check(
      "deck_cards_non_negative_ck",
      sql`${t.mainQty} >= 0 and ${t.extraQty} >= 0 and ${t.sideQty} >= 0`,
    ),
  ],
);

export type DeckRow = typeof decks.$inferSelect;
export type DeckFolderRow = typeof deckFolders.$inferSelect;
