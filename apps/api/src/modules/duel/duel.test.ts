import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { createDeck } from "../deck/service.js";

const { app, db } = createTestApp();

/**
 * Duels, rule by rule against `docs/ref-duels.md`.
 *
 * ATEM records a duel played in person; it does not referee one. So what is
 * tested here is who may write what, and when — never the game.
 */

const req = (method: string, path: string, cookie: string, body?: unknown) =>
  jsonRequest(app, method, path, body, { cookie });

type Duel = {
  id: string;
  status: string;
  winnerId: string | null;
  isHost: boolean;
  host: { deck: { id: string | null; name: string | null }; score: number | null };
  guest: { deck: { id: string | null; name: string | null }; score: number | null };
  turns?: { number: number; hostLife: number; guestLife: number; authorId: string; note: string | null }[];
};

/** Two friends, which is what a duel needs. */
async function twoFriends(prefix: string) {
  const host = await freshSession(app, `${prefix}-host`);
  const guest = await freshSession(app, `${prefix}-guest`);
  await req("POST", `/community/friends/${guest.userId}`, host.cookie);
  await req("POST", `/community/friends/${host.userId}/accept`, guest.cookie);
  return { host, guest };
}

const duelOf = async (cookie: string, id: string): Promise<Duel> =>
  (await (await req("GET", `/duels/${id}`, cookie)).json()) as Duel;

test("a duel is proposed to a friend, accepted, and the result names the winner", async () => {
  const { host, guest } = await twoFriends("duel-flow");
  const deck = await createDeck(db, host.userId, "Blue-Eyes");

  const proposed = await req("POST", "/duels", host.cookie, { guestId: guest.userId, deckId: deck.id });
  assert.equal(proposed.status, 201);
  const duel = (await proposed.json()) as Duel;
  assert.equal(duel.status, "proposed");
  assert.equal(duel.host.deck.name, "Blue-Eyes");

  // It waits in the guest's inbox.
  const waiting = (await (await req("GET", "/inbox", guest.cookie)).json()) as { items: { kind: string }[] };
  assert.equal(waiting.items[0]?.kind, "duel_invite");

  // Only the invited player accepts, and only an invitation can be accepted.
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, host.cookie)).status, 403);
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, guest.cookie)).status, 200);
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, guest.cookie)).status, 409);

  // The result: either player may record it, once.
  const recorded = await req("POST", `/duels/${duel.id}/result`, guest.cookie, {
    hostScore: 2, guestScore: 1, note: "Serré.",
  });
  assert.equal(recorded.status, 200);
  const done = (await recorded.json()) as Duel;
  assert.equal(done.status, "recorded");
  assert.equal(done.winnerId, host.userId, "the score says who won, nothing else");
  assert.equal((await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 0, guestScore: 2 })).status, 409);

  // And the host is told.
  const told = (await (await req("GET", "/inbox", host.cookie)).json()) as { items: { kind: string }[] };
  assert.equal(told.items[0]?.kind, "duel_recorded");
});

test("an equal score is a draw, and both players count it", async () => {
  const { host, guest } = await twoFriends("duel-draw");
  const duel = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;
  await req("POST", `/duels/${duel.id}/accept`, guest.cookie);
  const done = (await (await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 1, guestScore: 1 })).json()) as Duel;
  assert.equal(done.winnerId, null);

  for (const who of [host, guest]) {
    const profile = (await (await req("GET", `/players/${who.userId}`, who.cookie)).json()) as {
      duels: { played: number; won: number };
    };
    assert.equal(profile.duels.played, 1);
    assert.equal(profile.duels.won, 0, "a draw is not a win");
  }
});

test("a duel is between friends, and never with oneself", async () => {
  const alone = await freshSession(app, "duel-alone");
  const stranger = await freshSession(app, "duel-stranger");

  assert.equal((await req("POST", "/duels", alone.cookie, { guestId: alone.userId })).status, 400);
  assert.equal(
    (await req("POST", "/duels", alone.cookie, { guestId: stranger.userId })).status,
    404,
    "someone who is not a friend answers like someone who does not exist",
  );
  assert.equal((await req("POST", "/duels", alone.cookie, { guestId: "not-a-uuid" })).status, 400);
});

test("declining removes the invitation; a recorded duel stays", async () => {
  const { host, guest } = await twoFriends("duel-drop");
  const first = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;

  assert.equal((await req("DELETE", `/duels/${first.id}`, guest.cookie)).status, 200);
  assert.equal((await req("GET", `/duels/${first.id}`, guest.cookie)).status, 404);
  // The invitation leaves nothing behind in the inbox.
  const inbox = (await (await req("GET", "/inbox", guest.cookie)).json()) as { items: unknown[] };
  assert.equal(inbox.items.length, 0);

  const second = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;
  await req("POST", `/duels/${second.id}/accept`, guest.cookie);
  await req("POST", `/duels/${second.id}/result`, host.cookie, { hostScore: 2, guestScore: 0 });
  assert.equal((await req("DELETE", `/duels/${second.id}`, host.cookie)).status, 409, "a history is not rewritten");
});

