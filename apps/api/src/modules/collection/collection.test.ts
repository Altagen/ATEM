import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { cardPrints, cards } from "../referential/schema.js";
import { markUnidentified, upsertCard, upsertPrint } from "../referential/index.js";
import {
  adjustQuantity, listCollection, requeuePendingResolves, reresolve, resolveStatus,
  setFavorite, setNotes, clearCollection } from "./service.js";
import { configureResolveQueue, drainNow, resetResolveQueue } from "./resolve-queue.js";
import { ownedCards } from "./schema.js";

const { db } = createTestApp();

/**
 * Accounts are created by the service, not by the route.
 *
 * These tests are about the collection, not about how authentication travels —
 * and the route applies a rate limit that, at the fifth registration, would
 * fail tests that have nothing to do with it. Going through the service tests
 * what we mean to test.
 */
async function newUser(): Promise<{ id: string }> {
  const { user } = await registerUser(db, {
    email: freshEmail("collec"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Collector",
  });
  return { id: user.id };
}

/**
 * Checks that a write is rejected by a named database constraint.
 *
 * Drizzle wraps the driver's error: its `message` carries the query that
 * failed, and the constraint's name lives in the cause. Without that
 * distinction, an assertion on the message would pass for any SQL error — the
 * test's own typo included.
 */
async function assertRejectedBy(constraint: string, write: () => Promise<unknown>) {
  try {
    await write();
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    assert.equal(
      cause?.constraint_name,
      constraint,
      `expected a rejection by ${constraint}, got ${cause?.constraint_name ?? "no constraint"}`,
    );
    return;
  }
  assert.fail(`the write should have been rejected by ${constraint}`);
}

/** A card and its printing, placed by hand: no test goes out on the network. */
async function seedCard(passcode: number, setCode: string, names: { en: string; fr?: string }) {
  await upsertCard(db, {
    passcode,
    nameEn: names.en,
    nameFr: names.fr ?? null,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Fish", attribute: "WATER", atk: 1000, def: 3000, level: 9, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  return upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
}

test("an unknown code enters the inventory without waiting for the network", async () => {
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, { setCode: "ZZZZ-FR999", delta: 2 });

  assert.equal(item.quantity, 2);
  assert.equal(item.card, null);
  // The row exists, it is counted, and it knows it is awaiting its identity.
  assert.equal(item.print.resolveStatus, "pending");
});

test("input is normalised before identifying the row", async () => {
  const user = await newUser();
  await seedCard(11111111, "TEST-FR001", { en: "Test Card", fr: "Carte de test" });

  await adjustQuantity(db, user.id, { setCode: "test fr001", delta: 1 });
  const again = await adjustQuantity(db, user.id, { setCode: "  TEST-FR001  ", delta: 2 });

  // Three loose spellings, a single row.
  assert.equal(again.quantity, 3);
  const { total } = await listCollection(db, user.id, {});
  assert.equal(total, 1);
});

test("the displayed name follows the copy's language, not the interface's", async () => {
  // A card bought in English stays displayed in English: that is what is
  // written on the cardboard lying on the table.
  const user = await newUser();
  await seedCard(22222222, "AAAA-EN001", { en: "Great White", fr: "Grande Baleine" });
  await seedCard(22222222, "AAAA-FR001", { en: "Great White", fr: "Grande Baleine" });

  await adjustQuantity(db, user.id, { setCode: "AAAA-EN001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "AAAA-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, { sort: "setCode" });
  const byCode = new Map(items.map((item) => [item.setCode, item.card?.name]));
  assert.equal(byCode.get("AAAA-EN001"), "Great White");
  assert.equal(byCode.get("AAAA-FR001"), "Grande Baleine");
});

test("the quantity does not go below zero", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "BBBB-FR001", delta: 1 });
  await assert.rejects(
    () => adjustQuantity(db, user.id, { setCode: "BBBB-FR001", delta: -5 }),
    /fewer than zero/,
  );
});

