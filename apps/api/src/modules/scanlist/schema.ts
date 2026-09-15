import { sql } from "drizzle-orm";
import {
  check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { LIMITS } from "@atem/shared";
import { users } from "../identity/schema.js";

/**
 * An inventoried batch, independent from the collection.
 *
 * `pouredAt` carries the whole state: null, the batch is waiting; dated, it has
 * entered the collection. A boolean would have said the same thing while losing
 * the one piece of information anybody actually asks for again — **when**.
 */
export const scanlists = pgTable(
  "scanlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    pouredAt: timestamp("poured_at", { withTimezone: true }),
  },
  (t) => [index("scanlists_user_idx").on(t.userId, t.createdAt)],
);

/**
 * A batch line.
 *
 * It references **no printing**. That is deliberate: a batch is what was read
 * off cardboard, not what the catalogue thinks of it. The code may be unknown,
 * misread, or point at an edition YGOPRODeck does not index — the line must
 * exist anyway, and it is the pour that makes the connection.
 *
 * The name and passcode are copied as they were at scan time, so that the list
 * reads back identical in six months.
 */
export const scanlistLines = pgTable(
  "scanlist_lines",
  {
    id: serial("id").primaryKey(),
    scanlistId: uuid("scanlist_id")
      .notNull()
      .references(() => scanlists.id, { onDelete: "cascade" }),
    setCode: text("set_code").notNull(),
    name: text("name"),
    passcode: integer("passcode"),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    // A code appears once per batch: this is a counter, not a log.
    uniqueIndex("scanlist_lines_list_code_uidx").on(t.scanlistId, t.setCode),
    /**
     * A saved line counts at least one copy.
     *
     * Zero exists while scanning — it is the floor of “−1”, and it shows what
     * was just cancelled — but it is not saved: a line declaring zero copies
     * says nothing. The ceiling, for its part, prevents a hand-crafted file
     * from bringing an arbitrary number into the collection on pouring.
     */
    check(
      "scanlist_lines_quantity_ck",
      sql`${t.quantity} between 1 and ${sql.raw(String(LIMITS.quantity.max))}`,
    ),
  ],
);

export type ScanlistRow = typeof scanlists.$inferSelect;
