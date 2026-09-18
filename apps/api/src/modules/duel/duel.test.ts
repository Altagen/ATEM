import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { createDeck } from "../deck/service.js";

const { app, db } = createTestApp();

/**
 * Duels, rule by rule against `docs/ref-duels.md`.
 *
 * ATEM records a duel played in person; it does not referee one. So what is
 * tested here is who may write what and when, never the game: no legality, no
 * effects, no timer.
 */

const req = (method: string, path: string, cookie: string, body?: unknown) =>
  jsonRequest(app, method, path, body, { cookie });

type Duel = {
  id: string;
  status: string;
  winnerId: string | null;
  turnNumber: number | null;
  phase: string | null;
  currentPlayerId: string | null;
  host: { deck: { id: string | null; name: string | null }; life: number; score: number | null };
  guest: { deck: { id: string | null; name: string | null }; life: number; score: number | null };
  events?: { kind: string; phase: string; turnNumber: number; delta: number | null; authorId: string; note: string | null }[];
};

/** Two friends with a deck each — what a duel needs before the coin. */
async function ready(prefix: string) {
  const host = await freshSession(app, `${prefix}-host`);
  const guest = await freshSession(app, `${prefix}-guest`);
  await req("POST", `/community/friends/${guest.userId}`, host.cookie);
  await req("POST", `/community/friends/${host.userId}/accept`, guest.cookie);
  const hostDeck = await createDeck(db, host.userId, "Blue-Eyes");
  const guestDeck = await createDeck(db, guest.userId, "Harpies");
  return { host, guest, hostDeck, guestDeck };
}

/** A duel, accepted, with both decks chosen. */
async function accepted(prefix: string) {
  const table = await ready(prefix);
  const duel = (await (await req("POST", "/duels", table.host.cookie, {
    guestId: table.guest.userId, deckId: table.hostDeck.id,
  })).json()) as Duel;
  await req("POST", `/duels/${duel.id}/accept`, table.guest.cookie);
  await req("PUT", `/duels/${duel.id}/deck`, table.guest.cookie, { deckId: table.guestDeck.id });
  return { ...table, duel };
}

const duelOf = async (cookie: string, id: string): Promise<Duel> =>
  (await (await req("GET", `/duels/${id}`, cookie)).json()) as Duel;

test("a duel is proposed to a friend, accepted, and the result names the winner", async () => {
  const { host, guest, hostDeck } = await ready("duel-flow");
  const duel = (await (await req("POST", "/duels", host.cookie, {
    guestId: guest.userId, deckId: hostDeck.id,
  })).json()) as Duel;
  assert.equal(duel.status, "proposed");
  assert.equal(duel.host.deck.name, "Blue-Eyes");

  // It waits in the guest's inbox until they answer.
  const waiting = (await (await req("GET", "/inbox", guest.cookie)).json()) as { items: { kind: string }[] };
  assert.equal(waiting.items[0]?.kind, "duel_invite");

  // Only the invited player accepts, and only an invitation can be accepted.
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, host.cookie)).status, 403);
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, guest.cookie)).status, 200);
  assert.equal((await req("POST", `/duels/${duel.id}/accept`, guest.cookie)).status, 409);

  const recorded = await req("POST", `/duels/${duel.id}/result`, guest.cookie, {
    hostScore: 2, guestScore: 1, note: "Serré.",
  });
  assert.equal(recorded.status, 200);
  const done = (await recorded.json()) as Duel;
  assert.equal(done.status, "recorded");
  assert.equal(done.winnerId, host.userId, "the score says who won, nothing else");
  assert.equal((await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 0, guestScore: 2 })).status, 409);

  const told = (await (await req("GET", "/inbox", host.cookie)).json()) as { items: { kind: string }[] };
  assert.equal(told.items[0]?.kind, "duel_recorded");
});

