import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPanelHtml } from "./view.js";
import { EMPTY_FACETS, type ViewState } from "./state.js";

const state = (): ViewState => ({
  loading: false, items: [], total: 0, totalCopies: 0, pending: 0,
  query: "", kind: "", attributes: [], races: [], frameTypes: [], properties: [],
  levels: [], ranks: [], links: [],
  rarity: "", language: "", favoritesOnly: false, unresolvedOnly: false,
  sort: "recent", sortDir: "desc",
  view: "gallery", cols: "auto", density: "comfort", groupByMonster: true, pinned: true,
});

test("une rareté hostile ne peut pas ouvrir d'attribut", () => {
  /**
   * La rareté vient du catalogue distant : `cardsetsinfo.php` la rend telle
   * quelle et les facettes l'affichent. Une valeur qui ferme le guillemet pour
   * ouvrir un gestionnaire d'événement doit ressortir échappée, pas
   * interprétée.
   */
  const hostile = '" onmouseover="alert(1)';
  const html = filterPanelHtml(state(), { ...EMPTY_FACETS, rarities: [hostile] }).toString();

  assert.ok(!html.includes('onmouseover="alert(1)"'), "aucun gestionnaire ne doit apparaître");
  assert.ok(html.includes("&quot;"), "le guillemet doit être échappé");
});

test("un nom d'archétype hostile ne s'échappe pas non plus", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const html = filterPanelHtml(state(), { ...EMPTY_FACETS, races: [hostile] }).toString();

  assert.ok(!html.includes("<img src=x"), "aucune balise ne doit être injectée");
  assert.ok(html.includes("&lt;img"), "le chevron doit être échappé");
});
