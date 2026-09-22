/**
 * The rules for building a deck.
 *
 * Pure logic, shared by the server and the screen: the workshop greys a button
 * out with the very function that refuses the write. The earlier prototype had already
 * written the essentials — and **never called them server-side**. It was a
 * display helper, not a guard.
 *
 * **A deck counts cards, not printings.** Three Blue-Eyes in three different
 * set codes remain three Blue-Eyes for the three-copy rule. That is the rule of
 * the game, and it is also what makes the ceiling expressible in the database:
 * `deck_cards` holds one row per card, and a table constraint refuses the
 * fourth copy.
 *
 * The earlier prototype could not express it: its row identity was
 * `(deck, zone, passcode, set_code)`, so the same card lived on several rows and
 * totalled six copies without any constraint aggregating them. The ceiling was
 * checked **per row**.
 */

/** The three zones of a deck. The three-copy ceiling applies to their sum. */
export const DECK_ZONES = ["main", "extra", "side"] as const;
export type DeckZone = (typeof DECK_ZONES)[number];

/**
 * The absolute ceiling: three copies of a card in the whole deck.
 *
 * It depends neither on the banlist nor on the date. That is why it lives in
 * the database, in a constraint, and not in code someone could forget to call.
 */
export const DECK_MAX_COPIES = 3;

/**
 * Zone sizes, as the rules of the game set them.
 *
 * **The maximum is refused, the minimum is signalled.** A sixty-first card in
 * the Main Deck is legal in no situation: we refuse it. A twelve-card deck, on
 * the other hand, is a deck under construction — refusing it would prevent
 * building it. The distinction is the same as for the three-copy rule: what can
 * never be true is forbidden, what is not true yet is said.
 */
/**
 * The size a player is building the Main Deck **towards** — their own, per deck.
 *
 * The rules give a range, 40 to 60, and both ends are playable: a 40-card deck
 * draws its combo more often, a 60-card one survives decking out. Which one a
 * deck is aiming for is the player's decision, and nothing in the cards says it.
 * So it is stored per deck, and it is what “how many left?” counts towards.
 *
 * **A target refuses nothing.** It moves the line between “still building” and
 * “finished”, never the legality: the sixty-first card is refused because the
 * rules refuse it, and a forty-first is accepted whatever the target says.
 * The earlier prototype used its `main_size` as a maximum and showed “limit exceeded” on a
 * perfectly legal deck — the application inventing a rule of its own.
 *
 * The default is 40, which is both the most common format and the value that
 * makes the verdict identical to what it was before targets existed.
 */
export const DECK_MAIN_TARGET_DEFAULT = 40;

/**
 * What the picker offers. The stored value is only bounded by the rules' 40–60:
 * a deck aiming for 41 is a legitimate intention, it is simply not worth a line
 * in a menu of five.
 */
export const DECK_MAIN_TARGET_STEPS = [40, 45, 50, 55, 60] as const;

export const DECK_ZONE_LIMITS = {
  main: { min: 40, max: 60 },
  extra: { min: 0, max: 15 },
  side: { min: 0, max: 15 },
} as const satisfies Record<DeckZone, { min: number; max: number }>;

/**
 * Where a deck stands, in a single verdict.
 *
 * `Main 4/60` is a number, not an answer: it says neither whether the deck is
 * playable nor what should be done. So we return **the state**, along with what
 * it takes to write the sentence — how many cards to remove, or to add — and
 * the screen handles the words.
 *
 * **One state at a time, by severity.** Three simultaneous warnings do not get
 * read: we name what prevents play first, what is left to do next.
 *
 * - `over`: above a limit — the deck is refused in tournament.
 * - `missing`: it holds more copies than the collection has. That does not
 *   happen while building (the “+” refuses), but it happens when a card is
 *   later removed from the collection.
 * - `empty`: nothing yet. “40 more in the Main” on a brand-new deck would be
 *   exact and useless.
 * - `short`: under construction, below the deck's target.
 * - `ready`: built to the size it was aimed at.
 */
export type DeckStatus =
  | { kind: "over"; zone: DeckZone; excess: number }
  | { kind: "missing"; missing: number }
  | { kind: "empty" }
  | { kind: "short"; missing: number; target: number }
  | { kind: "ready" };

/**
 * `targetMain` is the deck's own, and it is **required** rather than defaulted
 * here: a call site that forgot it would otherwise get 40 silently and say
 * “ready” about a deck aimed at 60.
 */
export function deckStatus(
  counts: Record<DeckZone, number>,
  missing: number,
  targetMain: number,
): DeckStatus {
  for (const zone of DECK_ZONES) {
    const excess = counts[zone] - DECK_ZONE_LIMITS[zone].max;
    if (excess > 0) return { kind: "over", zone, excess };
  }
  if (missing > 0) return { kind: "missing", missing };
  if (DECK_ZONES.every((zone) => counts[zone] === 0)) return { kind: "empty" };

  if (counts.main < targetMain) {
    return { kind: "short", missing: targetMain - counts.main, target: targetMain };
  }
  return { kind: "ready" };
}

export type BanlistStatus = "unlimited" | "semi_limited" | "limited" | "forbidden";

/**
 * Normalises what the catalogue writes.
 *
 * YGOPRODeck returns “Banned”, “Limited”, “Semi-Limited” — and some feeds
 * return a number. Both shapes are accepted: having seen them is enough to know
 * we do not choose what we receive.
 */
