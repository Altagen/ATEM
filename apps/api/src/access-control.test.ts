import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "./test-support.js";
import { upsertCard, upsertPrint } from "./modules/referential/index.js";
import { adjustQuantity } from "./modules/collection/service.js";
import { resetResolveQueue } from "./modules/collection/resolve-queue.js";
import { createDeck } from "./modules/deck/service.js";
import { createFolder } from "./modules/deck/folders.js";
import { createScanlist } from "./modules/scanlist/service.js";

/**
 * One sweep over the whole write surface, from the outside.
 *
 * The services scope their queries by owner and each module tests its own; this
 * asks the question once for the application as a whole — **can a stranger, who
 * knows an identifier, change something that is not theirs?** — over every route
 * that writes.
 *
 * Written during the security audit of 2026-09-16, because per-module coverage
 * answers “is this route guarded?” and never “is any route unguarded?”. Nothing
 * was found open — the gap was in what we could prove, not in what the code did.
 *
 * Its worth was measured by mutation, and the result is worth recording.
 * Dropping the owner from a folder query is caught by that module's own test
 * first, and the sweep still passes: ownership there is enforced in more than
 * one place, so one missing clause opens nothing. Removing `requireViewer` from
 * a module, on the other hand, is caught **here and nowhere else** — a single
 * missing line, no visible symptom, every route of that module open to anyone.
 * That is the failure this file exists for.
 *
 * A stranger is refused, and the object is **read back afterwards** to check
 * nothing moved: a route answering 403 after writing would pass a test that only
 * looked at the status.
 */
const { app, db } = createTestApp();

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  jsonRequest(app, method, path, body, cookie ? { cookie } : {});