test("the coin is flipped by the server, once both decks are chosen", async () => {
  const table = await ready("duel-coin");
  const duel = (await (await req("POST", "/duels", table.host.cookie, { guestId: table.guest.userId })).json()) as Duel;
  await req("POST", `/duels/${duel.id}/accept`, table.guest.cookie);

  // Without decks there is nothing to start.
  assert.equal((await req("POST", `/duels/${duel.id}/start`, table.host.cookie)).status, 409);
  await req("PUT", `/duels/${duel.id}/deck`, table.host.cookie, { deckId: table.hostDeck.id });
  assert.equal((await req("POST", `/duels/${duel.id}/start`, table.host.cookie)).status, 409, "both, not one");
  await req("PUT", `/duels/${duel.id}/deck`, table.guest.cookie, { deckId: table.guestDeck.id });

  const started = (await (await req("POST", `/duels/${duel.id}/start`, table.host.cookie)).json()) as Duel;
  assert.equal(started.status, "playing");
  assert.equal(started.turnNumber, 1);
  assert.equal(started.phase, "draw", "the first turn opens on the Draw Phase");
  assert.equal(started.host.life, 8000);
  assert.equal(started.guest.life, 8000);
  assert.ok(
    started.currentPlayerId === table.host.userId || started.currentPlayerId === table.guest.userId,
    "somebody was drawn to begin",
  );
  assert.equal(started.events?.[0]?.kind, "start");

  // Starting twice is refused, and the decks are set from then on.
  assert.equal((await req("POST", `/duels/${duel.id}/start`, table.guest.cookie)).status, 409);
  assert.equal(
    (await req("PUT", `/duels/${duel.id}/deck`, table.host.cookie, { deckId: null })).status,
    409,
  );
});

test("the coin does not always fall on the same side", async () => {
  /**
   * A draw that always returns the host would pass every other test in this
   * file. Twelve duels: the chance of one side twelve times running is one in
   * two thousand, and a fixed coin fails it every time.
   */
  const table = await ready("duel-random");
  const first = new Set<string>();
  for (let index = 0; index < 12; index += 1) {
    const duel = (await (await req("POST", "/duels", table.host.cookie, {
      guestId: table.guest.userId, deckId: table.hostDeck.id,
    })).json()) as Duel;
    await req("POST", `/duels/${duel.id}/accept`, table.guest.cookie);
    await req("PUT", `/duels/${duel.id}/deck`, table.guest.cookie, { deckId: table.guestDeck.id });
    const started = (await (await req("POST", `/duels/${duel.id}/start`, table.host.cookie)).json()) as Duel;
    first.add(started.currentPlayerId ?? "");
  }
  assert.equal(first.size, 2, "both players began at least once");
});

test("the phases follow one another, and the turn passes to the other player", async () => {
  const { host, guest, duel } = await accepted("duel-phases");
  const started = (await (await req("POST", `/duels/${duel.id}/start`, host.cookie)).json()) as Duel;
  const opener = started.currentPlayerId;

  // Draw → standby → main1 → battle → main2 → end, one at a time.
  for (const phase of ["standby", "main1", "battle", "main2", "end"]) {
    const after = (await (await req("POST", `/duels/${duel.id}/phase`, guest.cookie)).json()) as Duel;
    assert.equal(after.phase, phase);
  }
  // The End Phase is the last: there is nothing after it but the next turn.
  assert.equal((await req("POST", `/duels/${duel.id}/phase`, host.cookie)).status, 409);

  const next = (await (await req("POST", `/duels/${duel.id}/turn`, host.cookie)).json()) as Duel;
  assert.equal(next.turnNumber, 2);
  assert.equal(next.phase, "draw");
  assert.notEqual(next.currentPlayerId, opener, "the turn passed to the other");

  // The turn can be ended from any phase: the players say when, not the app.
  await req("POST", `/duels/${duel.id}/phase`, host.cookie);
  const third = (await (await req("POST", `/duels/${duel.id}/turn`, guest.cookie)).json()) as Duel;
  assert.equal(third.turnNumber, 3);
  assert.equal(third.currentPlayerId, opener);
});

test("life points are taken in the phase under way, by either player", async () => {
  const { host, guest, duel } = await accepted("duel-life");
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  await req("POST", `/duels/${duel.id}/phase`, host.cookie);
  await req("POST", `/duels/${duel.id}/phase`, host.cookie);
  await req("POST", `/duels/${duel.id}/phase`, host.cookie); // battle

  const hit = (await (await req("POST", `/duels/${duel.id}/life`, guest.cookie, {
    playerId: host.userId, delta: -1800, note: "Blue-Eyes attaque.",
  })).json()) as Duel;
  assert.equal(hit.host.life, 6200);
  assert.equal(hit.guest.life, 8000);

  const written = hit.events?.at(-1);
  assert.equal(written?.kind, "life");
  assert.equal(written?.phase, "battle", "the phase it happened in, without being asked");
  assert.equal(written?.delta, -1800);
  assert.equal(written?.authorId, guest.userId, "who wrote it is kept");

  // Life points can be given back, and are clamped at zero rather than refused.
  await req("POST", `/duels/${duel.id}/life`, host.cookie, { playerId: host.userId, delta: 500 });
  const out = (await (await req("POST", `/duels/${duel.id}/life`, host.cookie, {
    playerId: host.userId, delta: -99_000,
  })).json()) as Duel;
  assert.equal(out.host.life, 0, "more damage than is left is the end of a duel, not an error");

  for (const body of [
    { playerId: host.userId, delta: 0 },
    { playerId: (await freshSession(app, "duel-life-outsider")).userId, delta: -100 },
  ]) {
    assert.equal((await req("POST", `/duels/${duel.id}/life`, host.cookie, body)).status, 400);
  }
});

