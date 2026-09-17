import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, textLengthStatus } from "./limits.js";

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
