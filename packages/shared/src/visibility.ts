/**
 * Who may look at a duellist's collection, or at their decks.
 *
 * Asked for by the maintainer on 2026-09-21, to close M4: each duellist chooses, for the
 * collection and for the decks separately. “Friends” is the default — open
 * enough that a friend can see what you play before a duel, closed to the rest
 * of the instance until you say otherwise.
 */
export const VISIBILITIES = ["everyone", "friends", "private"] as const;

export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_DEFAULT: Visibility = "friends";

export const isVisibility = (value: string): value is Visibility =>
  (VISIBILITIES as readonly string[]).includes(value);
