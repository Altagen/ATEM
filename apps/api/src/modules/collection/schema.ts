import {
  boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid,
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
