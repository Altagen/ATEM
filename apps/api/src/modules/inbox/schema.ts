import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../identity/schema.js";

/**
 * What is waiting for you: friend requests, and duel invitations to come.
 *
 * **The sentence is not stored.** ATEM-old wrote `title` and `message` into the
 * row, in the language of the moment: an inbox read in English still showed
 * “🤝 Demande d'ami !” for everything received before the switch, and a
 * reworded message never reached what had already been sent. Here a row holds
 * the event — its kind and who caused it — and the screen writes the sentence,
 * in the language being read.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The vocabulary is checked by the service, which owns the list. */
    kind: text("kind").notNull(),
    /**
     * Who caused it, when someone did.
     *
     * The row goes when they do (`cascade`): a notification about an account
     * that no longer exists has nothing left to say, and the screen would have
     * a name to display that it cannot find.
     */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Read by recipient, newest first: the `desc` belongs to the index, or the
    // database sorts afterwards.
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    /**
     * The unread count, and only the unread.
     *
     * A partial index carries the few rows that count rather than the whole
     * history — and that count is read on every screen, at every load.
     */
    index("notifications_user_unread_idx").on(t.userId).where(sql`read_at is null`),
  ],
);