export function parseBanlistStatus(raw: string | null | undefined): BanlistStatus {
  const value = String(raw ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!value) return "unlimited";
  if (value.includes("forbidden") || value === "banned" || value === "ban") return "forbidden";
  if (value.includes("semi")) return "semi_limited";
  if (value.includes("limited") || value === "limit") return "limited";
  if (value === "0") return "forbidden";
  if (value === "1") return "limited";
  if (value === "2") return "semi_limited";
  return "unlimited";
}

/** What the banlist allows: forbidden → 0, limited → 1, semi → 2, else 3. */
export function banlistMaxCopies(status: BanlistStatus): number {
  switch (status) {
    case "forbidden": return 0;
    case "limited": return 1;
    case "semi_limited": return 2;
    default: return DECK_MAX_COPIES;
  }
}

/**
 * Does a card belong in the Extra Deck?
 *
 * The question is settled on the catalogue's `type` and `frameType`, both in
 * English whatever language was asked for. A Pendulum monster that is also
 * Fusion or Synchro goes to the Extra: the frame decides, not the name.
 */
export function isExtraDeckCard(card: { type?: string | null; frameType?: string | null }): boolean {
  const blob = `${card.type ?? ""} ${card.frameType ?? ""}`.toLowerCase();
  return /\b(fusion|synchro|xyz|link)\b/.test(blob);
}

/**
 * What prevents adding more — or `null` when nothing does.
 *
 * Four bounds, four reasons, all reachable. There is no “ok” value: the absence
 * of a blocker is written `null`, which spares one more key in the message
 * tables — a key no path would ever reach.
 */
export type DeckBlockReason = "forbidden" | "banlist" | "not_owned" | "max_copies";

export type DeckAddCheck = {
  status: BanlistStatus;
  /** What the banlist allows. */
  legalMax: number;
  /**
   * The real ceiling: `min(3, owned)`.
   *
   * Ange's decision: **a deck is bounded by the collection.** You cannot put in
   * a card you do not have, so a deck is playable by construction. That is what
   * makes the earlier prototype's “owned / missing” computation moot — there is nothing to
   * be missing at the moment you add.
   */
  hardCap: number;
  /** Already present across the whole deck, main + extra + side together. */
  inDeck: number;
  /** What can still be added while staying legal. */
  remainingLegal: number;
  canAdd: boolean;
  /** What blocks, or `null` when nothing does. */
  blockedBy: DeckBlockReason | null;
};

/**
 * Can this card be taken `wanted` copies further?
 *
 * One function answers, and both sides call it: the workshop to grey out its
 * button — `wanted` is 1 there, “one more” — and the server to refuse a write
 * that sets a state. Two implementations would end up diverging, and it is the
 * server's that counts.
 *
 * `wanted` is what removed a detour: the server used to ask “may I add one?”,
 * received “yes” — nothing blocks the *first* copy — then had to question the
 * function again **at the edge** of the ceiling to know what to answer. It now
 * asks its real question the first time.
 */
export function checkDeckAdd(opts: {
  banlistTcg?: string | null;
  owned: number;
  inDeck: number;
  /** How many more are wanted. 1 by default: “one more”. */
  wanted?: number;
}): DeckAddCheck {
  const status = parseBanlistStatus(opts.banlistTcg);
  const legalMax = banlistMaxCopies(status);
  const owned = Math.max(0, Math.trunc(opts.owned));
  const inDeck = Math.max(0, Math.trunc(opts.inDeck));
  const hardCap = Math.min(DECK_MAX_COPIES, owned);
  const remainingLegal = Math.max(0, Math.min(legalMax, hardCap) - inDeck);
  const wanted = Math.max(1, Math.trunc(opts.wanted ?? 1));

  /**
   * The order of refusals is the one that explains best.
   *
   * A forbidden card you do not own is refused for the banlist, not for the
   * collection: that is the deciding information, the one you would not have
   * guessed. The other way round would send you buying an unplayable card.
   *
   * And the rule of the game comes before the banlist: at three copies both
   * apply, but “three per deck” is what must be said, not “the banlist allows
   * three”.
   */
  const canAdd = wanted <= remainingLegal;

  /**
   * The reason is judged **at the ceiling**, not at the current state.
   *
   * Asking for three copies when two are allowed is not blocked by the first:
   * the third is what blocks. So we look at what happens at the edge —
   * `inDeck + remainingLegal`, the state we would reach by taking all that is
   * left.
   */
  const atEdge = inDeck + remainingLegal;
  let blockedBy: DeckBlockReason | null = null;
  if (!canAdd) {
    if (status === "forbidden") blockedBy = "forbidden";
    else if (owned === 0) blockedBy = "not_owned";
    else if (atEdge >= DECK_MAX_COPIES) blockedBy = "max_copies";
    else if (atEdge >= legalMax) blockedBy = "banlist";
    else blockedBy = "not_owned";
  }

  return { status, legalMax, hardCap, inDeck, remainingLegal, canAdd, blockedBy };
}

/**
 * What a deck lacks to be playable — **and nothing else**.
 *
 * A deck is bounded by the collection when adding, but the collection moves
 * afterwards: a card gets sold, or given away. So the shortfall is computed on
 * read, card by card, and **only when there is one**.
 *
 * Four copies owned, three in the deck, one sold: `max(0, 3 − 3) = 0`. Nothing
 * happens, and nothing is displayed. Silence when all is well.
 */
export const missingCopies = (inDeck: number, owned: number): number =>
  Math.max(0, inDeck - owned);
