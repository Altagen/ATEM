/**
 * The identity of a printed card: the code read on the card itself.
 *
 * This file lives in `shared` rather than in the `referential` module: a set
 * code is not card data, it is the identity the collection stores and that
 * import/export files carry. Three modules depend on it.
 */

/**
 * The region codes met in the YGOPRODeck data, longest first — the order
 * matters for splitting.
 *
 * One-letter codes are those of the old European editions (`PSV-E088`).
 * Measured over the 44,517 real printings: 38,818 in `EN`, 1,808 with no region
 * code at all, 456 in `PT`, 4 in `SE`, and 3,431 that the naive
 * `PREFIX-XX999` shape cannot split — hence the splitting below.
 */
const LONG_REGIONS = [
  "EN", "FR", "DE", "IT", "PT", "SP", "ES", "JP", "JA", "KR", "AE", "SE",
] as const;
const SHORT_REGIONS = ["E", "F", "G", "I", "S", "P", "A"] as const;

/** The English counterpart of a region code, at constant width. */
const TO_ENGLISH: Record<string, string> = {
  FR: "EN", DE: "EN", IT: "EN", PT: "EN", SP: "EN", ES: "EN",
  JP: "EN", JA: "EN", KR: "EN", AE: "EN", SE: "EN", EN: "EN",
  // Old European editions: the English counterpart keeps a single letter.
  F: "E", G: "E", I: "E", S: "E", P: "E", A: "E", E: "E",
};

export type SetCodeParts = {
  /** The set prefix: `LOB`, `NECH`. */
  prefix: string;
  /** The region code, or `null` when the card carries none (`BPT-001`). */
  region: string | null;
  /**
   * The print number, as printed — it may start with a letter
   * (`NECH-ENS10` → `S10`, `SOI-ENSE1` → `SE1`).
   */
  number: string;
};

/** Canonical shape: uppercase, whitespace reduced to a dash. */
export function normalizeSetCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "-");
}

/**
 * Splits a set code into prefix / region / number.
 *
 * Two-letter regions are tried before one-letter ones, otherwise `PSV-E088`
 * would split on a region `E0` that does not exist. A number may start with a
 * letter, which the earlier prototype's version could not read: its shape
 * `([A-Z0-9]{2,5})-([A-Z]{2})(\d{3,4})` left 3,431 printings untranslated,
 * among them every one-letter European edition.
 */
export function parseSetCode(raw: string): SetCodeParts | null {
  const normalized = normalizeSetCode(raw);
  const separator = normalized.lastIndexOf("-");
  if (separator <= 0 || separator === normalized.length - 1) return null;

  const prefix = normalized.slice(0, separator);
  const rest = normalized.slice(separator + 1);
  if (!/^[A-Z0-9]+$/.test(prefix)) return null;

  for (const region of LONG_REGIONS) {
    if (rest.startsWith(region) && rest.length > region.length) {
      return { prefix, region, number: rest.slice(region.length) };
    }
  }
  for (const region of SHORT_REGIONS) {
    if (rest.startsWith(region) && rest.length > region.length) {
      return { prefix, region, number: rest.slice(region.length) };
    }
  }
  return { prefix, region: null, number: rest };
}

/**
 * The language deduced from the printed code. `LTGY-FR008` → `fr`.
 *
 * A code without a region is English: those are the first editions, distributed
 * in English only.
 */
export function languageFromSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts?.region) return "en";
  const lang = parts.region.length === 1 ? SHORT_TO_LANG[parts.region] : parts.region;
  return (lang ?? "en").toLowerCase();
}

/** One-letter regions do not spell their language the same way. */
const SHORT_TO_LANG: Record<string, string> = {
  E: "en", F: "fr", G: "de", I: "it", S: "es", P: "pt", A: "en",
};

/**
 * The canonical shape used as the **local join key**: region removed.
 *
 * `LOB-001` and `LOB-EN001` designate the same printing — the 2002 English
 * cards carried the region-less shape, the European reprints the one with a
 * region. Worse, YGOPRODeck's two entry points disagree: the full dump writes
 * `LOB-001`, while `cardsetsinfo.php` answers on `LOB-EN001`. Joining on the
 * code as written would therefore let two halves of the catalogue ignore each
 * other.
 *
 * Measured over the 44,517 real printings: 33,935 canonical keys, of which only
 * 8 point to two distinct cards (0.02%). The scanner's manual correction screen
 * absorbs those cases.
 */
export function canonicalSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts) return normalizeSetCode(raw);
  return `${parts.prefix}-${parts.number}`;
}

/**
 * The code to query at YGOPRODeck for a given physical code.
 *
 * Measured: `cardsetsinfo.php` knows **only** English codes. `LOB-EN001` and
 * `PSV-E088` answer; `LOB-FR001` and `SDK-FR001` return “No card matching”. So
 * we switch the region to its English counterpart to query, and keep the
 * physical code as the identity of the player's printing.
 */
export function toEnglishLookupSetCode(raw: string): string {
  const parts = parseSetCode(raw);
  if (!parts?.region) return normalizeSetCode(raw);
  const english = TO_ENGLISH[parts.region];
  if (!english || english === parts.region) return normalizeSetCode(raw);
  return `${parts.prefix}-${english}${parts.number}`;
}
