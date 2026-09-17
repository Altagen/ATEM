/**
 * What the community screen holds between two paints.
 */
import type { Avatar } from "@atem/shared";

/** Mirrors the server's `FriendStatus`. */
export type FriendStatus = "none" | "pending_sent" | "pending_received" | "friends";

/** Mirrors the server's `DuellistCard` (`GET /community/duellists`). */
export type Duellist = {
  id: string;
  displayName: string;
  tag: string;
  avatar: Avatar;
  bio: string;
  role: string;
  friendStatus: FriendStatus;
  isOnline: boolean;
  createdAt: string;
};

/**
 * Which duellists the list shows.
 *
 * The chips carry a count, so the screen holds the whole list whatever is
 * selected and filters it here — the server is asked only for the search.
 */
export type CommunityFilter = "all" | "friends" | "online" | "blocked";

export type CommunityState = {
  /** `null` while the first answer is on its way: dashes, never a guess. */
  duellists: Duellist[] | null;
  /** The server had more to send: the search has to narrow it down. */
  truncated: boolean;
  /** Read when the blocked chip is opened, so it reflects a block just made. */
  blocked: Duellist[] | null;
  filter: CommunityFilter;
  search: string;
  failure: string | null;
  /** The relation gesture under way, by duellist: its buttons go inert. */
  busy: Set<string>;
};

export const communityState = (): CommunityState => ({
  duellists: null,
  truncated: false,
  blocked: null,
  filter: "all",
  search: "",
  failure: null,
  busy: new Set(),
});
