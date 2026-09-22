import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPanelHtml } from "./view.js";
import { EMPTY_FACETS, type ViewState } from "./state.js";

const state = (): ViewState => ({
  owner: null, loading: false, items: [], total: 0, totalCopies: 0, pending: 0,
  query: "", kind: "", attributes: [], races: [], frameTypes: [], properties: [],
  levels: [], ranks: [], links: [],
  rarity: "", language: "", favoritesOnly: false, unresolvedOnly: false,
  sort: "recent", sortDir: "desc",
  view: "gallery", cols: "auto", density: "comfort", groupByMonster: true, pinned: true,
});

test("a hostile rarity cannot open an attribute", () => {
  /**
   * Rarity comes from the remote catalogue: `cardsetsinfo.php` returns it as is
   * and the facets display it. A value that closes the quote to open an event
   * handler must come out escaped, not interpreted.
   */
  const hostile = '" onmouseover="alert(1)';
  const html = filterPanelHtml(state(), { ...EMPTY_FACETS, rarities: [hostile] }).toString();

  assert.ok(!html.includes('onmouseover="alert(1)"'), "no handler must appear");
  assert.ok(html.includes("&quot;"), "the quote must be escaped");
});

test("a hostile archetype name does not escape either", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const html = filterPanelHtml(state(), { ...EMPTY_FACETS, races: [hostile] }).toString();

  assert.ok(!html.includes("<img src=x"), "no tag must be injected");
  assert.ok(html.includes("&lt;img"), "the angle bracket must be escaped");
});
