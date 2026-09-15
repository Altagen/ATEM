/**
 * The bounds, in one place.
 *
 * ATEM-old lived the drift this file prevents: the same limit decided in three
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
