import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";

const { app } = createTestApp();

/**
 * The inbox, and what the relation gestures put in it.
 *
 * The rule these tests hold: a line never outlives what it talks about. A
 * request that is cancelled, refused or blocked leaves nothing behind offering
 * to answer it — the earlier prototype's inbox answered such lines with an error.
 */

const req = (method: string, path: string, cookie: string, body?: unknown) =>
  jsonRequest(app, method, path, body, { cookie });

type Item = {
  id: string;
  kind: string;
  isRead: boolean;
  subjectId: string | null;
  actor: { id: string; displayName: string } | null;
};

const inbox = async (cookie: string): Promise<{ items: Item[]; unread: number }> => {
  const response = await req("GET", "/inbox", cookie);
  assert.equal(response.status, 200);
  return (await response.json()) as { items: Item[]; unread: number };
};

test("a friend request lands in the inbox, and accepting tells the other side", async () => {
  const asker = await freshSession(app, "inbox-asker");
  const asked = await freshSession(app, "inbox-asked");

  await req("POST", `/community/friends/${asked.userId}`, asker.cookie);

  const waiting = await inbox(asked.cookie);
  assert.equal(waiting.unread, 1);
  assert.equal(waiting.items[0]?.kind, "friend_request");
  assert.equal(waiting.items[0]?.actor?.id, asker.userId);
  // Nothing in one's own inbox for one's own gesture.
  assert.equal((await inbox(asker.cookie)).items.length, 0);

  await req("POST", `/community/friends/${asker.userId}/accept`, asked.cookie);

  // The request is answered: the line offering to accept it is gone.
  assert.deepEqual((await inbox(asked.cookie)).items.map((item) => item.kind), []);
  const told = await inbox(asker.cookie);
  assert.equal(told.items[0]?.kind, "friend_accepted");
  assert.equal(told.items[0]?.actor?.id, asked.userId);
});

test("a request cancelled, refused or blocked leaves no line behind", async () => {
  const one = await freshSession(app, "inbox-undo-one");
  const two = await freshSession(app, "inbox-undo-two");

  // Cancelled by its sender.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("DELETE", `/community/friends/${two.userId}`, one.cookie);
  assert.equal((await inbox(two.cookie)).items.length, 0);

  // Refused by its recipient.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("DELETE", `/community/friends/${one.userId}`, two.cookie);
  assert.equal((await inbox(two.cookie)).items.length, 0);

  // Blocked before answering.
  await req("POST", `/community/friends/${two.userId}`, one.cookie);
  await req("POST", `/community/blocks/${one.userId}`, two.cookie);
  assert.equal((await inbox(two.cookie)).items.length, 0);
});

test("reading everything, and throwing a line away", async () => {
  const reader = await freshSession(app, "inbox-reader");
  const first = await freshSession(app, "inbox-first");
  const second = await freshSession(app, "inbox-second");
  await req("POST", `/community/friends/${reader.userId}`, first.cookie);
  await req("POST", `/community/friends/${reader.userId}`, second.cookie);

  const both = await inbox(reader.cookie);
  assert.equal(both.unread, 2);

  assert.equal((await (await req("GET", "/inbox/unread", reader.cookie)).json() as { unread: number }).unread, 2);

  await req("POST", "/inbox/read-all", reader.cookie);
  assert.equal((await inbox(reader.cookie)).unread, 0);

  await req("DELETE", `/inbox/${both.items[0]!.id}`, reader.cookie);
  assert.equal((await inbox(reader.cookie)).items.length, 1);
});

test("an inbox is nobody else's to read, mark or empty", async () => {
  const owner = await freshSession(app, "inbox-owner");
  const stranger = await freshSession(app, "inbox-stranger");
  const sender = await freshSession(app, "inbox-sender");
  await req("POST", `/community/friends/${owner.userId}`, sender.cookie);

  const id = (await inbox(owner.cookie)).items[0]!.id;

  assert.equal((await inbox(stranger.cookie)).items.length, 0, "each inbox holds only its own");
  assert.equal((await req("DELETE", `/inbox/${id}`, stranger.cookie)).status, 404);
  await req("POST", "/inbox/read-all", stranger.cookie);

  const after = await inbox(owner.cookie);
  assert.equal(after.unread, 1, "nothing a stranger did touched it");
  assert.equal((await req("DELETE", "/inbox/not-a-uuid", owner.cookie)).status, 400);
});

test("an invitation says which duel it is about", async () => {
  /**
   * Its line is the way into that duel: invitations are not listed on the duels
   * screen — one duel at a time — so without this the inbox led to “no duel
   * under way”.
   */
  const host = await freshSession(app, "inbox-duel-host");
  const guest = await freshSession(app, "inbox-duel-guest");
  await req("POST", `/community/friends/${guest.userId}`, host.cookie);
  await req("POST", `/community/friends/${host.userId}/accept`, guest.cookie);

  const duel = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as { id: string };
  const waiting = (await inbox(guest.cookie)).items[0];
  assert.equal(waiting?.kind, "duel_invite");
  assert.equal(waiting?.subjectId, duel.id);

  // A friend request is about nobody's duel.
  const other = await freshSession(app, "inbox-duel-other");
  await req("POST", `/community/friends/${guest.userId}`, other.cookie);
  const friendLine = (await inbox(guest.cookie)).items.find((item) => item.kind === "friend_request");
  assert.equal(friendLine?.subjectId, null);
});

test("a line does not outlive the account it talks about", async () => {
  // The account is the only thing that makes the line readable: without a name
  // to show, “someone wants to be your friend” says nothing.
  const reader = await freshSession(app, "inbox-gone-reader");
  const leaver = await freshSession(app, "inbox-gone-leaver");
  await req("POST", `/community/friends/${reader.userId}`, leaver.cookie);
  assert.equal((await inbox(reader.cookie)).items.length, 1);

  await jsonRequest(app, "DELETE", "/auth/me", { password: "Un-Mot-De-Passe-1!" }, { cookie: leaver.cookie });
  assert.equal((await inbox(reader.cookie)).items.length, 0);
});
