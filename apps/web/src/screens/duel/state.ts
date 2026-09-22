/**
 * What the duels screen holds between two paints.
 */
import type { DuelPhase } from "@atem/shared";
import type { Duellist } from "../community/state.js";

export type DuelStatus = "proposed" | "accepted" | "playing" | "recorded";

/** Mirrors the server's `DuelSide`. */
export type DuelSide = {
  player: Duellist | null;
  /** The account was deleted — its recorded duels stay with the other player. */
  removed: boolean;
  /** Whether this side won; `null` until the duel is recorded. */
  won: boolean | null;
  deck: { id: string | null; name: string | null };
  life: number;
};

/** Mirrors the server's `DuelEvent`. */
export type DuelEvent = {
  id: string;
  seq: number;
  kind: "start" | "phase" | "turn" | "life";
  turnNumber: number;
  phase: DuelPhase;
  authorId: string | null;
  playerId: string | null;
  delta: number | null;
  hostLife: number;
  guestLife: number;
  note: string | null;
  createdAt: string;
};

/** Mirrors the server's `Duel`. */
export type Duel = {
  id: string;
  status: DuelStatus;
  playedOn: string;
  host: DuelSide;
  guest: DuelSide;
  turnNumber: number | null;
  phase: DuelPhase | null;
  currentPlayerId: string | null;
  note: string | null;
  winnerId: string | null;
  isHost: boolean;
  createdAt: string;
  recordedAt: string | null;
};

export type DuelDetail = Duel & { events: DuelEvent[] };

/** A deck of one's own, as the picker lists them. */
export type DeckChoice = { id: string; name: string };

export type DuelState = {
  /** `null` until the list has answered. */
  duels: Duel[] | null;
  /** The duel being looked at, or `null` on the list. */
  open: DuelDetail | null;
  failure: string | null;
  /** The list shows the duel under way, or the ones already played. */
  showPast: boolean;
  /** The duels already played, paged: they accumulate for as long as one plays. */
  past: Duel[] | null;
  pastCursor: string | null;
  /** The turn-by-turn, newest first or oldest first — the reader chooses. */
  newestFirst: boolean;
  /** The invitation window: whom, when, with which deck. */
  invite: { guestId: string; playedOn: string; deckId: string } | null;
  friends: Duellist[] | null;
  decks: DeckChoice[] | null;
  /** The result window: who won, and a word about it. */
  result: { winnerId: string; note: string } | null;
  /** Naming the deck one brought, before the coin. */
  deckPick: { deckId: string } | null;
/**
   * The victory panel is set aside, to go back and correct a life total.
   *
   * A duellist at zero ends the duel; a duellist at zero **by a mistyped
   * figure** has to be able to put it back.
   */
  correcting: boolean;
  /**
   * The board alone, on a phone: a duel is followed between two hands and a
   * mat, and scrolling to find the life points is one hand too many.
   */
  focus: boolean;
  /** A custom amount, when the offered ones do not fit. */
  life: { amount: string; note: string } | null;
  /**
   * The coin, while it turns.
   *
   * It holds the two names and, once the server has answered, the one it fell
   * on — the screen keeps turning for a moment before settling, because a coin
   * that lands instantly is not a coin flip.
   */
  coin: { names: [string, string]; winner: string | null } | null;
  busy: boolean;
};

export const duelState = (): DuelState => ({
  duels: null,
  open: null,
  failure: null,
  showPast: false,
  past: null,
  pastCursor: null,
  newestFirst: true,
  invite: null,
  friends: null,
  decks: null,
  result: null,
  deckPick: null,
  life: null,
  correcting: false,
  focus: false,
  coin: null,
  busy: false,
});
