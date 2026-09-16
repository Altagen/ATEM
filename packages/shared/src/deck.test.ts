import { test } from "node:test";
import assert from "node:assert/strict";
import {
  banlistMaxCopies, checkDeckAdd, DECK_MAIN_TARGET_DEFAULT, DECK_MAIN_TARGET_STEPS, deckStatus,
  isExtraDeckCard, missingCopies, parseBanlistStatus,
} from "./deck.js";

/**
 * The building rules, under test.
 *
 * ATEM-old had **no test at all** on decks — no service, no folders, no routes —
 * and that is where two functional gaps were found. So that is where we start.
 */

test("the banlist reads in both of its spellings", () => {
  // YGOPRODeck returns words; some feeds return a number. Both exist, and
  // having seen them is enough to know we do not choose what we receive.
  for (const [raw, expected] of [
    ["Banned", 0], ["Forbidden", 0], ["0", 0],
    ["Limited", 1], ["1", 1],
    ["Semi-Limited", 2], ["semi limited", 2], ["2", 2],
    ["", 3], [null, 3], ["anything at all", 3],
  ] as const) {
    assert.equal(banlistMaxCopies(parseBanlistStatus(raw)), expected, `“${raw}”`);
  }
});

test("“semi” wins over “limited”, which it contains", () => {
  // `Semi-Limited` contains `limited`: testing in the wrong order files it as
  // “limited to 1” instead of 2.
  assert.equal(parseBanlistStatus("Semi-Limited"), "semi_limited");
});

test("the ceiling is the lowest of the three", () => {
  /**
   * Three bounds overlap: the rule of the game (3), the banlist, and what you
   * own. The lowest decides.
   */
  // Owned in numbers, unlimited: the rule of the game bounds at 3.
  assert.equal(checkDeckAdd({ owned: 10, inDeck: 0 }).remainingLegal, 3);
  // Limited: the banlist bounds at 1.
  assert.equal(checkDeckAdd({ banlistTcg: "Limited", owned: 10, inDeck: 0 }).remainingLegal, 1);
  // Only two owned: the collection bounds at 2.
  assert.equal(checkDeckAdd({ owned: 2, inDeck: 0 }).remainingLegal, 2);
});

test("a card you do not own cannot be added", () => {
  // Ange's decision: a deck is bounded by the collection, hence playable by
  // construction.
  const issue = checkDeckAdd({ owned: 0, inDeck: 0 });
  assert.equal(issue.canAdd, false);
  assert.equal(issue.blockedBy, "not_owned");
});

test("a forbidden card is refused for the banlist, even when not owned", () => {
  /**
   * The order of refusals is the one that explains best: saying “you do not own
   * it” of a forbidden card would send you buying it for nothing.
   */
  const issue = checkDeckAdd({ banlistTcg: "Forbidden", owned: 0, inDeck: 0 });
  assert.equal(issue.blockedBy, "forbidden");
});

test("the total covers the whole deck, not one zone", () => {
  /**
   * This is ATEM-old's gap n°1: its uniqueness was
   * `(deck, zone, passcode, set_code)`, so the same card lived on several rows
   * and totalled six copies. The ceiling was checked per row.
   */
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 3 }).canAdd, false);
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 3 }).blockedBy, "max_copies");
});

test("hitting the ceiling for want of copies says so", () => {
  // Two owned, two in the deck: it is not the three-copy rule that blocks.
  const issue = checkDeckAdd({ owned: 2, inDeck: 2 });
  assert.equal(issue.canAdd, false);
  assert.equal(issue.blockedBy, "not_owned");
});

test("the Extra Deck is recognised by the frame, not by the name", () => {
  for (const card of [
    { type: "Fusion Monster", frameType: "fusion" },
    { type: "Synchro Monster", frameType: "synchro" },
    { type: "XYZ Monster", frameType: "xyz" },
    { type: "Link Monster", frameType: "link" },
    // A Pendulum that is also Fusion goes to the Extra: the frame decides.
    { type: "Pendulum Effect Fusion Monster", frameType: "fusion_pendulum" },
  ]) {
    assert.equal(isExtraDeckCard(card), true, card.type);
  }

  for (const card of [
    { type: "Effect Monster", frameType: "effect" },
    { type: "Normal Monster", frameType: "normal" },
    { type: "Spell Card", frameType: "spell" },
    { type: "Trap Card", frameType: "trap" },
    { type: "Pendulum Effect Monster", frameType: "effect_pendulum" },
  ]) {
    assert.equal(isExtraDeckCard(card), false, card.type);
  }
});

