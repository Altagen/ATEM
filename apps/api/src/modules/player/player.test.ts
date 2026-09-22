import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { createDeck } from "../deck/service.js";

const { app, db } = createTestApp();

/**
 * A profile — written by its owner, read by anyone signed in.
 *
 * The route carries someone else's identity in its path, the first one that
 * does: the tests below are about what that must never allow.
 */

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  jsonRequest(app, method, path, body, cookie ? { cookie } : {});

type PlayerAnswer = {
  profile: Record<string, unknown> & { displayName: string; bio: string; avatar: string };
  isOwner: boolean;
  duels: { played: number; won: number };
};

test("the owner writes bio and avatar in one request, and reads them back as their own", async () => {
  const owner = await freshSession(app, "profile-owner");

  const saved = await req("PATCH", "/auth/me", {
    displayName: "Profile Owner", bio: "  Blue-Eyes, always.  ", avatar: "occult",
  }, owner.cookie);
  assert.equal(saved.status, 200);

  const response = await req("GET", `/players/${owner.userId}`, undefined, owner.cookie);
  assert.equal(response.status, 200);
  const body = (await response.json()) as PlayerAnswer;
  assert.equal(body.isOwner, true);
  assert.equal(body.profile.displayName, "Profile Owner");
  assert.equal(body.profile.bio, "Blue-Eyes, always.", "trimmed");
  assert.equal(body.profile.avatar, "occult");
});

test("another duellist reads the profile — and nothing private", async () => {
  const owner = await freshSession(app, "profile-read-owner");
  const visitor = await freshSession(app, "profile-read-visitor");
  await createDeck(db, owner.userId, "Filed deck");

  const response = await req("GET", `/players/${owner.userId}`, undefined, visitor.cookie);
  assert.equal(response.status, 200);
  const body = (await response.json()) as PlayerAnswer;

  assert.equal(body.isOwner, false);
  assert.equal(body.profile.avatar, "dragon", "the default avatar");
  assert.equal(body.profile.bio, "");
  // What is the account's, not the profile's, never leaves.
  for (const key of ["email", "locale", "passwordHash", "tokenVersion", "suspendedAt"]) {
    assert.equal(key in body.profile, false, `${key} is not part of a profile`);
  }
  /**
   * A profile carries no deck list.
   *
   * Decided with the maintainer on 2026-09-18: nothing goes on a profile for the sake of
   * filling it, and one does not look a duellist up to read their shelf.
   */
  assert.equal("decks" in body, false, "a profile is not a shelf");
  assert.deepEqual(Object.keys(body).sort(), ["duels", "friendStatus", "isOwner", "profile", "sees"]);
});

test("a profile route refuses every write, whoever asks", async () => {
  /**
   * ADR-009: the path carries the owner, so a write here would take its target
   * from the request. The refusal is structural — mounted before any route —
   * so it holds for writes nobody has written yet, which is why the paths below
   * include one that has no handler at all.
   */
  const owner = await freshSession(app, "profile-write-owner");
  await req("PATCH", "/auth/me", { bio: "Untouched" }, owner.cookie);

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    for (const path of [`/players/${owner.userId}`, `/players/${owner.userId}/bio`]) {
      const response = await req(method, path, { bio: "stolen" }, owner.cookie);
      assert.equal(response.status, 405, `${method} ${path}`);
    }
  }

  const after = (await (await req("GET", `/players/${owner.userId}`, undefined, owner.cookie)).json()) as PlayerAnswer;
  assert.equal(after.profile.bio, "Untouched");
});

test("bio and avatar are bounded by the server, not only by the screen", async () => {
  const { cookie } = await freshSession(app, "profile-bounds");

  // At the bound exactly, the counter is red but saving is allowed.
  assert.equal((await req("PATCH", "/auth/me", { bio: "a".repeat(255) }, cookie)).status, 200);
  assert.equal((await req("PATCH", "/auth/me", { bio: "a".repeat(256) }, cookie)).status, 400);
  // Measured before trimming, as the counter measures it.
  assert.equal((await req("PATCH", "/auth/me", { bio: ` ${"a".repeat(255)}` }, cookie)).status, 400);
  // The earlier prototype accepted any `preset:` prefix; only the five offered go through.
  for (const avatar of ["preset:anything", "mage", "", "DRAGON"]) {
    assert.equal((await req("PATCH", "/auth/me", { avatar }, cookie)).status, 400, avatar);
  }
  // Emptying the bio is a change, not an empty request.
  assert.equal((await req("PATCH", "/auth/me", { bio: "" }, cookie)).status, 200);
});

test("an unknown, malformed or suspended player is not found — without a session, nothing", async () => {
  const visitor = await freshSession(app, "profile-missing");
  const suspended = await freshSession(app, "profile-suspended");

  const unknown = await req("GET", "/players/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d", undefined, visitor.cookie);
  assert.equal(unknown.status, 404);
  const malformed = await req("GET", "/players/not-a-uuid", undefined, visitor.cookie);
  assert.equal(malformed.status, 400, "a malformed identifier is not a server error");

  await db.execute(sql`update users set suspended_at = now() where id = ${suspended.userId}`);
  const hidden = await req("GET", `/players/${suspended.userId}`, undefined, visitor.cookie);
  assert.equal(hidden.status, 404, "told apart from an unknown account by nothing");

  const anonymous = await req("GET", `/players/${visitor.userId}`);
  assert.equal(anonymous.status, 401);
});

/**
 * The collection and the decks follow their owner's choice (M4, 2026-09-21):
 * everyone, friends — the default — or nobody else. The answer to a refusal is
 * “not found”, never “private”, and the owner always sees their own.
 */
