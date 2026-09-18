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
   * Decided with Ange on 2026-09-18: nothing goes on a profile for the sake of
   * filling it, and one does not look a duellist up to read their shelf.
   */
  assert.equal("decks" in body, false, "a profile is not a shelf");
  assert.deepEqual(Object.keys(body).sort(), ["duels", "friendStatus", "isOwner", "profile"]);
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
  // ATEM-old accepted any `preset:` prefix; only the five offered go through.
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
