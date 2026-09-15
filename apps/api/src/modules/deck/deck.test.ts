import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { adjustQuantity } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";
import { createDeck, deleteDeck, getDeck, listDecks, updateDeck, setDeckCard } from "./service.js";

const { db } = createTestApp();

/**
 * Decks — the area where ATEM-old had **no test at all**, and where the triage
 * found two functional gaps.
 */

async function newUser() {
  const { user } = await registerUser(db, {
    email: freshEmail("deck"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Duellist",
  });
  return user;
}

/** A card in the catalogue, and `copies` copies in the collection. */
async function seed(
  passcode: number,
  setCode: string,
  options: {
    copies?: number; owner?: string; banlist?: string | null; extra?: boolean;
    image?: string;
  } = {},
) {
  await upsertCard(db, {
    passcode,
    nameEn: `Card ${passcode}`,
    nameFr: `Carte ${passcode}`,
    descEn: null, descFr: null,
    type: options.extra ? "Fusion Monster" : "Effect Monster",
    frameType: options.extra ? "fusion" : "effect",
    race: "Dragon", attribute: "LIGHT", atk: 1000, def: 1000, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null,
    banlistTcg: options.banlist ?? null,
    imageUrl: null, imageUrlSmall: options.image ?? null,
  });
  await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });

  if (options.owner && options.copies) {
    await adjustQuantity(db, options.owner, { setCode, delta: options.copies, passcode });
    resetResolveQueue();
  }
}

test("a deck counts cards, not printings", async () => {
  /**
   * The rule Ange set, and what makes the ceiling expressible: three Blue-Eyes
   * in three set codes remain three Blue-Eyes.
   */
  const user = await newUser();
  await seed(70000001, "DKDK-FR001", { owner: user.id, copies: 1 });
  // Two more printings of the **same** card.
  await upsertPrint(db, { setCode: "DKDK-FR101", cardPasscode: 70000001, rarity: "Ultra Rare" });
  await upsertPrint(db, { setCode: "DKDK-FR102", cardPasscode: 70000001, rarity: "Secret Rare" });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR101", delta: 1, passcode: 70000001 });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR102", delta: 1, passcode: 70000001 });
  resetResolveQueue();

  const deck = await createDeck(db, user.id, "Three codes, one card");
  const after = await setDeckCard(db, user.id, deck.id, {
    passcode: 70000001, zone: "main", quantity: 3,
  });

  assert.equal(after.cards.length, 1, "a single row for the card");
  assert.equal(after.cards[0]?.owned, 3, "the three printings count as three");
  assert.equal(after.counts.main, 3);
});

test("the fourth copy is refused by the database itself", async () => {
  /**
   * ATEM-old's gap n°1: its uniqueness was `(deck, zone, passcode, set_code)`,
   * so the same card lived on several rows and totalled six copies. The ceiling
   * was checked per row, never aggregated.
   *
   * Here the three zones are three columns, and the constraint applies to their
   * sum: even bypassing the service, the database refuses.
   */
  const user = await newUser();
  await seed(70000002, "DKDK-FR002", { owner: user.id, copies: 5 });
  const deck = await createDeck(db, user.id, "Ceiling");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000002, zone: "main", quantity: 3 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000002, zone: "side", quantity: 1 }),
    /no more than 3/,
  );

  const read = await getDeck(db, user.id, deck.id);
  assert.equal(read.counts.main + read.counts.extra + read.counts.side, 3);
});

test("the total covers every zone at once", async () => {
  const user = await newUser();
  await seed(70000003, "DKDK-FR003", { owner: user.id, copies: 5 });
  const deck = await createDeck(db, user.id, "Spread out");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "main", quantity: 2 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "side", quantity: 1 });

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "side", quantity: 2 }),
    /no more than 3|that many/,
  );
});

test("a card one does not own does not go into a deck", async () => {
  // Ange's decision: a deck is bounded by the collection, hence playable.
  const user = await newUser();
  await seed(70000004, "DKDK-FR004");
  const deck = await createDeck(db, user.id, "Without the card");

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000004, zone: "main", quantity: 1 }),
    /do not own enough/,
  );
});

test("no more go in than one owns", async () => {
  const user = await newUser();
  await seed(70000005, "DKDK-FR005", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "Only two");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000005, zone: "main", quantity: 2 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000005, zone: "main", quantity: 3 }),
    /do not own enough/,
  );
});