test("the quantity is capped", async () => {
  // ATEM-old had no upper bound: a CSV with quantity=999999999 went through.
  const user = await newUser();
  await assert.rejects(
    () => adjustQuantity(db, user.id, { setCode: "CCCC-FR001", delta: 1001 }),
    /At most 1000 copies/,
  );
});

test("a row that falls to zero disappears from the collection", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "DDDD-FR001", delta: 2 });
  await adjustQuantity(db, user.id, { setCode: "DDDD-FR001", delta: -2 });

  const { total } = await listCollection(db, user.id, {});
  assert.equal(total, 0);
});

test("a row at zero keeps its note and favourite until the card comes back", async () => {
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, { setCode: "DQDQ-FR001", delta: 1 });
  await setNotes(db, user.id, item.id, "Signed by the artist");
  await setFavorite(db, user.id, item.id, true);

  await adjustQuantity(db, user.id, { setCode: "DQDQ-FR001", delta: -1 });
  const back = await adjustQuantity(db, user.id, { setCode: "DQDQ-FR001", delta: 1 });

  assert.equal(back.quantity, 1);
  assert.equal(back.notes, "Signed by the artist");
  assert.equal(back.isFavorite, true);
});

test("someone else's row is not found, rather than forbidden", async () => {
  // A 403 would confirm the row exists. A 404 says nothing.
  const owner = await newUser();
  const stranger = await newUser();
  const item = await adjustQuantity(db, owner.id, { setCode: "EEEE-FR001", delta: 1 });

  await assert.rejects(() => setFavorite(db, stranger.id, item.id, true), /not found/);
  await setFavorite(db, owner.id, item.id, true);
});

test("an account's collection ignores everyone else's", async () => {
  const first = await newUser();
  const second = await newUser();
  await adjustQuantity(db, first.id, { setCode: "FFFF-FR001", delta: 3 });

  assert.equal((await listCollection(db, second.id, {})).total, 0);
  assert.equal((await listCollection(db, first.id, {})).total, 1);
});

test("consolidating a provisional row loses no copy", async () => {
  // The normal path of every scanned card: the row is provisional first, then
  // re-attached to the real edition. ATEM-old lost copies there when the
  // operation was not atomic.
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "GGGG-FR001", delta: 4 });

  const before = await listCollection(db, user.id, {});
  assert.equal(before.items[0]?.card, null);
  assert.equal(before.items[0]?.quantity, 4);

  // The real edition appears in the catalogue, as after a successful network call.
  await seedCard(33333333, "GGGG-FR001", { en: "Late Card", fr: "Carte tardive" });
  assert.equal(await reresolve(db, user.id, "GGGG-FR001"), true);

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 1, "a single row after consolidation");
  assert.equal(after.items[0]?.quantity, 4, "the four copies are kept");
  assert.equal(after.items[0]?.card?.name, "Carte tardive");
});

test("consolidation merges with an already resolved row", async () => {
  const user = await newUser();
  await seedCard(44444444, "HHHH-FR001", { en: "Known", fr: "Connue" });
  await adjustQuantity(db, user.id, { setCode: "HHHH-FR001", delta: 2 });

  // A second provisional row on the same code, as after a scan that did not
  // find the edition on the first try.
  const placeholder = await upsertPrint(db, {
    setCode: "HHHH-FR001", cardPasscode: null, rarity: "Other",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: placeholder.id, setCode: "HHHH-FR001", quantity: 3,
  });

  await reresolve(db, user.id, "HHHH-FR001");

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 1);
  assert.equal(after.items[0]?.quantity, 5, "2 + 3, nothing lost");
});

test("filters apply to the canonical English values", async () => {
  // Enumerations stay English in the database: a filter stays valid when the
  // user changes their interface language.
  const user = await newUser();
  await seedCard(55555555, "IIII-FR001", { en: "Filtered", fr: "Filtrée" });
  await adjustQuantity(db, user.id, { setCode: "IIII-FR001", delta: 1 });

  assert.equal((await listCollection(db, user.id, { attribute: ["WATER"] })).total, 1);
  assert.equal((await listCollection(db, user.id, { attribute: ["DARK"] })).total, 0);
  assert.equal((await listCollection(db, user.id, { levels: ["9"] })).total, 1);
  assert.equal((await listCollection(db, user.id, { levels: ["10"] })).total, 0);
});

