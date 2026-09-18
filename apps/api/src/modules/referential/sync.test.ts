import { test } from "node:test";
import assert from "node:assert/strict";
import { printRowsFrom } from "./sync.js";
import type { YgoCard } from "./ygoprodeck.js";

/**
 * Building the printings from the dump, without the network.
 *
 * What is tested here is the arbitration: the dump contradicts itself, and the
 * result must not depend on the order it arrives in.
 */

const card = (id: number, sets: [string, string][]): YgoCard => ({
  id,
  name: `Card ${id}`,
  type: "Normal Monster",
  frameType: "normal",
  desc: "",
  card_sets: sets.map(([set_code, set_rarity]) => ({ set_code, set_rarity, set_name: "A set" })),
} as unknown as YgoCard);

test("two cards claiming one printing: the lower passcode keeps it", () => {
  /**
   * YGOPRODeck registers an alternate artwork as its own card, carrying the set
   * codes of the original print. Measured on 2026-09-19: `LOB-FR001` — the 2002
   * Blue-Eyes — landed on 89631146, the alternate art, whose single printing
   * then hid the sheet's “other printings” block.
   */
  const original = card(89631139, [["LOB-FR001", "Ultra Rare"]]);
  const alternate = card(89631146, [["LOB-FR001", "Ultra Rare"]]);

  for (const dump of [[original, alternate], [alternate, original]]) {
    const { rows } = printRowsFrom(dump);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.cardPasscode, 89631139, "the order of the dump changes nothing");
  }
});

test("the same printing listed twice by one card is written once", () => {
  // PostgreSQL refuses an `ON CONFLICT` batch holding the same key twice.
  const { rows } = printRowsFrom([card(46986414, [["LOB-EN005", "Rare"], ["LOB-EN005", "Rare"]])]);
  assert.equal(rows.length, 1);
});

test("a printing whose code has no dash is counted, not written", () => {
  // Twelve entries out of 44,517 are malformed on the source's side.
  const { rows, malformed } = printRowsFrom([card(12345678, [["DB13", "Common"], ["SDY-EN001", "Common"]])]);
  assert.equal(malformed, 1);
  assert.deepEqual(rows.map((row) => row.setCode), ["SDY-EN001"]);
});

test("different rarities of one set code are different printings", () => {
  // They are what the “other printings” block exists to tell apart.
  const { rows } = printRowsFrom([card(89631139, [["LOB-EN001", "Ultra Rare"], ["LOB-EN001", "Secret Rare"]])]);
  assert.equal(rows.length, 2);
});
