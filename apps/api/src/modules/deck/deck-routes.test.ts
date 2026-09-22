import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { adjustQuantity } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";

const { app, db } = createTestApp();

/**
 * The deck routes — what the service cannot test on its own.
 *
 * The service already receives an identity; these tests check **where it comes
 * from**. That is the question the `ownerId` / `viewerId` seam made explicit
 * (ADR-009), and the one the maintainer asked: another player must not be able to modify
 * anything.
 */

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  jsonRequest(app, method, path, body, cookie ? { cookie } : {});

async function cardInCollection(passcode: number, setCode: string, userId: string, copies = 3) {
  await upsertCard(db, {
    passcode, nameEn: `Route ${passcode}`, nameFr: `Route ${passcode}`,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Dragon", attribute: "LIGHT", atk: 1, def: 1, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
  await adjustQuantity(db, userId, { setCode, delta: copies, passcode });
  resetResolveQueue();
}

test("no deck route answers without a session", async () => {
  // The guard is mounted on the whole sub-app: forgetting a single route would
  // be enough to expose everybody's decks.
  for (const [method, path, body] of [
    ["GET", "/decks", undefined],
    ["POST", "/decks", { name: "Sans session" }],
    ["GET", "/decks/00000000-0000-0000-0000-000000000000", undefined],
    ["PATCH", "/decks/00000000-0000-0000-0000-000000000000", { name: "x" }],
    ["DELETE", "/decks/00000000-0000-0000-0000-000000000000", undefined],
    ["PUT", "/decks/00000000-0000-0000-0000-000000000000/cards",
      { passcode: 1, zone: "main", quantity: 1 }],
  ] as const) {
    const response = await req(method, path, body);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("a deck's full life cycle goes through its routes", async () => {
  const { cookie } = await freshSession(app, "deckroute");

  const created = await req("POST", "/decks", { name: "My first deck" }, cookie);
  assert.equal(created.status, 201);
  const deck = (await created.json()) as { id: string; name: string };
  assert.equal(deck.name, "My first deck");

  const list = await req("GET", "/decks", undefined, cookie);
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as { items: unknown[] }).items.length, 1);

  const renamed = await req("PATCH", `/decks/${deck.id}`, { name: "Renamed" }, cookie);
  assert.equal(renamed.status, 200);
  const read = await req("GET", `/decks/${deck.id}`, undefined, cookie);
  assert.equal(((await read.json()) as { name: string }).name, "Renamed");

  assert.equal((await req("DELETE", `/decks/${deck.id}`, undefined, cookie)).status, 200);
  assert.equal((await req("GET", `/decks/${deck.id}`, undefined, cookie)).status, 404);
});

test("nobody writes into someone else's deck, even knowing its identifier", async () => {
  /**
   * This is the guarantee the maintainer asked for. The writing identity comes from the
   * **session**, never from the path: knowing a deck's identifier grants no
   * right over it.
   *
   * **The read answers 404, the writes 403.** The read does not confirm the
   * existence of a deck one is not allowed to see; the write, on the other
   * hand, must tell the truth — “this deck is not yours” — because the day we
   * look at another player's deck, it is in front of us, and “not found” would
   * be a lie nothing explains.
   */
  const owner = await freshSession(app, "owner");
  const intruder = await freshSession(app, "intruder");
  await cardInCollection(71000001, "RTRT-FR001", owner.userId);
  await cardInCollection(71000001, "RTRT-FR002", intruder.userId);

  const created = await req("POST", "/decks", { name: "Mine" }, owner.cookie);
  const deck = (await created.json()) as { id: string };

  for (const [method, path, body] of [
    ["PATCH", `/decks/${deck.id}`, { name: "Stolen" }],
    ["DELETE", `/decks/${deck.id}`, undefined],
    ["PUT", `/decks/${deck.id}/cards`, { passcode: 71000001, zone: "main", quantity: 1 }],
  ] as const) {
    const response = await req(method, path, body, intruder.cookie);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.match(((await response.json()) as { message: string }).message, /not yours/);
  }

  const read = await req("GET", `/decks/${deck.id}`, undefined, intruder.cookie);
  assert.equal(read.status, 404, "the read does not confirm existence");

  // And the deck has not moved.
  const again = await req("GET", `/decks/${deck.id}`, undefined, owner.cookie);
  const state = (await again.json()) as { name: string; cards: unknown[] };
  assert.equal(state.name, "Mine");
  assert.equal(state.cards.length, 0);
});

test("setting a card twice in a row leaves the same deck", async () => {
  /**
   * `PUT` declares a state — “three copies in the Main” — not an increment. A
   * double tap therefore cannot double the quantity, with no counter to
   * reconcile.
   */
  const { cookie, userId } = await freshSession(app, "idempot");
  await cardInCollection(71000002, "RTRT-FR003", userId);
  const deck = (await (await req("POST", "/decks", { name: "Idempotent" }, cookie)).json()) as { id: string };

  const body = { passcode: 71000002, zone: "main", quantity: 2 };
  await req("PUT", `/decks/${deck.id}/cards`, body, cookie);
  const second = await req("PUT", `/decks/${deck.id}/cards`, body, cookie);

  assert.equal(second.status, 200);
  const state = (await second.json()) as { counts: { main: number } };
  assert.equal(state.counts.main, 2);
});

test("an invalid body is refused before reaching the database", async () => {
  const { cookie } = await freshSession(app, "invalid");
  const deck = (await (await req("POST", "/decks", { name: "Validation" }, cookie)).json()) as { id: string };

  for (const body of [
    { passcode: 1, zone: "graveyard", quantity: 1 },
    { passcode: 1, zone: "main", quantity: 4 },
    { passcode: 1, zone: "main", quantity: -1 },
    { passcode: -5, zone: "main", quantity: 1 },
    { zone: "main", quantity: 1 },
  ]) {
    const response = await req("PUT", `/decks/${deck.id}/cards`, body, cookie);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("an empty deck name is refused", async () => {
  const { cookie } = await freshSession(app, "emptyname");
  for (const body of [{ name: "" }, { name: "   " }, {}]) {
    assert.equal((await req("POST", "/decks", body, cookie)).status, 400, JSON.stringify(body));
  }
});

test("an unreadable body does not bring the route down", async () => {
  // A client sending truncated JSON deserves a 400, not an internal error.
  const { cookie } = await freshSession(app, "unreadable");
  const response = await app.request("/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: "{this is not JSON",
  });
  assert.equal(response.status, 400);
});

test("the origin guard protects deck writes", async () => {
  /**
   * `SameSite=Strict` already does the essential; the origin guard is the
   * second lock. It is mounted for the whole application — this test checks
   * that a module added afterwards does inherit it.
   */
  const { cookie } = await freshSession(app, "csrfdeck");
  const response = await app.request("/decks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
      Origin: "https://elsewhere.example",
      Host: "atem.example.com",
    },
    body: JSON.stringify({ name: "From elsewhere" }),
  });
  assert.equal(response.status, 403);
});

test("an identifier that is not a UUID does not bring the route down", async () => {
  // The column is a `uuid`: PostgreSQL refuses the comparison, and without a
  // guard the refusal surfaces as an internal error.
  const { cookie } = await freshSession(app, "notauuid");
  const response = await req("GET", "/decks/not-a-uuid", undefined, cookie);
  assert.ok(
    response.status === 400 || response.status === 404,
    `expected 400 or 404, got ${response.status}`,
  );
});
