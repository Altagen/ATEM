/**
 * Scanlists — taking stock without pouring into the collection.
 *
 * The need: fifty cards arrive and you want to know what is in them before
 * deciding. Pouring them into the collection, then exporting and computing the
 * difference, does not hold — that is a subtraction where not mixing would have
 * been enough.
 *
 * **A scanlist never consults the collection.** It is the inventory of what has
 * just arrived, and nothing else. The scanner's “−1” decrements the batch line,
 * never the collection: a line that reaches zero stays at zero, and one more
 * “−1” removes nothing elsewhere. There is simply no path for that — the batch
 * in progress never leaves the browser.
 *
 * On pouring, the quantities add to the collection's. The list survives, marked
 * “poured”: it keeps the trace of what came in and when, and that is what makes
 * it possible to refuse a second pour. Discarding it stays a separate action —
 * filing and destroying are not the same gesture.
 */

/**
 * A batch line.
 *
 * Its identity is the **set code**, not the passcode: it is the printed copy
 * you hold, not the card in general. The same Blue-Eyes exists as `LOB-FR001`
 * and in sixty other printings.
 */
export type ScanlistLine = {
  setCode: string;
  /**
   * The name, when we have it.
   *
   * It arrives **after** the line: adding does not wait for it. The browser
   * holds the set code at the moment you press, so that is what we display
   * while the catalogue has not answered — and forever, if it never does.
   */
  name: string | null;
  passcode: number | null;
  quantity: number;
};

export type ScanlistSummary = {
  id: string;
  name: string;
  createdAt: string;
  /** The pour date, or `null`: this field is what says “pending”. */
  pouredAt: string | null;
  /** Number of distinct references. */
  lineCount: number;
  /** Sum of copies — what will enter the collection on pouring. */
  copyCount: number;
};

export type ScanlistDetail = ScanlistSummary & { lines: ScanlistLine[] };

/**
 * The outcome of a pour.
 *
 * `poured` counts the copies that actually came in, `failed` the lines the
 * catalogue could not place. Both are returned: a half-poured scanlist must
 * read as such, not as a success.
 */
export type PourResult = {
  poured: number;
  failed: number;
  pouredAt: string;
  errors: { setCode: string; error: string }[];
};

/** The export format version, written to the file and read back on import. */
export const SCANLIST_EXPORT_VERSION = 1;

/**
 * A line at zero does not enter a saved list.
 *
 * It stays visible while scanning — that is what lets you see what you just
 * cancelled, and the floor is zero, never less. But a line declaring zero
 * copies says nothing worth keeping.
 */
export const keptForSaving = (lines: ScanlistLine[]): ScanlistLine[] =>
  lines.filter((line) => line.quantity > 0);