async function ownedCard(passcode: number, setCode: string, userId: string) {
  await upsertCard(db, {
    passcode, nameEn: `Access ${passcode}`, nameFr: null, descEn: null, descFr: null,
    type: "Effect Monster", frameType: "effect", race: "Dragon", attribute: "LIGHT",
    atk: 1, def: 1, level: 4, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
  resetResolveQueue();
  return adjustQuantity(db, userId, { setCode, delta: 1 });
}

test("a stranger who knows an identifier still changes nothing", async () => {
  const owner = await freshSession(app, "access-owner");
  const stranger = await freshSession(app, "access-stranger");

  const row = await ownedCard(74000001, "ACCS-FR001", owner.userId);
  const deck = await createDeck(db, owner.userId, "Access deck");
  const folder = await createFolder(db, owner.userId, { name: "Access folder", parentId: null });
  const batch = await createScanlist(db, owner.userId, { name: "Access batch", lines: [{ setCode: "ACCS-FR001", quantity: 1, name: null, passcode: null }] });

  /**
   * Every route that writes, with the identifier of something owned by someone
   * else. `403` and `404` are both correct answers and the choice is deliberate
   * per resource (ADR-009): a deck says “not yours”, because one day you will be
   * able to look at someone else's; a folder or a batch says “not found”,
   * because nothing will ever put them in front of you, and a 403 there would
   * confirm the thing exists.
   */
  const attempts: [string, string, unknown][] = [
    ["PATCH", `/collection/${row.id}/notes`, { notes: "stolen" }],
    ["PATCH", `/collection/${row.id}/favorite`, { isFavorite: true }],
    ["PATCH", `/decks/${deck.id}`, { name: "stolen" }],
    ["DELETE", `/decks/${deck.id}`, undefined],
    ["PUT", `/decks/${deck.id}/cards`, { passcode: 74000001, zone: "main", quantity: 1 }],
    ["PATCH", `/decks/folders/${folder.id}`, { name: "stolen" }],
    ["DELETE", `/decks/folders/${folder.id}`, undefined],
    ["POST", `/scanlists/${batch.id}/pour`, undefined],
    ["DELETE", `/scanlists/${batch.id}`, undefined],
  ];

  for (const [method, path, body] of attempts) {
    const response = await req(method, path, body, stranger.cookie);
    assert.ok(
      response.status === 403 || response.status === 404,
      `${method} ${path} answered ${response.status}`,
    );
  }

  // Nothing moved. A route that refused after writing would have passed above.
  const deckAfter = await req("GET", `/decks/${deck.id}`, undefined, owner.cookie);
  assert.equal(deckAfter.status, 200, "the deck still exists");
  assert.equal(((await deckAfter.json()) as { name: string }).name, "Access deck");

  const folders = await req("GET", "/decks/folders", undefined, owner.cookie);
  const folderNames = ((await folders.json()) as { items: { name: string }[] }).items
    .map((f) => f.name);
  assert.ok(folderNames.includes("Access folder"), "the folder kept its name and its existence");

  const batches = await req("GET", "/scanlists", undefined, owner.cookie);
  const kept = ((await batches.json()) as { items: { id: string; pouredAt: string | null }[] })
    .items.find((b) => b.id === batch.id);
  assert.ok(kept, "the batch still exists");
  assert.equal(kept?.pouredAt ?? null, null, "and it was not poured by someone else");

  const collection = await req("GET", "/collection", undefined, owner.cookie);
  const item = ((await collection.json()) as { items: { id: number; notes: string | null; isFavorite: boolean }[] })
    .items.find((i) => i.id === row.id);
  assert.equal(item?.notes ?? null, null, "the note was not written");
  assert.equal(item?.isFavorite, false, "the favourite was not set");
});

test("without a session, every write route refuses", async () => {
  /**
   * `requireViewer` is mounted per module, so forgetting it on a new module is a
   * single missing line with no visible symptom — the routes simply work, for
   * everyone. This asks the whole surface at once.
   */
  const attempts: [string, string][] = [
    ["GET", "/collection"],
    ["DELETE", "/collection"],
    ["GET", "/collection/export"],
    ["POST", "/collection/import"],
    ["GET", "/collection/imports"],
    ["POST", "/collection/adjust"],
    ["PATCH", "/collection/1/notes"],
    ["PATCH", "/collection/1/favorite"],
    ["GET", "/decks"],
    ["POST", "/decks"],
    ["GET", "/decks/folders"],
    ["POST", "/decks/folders"],
    ["GET", "/scanlists"],
    ["POST", "/scanlists"],
    ["GET", "/catalogue/cards/89631139"],
    ["GET", "/media/cards/89631139.jpg"],
    ["GET", "/auth/me/account"],
    ["PATCH", "/auth/me"],
    ["POST", "/auth/me/password"],
    ["POST", "/auth/me/email"],
    ["GET", "/players/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["GET", "/community/duellists"],
    ["POST", "/community/friends/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["POST", "/community/friends/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d/accept"],
    ["DELETE", "/community/friends/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["GET", "/community/blocks"],
    ["POST", "/community/blocks/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["DELETE", "/community/blocks/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["GET", "/inbox"],
    ["GET", "/inbox/unread"],
    ["POST", "/inbox/read-all"],
    ["DELETE", "/inbox/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["GET", "/duels"],
    ["POST", "/duels"],
    ["GET", "/duels/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
    ["POST", "/duels/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d/accept"],
    ["DELETE", "/duels/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d"],
  ];

  for (const [method, path] of attempts) {
    const response = await req(method, path, method === "GET" ? undefined : {});
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("an out-of-range identifier is refused, not turned into a server error", async () => {
  /**
   * `Number.isInteger(1e20)` is true — it is a whole number to JavaScript — so
   * the guard passed it to PostgreSQL, which refused the comparison against a
   * `bigint` column. A mistyped address became a 500, with the failed query in
   * the logs. Measured through the running API during the audit of 2026-09-16,
   * then closed here for every numeric identifier at once.
   */
  const { cookie } = await freshSession(app, "range");

  const refused: [string, string][] = [
    ["GET", "/catalogue/cards/99999999999999999999"],
    ["GET", "/catalogue/cards/0"],
    ["GET", "/catalogue/cards/-1"],
    ["GET", "/catalogue/cards/abc"],
    // `integer` overflows far sooner than `bigint`: 2^31 is already too much.
    ["PATCH", "/collection/2147483648/notes"],
    ["PATCH", "/collection/1e20/favorite"],
  ];

  for (const [method, path] of refused) {
    const response = await req(method, path, method === "GET" ? undefined : {}, cookie);
    assert.equal(response.status, 400, `${method} ${path}`);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, "invalid_input", `${method} ${path}`);
  }
});

test("an unexpected failure says nothing about the server", async () => {
  /**
   * Whatever goes wrong, the client is told `internal` and nothing else: no
   * query, no stack, no constraint name. The details belong in the log, where
   * the operator is — and a failed query is a map of the schema to anyone else.
   */
  const { cookie } = await freshSession(app, "opaque");
  const response = await req("GET", "/catalogue/cards/abc", undefined, cookie);
  const body = await response.text();

  assert.doesNotMatch(body, /select |insert |update |from "|drizzle|postgres/i);
  assert.doesNotMatch(body, /\bat \/|\.ts:\d+/, "no stack frame reaches the client");
});