test("nothing is played before the start, or after the result", async () => {
  const { host, guest, duel } = await accepted("duel-closed");

  for (const path of ["phase", "turn"]) {
    assert.equal((await req("POST", `/duels/${duel.id}/${path}`, host.cookie)).status, 409);
  }
  assert.equal(
    (await req("POST", `/duels/${duel.id}/life`, host.cookie, { playerId: host.userId, delta: -100 })).status,
    409,
  );

  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  await req("POST", `/duels/${duel.id}/result`, guest.cookie, { hostScore: 2, guestScore: 0 });

  for (const path of ["phase", "turn", "start"]) {
    assert.equal((await req("POST", `/duels/${duel.id}/${path}`, host.cookie)).status, 409, path);
  }
  const frozen = await duelOf(host.cookie, duel.id);
  assert.equal(frozen.phase, null, "a finished duel is nowhere: its history holds the turns");
  assert.ok((frozen.events?.length ?? 0) > 0);
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
  const { host, guest, duel } = await accepted("duel-drop");

  assert.equal((await req("DELETE", `/duels/${duel.id}`, guest.cookie)).status, 200);
  assert.equal((await req("GET", `/duels/${duel.id}`, guest.cookie)).status, 404);
  const inbox = (await (await req("GET", "/inbox", guest.cookie)).json()) as { items: unknown[] };
  assert.equal(inbox.items.length, 0, "the invitation leaves nothing behind");

  const { duel: second } = await accepted("duel-drop-two");
  await req("POST", `/duels/${second.id}/result`, host.cookie, { hostScore: 2, guestScore: 0 });
  assert.equal((await req("DELETE", `/duels/${second.id}`, host.cookie)).status, 404, "another table");
});

test("a duel is nobody else's to read or to write", async () => {
  const { host, duel } = await accepted("duel-private");
  const stranger = await freshSession(app, "duel-nosy");
  await req("POST", `/duels/${duel.id}/start`, host.cookie);

  for (const [method, path, body] of [
    ["GET", `/duels/${duel.id}`, undefined],
    ["POST", `/duels/${duel.id}/accept`, undefined],
    ["DELETE", `/duels/${duel.id}`, undefined],
    ["POST", `/duels/${duel.id}/result`, { hostScore: 9, guestScore: 0 }],
    ["POST", `/duels/${duel.id}/phase`, undefined],
    ["POST", `/duels/${duel.id}/turn`, undefined],
    ["POST", `/duels/${duel.id}/life`, { playerId: host.userId, delta: -8000 }],
    ["PUT", `/duels/${duel.id}/deck`, { deckId: null }],
  ] as [string, string, unknown][]) {
    assert.equal((await req(method, path, stranger.cookie, body)).status, 404, `${method} ${path}`);
  }

  const after = await duelOf(host.cookie, duel.id);
  assert.equal(after.status, "playing");
  assert.equal(after.host.life, 8000, "nothing moved");
  assert.equal((await (await req("GET", "/duels", stranger.cookie)).json() as { items: unknown[] }).items.length, 0);
});

test("a deck is one's own, and its name outlives it", async () => {
  const { host, guest, hostDeck, guestDeck, duel } = await accepted("duel-deck");

  assert.equal(
    (await req("PUT", `/duels/${duel.id}/deck`, host.cookie, { deckId: guestDeck.id })).status,
    404,
    "one brings one's own deck",
  );
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  await req("POST", `/duels/${duel.id}/result`, host.cookie, { hostScore: 2, guestScore: 1 });

  // The deck is deleted; the duel still says what was played with.
  assert.equal((await req("DELETE", `/decks/${hostDeck.id}`, host.cookie)).status, 200);
  const kept = await duelOf(guest.cookie, duel.id);
  assert.equal(kept.host.deck.name, "Blue-Eyes");
  assert.equal(kept.host.deck.id, null, "the link is gone, the name is not");
});
