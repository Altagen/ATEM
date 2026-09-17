import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";

const { app, db } = createTestApp();

/**
 * Friendship, blocking, and the directory that shows both.
 *
 * A friendship is one row for two people, so most of what can go wrong is a
 * question of symmetry: what each of the two sees, and what remains when one of
 * them refuses.
 */

const req = (method: string, path: string, cookie: string, body?: unknown) =>
  jsonRequest(app, method, path, body, { cookie });

type Card = { id: string; displayName: string; friendStatus: string; isOnline: boolean };

const duellists = async (cookie: string, query = ""): Promise<Card[]> => {
  const response = await req("GET", `/community/duellists${query}`, cookie);
  assert.equal(response.status, 200);
  return ((await response.json()) as { items: Card[] }).items;
};

test("the directory answers a bounded list, and says when it cut it", async () => {
  /**
   * The screen holds the whole answer to count its chips, so an instance with
   * thousands of accounts must not send them all — the search narrows instead.
   */
  const viewer = await freshSession(app, "bound-viewer");
  const response = await req("GET", "/community/duellists", viewer.cookie);
  const body = (await response.json()) as { items: Card[]; truncated: boolean };
  assert.ok(body.items.length <= 200, `answered ${body.items.length}`);
  assert.equal(typeof body.truncated, "boolean");
});

const statusOf = (items: Card[], id: string) => items.find((item) => item.id === id)?.friendStatus;

test("a request is pending on both sides, and accepting makes it mutual", async () => {
  const asker = await freshSession(app, "friend-asker");
  const asked = await freshSession(app, "friend-asked");

  const sent = await req("POST", `/community/friends/${asked.userId}`, asker.cookie);
  assert.equal(sent.status, 200);
  assert.equal(((await sent.json()) as { friendStatus: string }).friendStatus, "pending_sent");

  // The same gesture twice sends one request: the pair is unique.
  await req("POST", `/community/friends/${asked.userId}`, asker.cookie);

  assert.equal(statusOf(await duellists(asker.cookie), asked.userId), "pending_sent");
  assert.equal(statusOf(await duellists(asked.cookie), asker.userId), "pending_received",
    "the receiver sees a request to answer, not one they sent");

  // Only the other side may accept — otherwise anyone befriends anyone alone.
  assert.equal((await req("POST", `/community/friends/${asked.userId}/accept`, asker.cookie)).status, 404);

  const accepted = await req("POST", `/community/friends/${asker.userId}/accept`, asked.cookie);
  assert.equal(accepted.status, 200);
  assert.equal(statusOf(await duellists(asker.cookie), asked.userId), "friends");
  assert.equal(statusOf(await duellists(asked.cookie), asker.userId), "friends");
});

test("two people who ask each other are friends without either accepting", async () => {
  // They have both said the same thing: there is nothing left to answer.
  const one = await freshSession(app, "cross-one");
  const two = await freshSession(app, "cross-two");

  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  const back = await req("POST", `/community/friends/${one.userId}`, two.cookie);
  assert.equal(((await back.json()) as { friendStatus: string }).friendStatus, "friends");
  assert.equal(statusOf(await duellists(one.cookie), two.userId), "friends");
});

test("removing, refusing and cancelling all leave both at the start", async () => {
  const one = await freshSession(app, "undo-one");
  const two = await freshSession(app, "undo-two");

  // Cancelling one's own request.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("DELETE", `/community/friends/${two.userId}`, one.cookie);
  assert.equal(statusOf(await duellists(two.cookie), one.userId), "none", "nothing is left to answer");

  // Refusing someone else's.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("DELETE", `/community/friends/${one.userId}`, two.cookie);
  assert.equal(statusOf(await duellists(one.cookie), two.userId), "none");

  // Removing an accepted friendship, from either side.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("POST", `/community/friends/${one.userId}/accept`, two.cookie);
  await req("DELETE", `/community/friends/${two.userId}`, one.cookie);
  assert.equal(statusOf(await duellists(two.cookie), one.userId), "none");
});

