import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, textLengthStatus } from "./limits.js";
import { halvedLife } from "./duel.js";

test("a bio's counter goes ok, warn, full, over — and only over blocks", () => {
  const max = LIMITS.bio.max;
  assert.equal(textLengthStatus("", max).state, "ok");
  assert.equal(textLengthStatus("a".repeat(229), max).state, "ok");
  assert.equal(textLengthStatus("a".repeat(230), max).state, "warn");
  assert.equal(textLengthStatus("a".repeat(255), max).state, "full");
  const over = textLengthStatus("a".repeat(258), max);
  assert.equal(over.state, "over");
  assert.equal(over.remaining, -3);
});

test("the length is counted as the server counts it, in UTF-16 units", () => {
  // One emoji outside the basic plane is two units for `z.string().max()` too.
  assert.equal(textLengthStatus("🐉", 10).length, 2);
});

test("halving life points rounds up, in the payer's favour", () => {
  // The maintainer's rule on 2026-09-19: 4001 halved leaves 2001, not 2000.
  assert.equal(halvedLife(8000), 4000);
  assert.equal(halvedLife(4001), 2001);
  assert.equal(halvedLife(1), 1, "one point is not lost by halving");
  assert.equal(halvedLife(0), 0);
});
