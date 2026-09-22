/**
 * The bounds, in one place.
 *
 * The earlier prototype lived the drift this file prevents: the same limit decided in three
 * different places, with three values, so that the interface counter showed
 * green on input the API refused.
 *
 * One bound was missing entirely — the quantity of a collection copy had no
 * ceiling at all, where scanlists capped at 1000. A CSV file carrying
 * `quantity=999999999` went through.
 */
export const LIMITS = {
  password: { min: 16, max: 512 },
  displayName: { min: 2, max: 32 },
  /** The profile's bio — the earlier prototype's 255, which its counter and its schema agreed on. */
  bio: { max: 255 },
  email: { max: 254 },
  setCode: { max: 32 },
  deckName: { max: 60 },
  /**
   * The note on a collection copy — condition, provenance, price paid.
   *
   * It was called `deckNotes` while no deck used it: the deck note has been
   * removed for want of a screen showing it, and the name already pointed at
   * the wrong object.
   */
  note: { max: 2000 },
  /** Per collection line as per scanlist line — the same ceiling. */
  quantity: { min: 0, max: 1000 },
  csvImport: { maxBytes: 5 * 1024 * 1024 },
  scanlist: { maxLines: 2000 },
  scanlistName: { min: 1, max: 60 },
} as const;

/**
 * A free text field against its bound, as its counter shows it.
 *
 * Four states, not three: `full` is reached exactly at the bound — the field
 * turns red, one more character overflows — yet saving is still allowed,
 * because the server accepts that length. Only `over` blocks. `warn` starts at
 * 90 % of the bound.
 *
 * The length is `String.length`, UTF-16 units — an emoji outside the basic
 * plane counts two. That is also what `z.string().max()` counts, and the only
 * measure that holds here: a counter in graphemes would show 248 while the
 * server refused 256. Taken from the earlier prototype's `textLengthStatus`.
 */
export type TextLengthStatus = {
  length: number;
  limit: number;
  /** Negative past the bound: the number of characters to remove. */
  remaining: number;
  state: "ok" | "warn" | "full" | "over";
};

export function textLengthStatus(value: string, limit: number): TextLengthStatus {
  const length = value.length;
  const remaining = limit - length;
  const state: TextLengthStatus["state"] =
    length > limit ? "over"
      : length === limit ? "full"
        : length >= Math.ceil(limit * 0.9) ? "warn"
          : "ok";
  return { length, limit, remaining, state };
}