test("an unidentified printing stays visible and filterable", async () => {
  // It is precisely the row the player wants to fix: it must not disappear
  // because it has no card.
  const user = await newUser();
  await seedCard(66666666, "JJJJ-FR001", { en: "Resolved", fr: "Résolue" });
  await adjustQuantity(db, user.id, { setCode: "JJJJ-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "KKKK-FR999", delta: 1 });

  assert.equal((await listCollection(db, user.id, {})).total, 2);
  const unresolved = await listCollection(db, user.id, { unresolvedOnly: true });
  assert.equal(unresolved.total, 1);
  assert.equal(unresolved.items[0]?.setCode, "KKKK-FR999");
});

test("the database refuses a resolved printing without a card", async () => {
  // The invariant does not rest on the code's discipline: PostgreSQL enforces it.
  await assertRejectedBy("card_prints_resolved_has_card", () =>
    db.insert(cardPrints).values({
      setCode: "LLLL-FR001",
      canonicalSetCode: "LLLL-001",
      cardPasscode: null,
      resolveStatus: "resolved",
    }),
  );
});

test("the database refuses an invented resolve status", async () => {
  await assertRejectedBy("card_prints_status_vocab", () =>
    db.insert(cardPrints).values({
      setCode: "MMMM-FR001",
      canonicalSetCode: "MMMM-001",
      cardPasscode: null,
      resolveStatus: "maybe",
    }),
  );
});

test("the catalogue is never written by the collection", async () => {
  // A provisional card creates no row in `cards`: that is what replaces
  // ATEM-old's negative passcodes.
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "NNNN-FR777", delta: 1 });

  /**
   * The question is about **this** printing, not about the size of the table.
   *
   * Counting every row in `cards` before and after made the test depend on
   * what the other test files were doing at that instant — they share one
   * database, and node runs them in parallel. It failed on 2026-09-18 for a
   * card another file inserted in between, which said nothing about the
   * collection.
   */
  const [print] = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.setCode, "NNNN-FR777"))
    .limit(1);
  assert.equal(print?.cardPasscode, null, "no card fabricated for it");
  assert.equal(print?.resolveStatus, "pending");

  const fabricated = await db
    .select({ passcode: cards.passcode })
    .from(cards)
    .where(eq(cards.nameEn, "NNNN-FR777"));
  assert.equal(fabricated.length, 0, "and none named after the code either");
});

test("the player's code is materialised even if only English is in the catalogue", async () => {
  // The normal case after a full import: the catalogue only contains English
  // codes. A French card must nonetheless produce a row carrying the code
  // actually printed, and display the French name.
  //
  // Without that, the row pointed at the English printing: English name on a
  // French card, and a code never typed handed back by the export. A defect
  // seen on screen, not in the code.
  const user = await newUser();
  await seedCard(77777777, "OOOO-EN001", { en: "Great White", fr: "Grande Baleine" });

  const item = await adjustQuantity(db, user.id, { setCode: "OOOO-FR001", delta: 1 });

  assert.equal(item.print.setCode, "OOOO-FR001", "the player's printed code");
  assert.equal(item.print.language, "fr");
  assert.equal(item.print.resolveStatus, "resolved", "re-attached to the known card");
  assert.equal(item.card?.name, "Grande Baleine");
});

test("the region-less notation joins the one with a region", async () => {
  // The YGOPRODeck dump writes “LOB-001”, cardsetsinfo answers on “LOB-EN001”,
  // and cards carry one or the other depending on their print year.
  const user = await newUser();
  await seedCard(88888888, "PPPP-001", { en: "No Region", fr: "Sans région" });

  const item = await adjustQuantity(db, user.id, { setCode: "PPPP-FR001", delta: 1 });

  assert.equal(item.print.setCode, "PPPP-FR001");
  assert.equal(item.card?.name, "Sans région");
});

