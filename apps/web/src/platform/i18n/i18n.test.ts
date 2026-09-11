import { test } from "node:test";
import assert from "node:assert/strict";
import { locale, setLocale, t } from "./index.js";
import { EN } from "./en.js";

/**
 * Le français est la clé.
 *
 * `t("Ma collection")` rend la phrase telle quelle en français, et sa
 * traduction en anglais. Le dictionnaire est donc une table française →
 * anglaise, et c'est ce qui garde les gabarits lisibles : on y lit la phrase,
 * pas un identifiant qu'il faut aller résoudre ailleurs.
 */

// `setLocale` touche au document ; en test il n'y en a pas.
const globalAvecDocument = globalThis as { document?: unknown };
globalAvecDocument.document ??= { documentElement: { lang: "fr" } };

test("le français rend la clé elle-même", () => {
  setLocale("fr");
  assert.equal(locale(), "fr");
  assert.equal(t("Ma collection"), "Ma collection");
});

test("l'anglais rend la traduction", () => {
  setLocale("en");
  assert.equal(t("Ma collection"), "My collection");
  setLocale("fr");
});

test("une phrase sans traduction repart en français", () => {
  /**
   * Le repli est délibéré : un message qu'on n'a pas su traduire vaut mieux
   * qu'un trou. La barrière `check-translations.mjs` s'assure que ce repli ne
   * serve jamais en pratique — elle refuse toute chaîne sans anglais.
   */
  setLocale("en");
  assert.equal(t("Phrase inventée pour l'épreuve"), "Phrase inventée pour l'épreuve");
  setLocale("fr");
});

test("les valeurs nommées se placent où la langue les veut", () => {
  /**
   * C'est la raison des `{nom}` plutôt que d'une interpolation : l'ordre des
   * mots change d'une langue à l'autre, et une phrase coupée en trois morceaux
   * autour d'un `${}` ne se traduit pas.
   */
  setLocale("fr");
  assert.equal(t("Niv. {n}", { n: 9 }), "Niv. 9");
  setLocale("en");
  assert.equal(t("Niv. {n}", { n: 9 }), "Lv. 9");
  setLocale("fr");
});

test("une valeur absente laisse son emplacement visible", () => {
  // Plutôt que d'écrire « undefined » au milieu d'une phrase : le trou se voit,
  // et se corrige.
  assert.equal(t("Niv. {n}", {}), "Niv. {n}");
});

test("une valeur nulle ou zéro s'écrit quand même", () => {
  assert.equal(t("Niv. {n}", { n: 0 }), "Niv. 0");
});

test("un emplacement accentué trouve sa valeur", () => {
  /**
   * `\w` ne couvre pas les lettres accentuées : `{montrées}` et `{réf}`
   * s'affichaient tels quels, accolades comprises, sur la ligne de bilan de la
   * collection. Le typage n'y voyait rien — les clés existaient dans l'objet.
   */
  setLocale("fr");
  assert.equal(
    t("{montrées}/{total} édition(s) · {ex} ex.", { montrées: 3, total: 12, ex: 5 }),
    "3/12 édition(s) · 5 ex.",
  );
  setLocale("en");
  assert.equal(
    t("{réf} référence(s) · {ex} ex.", { réf: 4, ex: 9 }),
    "4 reference(s) · ×9",
  );
  setLocale("fr");
});

test("aucune traduction anglaise n'est vide", () => {
  for (const [fr, en] of Object.entries(EN)) {
    assert.ok(en.trim().length > 0, `« ${fr} » n'a pas de traduction`);
  }
});

test("les emplacements nommés survivent à la traduction", () => {
  /**
   * Une traduction qui perd un `{nom}` fait disparaître une donnée de la
   * phrase — un nombre de cartes, une date — sans que rien ne le signale.
   */
  const emplacements = (phrase: string) =>
    [...phrase.matchAll(/\{([\p{L}\p{N}_]+)\}/gu)].map((m) => m[1]).sort();

  for (const [fr, en] of Object.entries(EN)) {
    assert.deepEqual(
      emplacements(en),
      emplacements(fr),
      `« ${fr} » et sa traduction ne portent pas les mêmes valeurs`,
    );
  }
});
