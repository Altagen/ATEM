import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "../identity/schema.js";

/**
 * A friendship: **one row for two people**.
 *
 * Taken from the earlier prototype, whose reasoning was right and whose defect it had already
 * fixed: its first table stored accepted friendships twice, one row per
 * direction, and “pending” existed only as an inbox message — deleting the
 * message erased the request without the sender ever knowing.
 *
 * The pair is ordered by identifier (`user_a < user_b`), which is what makes the
 * uniqueness real: without it (Alice, Bob) and (Bob, Alice) are two different
 * rows, so two friendships between the same two people, and which one you see
 * depends on who is reading. `requesterId` is what the ordering erases, and it
 * is what tells “request sent” from “request received”.
 */
export const friendEdges = pgTable(
  "friend_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userA: uuid("user_a").notNull().references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b").notNull().references(() => users.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** `pending` or `accepted`. Refusing deletes the row: there is nothing to keep. */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("friend_edges_pair_uidx").on(t.userA, t.userB),
    check("friend_edges_ordered", sql`${t.userA} < ${t.userB}`),
    // The requester is one of the two, or nobody can answer the request.
    check("friend_edges_requester", sql`${t.requesterId} in (${t.userA}, ${t.userB})`),
    check("friend_edges_status", sql`${t.status} in ('pending', 'accepted')`),
    index("friend_edges_user_b_idx").on(t.userB),
  ],
);

/**
 * A block, in one direction — but it takes effect in both.
 *
 * The person I blocked disappears from my lists, and I disappear from theirs:
 * a block that only hid one side would let the blocked person keep acting on
 * the other.
 */
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("blocks_pair_uidx").on(t.userId, t.blockedUserId),
    check("blocks_not_self", sql`${t.userId} <> ${t.blockedUserId}`),
    // “Who blocked me?” is asked as often as “who did I block?”.
    index("blocks_blocked_idx").on(t.blockedUserId),
  ],
);