test("the banlist bounds before the collection does", async () => {
  /**
   * `checkDeckAdd` existed in ATEM-old and did this computation correctly — it
   * simply was **never called server-side**. It was a display helper: the
   * screen greyed a button out, nothing stopped the request.
   */
  const user = await newUser();
  await seed(70000006, "DKDK-FR006", { owner: user.id, copies: 3, banlist: "Limited" });
  const deck = await createDeck(db, user.id, "Limited one");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000006, zone: "main", quantity: 1 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000006, zone: "main", quantity: 2 }),
    /banlist/,
  );
});

test("a forbidden card does not go in, even when owned", async () => {
  const user = await newUser();
  await seed(70000007, "DKDK-FR007", { owner: user.id, copies: 3, banlist: "Forbidden" });
  const deck = await createDeck(db, user.id, "Forbidden one");

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000007, zone: "main", quantity: 1 }),
    /forbidden/,
  );
});

test("the Extra Deck accepts only what belongs to it", async () => {
  const user = await newUser();
  await seed(70000008, "DKDK-FR008", { owner: user.id, copies: 2, extra: true });
  await seed(70000009, "DKDK-FR009", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "Zones");

  // A Fusion in the Main Deck is a dead hand.
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000008, zone: "main", quantity: 1 }),
    /Extra Deck/,
  );
  // An Effect monster in the Extra is illegal.
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000009, zone: "extra", quantity: 1 }),
    /not belong in the Extra/,
  );

  // Each in its place, on the other hand.
  await setDeckCard(db, user.id, deck.id, { passcode: 70000008, zone: "extra", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000009, zone: "main", quantity: 1 });
  const read = await getDeck(db, user.id, deck.id);
  assert.equal(read.counts.extra, 1);
  assert.equal(read.counts.main, 1);
});

test("the Side Deck accepts both", async () => {
  // That is the rule of the game: the Side serves to swap cards on both sides.
  const user = await newUser();
  await seed(70000010, "DKDK-FR010", { owner: user.id, copies: 1, extra: true });
  await seed(70000011, "DKDK-FR011", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "Mixed side");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000010, zone: "side", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000011, zone: "side", quantity: 1 });
  assert.equal((await getDeck(db, user.id, deck.id)).counts.side, 2);
});

test("setting zero removes the card from the deck", async () => {
  const user = await newUser();
  await seed(70000012, "DKDK-FR012", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "To empty");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000012, zone: "main", quantity: 2 });
  const emptied = await setDeckCard(db, user.id, deck.id, {
    passcode: 70000012, zone: "main", quantity: 0,
  });
  assert.equal(emptied.cards.length, 0, "no empty row is left behind");
});

test("a shortfall is signalled only when there is one", async () => {
  /**
   * Ange's clarification: four copies owned, three in the deck, one sold —
   * nothing happens. The deck only speaks up when a card is genuinely missing.
   */
  const user = await newUser();
  await seed(70000013, "DKDK-FR013", { owner: user.id, copies: 4 });
  const deck = await createDeck(db, user.id, "Drift");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000013, zone: "main", quantity: 3 });

  assert.equal((await getDeck(db, user.id, deck.id)).missing, 0);

  // One gets sold: three are left, three are needed.
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR013", delta: -1, passcode: 70000013 });
  resetResolveQueue();
  assert.equal((await getDeck(db, user.id, deck.id)).missing, 0, "nothing is missing yet");

  // A second one gets sold: now one is missing.
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR013", delta: -1, passcode: 70000013 });
  resetResolveQueue();
  const after = await getDeck(db, user.id, deck.id);
  assert.equal(after.missing, 1);
  assert.equal(after.cards[0]?.missing, 1);
});

test("the shortfall shows in the deck list too", async () => {
  const user = await newUser();
  await seed(70000014, "DKDK-FR014", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "Full of holes");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000014, zone: "main", quantity: 1 });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR014", delta: -1, passcode: 70000014 });
  resetResolveQueue();

  const list = await listDecks(db, user.id);
  const found = list.find((d) => d.id === deck.id);
  assert.equal(found?.missing, 1, "one sees at a glance which ones are ready");
});

