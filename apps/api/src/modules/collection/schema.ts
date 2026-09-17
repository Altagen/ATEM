import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { cardPrints } from "../referential/schema.js";
import { users } from "../identity/schema.js";

/**
 * A copy owned.
 *
 * The unit is the **printing**, not the card: the player scans a set code, so
 * they declare owning one precise edition. A line's “+1 / −1” therefore acts on
 * that edition, and two editions of the same card are two lines.
 */
export const ownedCards = pgTable(
  "owned_cards",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    printId: integer("print_id").notNull().references(() => cardPrints.id, { onDelete: "restrict" }),
    /**
     * The set code is copied here, although it already lives on the printing.
     *
     * It is what the player actually read on their card, and what the export
     * must give back — even if the printing was never resolved, even if the
     * catalogue changes its mind later. The truth of an inventory belongs to
     * the inventory.
     */
    setCode: text("set_code").notNull(),
    /**
     * Zero is a legitimate value: the row is kept, and reads hide it.
     *
     * Removing the last copy does not delete the line, so its note and its
     * favourite survive a sale followed by a re-purchase — the write only ever
     * touches the quantity.
     *
     * **The bounds are not a database constraint, unlike `deck_cards`.**
     * `adjustQuantity` writes in a single `INSERT … ON CONFLICT DO UPDATE SET
     * quantity = quantity + delta`, so two simultaneous “+1” cannot lose an
     * increment. PostgreSQL evaluates a `CHECK` on the row *proposed for
     * insertion*, before the conflict turns it into an update: a “−2” on a row
     * holding 2 would be refused for its `-2`, although the result is 0. Tried
     * and measured on 2026-09-16 — seven tests fell. The bounds are therefore
     * checked after the write, inside the same transaction, which rolls back
     * when they are exceeded.
     */
    quantity: integer("quantity").notNull().default(1),
    isFavorite: boolean("is_favorite").notNull().default(false),
    notes: text("notes"),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("owned_cards_user_print_uidx").on(t.userId, t.printId),
    index("owned_cards_user_idx").on(t.userId),
    index("owned_cards_user_favorite_idx").on(t.userId, t.isFavorite),
    index("owned_cards_set_code_idx").on(t.setCode),
  ],
);

/**
 * The record of a collection import — what the settings' history shows.
 *
 * ATEM-old kept this in the browser's `localStorage`, “the server keeps no trace
 * of imports”. So an import made from a phone never appeared on the computer, and
 * clearing the site's data erased what the screen called a complete journal. It
 * is a row on the server now: the account's history, wherever it is read from,
 * and gone with the account (`cascade`).
 *
 * The file's content is not kept — only its name and the summary. The cards it
 * brought are in the collection already; a second copy of them would be data
 * nobody reads.
 */
export const collectionImports = pgTable(
  "collection_imports",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mode: text("mode").notNull(),
    imported: integer("imported").notNull(),
    removed: integer("removed").notNull(),
    failed: integer("failed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("collection_imports_user_idx").on(t.userId, t.createdAt),
    // The two modes the import route accepts, and nothing else — as `users.role`.
    check("collection_imports_mode_vocab", sql`${t.mode} in ('merge', 'replace')`),
  ],
);
