/**
 * What the inbox screen holds between two paints.
 */
import type { Duellist } from "../community/state.js";

/** Mirrors the server's `NotificationKind`. */
export type NotificationKind =
  | "friend_request" | "friend_accepted"
  | "duel_invite" | "duel_accepted" | "duel_recorded";

/** Mirrors the server's `InboxItem`. */
export type InboxItem = {
  id: string;
  kind: NotificationKind;
  actor: Duellist | null;
  isRead: boolean;
  createdAt: string;
};

export type InboxState = {
  /** `null` until the first answer: nothing is guessed in the meantime. */
  items: InboxItem[] | null;
  unread: number;
  failure: string | null;
  /** The line under way, so its buttons go inert. */
  busy: Set<string>;
};

export const inboxState = (): InboxState => ({
  items: null,
  unread: 0,
  failure: null,
  busy: new Set(),
});