test("consolidation does not melt two different rarities together", async () => {
  // The unit of the inventory is (set_code, rarity, language). Consolidating
  // across rarity loses no copy, but loses its edition — which contradicts the
  // module's reason for being.
  const user = await newUser();
  await seedCard(99999901, "RRRR-FR001", { en: "Two Rarities", fr: "Deux raretés" });

  // A known edition, in Ultra Rare.
  const ultra = await upsertPrint(db, {
    setCode: "RRRR-FR001", cardPasscode: 99999901, rarity: "Ultra Rare", language: "fr",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: ultra.id, setCode: "RRRR-FR001", quantity: 3,
  });

  // And a second one, in Secret Rare, identified as well.
  const secret = await upsertPrint(db, {
    setCode: "RRRR-FR001", cardPasscode: 99999901, rarity: "Secret Rare", language: "fr",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: secret.id, setCode: "RRRR-FR001", quantity: 2,
  });

  await reresolve(db, user.id, "RRRR-FR001");

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 2, "the two rarities stay distinct");
  const quantities = after.items.map((item) => item.quantity).sort();
  assert.deepEqual(quantities, [2, 3]);
});

test("two simultaneous additions lose no copy", async () => {
  // A double tap on “+1”, or the scanner button pressed twice. The original
  // read-then-write let both read the same quantity and write the same sum: one
  // increment lost, with no error at all.
  const user = await newUser();
  await seedCard(99999902, "SSSS-FR001", { en: "Concurrent", fr: "Concurrent" });

  await Promise.all(
    Array.from({ length: 8 }, () =>
      adjustQuantity(db, user.id, { setCode: "SSSS-FR001", delta: 1 }),
    ),
  );

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.quantity, 8, "eight simultaneous additions make eight copies");
});

test("the passcode identifies the card without waiting", async () => {
  // The fallback when the set code is unreadable: the eight digits at the
  // bottom left stay legible. ATEM-old had this field; it had disappeared.
  const user = await newUser();
  await seedCard(12345678, "TTTT-EN001", { en: "By Passcode", fr: "Par passcode" });

  const item = await adjustQuantity(db, user.id, {
    setCode: "ZZZZ-FR001",
    delta: 1,
    passcode: 12345678,
  });

  assert.equal(item.print.resolveStatus, "resolved", "identified right away");
  assert.equal(item.card?.name, "Par passcode");
  assert.equal(item.setCode, "ZZZZ-FR001", "the player's code stays its identity");
});

test("an unknown passcode does not prevent the addition", async () => {
  // Fetching the card would require a network call, and nothing goes out on a
  // request's path. The row enters as pending, as usual.
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, {
    setCode: "UUUU-FR001",
    delta: 1,
    passcode: 99999999,
  });
  assert.equal(item.print.resolveStatus, "pending");
  assert.equal(item.quantity, 1);
});

test("search finds by passcode too", async () => {
  const user = await newUser();
  await seedCard(24681012, "VVVV-FR001", { en: "Findable", fr: "Trouvable" });
  await adjustQuantity(db, user.id, { setCode: "VVVV-FR001", delta: 1 });

  assert.equal((await listCollection(db, user.id, { query: "24681012" })).total, 1);
  assert.equal((await listCollection(db, user.id, { query: "2468" })).total, 1);
  assert.equal((await listCollection(db, user.id, { query: "99999999" })).total, 0);
});

