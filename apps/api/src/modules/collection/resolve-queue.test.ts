import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configureResolveQueue, drainNow, enqueueResolve, pendingCount, resetResolveQueue,
} from "./resolve-queue.js";

/**
 * The deferred resolution queue.
 *
 * It had no test at all, although it carries everything that happens **after**
 * the “+1”: a scanned card enters the collection right away, and it is this
 * queue that then finds out what it is. When it gets it wrong, the symptom is a
 * row that stays “awaiting identification” with nothing explaining it — the
 * module's hardest defect to diagnose.
 *
 * These tests touch neither the database nor the network: the queue knows only
 * two functions it is given, and those are exactly what we substitute.
 */

test("each person gets their own attempt on the same code", async () => {
  resetResolveQueue();
  const seen: string[] = [];
  configureResolveQueue({
    attempt: async (userId, setCode) => {
      seen.push(`${userId}|${setCode}`);
      return true;
    },
    abandon: async () => {},
  });

  /**
   * ATEM-old's bug, in one line: de-duplication was by code alone. If A had
   * already queued `LOB-FR001`, B's entry was dropped as a duplicate — and B's
   * row stayed provisional indefinitely. The work to do is not “resolve this
   * code”, it is “repair this person's row”.
   */
  enqueueResolve("user-a", "LOB-FR001");
  enqueueResolve("user-b", "LOB-FR001");
  await drainNow();

  assert.deepEqual(seen, ["user-a|LOB-FR001", "user-b|LOB-FR001"]);
});

test("the same work asked twice is done once", async () => {
  resetResolveQueue();
  let calls = 0;
  configureResolveQueue({
    attempt: async () => {
      calls += 1;
      return true;
    },
    abandon: async () => {},
  });

  enqueueResolve("user-a", "LOB-FR001");
  enqueueResolve("user-a", "LOB-FR001");
  assert.equal(pendingCount(), 1, "a single entry in the queue");

  await drainNow();
  assert.equal(calls, 1);
});

test("an absence is final, and gets recorded", async () => {
  resetResolveQueue();
  const abandoned: string[] = [];
  configureResolveQueue({
    // `false` without an error: the code does not exist at YGOPRODeck.
    attempt: async () => false,
    abandon: async (_userId, setCode) => void abandoned.push(setCode),
  });

  enqueueResolve("user-a", "RA03-FR004UL");
  await drainNow();

  assert.deepEqual(abandoned, ["RA03-FR004UL"]);
  assert.equal(pendingCount(), 0, "we do not ask again for a code we know does not exist");
});

test("an outage is retried, and records nothing", async () => {
  resetResolveQueue();
  let calls = 0;
  let abandons = 0;
  configureResolveQueue({
    attempt: async () => {
      calls += 1;
      throw new Error("network unreachable");
    },
    abandon: async () => void (abandons += 1),
  });

  enqueueResolve("user-a", "LOB-FR001");
  await drainNow();

  assert.equal(calls, 1);
  assert.equal(pendingCount(), 1, "the entry stays queued for another attempt");
  assert.equal(
    abandons,
    0,
    "a network outage is not a non-existent card: nothing must be recorded",
  );
});

test("the queue gives up after four outages, without declaring the code absent", async (t) => {
  resetResolveQueue();
  let calls = 0;
  let abandons = 0;
  configureResolveQueue({
    attempt: async () => {
      calls += 1;
      throw new Error("network unreachable");
    },
    abandon: async () => void (abandons += 1),
  });

  /**
   * The clock is simulated: the queue waits up to 24 s before its fourth
   * attempt, and a test that really sleeps that long ends up deleted or flaky.
   * We move time forward, we do not endure it.
   */
  t.mock.timers.enable({ apis: ["Date"] });

  enqueueResolve("user-a", "LOB-FR001");
  for (let round = 0; round < 5 && pendingCount() > 0; round += 1) {
    await drainNow();
    t.mock.timers.tick(60_000);
  }

  assert.equal(calls, 4, `four attempts expected, ${calls} made`);
  assert.equal(pendingCount(), 0, "the queue lets go instead of spinning forever");
  assert.equal(
    abandons,
    0,
    "after an outage the row must be queued again at the next startup — not filed away",
  );
});

test("an entry that is not due yet is not processed", async () => {
  resetResolveQueue();
  let calls = 0;
  configureResolveQueue({
    attempt: async () => {
      calls += 1;
      throw new Error("network unreachable");
    },
    abandon: async () => {},
  });

  enqueueResolve("user-a", "LOB-FR001");
  await drainNow();
  assert.equal(calls, 1);

  // Right after the failure, the entry carries a wait: draining again must
  // trigger nothing, otherwise the spreading serves no purpose.
  await drainNow();
  assert.equal(calls, 1, "the wait between two attempts must be honoured");

  resetResolveQueue();
});

test("a task that throws does not condemn the following ones", async () => {
  resetResolveQueue();
  const processed: string[] = [];
  configureResolveQueue({
    attempt: async (_userId, setCode) => {
      if (setCode === "RQRQ-FR001") throw new Error("network unreachable");
      processed.push(setCode);
      return true;
    },
    abandon: async () => {},
  });

  enqueueResolve("user-a", "RQRQ-FR001");
  enqueueResolve("user-a", "RQRQ-FR002");
  await drainNow();

  assert.deepEqual(processed, ["RQRQ-FR002"]);
  resetResolveQueue();
});
