/**
 * What the duels screen holds between two paints.
 */
import type { Duellist } from "../community/state.js";

export type DuelStatus = "proposed" | "open" | "recorded";

/** Mirrors the server's `DuelSide`. */
export type DuelSide = {
  player: Duellist | null;
  deck: { id: string | null; name: string | null };
  score: number | null;
};

export type DuelTurn = {
  id: string;
  number: number;
  playerId: string;
  authorId: string;
  hostLife: number;
  guestLife: number;
  note: string | null;
};

/** Mirrors the server's `Duel`. */
export type Duel = {
  id: string;
  status: DuelStatus;
  playedOn: string;
  host: DuelSide;
  guest: DuelSide;
  note: string | null;
  winnerId: string | null;
  isHost: boolean;
  createdAt: string;
  recordedAt: string | null;
};

export type DuelDetail = Duel & { turns: DuelTurn[] };

/** A deck of one's own, as the pickers list them. */
export type DeckChoice = { id: string; name: string };

export type DuelState = {
  /** `null` until the list has answered. */
  duels: Duel[] | null;
  /** The duel being looked at, or `null` on the list. */
  open: DuelDetail | null;
  failure: string | null;
  /** The invitation window: whom, when, with which deck. */
  invite: { guestId: string; playedOn: string; deckId: string } | null;
  friends: Duellist[] | null;
  decks: DeckChoice[] | null;
  /** The result window's fields — scores as typed, checked before sending. */
  result: { hostScore: string; guestScore: string; note: string } | null;
  /** Naming the deck one brought, on an open duel. */
  deckPick: { deckId: string } | null;
  /** The next turn being written. */
  turn: { number: number; playerId: string; hostLife: string; guestLife: string; note: string } | null;
  busy: boolean;
};

export const duelState = (): DuelState => ({
  duels: null,
  open: null,
  failure: null,
  invite: null,
  friends: null,
  decks: null,
  result: null,
  deckPick: null,
  turn: null,
  busy: false,
});