test("an Xyz rank is not confused with a level", async () => {
  // The API files both under the same field. A Rank 4 Xyz is not a Level 4
  // monster: mixing them produces a filter that means nothing.
  const user = await newUser();
  await upsertCard(db, {
    passcode: 31415926, nameEn: "Xyz Four", nameFr: null, descEn: null, descFr: null,
    type: "XYZ Monster", frameType: "xyz", race: "Warrior", attribute: "DARK",
    atk: 2000, def: 2000, level: 4, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode: "WWWW-FR001", cardPasscode: 31415926, rarity: "Rare" });
  await seedCard(27182818, "WWWW-FR002", { en: "Level Four", fr: "Niveau quatre" });

  await adjustQuantity(db, user.id, { setCode: "WWWW-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "WWWW-FR002", delta: 1 });

  const byRank = await listCollection(db, user.id, { ranks: ["4"] });
  assert.equal(byRank.total, 1);
  assert.equal(byRank.items[0]?.card?.name, "Xyz Four");

  // The level-9 card placed by `seedCard` has no rank 4.
  const byLevel = await listCollection(db, user.id, { levels: ["9"] });
  assert.equal(byLevel.total, 1);
  assert.equal(byLevel.items[0]?.card?.name, "Niveau quatre");
});

test("the sort direction reverses", async () => {
  const user = await newUser();
  await seedCard(11111191, "XAAA-FR001", { en: "Alpha", fr: "Alpha" });
  await seedCard(11111192, "XBBB-FR001", { en: "Beta", fr: "Beta" });
  await adjustQuantity(db, user.id, { setCode: "XAAA-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "XBBB-FR001", delta: 1 });

  const asc = await listCollection(db, user.id, { sort: "setCode", sortDir: "asc" });
  const desc = await listCollection(db, user.id, { sort: "setCode", sortDir: "desc" });

  assert.equal(asc.items[0]?.setCode, "XAAA-FR001");
  assert.equal(desc.items[0]?.setCode, "XBBB-FR001");
});

test("a note is saved and read back", async () => {
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, { setCode: "YYYY-FR001", delta: 1 });

  await setNotes(db, user.id, item.id, "  Bought in store  ");
  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.notes, "Bought in store", "edge whitespace is trimmed");

  await setNotes(db, user.id, item.id, "   ");
  const cleared = await listCollection(db, user.id, {});
  assert.equal(cleared.items[0]?.notes, null, "an empty note is cleared");
});

test("someone else's note is not found", async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const item = await adjustQuantity(db, owner.id, { setCode: "YZZZ-FR001", delta: 1 });
  await assert.rejects(() => setNotes(db, stranger.id, item.id, "theft"), /not found/);
});

test("a card not yet translated is flagged", async () => {
  /**
   * 2,863 cards out of 14,524 have **no** French data at YGOPRODeck — no name,
   * no text. It is not permanent: measured per set, old ones are covered 100%
   * and recent ones 0–60%. The source is behind, it has not given up.
   *
   * The screen must be able to say so, and say it correctly: “Aspischool” is
   * indeed called « Banc d'aspis », it is the catalogue that does not know yet.
   */
  const user = await newUser();
  await upsertCard(db, {
    passcode: 55555591, nameEn: "English Only", nameFr: null,
    descEn: "Destroy one monster.", descFr: null,
    type: "Effect Monster", frameType: "effect", race: "Fiend", attribute: "DARK",
    atk: 1000, def: 1000, level: 4, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode: "ZAAA-FR001", cardPasscode: 55555591, rarity: "Rare" });
  await adjustQuantity(db, user.id, { setCode: "ZAAA-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.card?.name, "English Only", "the name is the English one too");
  assert.equal(items[0]?.card?.desc, "Destroy one monster.");
  assert.equal(items[0]?.card?.frenchPending, true, "the screen must be able to say so");
});

test("a translated card flags nothing", async () => {
  const user = await newUser();
  await seedCard(55555592, "ZBBB-FR001", { en: "Both", fr: "Les deux" });
  await db
    .update(cards)
    .set({ descFr: "Détruisez un monstre." })
    .where(eq(cards.passcode, 55555592));
  await adjustQuantity(db, user.id, { setCode: "ZBBB-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.card?.desc, "Détruisez un monstre.");
  assert.equal(items[0]?.card?.frenchPending, false);
});

/**
 * The catch-up at startup.
 *
 * The resolve queue lives in memory only. A row entered just before a redeploy
 * — or a `docker compose down` — stayed “awaiting identification” **forever**:
 * nothing picked the work up again, and nothing signalled it. The queue's own
 * comment promised the opposite.
 */

/**
 * Replays a startup and returns the codes the queue would ask for again.
 *
 * The database is shared by every test in this file: counting entries would say
 * nothing, since the others' would show up too. So we look at **which** codes
 * the catch-up queues, and search for ours.
 */
async function codesRequeuedAtStartup(): Promise<string[]> {
  resetResolveQueue();
  const asked: string[] = [];
  configureResolveQueue({
    attempt: async (_userId, setCode) => {
      asked.push(setCode);
      return true;
    },
    abandon: async () => {},
  });

  await requeuePendingResolves(db);
  await drainNow();
  resetResolveQueue();
  return asked;
}

test("rows still pending are queued again at startup", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR001", delta: 1 });

  assert.ok(
    (await codesRequeuedAtStartup()).includes("QQQQ-FR001"),
    "the pending row must be picked up",
  );
});

test("a code declared non-existent is not asked for again at startup", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR002", delta: 1 });

  // What the queue does when YGOPRODeck answers “nothing”: an absence, not an
  // outage. Without that mark, every restart fired the call again.
  assert.equal(await markUnidentified(db, "QQQQ-FR002"), 1);

  assert.ok(
    !(await codesRequeuedAtStartup()).includes("QQQQ-FR002"),
    "we do not ask again for a code we know does not exist",
  );
});

test("a non-existent row is still counted as pending on screen", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR003", delta: 1 });
  await markUnidentified(db, "QQQQ-FR003");

  /**
   * The screen adds the two states together: to the player, an unidentified
   * card stays an unidentified card, whether we gave up or not. The
   * `pending` / `unidentified` split serves the queue, not the display.
   */
  const state = await resolveStatus(db, user.id);
  assert.equal(state.unidentified, 1);
  assert.equal(state.pending, 0);
});

test("marking a code absent does not undo an identified printing", async () => {
  await seedCard(99999903, "QQQQ-FR004", { en: "Well known", fr: "Bien connue" });

  const marked = await markUnidentified(db, "QQQQ-FR004");
  assert.equal(marked, 0, "only rows still provisional are concerned");

  const [print] = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.setCode, "QQQQ-FR004"))
    .limit(1);
  assert.equal(print?.resolveStatus, "resolved");
});