test("two decks with the same name are refused", async () => {
  // Two decks with the same name are impossible to tell apart in a list, and
  // the delete confirmation is typed by name.
  const user = await newUser();
  await createDeck(db, user.id, "Same name");
  await assert.rejects(() => createDeck(db, user.id, "Same name"), /already have a deck with that name/);
});

test("two people may name their deck alike", async () => {
  // Uniqueness is per account: the neighbour's name reserves nothing.
  const a = await newUser();
  const b = await newUser();
  await createDeck(db, a.id, "Blue-Eyes");
  assert.ok(await createDeck(db, b.id, "Blue-Eyes"));
});

test("writing into someone else's deck is forbidden, and says so", async () => {
  /**
   * Asked by Ange: “even if someone forces the route to modify it, in the end
   * they get a 403”.
   *
   * **Not found and forbidden are not the same answer.** A read can blur the
   * two — it is even prudent as long as another's deck cannot be looked at. A
   * write cannot: the day that deck is in front of us, answering “not found”
   * when trying to modify it would be a lie. The guarantee lives in the
   * service, not in the screen that hides the pencil.
   */
  const owner = await newUser();
  const other = await newUser();
  await seed(72000500, "DKAU-FR500", { owner: owner.id, copies: 1 });
  const deck = await createDeck(db, owner.id, "Private");
  await setDeckCard(db, owner.id, deck.id, {
    passcode: 72000500, zone: "main", quantity: 1,
  });

  // The read confirms nothing.
  await assert.rejects(() => getDeck(db, other.id, deck.id), /not found/);

  // The three writes refuse, and name the reason.
  await assert.rejects(() => updateDeck(db, other.id, deck.id, { name: "Stolen" }), /not yours/);
  await assert.rejects(() => deleteDeck(db, other.id, deck.id), /not yours/);
  await assert.rejects(
    () => setDeckCard(db, other.id, deck.id, { passcode: 72000500, zone: "main", quantity: 3 }),
    /not yours/,
  );

  // And nothing moved.
  const read = await getDeck(db, owner.id, deck.id);
  assert.equal(read.name, "Private");
  assert.equal(read.counts.main, 1);
});

test("a deck that does not exist stays not found, even on a write", async () => {
  // The distinction only makes sense one way: we do not say “forbidden” of an
  // identifier that designates nothing.
  const user = await newUser();
  const ghost = "00000000-0000-4000-8000-000000000000";
  await assert.rejects(() => updateDeck(db, user.id, ghost, { name: "x" }), /not found/);
  await assert.rejects(() => deleteDeck(db, user.id, ghost), /not found/);
});

test("discarding a deck takes its cards with it", async () => {
  const user = await newUser();
  await seed(70000015, "DKDK-FR015", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "To discard");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000015, zone: "main", quantity: 1 });

  await deleteDeck(db, user.id, deck.id);
  await assert.rejects(() => getDeck(db, user.id, deck.id), /not found/);
});

test("discarding a deck does not touch the collection", async () => {
  // A deck is an intention, not a possession.
  const user = await newUser();
  await seed(70000016, "DKDK-FR016", { owner: user.id, copies: 3 });
  const deck = await createDeck(db, user.id, "No effect");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000016, zone: "main", quantity: 3 });
  await deleteDeck(db, user.id, deck.id);

  const { listCollection } = await import("../collection/service.js");
  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 3, "the cards are still there");
});

test("a malformed deck identifier is refused, not crashed on", async () => {
  // Same defect as for scanlists, found by the same route test: a `uuid` column
  // compared to anything at all brings the query down.
  const user = await newUser();
  for (const crooked of ["not-a-uuid", "", "12345"]) {
    await assert.rejects(() => getDeck(db, user.id, crooked), /Invalid identifier/, `“${crooked}”`);
    await assert.rejects(() => deleteDeck(db, user.id, crooked), /Invalid identifier/);
    await assert.rejects(() => updateDeck(db, user.id, crooked, { name: "x" }), /Invalid identifier/);
  }
});

test("a full zone refuses the extra card", async () => {
  /**
   * The maximum is refused, the minimum is signalled: a sixteenth Extra card is
   * legal in no situation, whereas a twelve-card deck is a deck under
   * construction.
   */
  const user = await newUser();
  const deck = await createDeck(db, user.id, "Full Extra");

  // Fifteen different Extra cards, one of each.
  for (let i = 0; i < 15; i += 1) {
    const passcode = 72000100 + i;
    await seed(passcode, `DKEX-FR${String(100 + i)}`, { owner: user.id, copies: 1, extra: true });
    await setDeckCard(db, user.id, deck.id, { passcode, zone: "extra", quantity: 1 });
  }
  assert.equal((await getDeck(db, user.id, deck.id)).counts.extra, 15);

  await seed(72000200, "DKEX-FR200", { owner: user.id, copies: 1, extra: true });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 72000200, zone: "extra", quantity: 1 }),
    /Extra Deck is full/,
  );
});

