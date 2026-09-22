/**
 * The inbox — what is waiting, and what has been dealt with.
 *
 * It owns `notifications` and nothing else. Other modules ask it to record an
 * event (`notify`) or to take back one that has lost its meaning (`withdraw`):
 * a friend request that is cancelled leaves no message behind, which is what
 * The earlier prototype's inbox got right and its notification table nearly lost.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { listProfiles, type Duellist } from "../identity/index.js";
import { notifications } from "./schema.js";

/**
 * The events an inbox can hold.
 *
 * A closed list: the screen writes one sentence per kind, and a kind it does
 * not know would be a line with nothing to say. Duel invitations join it when
 * duels arrive.
 */
export const NOTIFICATION_KINDS = [
  "friend_request", "friend_accepted",
  "duel_invite", "duel_accepted", "duel_recorded",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One line of the inbox, with the profile it talks about. */
export type InboxItem = {
  id: string;
  kind: NotificationKind;
  /** What it is about — a duel, for an invitation. `null` when nothing. */
  subjectId: string | null;
  /** `null` when the account behind it is gone — the row goes with it, so rare. */
  actor: Duellist | null;
  isRead: boolean;
  createdAt: Date;
};

/** How many lines the inbox answers. Older ones are of no use to anyone. */
const INBOX_LIMIT = 100;

/**
 * Records an event for someone.
 *
 * Never for oneself: a notification about something you just did is noise, and
 * the badge it lights up would say there is something to look at when there is
 * not.
 */
export async function notify(
  db: Database,
  input: { userId: string; kind: NotificationKind; actorId?: string; subjectId?: string },
): Promise<void> {
  if (input.actorId === input.userId) return;
  await db.insert(notifications).values({
    userId: input.userId,
    kind: input.kind,
    actorId: input.actorId ?? null,
    subjectId: input.subjectId ?? null,
  });
}

/**
 * Takes back events that have lost their meaning.
 *
 * A cancelled or refused friend request must not leave a line offering to
 * accept something that no longer exists — in the earlier prototype, answering it returned
 * an error nobody could act on.
 */
export async function withdraw(
  db: Database,
  input: { userId: string; kind: NotificationKind; actorId: string },
): Promise<void> {
  await db
    .delete(notifications)
    .where(and(
      eq(notifications.userId, input.userId),
      eq(notifications.kind, input.kind),
      eq(notifications.actorId, input.actorId),
    ));
}

export async function unreadCount(db: Database, viewerId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, viewerId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function listInbox(db: Database, viewerId: string): Promise<InboxItem[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewerId))
    .orderBy(desc(notifications.createdAt))
    .limit(INBOX_LIMIT);

  const actors = await listProfiles(db, {
    ids: [...new Set(rows.map((row) => row.actorId).filter((id): id is string => id !== null))],
  });
  const byId = new Map(actors.map((actor) => [actor.id, actor]));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as NotificationKind,
    subjectId: row.subjectId,
    actor: row.actorId === null ? null : byId.get(row.actorId) ?? null,
    isRead: row.readAt !== null,
    createdAt: row.createdAt,
  }));
}

/** One line of one's own inbox — never anyone else's. */
async function own(db: Database, viewerId: string, id: string): Promise<string> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, requireUuid(id)), eq(notifications.userId, viewerId)))
    .limit(1);
  if (!row) throw notFound("Notification not found.");
  return row.id;
}

/**
 * Reading it all at once — the only way there is.
 *
 * Opening the inbox is reading it: a per-line “mark as read” would be a gesture
 * for something the screen has already done, and a route nothing calls.
 */
export async function markAllRead(db: Database, viewerId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, viewerId), isNull(notifications.readAt)));
}

export async function removeNotification(db: Database, viewerId: string, id: string): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.id, await own(db, viewerId, id)), eq(notifications.userId, viewerId)));
}
