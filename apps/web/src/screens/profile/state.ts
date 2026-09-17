/**
 * What the profile screen holds between two paints.
 */
import type { Avatar } from "@atem/shared";

/** Mirrors the server's `PlayerProfile` (`GET /players/:id`). */
export type PlayerProfile = {
  profile: {
    id: string;
    displayName: string;
    tag: string;
    role: string;
    avatar: Avatar;
    bio: string;
    createdAt: string;
  };
  isSelf: boolean;
  decks: { id: string; name: string; main: number }[];
};

export type ProfileState = {
  /** `null` while loading; then either the profile or why it is not shown. */
  player: PlayerProfile | null;
  failure: string | null;
  /** The edit window's fields, `null` when it is closed. */
  draft: { displayName: string; bio: string; avatar: Avatar } | null;
  saving: boolean;
};

export const profileState = (): ProfileState => ({
  player: null,
  failure: null,
  draft: null,
  saving: false,
});
