/**
 * Translations — **the English phrase is the key**.
 *
 * `t("My collection")` renders “My collection” in English and « Ma collection »
 * in French. Templates stay readable: you read the sentence, not an identifier
 * like `collection.title` that has to be resolved elsewhere.
 *
 * The usual objection to phrase-as-key — editing the source phrase silently
 * orphans its translation — does not hold here: `scripts/check-translations.mjs`
 * rejects any displayed string without a translation **and** any translation
 * nothing uses. The defect is not silent, it fails the build.
 *
 * The dictionary also covers the server's messages. The API answers with the
 * English phrase; the front looks it up before displaying. That is what spares
 * us inventing a distinct error code for each of its thirty sentences.
 *
 * French was the key until 2026-09-14. The project is heading for GitHub, and
 * a reader should not have to speak French to read the source — the displayed
 * language stays French by default, which is a product choice, not a source
 * one.
 */
import { FR } from "./fr.js";

export type Locale = "fr" | "en";

let current: Locale = "fr";

export const locale = (): Locale => current;

/**
 * Sets the interface language.
 *
 * It comes from the account, not from the browser: it is a setting you choose
 * once and find again on your phone as on your computer.
 */
export function setLocale(next: Locale): void {
  current = next;
  document.documentElement.lang = next;
}

/**
 * Translates, and fills in the named values.
 *
 * Values are written `{name}` rather than interpolated: a sentence cut into
 * three pieces around a `${}` cannot be translated — word order changes from
 * one language to the next, and that is precisely what has to move.
 *
 * A key with no French entry falls back to the English phrase. Visible, but not
 * broken — and the gate refuses it long before a user sees it.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const base = current === "en" ? key : (FR[key] ?? key);
  if (!vars) return base;
  /**
   * The pattern is **unicode**, and that is not a detail.
   *
   * `\w` does not cover accented letters: when French was the key, `{montrées}`,
   * `{réf}`, `{étape}` and `{où}` never found their value and were displayed as
   * written, braces included, on the collection's summary line. Typing saw
   * nothing — the keys did exist in the object. Found by the end-to-end test,
   * not by review. Placeholders are English now, but the fix stays: a French
   * translation may well carry an accented one.
   */
  return base.replace(/\{([\p{L}\p{N}_]+)\}/gu, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Translates a message coming from the server.
 *
 * It arrives in English — the key. If it is in the dictionary, we render its
 * version in the current language; otherwise we render it as is. A message we
 * failed to translate beats a generic one that teaches nothing.
 */
export const tServer = (message: string): string => t(message);