test("a row that fell to zero is not picked up at startup", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR005", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR005", delta: -1 });

  assert.ok(
    !(await codesRequeuedAtStartup()).includes("QQQQ-FR005"),
    "nobody owns it any more: there is nothing to identify",
  );
});

test("an unreadable level filter does not bring the query down", async () => {
  const user = await newUser();
  await seedCard(99999904, "LVLX-FR001", { en: "Readable level", fr: "Niveau lisible" });
  await adjustQuantity(db, user.id, { setCode: "LVLX-FR001", delta: 1 });

  /**
   * `?level=abc` reached this point as a non-empty list of non-numeric values:
   * the template wrote `in ()`, which PostgreSQL refuses, and the whole query
   * went out as a 500 with a stack trace. An unreadable filter value is a
   * request nothing matches, not a failure.
   */
  const levels = await listCollection(db, user.id, { levels: ["abc"] });
  assert.equal(levels.total, 0);

  const ranks = await listCollection(db, user.id, { ranks: ["xyz", ""] });
  assert.equal(ranks.total, 0);

  // And a list where some values hold stays a normal filter.
  const mixed = await listCollection(db, user.id, { levels: ["abc", "9"] });
  assert.equal(mixed.total, 1);
});

test("a supplied passcode does not fabricate a second printing of the same code", async () => {
  /**
   * Reported by Ange from the workshop: two rows for the same card, the same
   * code displayed twice, and “×2 owned” on each.
   *
   * The passcode path returned a brand-new printing directly — with no rarity,
   * and **without consulting the local index**. Adding a code already resolved
   * as “Common” with its passcode therefore built a second printing of the same
   * code and language, with an empty rarity. The collection then carried rows
   * on both.
   */
  const user = await newUser();
  await seedCard(88000001, "PCPC-FR001", { en: "Twice", fr: "Deux fois" });

  // The first time without a passcode: resolution establishes the printing.
  await adjustQuantity(db, user.id, { setCode: "PCPC-FR001", delta: 1 });
  // The second with it: this is the path that built the duplicate.
  await adjustQuantity(db, user.id, { setCode: "PCPC-FR001", delta: 1, passcode: 88000001 });

  const prints = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.setCode, "PCPC-FR001"));
  assert.equal(prints.length, 1, "a single printing for one code and one language");

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.total, 1, "a single collection row");
  assert.equal(collection.items[0]?.quantity, 2);
});