test("the turns are written by both, append-only, and the last one can be corrected", async () => {
  const { host, guest } = await twoFriends("duel-turns");
  const duel = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;

  // Nothing is written before the duel is accepted.
  assert.equal(
    (await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
      number: 1, playerId: host.userId, hostLife: 8000, guestLife: 8000,
    })).status,
    409,
  );
  await req("POST", `/duels/${duel.id}/accept`, guest.cookie);

  await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 1, playerId: host.userId, hostLife: 8000, guestLife: 8000, note: "Pose et passe.",
  });
  // The other player writes into the same history.
  const answered = await req("PUT", `/duels/${duel.id}/turns`, guest.cookie, {
    number: 2, playerId: guest.userId, hostLife: 8000, guestLife: 5000,
  });
  assert.equal(answered.status, 200);

  // A gap is refused; the last turn can be corrected.
  assert.equal((await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 9, playerId: host.userId, hostLife: 100, guestLife: 100,
  })).status, 409);
  await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 2, playerId: guest.userId, hostLife: 8000, guestLife: 4000,
  });

  const detail = await duelOf(host.cookie, duel.id);
  assert.deepEqual(detail.turns?.map((turn) => turn.number), [1, 2]);
  assert.equal(detail.turns?.[1]?.guestLife, 4000, "corrected, not duplicated");
  assert.equal(detail.turns?.[1]?.authorId, host.userId, "who wrote it is kept");

  // A turn belongs to one of the two, and life points are whole numbers.
  const outsider = await freshSession(app, "duel-outsider");
  assert.equal((await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 3, playerId: outsider.userId, hostLife: 10, guestLife: 10,
  })).status, 400);
  assert.equal((await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 3, playerId: host.userId, hostLife: -5, guestLife: 10,
  })).status, 400);

  // Once recorded, the history is frozen.
  await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 2, guestScore: 0 });
  assert.equal((await req("PUT", `/duels/${duel.id}/turns`, host.cookie, {
    number: 3, playerId: host.userId, hostLife: 10, guestLife: 0,
  })).status, 409);
});

test("a duel is nobody else's to read or to write", async () => {
  const { host, guest } = await twoFriends("duel-private");
  const stranger = await freshSession(app, "duel-nosy");
  const duel = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;
  await req("POST", `/duels/${duel.id}/accept`, guest.cookie);

  for (const [method, path, body] of [
    ["GET", `/duels/${duel.id}`, undefined],
    ["POST", `/duels/${duel.id}/accept`, undefined],
    ["DELETE", `/duels/${duel.id}`, undefined],
    ["POST", `/duels/${duel.id}/result`, { hostScore: 9, guestScore: 0 }],
    ["PUT", `/duels/${duel.id}/turns`, { number: 1, playerId: host.userId, hostLife: 0, guestLife: 0 }],
    ["PUT", `/duels/${duel.id}/deck`, { deckId: null }],
  ] as [string, string, unknown][]) {
    assert.equal((await req(method, path, stranger.cookie, body)).status, 404, `${method} ${path}`);
  }

  // Nothing moved.
  const after = await duelOf(host.cookie, duel.id);
  assert.equal(after.status, "open");
  assert.equal(after.turns?.length, 0);
  assert.equal((await (await req("GET", "/duels", stranger.cookie)).json() as { items: unknown[] }).items.length, 0);
});

test("a deck is one's own, and its name outlives it", async () => {
  const { host, guest } = await twoFriends("duel-deck");
  const mine = await createDeck(db, host.userId, "Dark Magician");
  const theirs = await createDeck(db, guest.userId, "Harpies");

  const duel = (await (await req("POST", "/duels", host.cookie, { guestId: guest.userId })).json()) as Duel;
  await req("POST", `/duels/${duel.id}/accept`, guest.cookie);

  assert.equal(
    (await req("PUT", `/duels/${duel.id}/deck`, host.cookie, { deckId: theirs.id })).status,
    404,
    "one brings one's own deck",
  );
  assert.equal((await req("PUT", `/duels/${duel.id}/deck`, host.cookie, { deckId: mine.id })).status, 200);
  await req("PUT", `/duels/${duel.id}/deck`, guest.cookie, { deckId: theirs.id });
  await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 2, guestScore: 1 });

  // The deck is deleted; the duel still says what was played with.
  assert.equal((await req("DELETE", `/decks/${mine.id}`, host.cookie)).status, 200);
  const kept = await duelOf(host.cookie, duel.id);
  assert.equal(kept.host.deck.name, "Dark Magician");
  assert.equal(kept.host.deck.id, null, "the link is gone, the name is not");
  assert.equal(kept.guest.deck.name, "Harpies");
});
