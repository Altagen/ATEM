import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resetOutboundRate, retryAfterMs, throttleOutbound, withOutboundSlot,
} from "./outbound-rate.js";

/**
 * The outbound rate towards YGOPRODeck.
 *
 * The earlier prototype got banned for an hour for counting it badly: it limited API calls
 * but not image downloads, which went out by another path. A limiter per kind
 * of call protects nothing — the total is what counts, and that is why there is
 * only one bucket.
 */
test("calls are spread out over time", async () => {
  resetOutboundRate();
  const started = Date.now();

  // Eight tokens per second: four calls require at least three waiting
  // intervals, the first one leaving immediately.
  await Promise.all([1, 2, 3, 4].map(() => withOutboundSlot(async () => null)));

  const elapsed = Date.now() - started;
  assert.ok(
    elapsed >= 3 * 125 - 20,
    `four calls should take at least ~375 ms, took ${elapsed} ms`,
  );
});

test("call order is preserved", async () => {
  resetOutboundRate();
  const seen: number[] = [];
  await Promise.all(
    [0, 1, 2, 3].map((index) => withOutboundSlot(async () => void seen.push(index))),
  );
  assert.deepEqual(seen, [0, 1, 2, 3]);
});

test("a lone call pays no wait", async () => {
  resetOutboundRate();
  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started < 60, "the first token is available right away");
});

test("the task's value is returned as is", async () => {
  resetOutboundRate();
  assert.equal(await withOutboundSlot(async () => "payload"), "payload");
});

test("a task that throws does not block the bucket", async () => {
  resetOutboundRate();
  await assert.rejects(() => withOutboundSlot(async () => Promise.reject(new Error("outage"))));
  // The next token must be served: otherwise a single network outage would
  // freeze all card resolution until the next restart.
  assert.equal(await withOutboundSlot(async () => "after"), "after");
});

/**
 * Backing off after a 429.
 *
 * A rate refusal is not about the request that received it: it says the
 * instance is talking too much. Retrying it later while the others go out at
 * full rate earns the one-hour address ban — and during that hour, no card gets
 * identified at all.
 */
test("a 429 holds the whole bucket back, not just the refused call", async () => {
  resetOutboundRate();
  throttleOutbound(300);

  const started = Date.now();
  await withOutboundSlot(async () => null);
  const elapsed = Date.now() - started;

  assert.ok(elapsed >= 260, `the next call should wait ~300 ms, took ${elapsed} ms`);
});

test("a shorter back-off does not cut short the one under way", async () => {
  resetOutboundRate();
  throttleOutbound(400);
  throttleOutbound(10);

  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started >= 360, "the longest wait wins");
});

test("the back-off is capped", () => {
  resetOutboundRate();
  // A `Retry-After` of one day must not condemn the instance until tomorrow: we
  // cap at ten minutes, even if it means retrying for nothing.
  throttleOutbound(24 * 3600_000);
  const started = Date.now();
  throttleOutbound(0);
  assert.ok(Date.now() - started < 50, "the function does not block");
});

test("an absurd back-off is ignored", async () => {
  resetOutboundRate();
  throttleOutbound(Number.NaN);
  throttleOutbound(-5);
  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started < 60, "neither NaN nor a negative value holds the bucket");
});

/**
 * `Retry-After` exists in two shapes, and reading only one amounts to ignoring
 * the other in silence — hence setting off again at once, which the header
 * forbade.
 */
test("“Retry-After” reads in seconds", () => {
  assert.equal(retryAfterMs("120"), 120_000);
  assert.equal(retryAfterMs(" 30 "), 30_000);
  assert.equal(retryAfterMs("0"), 0);
});

test("“Retry-After” also reads as an HTTP date", () => {
  const future = new Date(Date.now() + 5_000).toUTCString();
  const delay = retryAfterMs(future);
  assert.ok(delay !== null && delay > 3_000 && delay <= 6_000, `delay read: ${delay}`);

  // A date already past means “right now”, not a negative delay.
  assert.equal(retryAfterMs(new Date(Date.now() - 60_000).toUTCString()), 0);
});

test("a missing or unreadable “Retry-After” says nothing", () => {
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs(""), null);
  assert.equal(retryAfterMs("soon"), null);
});