const befriend = async (a: { userId: string; cookie: string }, b: { userId: string; cookie: string }) => {
  assert.equal((await req("POST", `/community/friends/${b.userId}`, undefined, a.cookie)).status, 200);
  assert.equal((await req("POST", `/community/friends/${a.userId}/accept`, undefined, b.cookie)).status, 200);
};

const shelves = async (ownerId: string, cookie: string) => ({
  collection: (await req("GET", `/players/${ownerId}/collection`, undefined, cookie)).status,
  facets: (await req("GET", `/players/${ownerId}/collection/facets`, undefined, cookie)).status,
  decks: (await req("GET", `/players/${ownerId}/decks`, undefined, cookie)).status,
});

test("by default, friends see the collection and the decks, and strangers do not", async () => {
  const owner = await freshSession(app, "shelf-owner");
  const friend = await freshSession(app, "shelf-friend");
  const stranger = await freshSession(app, "shelf-stranger");
  await befriend(owner, friend);

  assert.deepEqual(await shelves(owner.userId, friend.cookie), { collection: 200, facets: 200, decks: 200 });
  assert.deepEqual(await shelves(owner.userId, stranger.cookie), { collection: 404, facets: 404, decks: 404 });
  assert.deepEqual(await shelves(owner.userId, owner.cookie), { collection: 200, facets: 200, decks: 200 });

  // The profile says so, so the screen offers only what opens.
  const seen = (await (await req("GET", `/players/${owner.userId}`, undefined, stranger.cookie)).json()) as {
    sees: { collection: boolean; decks: boolean };
  };
  assert.deepEqual(seen.sees, { collection: false, decks: false });
});

test("each shelf has its own setting: everyone, and nobody else", async () => {
  const owner = await freshSession(app, "shelf-split-owner");
  const friend = await freshSession(app, "shelf-split-friend");
  const stranger = await freshSession(app, "shelf-split-stranger");
  await befriend(owner, friend);

  const set = await req("PATCH", "/auth/me/visibility", { collection: "everyone", decks: "private" }, owner.cookie);
  assert.equal(set.status, 200);
  assert.deepEqual(((await set.json()) as { visibility: unknown }).visibility, { collection: "everyone", decks: "private" });

  assert.deepEqual(await shelves(owner.userId, stranger.cookie), { collection: 200, facets: 200, decks: 404 });
  assert.deepEqual(await shelves(owner.userId, friend.cookie), { collection: 200, facets: 200, decks: 404 },
    "private is private for friends too");
  assert.deepEqual(await shelves(owner.userId, owner.cookie), { collection: 200, facets: 200, decks: 200 });

  const account = (await (await req("GET", "/auth/me/account", undefined, owner.cookie)).json()) as {
    account: { visibility: unknown };
  };
  assert.deepEqual(account.account.visibility, { collection: "everyone", decks: "private" });

  assert.equal((await req("PATCH", "/auth/me/visibility", { decks: "public" }, owner.cookie)).status, 400);
  assert.equal((await req("PATCH", "/auth/me/visibility", {}, owner.cookie)).status, 400);
});

test("a visitor reads a deck and the collection, but never the notes", async () => {
  const owner = await freshSession(app, "shelf-read-owner");
  const visitor = await freshSession(app, "shelf-read-visitor");
  await req("PATCH", "/auth/me/visibility", { collection: "everyone", decks: "everyone" }, owner.cookie);
  const deck = await createDeck(db, owner.userId, "Shown deck");

  const decks = (await (await req("GET", `/players/${owner.userId}/decks`, undefined, visitor.cookie)).json()) as {
    items: { id: string; name: string }[]; folders: unknown[];
  };
  assert.deepEqual(decks.items.map((item) => item.name), ["Shown deck"]);
  assert.deepEqual(decks.folders, []);
  const one = await req("GET", `/players/${owner.userId}/decks/${deck.id}`, undefined, visitor.cookie);
  assert.equal(one.status, 200);

  // A deck of someone else's, asked through this owner's path, is not found.
  const other = await createDeck(db, visitor.userId, "Not theirs");
  assert.equal((await req("GET", `/players/${owner.userId}/decks/${other.id}`, undefined, visitor.cookie)).status, 404);

  // Notes stay their owner's, even when the collection is open to everyone.
  const added = (await (await req("POST", "/collection/adjust", { setCode: "ZZZZ-FR998", delta: 1 }, owner.cookie))
    .json()) as { item: { id: number } };
  assert.equal((await req("PATCH", `/collection/${added.item.id}/notes`, { notes: "lent to Yugi" }, owner.cookie)).status, 200);
  const page = (await (await req("GET", `/players/${owner.userId}/collection`, undefined, visitor.cookie)).json()) as {
    items: { notes: string | null }[];
  };
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.notes, null);
});

test("a block closes the shelves whatever they are set to, and they refuse writes", async () => {
  const owner = await freshSession(app, "shelf-block-owner");
  const visitor = await freshSession(app, "shelf-block-visitor");
  await req("PATCH", "/auth/me/visibility", { collection: "everyone", decks: "everyone" }, owner.cookie);
  assert.equal((await req("POST", `/community/blocks/${visitor.userId}`, undefined, owner.cookie)).status, 200);
  assert.deepEqual(await shelves(owner.userId, visitor.cookie), { collection: 404, facets: 404, decks: 404 });

  for (const path of [`/players/${owner.userId}/collection`, `/players/${owner.userId}/decks`]) {
    assert.equal((await req("POST", path, {}, owner.cookie)).status, 405);
  }
});