test("replacing a quantity in a full zone stays possible", async () => {
  // The total is computed **outside the row being rewritten**: going from 3 to
  // 2 in a maxed-out zone must not be refused as an addition.
  const user = await newUser();
  const deck = await createDeck(db, user.id, "Maxed side");
  for (let i = 0; i < 5; i += 1) {
    const passcode = 72000300 + i;
    await seed(passcode, `DKSD-FR${String(300 + i)}`, { owner: user.id, copies: 3 });
    await setDeckCard(db, user.id, deck.id, { passcode, zone: "side", quantity: 3 });
  }
  assert.equal((await getDeck(db, user.id, deck.id)).counts.side, 15);

  // The zone is full, but we are reducing: that is allowed.
  const reduced = await setDeckCard(db, user.id, deck.id, {
    passcode: 72000300, zone: "side", quantity: 1,
  });
  assert.equal(reduced.counts.side, 13);
});

test("a deck's cover is the card it plays the most", async () => {
  /**
   * A cover chosen by hand would ask for a column, a picker, and a fix-up when
   * that card leaves the deck. This one is deduced: the most played card **is**
   * the deck's identity.
   */
  const user = await newUser();
  await seed(72000400, "DKCV-FR400", { owner: user.id, copies: 3, image: "https://images.ygoprodeck.com/images/cards_small/72000400.jpg" });
  await seed(72000401, "DKCV-FR401", { owner: user.id, copies: 3, image: "https://images.ygoprodeck.com/images/cards_small/72000401.jpg" });

  const deck = await createDeck(db, user.id, "Cover");
  assert.equal(deck.coverImage, null, "a brand-new deck has no face");

  await setDeckCard(db, user.id, deck.id, { passcode: 72000400, zone: "main", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 72000401, zone: "main", quantity: 3 });

  // The number of copies wins, not row order nor the passcode — here the
  // larger of the two takes it.
  const [summary] = await listDecks(db, user.id);
  assert.equal(summary?.coverImage, "/media/cards/72000401-small.jpg", "the one it plays three times");

  // The full sheet answers the same: one rule, two screens.
  assert.equal((await getDeck(db, user.id, deck.id)).coverImage, "/media/cards/72000401-small.jpg");
});

test("at equal copies, the cover does not change from one request to the next", async () => {
  // Without a tie-break, the row order returned by the database would make the
  // artwork vary on every refresh.
  const user = await newUser();
  await seed(72000410, "DKCV-FR410", { owner: user.id, copies: 2, image: "https://images.ygoprodeck.com/images/cards_small/72000410.jpg" });
  await seed(72000411, "DKCV-FR411", { owner: user.id, copies: 2, image: "https://images.ygoprodeck.com/images/cards_small/72000411.jpg" });

  const deck = await createDeck(db, user.id, "Tie");
  await setDeckCard(db, user.id, deck.id, { passcode: 72000411, zone: "main", quantity: 2 });
  await setDeckCard(db, user.id, deck.id, { passcode: 72000410, zone: "main", quantity: 2 });

  const [summary] = await listDecks(db, user.id);
  assert.equal(summary?.coverImage, "/media/cards/72000410-small.jpg", "the smallest passcode decides");
});

test("a deck holding only Extra cards still has a face", async () => {
  // The Main first, because that is what gets played; but a deck under
  // construction must not be left without artwork.
  const user = await newUser();
  await seed(72000420, "DKCV-FR420", { owner: user.id, copies: 1, extra: true, image: "https://images.ygoprodeck.com/images/cards_small/72000420.jpg" });

  const deck = await createDeck(db, user.id, "Extra only");
  await setDeckCard(db, user.id, deck.id, { passcode: 72000420, zone: "extra", quantity: 1 });

  const [summary] = await listDecks(db, user.id);
  assert.equal(summary?.coverImage, "/media/cards/72000420-small.jpg");
});