test("a known rarity beats an empty one", async () => {
  /**
   * An empty rarity means “we do not know yet”, not “this printing has none”.
   * Asked without a preference, the local lookup found the empty row
   * “exactly” and preferred it to the one resolution had established — a
   * duplicate born elsewhere became the canonical answer.
   */
  // The card is placed under another code: `seedCard` creates its own printing,
  // and we want exactly two printings on the one under test.
  await seedCard(88000002, "PCPC-FR800", { en: "Rarity", fr: "Rareté" });
  // Two printings of the same code: one knows, the other does not.
  await upsertPrint(db, {
    setCode: "PCPC-FR002", cardPasscode: 88000002, rarity: "Ultra Rare", language: "fr",
  });
  await upsertPrint(db, {
    setCode: "PCPC-FR002", cardPasscode: 88000002, rarity: "", language: "fr",
  });

  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "PCPC-FR002", delta: 1 });

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.print.rarity, "Ultra Rare", "the known rarity wins");
});

test("a passcode identifies a printing that was still waiting", async () => {
  // The passcode keeps its purpose: naming the card when the code has not been
  // resolved yet. It must simply no longer create a row next to it.
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "PCPC-FR003", delta: 1 });
  /**
   * We freeze the queue: it is **the waiting** that is under test here.
   *
   * This test has failed intermittently — roughly once in four to eight runs,
   * seen on 2026-09-12 and 2026-09-15, never on demand. The assertions below
   * therefore carry the printings they read: the next occurrence will say what
   * the database actually held, instead of only which line failed.
   */
  resetResolveQueue();
  const prints = () => db.select().from(cardPrints).where(eq(cardPrints.setCode, "PCPC-FR003"));

  const before = await listCollection(db, user.id, {});
  assert.equal(
    before.items[0]?.card,
    null,
    `it is awaiting identification — printings: ${JSON.stringify(await prints())}`,
  );

  await seedCard(88000003, "PCPC-FR900", { en: "Named", fr: "Nommée" });
  await adjustQuantity(db, user.id, { setCode: "PCPC-FR003", delta: 1, passcode: 88000003 });

  const after = await listCollection(db, user.id, {});
  assert.equal(
    after.total,
    1,
    `still a single row — printings: ${JSON.stringify(await prints())}`,
  );
  assert.equal(after.items[0]?.card?.name, "Nommée");
  assert.equal(after.items[0]?.quantity, 2);
});

test("clearing a collection empties it in one go, and only it", async () => {
  /**
   * ATEM-old looped `DELETE /:id` from the browser, one request per card, and a
   * failure halfway left the collection half erased. One statement here — and it
   * touches only this person's printings: another collection, and this person's
   * decks, are left exactly as they were.
   */
  const owner = await newUser();
  const neighbour = await newUser();
  await seedCard(88000401, "CLRC-FR401", { en: "Clear A", fr: "Effacer A" });
  await seedCard(88000402, "CLRC-FR402", { en: "Clear B", fr: "Effacer B" });

  await adjustQuantity(db, owner.id, { setCode: "CLRC-FR401", delta: 3 });
  await adjustQuantity(db, owner.id, { setCode: "CLRC-FR402", delta: 1 });
  await adjustQuantity(db, neighbour.id, { setCode: "CLRC-FR401", delta: 2 });

  const removed = await clearCollection(db, owner.id);
  assert.equal(removed, 2, "it reports what it removed, not a success it did not measure");

  assert.equal((await listCollection(db, owner.id, {})).total, 0);
  const theirs = await listCollection(db, neighbour.id, {});
  assert.equal(theirs.total, 1, "someone else's collection is untouched");
  assert.equal(theirs.items[0]?.quantity, 2);

  // Clearing an empty collection is not an error — it is already the state asked for.
  assert.equal(await clearCollection(db, owner.id), 0);
});
