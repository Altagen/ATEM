import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * What the administrator did — asked for by the maintainer on 2026-09-21.
 *
 * One row per gesture, written by the admin module alone. The account it was
 * about is kept **by label** (`Name#0042`) as well as by identifier: deleting
 * an account is itself logged, and a line that lost its subject's name the
 * moment it was written would say nothing. No foreign key for the same reason.
 *
 * This is the administrator's log, not the players': what happens on the
 * instance is the server's own logs' business, and a pipe for them can come
 * later.
 */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** `account_created`, `account_suspended`, … — see `ADMIN_ACTIONS`. */
    action: text("action").notNull(),
    targetId: uuid("target_id"),
    targetLabel: text("target_label"),
    /** What the line needs to be read later — the new setting, for instance. */
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("admin_actions_created_idx").on(t.createdAt)],
);
