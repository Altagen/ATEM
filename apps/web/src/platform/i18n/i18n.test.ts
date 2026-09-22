import { test } from "node:test";
import assert from "node:assert/strict";
import { locale, setLocale, t } from "./index.js";
import { FR } from "./fr.js";

/**
 * English is the key.
 *
 * `t("My collection")` renders the phrase as written in English, and its
 * translation in French. The dictionary is therefore an English → French table,
 * and that is what keeps templates readable: you read the sentence, not an
 * identifier that has to be resolved elsewhere.
 */

// `setLocale` touches the document; there is none under test.
const globalWithDocument = globalThis as { document?: unknown };
globalWithDocument.document ??= { documentElement: { lang: "fr" } };

test("English renders the key itself", () => {
  setLocale("en");
  assert.equal(locale(), "en");
  assert.equal(t("My collection"), "My collection");
  setLocale("fr");
});

test("French renders the translation", () => {
  setLocale("fr");
  assert.equal(t("My collection"), "Ma collection");
});

test("a phrase with no translation falls back to English", () => {
  /**
   * The fallback is deliberate: a message we failed to translate beats a hole.
   * `check-translations.mjs` makes sure it never serves in practice — it
   * refuses any displayed string missing from the dictionary.
   */
  setLocale("fr");
  assert.equal(t("A phrase invented for the test"), "A phrase invented for the test");
});

test("named values land where the language wants them", () => {
  /**
   * That is the reason for `{name}` rather than interpolation: word order
   * changes from one language to the next, and a sentence cut into three pieces
   * around a `${}` cannot be translated.
   */
  setLocale("en");
  assert.equal(t("Lv. {n}", { n: 9 }), "Lv. 9");
  setLocale("fr");
  assert.equal(t("Lv. {n}", { n: 9 }), "Niv. 9");
});

test("a missing value leaves its slot visible", () => {
  // Rather than writing “undefined” in the middle of a sentence: the hole shows,
  // and gets fixed.
  setLocale("en");
  assert.equal(t("Lv. {n}", {}), "Lv. {n}");
  setLocale("fr");
});

test("a null or zero value is still written", () => {
  assert.equal(t("Lv. {n}", { n: 0 }), "Niv. 0");
});

test("an accented slot finds its value", () => {
  /**
   * `\w` does not cover accented letters. When French was the key, `{montrées}`
   * and `{réf}` were displayed as written, braces included, on the collection's
   * summary line. Typing saw nothing — the keys did exist in the object.
   * Placeholders are English now, but a French translation may carry an
   * accented one, so the unicode pattern stays.
   */
  setLocale("fr");
  assert.equal(
    t("{shown}/{total} printing(s) · ×{copies}", { shown: 3, total: 12, copies: 5 }),
    "3/12 édition(s) · 5 ex.",
  );
});

test("no French translation is empty", () => {
  for (const [key, fr] of Object.entries(FR)) {
    assert.ok(fr.trim().length > 0, `“${key}” has no translation`);
  }
});

test("named slots survive translation", () => {
  /**
   * A translation that loses a `{name}` drops a piece of data from the
   * sentence — a card count, a date — without anything signalling it.
   */
  const slots = (phrase: string) =>
    [...phrase.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map((m) => m[1]).sort();

  for (const [key, fr] of Object.entries(FR)) {
    assert.deepEqual(slots(fr), slots(key), `“${key}” and its translation carry different values`);
  }
});