test("a block works both ways, severs the link, and hides the profile", async () => {
  const blocker = await freshSession(app, "blocker");
  const blocked = await freshSession(app, "blocked");

  await req("POST", `/community/friends/${blocked.userId}`, blocker.cookie);
  await req("POST", `/community/friends/${blocker.userId}/accept`, blocked.cookie);

  assert.equal((await req("POST", `/community/blocks/${blocked.userId}`, blocker.cookie)).status, 200);

  // Gone from both lists, and the friendship with it.
  assert.equal(statusOf(await duellists(blocker.cookie), blocked.userId), undefined);
  assert.equal(statusOf(await duellists(blocked.cookie), blocker.userId), undefined);

  // The profile answers “not found” — in both directions, and for both.
  assert.equal((await req("GET", `/players/${blocked.userId}`, blocker.cookie)).status, 404);
  assert.equal((await req("GET", `/players/${blocker.userId}`, blocked.cookie)).status, 404);
  // And the blocked person cannot ask again.
  assert.equal((await req("POST", `/community/friends/${blocker.userId}`, blocked.cookie)).status, 404);

  const mine = await req("GET", "/community/blocks", blocker.cookie);
  assert.deepEqual(((await mine.json()) as { items: Card[] }).items.map((item) => item.id), [blocked.userId]);

  assert.equal((await req("DELETE", `/community/blocks/${blocked.userId}`, blocker.cookie)).status, 200);
  assert.equal((await req("GET", `/players/${blocked.userId}`, blocker.cookie)).status, 200);
  assert.equal(statusOf(await duellists(blocker.cookie), blocked.userId), "none",
    "unblocking does not bring the friendship back");
});

test("the directory searches by name and by number, and puts friends first", async () => {
  const viewer = await freshSession(app, "dir-viewer");
  const friend = await freshSession(app, "dir-friend");
  const stranger = await freshSession(app, "dir-stranger");
  await req("POST", `/community/friends/${friend.userId}`, viewer.cookie);
  await req("POST", `/community/friends/${viewer.userId}/accept`, friend.cookie);

  const all = await duellists(viewer.cookie);
  assert.equal(all.some((item) => item.id === viewer.userId), false, "you are not in your own list");
  assert.equal(all[0]?.id, friend.userId, "friends come first");

  // By name…
  const byName = await duellists(viewer.cookie, "?q=Tester%20dir-stranger");
  assert.deepEqual(byName.map((item) => item.id), [stranger.userId]);

  // …and by the number people give out, with or without its “#”.
  const [tag] = await db.execute(sql`select tag from users where id = ${stranger.userId}`)
    .then((rows) => (rows as unknown as { tag: string }[]).map((row) => row.tag));
  const byTag = await duellists(viewer.cookie, `?q=%23${tag}`);
  assert.equal(byTag.some((item) => item.id === stranger.userId), true);

  assert.equal((await req("GET", `/community/duellists?q=${"x".repeat(65)}`, viewer.cookie)).status, 400);
});

test("presence is read from the last request, and the online filter follows it", async () => {
  const viewer = await freshSession(app, "seen-viewer");
  const seen = await freshSession(app, "seen-other");

  // Registering was a request: they are around.
  assert.equal((await duellists(viewer.cookie)).find((item) => item.id === seen.userId)?.isOnline, true);

  // An hour without a request, and they are not.
  await db.execute(sql`update users set last_seen_at = now() - interval '1 hour' where id = ${seen.userId}`);
  assert.equal((await duellists(viewer.cookie)).find((item) => item.id === seen.userId)?.isOnline, false);
});

test("a relation needs two real accounts", async () => {
  const viewer = await freshSession(app, "self-friend");
  assert.equal((await req("POST", `/community/friends/${viewer.userId}`, viewer.cookie)).status, 400,
    "nobody is their own friend");
  assert.equal((await req("POST", "/community/friends/not-a-uuid", viewer.cookie)).status, 400);
  assert.equal(
    (await req("POST", "/community/friends/0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d", viewer.cookie)).status,
    404,
  );

  const suspended = await freshSession(app, "suspended-friend");
  await db.execute(sql`update users set suspended_at = now() where id = ${suspended.userId}`);
  assert.equal((await req("POST", `/community/friends/${suspended.userId}`, viewer.cookie)).status, 404);
  assert.equal((await duellists(viewer.cookie)).some((item) => item.id === suspended.userId), false);
});