test("a shortfall is signalled only when there is one", () => {
  /**
   * Ange's clarification: four copies owned, three in the deck, one sold —
   * nothing happens. Silence when all is well.
   */
  assert.equal(missingCopies(3, 4), 0, "more than needed");
  assert.equal(missingCopies(3, 3), 0, "exactly what is needed");
  assert.equal(missingCopies(3, 1), 2, "two to find");
  assert.equal(missingCopies(0, 0), 0);
});

test("asking for more than what is left says which bound spoke", () => {
  /**
   * The server sets a state — “three in the Main” — not an increment. Asked
   * about the current state, the check answered “nothing blocks”: true of the
   * *first* copy. It then had to be asked again at the edge of the ceiling to
   * know what to answer. `wanted` removes that detour.
   */
  // Two owned, three wanted: the collection is the bound.
  assert.equal(checkDeckAdd({ owned: 2, inDeck: 0, wanted: 3 }).blockedBy, "not_owned");
  // Limited to one, two wanted: the banlist.
  assert.equal(
    checkDeckAdd({ banlistTcg: "Limited", owned: 3, inDeck: 0, wanted: 2 }).blockedBy,
    "banlist",
  );
  // Five owned, four wanted: the rule of the game.
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 0, wanted: 4 }).blockedBy, "max_copies");
  // And what goes through says nothing.
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 0, wanted: 3 }).blockedBy, null);
});

test("a deck's verdict names one thing at a time", () => {
  const full = { main: 40, extra: 0, side: 0 };
  const D = DECK_MAIN_TARGET_DEFAULT;
  assert.equal(deckStatus(full, 0, D).kind, "ready");
  assert.equal(deckStatus({ main: 60, extra: 15, side: 15 }, 0, D).kind, "ready", "at the limits");
  assert.equal(deckStatus({ main: 0, extra: 0, side: 0 }, 0, D).kind, "empty");

  // Under construction: enough to write “28 more in the Main”.
  assert.deepEqual(deckStatus({ main: 12, extra: 0, side: 0 }, 0, D), {
    kind: "short", missing: 28, target: 40,
  });

  // Above a limit: the offending zone and how many to remove.
  assert.deepEqual(deckStatus({ main: 61, extra: 0, side: 0 }, 0, D), {
    kind: "over", zone: "main", excess: 1,
  });
  assert.deepEqual(deckStatus({ main: 40, extra: 16, side: 0 }, 0, D), {
    kind: "over", zone: "extra", excess: 1,
  });

  // The shortfall counts even on a deck of legal size.
  assert.deepEqual(deckStatus(full, 2, D), { kind: "missing", missing: 2 });
});

test("the target moves the finish line, never the legality", () => {
  /**
   * A deck aimed at 60 is not finished at 40, even though it is playable there:
   * the player said 60. And a deck aimed at 40 is finished at 40, even though
   * the rules would allow twenty more.
   */
  assert.deepEqual(deckStatus({ main: 40, extra: 0, side: 0 }, 0, 60), {
    kind: "short", missing: 20, target: 60,
  });
  assert.equal(deckStatus({ main: 60, extra: 0, side: 0 }, 0, 60).kind, "ready");
  assert.equal(deckStatus({ main: 40, extra: 0, side: 0 }, 0, 40).kind, "ready");

  /**
   * The sixty-first card is refused whatever the target, and a forty-first is
   * accepted whatever the target — ATEM-old showed “limit exceeded” there,
   * which is the application inventing a rule.
   */
  assert.equal(deckStatus({ main: 61, extra: 0, side: 0 }, 0, 60).kind, "over");
  assert.equal(deckStatus({ main: 41, extra: 0, side: 0 }, 0, 40).kind, "ready");

  // Every step the picker offers is a target the verdict understands.
  for (const step of DECK_MAIN_TARGET_STEPS) {
    assert.equal(deckStatus({ main: step, extra: 0, side: 0 }, 0, step).kind, "ready", String(step));
    assert.equal(deckStatus({ main: step - 1, extra: 0, side: 0 }, 0, step).kind, "short", String(step));
  }
});

test("the verdict announces first what prevents play", () => {
  /**
   * Three simultaneous warnings do not get read. A 61-card deck missing one
   * copy from the collection is **too big** first: that is what gets fixed
   * first, and it is true whatever you own.
   */
  assert.equal(deckStatus({ main: 61, extra: 0, side: 0 }, 3, DECK_MAIN_TARGET_DEFAULT).kind, "over");
  // And a shortfall comes before incompleteness, which is not a defect.
  assert.equal(deckStatus({ main: 12, extra: 0, side: 0 }, 1, DECK_MAIN_TARGET_DEFAULT).kind, "missing");
});
