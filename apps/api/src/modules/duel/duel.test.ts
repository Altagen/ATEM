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
  host: { deck: { id: string | null; name: string | null }; life: number; player: unknown; removed: boolean; won: boolean | null };
  guest: { deck: { id: string | null; name: string | null }; life: number; player: unknown; removed: boolean; won: boolean | null };
  events?: { kind: string; phase: string; turnNumber: number; delta: number | null; authorId: string | null; note: string | null }[];
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

/**
 * The cookie of whoever is playing this turn, and the other one.
 *
 * The coin decides who begins, so a test cannot know it: it asks. Written on
 * 2026-09-19, when phases became the turn player's alone.
 */
async function sides(duel: { id: string }, one: { cookie: string; userId: string }, two: { cookie: string; userId: string }) {
  const state = await duelOf(one.cookie, duel.id);
  return state.currentPlayerId === one.userId
    ? { playing: one, waiting: two }
    : { playing: two, waiting: one };
}

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

  // Either player records it, and it is a winner — not a score (Ange, 2026-09-19).
  const recorded = await req("POST", `/duels/${duel.id}/result`, guest.cookie, {
    winnerId: host.userId, note: "Serré.",
  });
  assert.equal(recorded.status, 200);
  const done = (await recorded.json()) as Duel;
  assert.equal(done.status, "recorded");
  assert.equal(done.winnerId, host.userId);
  assert.equal((await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: guest.userId })).status, 409);

  const told = (await (await req("GET", "/inbox", host.cookie)).json()) as { items: { kind: string }[] };
  assert.equal(told.items[0]?.kind, "duel_recorded");
});

test("the winner is one of the two, and the profile counts what was won", async () => {
  const { host, guest, duel } = await accepted("duel-winner");
  const outsider = await freshSession(app, "duel-winner-outsider");

  assert.equal(
    (await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: outsider.userId })).status,
    400,
    "a winner who did not play it",
  );
  assert.equal(
    (await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: "not-a-uuid" })).status,
    400,
  );

  await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: guest.userId });

  const tally = async (who: { userId: string; cookie: string }) =>
    ((await (await req("GET", `/players/${who.userId}`, who.cookie)).json()) as {
      duels: { played: number; won: number };
    }).duels;
  assert.deepEqual(await tally(guest), { played: 1, won: 1 });
  assert.deepEqual(await tally(host), { played: 1, won: 0 });
});

test("past duels are answered a page at a time", async () => {
  /**
   * One duel is under way at a time, but the ones played accumulate for as long
   * as one plays. Ange asked whether they were paged: they are now.
   */
  const table = await ready("duel-page");
  for (let index = 0; index < 3; index += 1) {
    const duel = (await (await req("POST", "/duels", table.host.cookie, {
      guestId: table.guest.userId, deckId: table.hostDeck.id,
    })).json()) as Duel;
    await req("POST", `/duels/${duel.id}/accept`, table.guest.cookie);
    await req("POST", `/duels/${duel.id}/result`, table.host.cookie, { winnerId: table.host.userId });
  }

  const page = async (query: string) =>
    (await (await req("GET", `/duels${query}`, table.host.cookie)).json()) as
      { items: Duel[]; nextCursor: string | null };

  const first = await page("?past=1&limit=2");
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor, "there is more to read");

  const second = await page(`?past=1&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextCursor, null);
  // No duel is read twice, and none is skipped.
  const ids = [...first.items, ...second.items].map((duel) => duel.id);
  assert.equal(new Set(ids).size, 3);

  // The duel under way is not among them, and they are not among it.
  const under = await page("?past=0");
  assert.equal(under.items.length, 0, "all three are recorded");
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

test("the phases follow one another, moved by the duellist whose turn it is", async () => {
  const { host, guest, duel } = await accepted("duel-phases");
  const started = (await (await req("POST", `/duels/${duel.id}/start`, host.cookie)).json()) as Duel;
  const opener = started.currentPlayerId;
  const first = await sides(duel, host, guest);

  // Nobody advances someone else's turn (Ange, 2026-09-19).
  assert.equal((await req("POST", `/duels/${duel.id}/phase`, first.waiting.cookie)).status, 403);
  assert.equal((await req("POST", `/duels/${duel.id}/turn`, first.waiting.cookie)).status, 403);
  assert.equal((await duelOf(host.cookie, duel.id)).phase, "draw", "nothing moved");

  // Draw → standby → main1 → battle → main2 → end, one at a time.
  for (const phase of ["standby", "main1", "battle", "main2", "end"]) {
    const after = (await (await req("POST", `/duels/${duel.id}/phase`, first.playing.cookie)).json()) as Duel;
    assert.equal(after.phase, phase);
  }
  // The End Phase is the last: there is nothing after it but the next turn.
  assert.equal((await req("POST", `/duels/${duel.id}/phase`, first.playing.cookie)).status, 409);

  const next = (await (await req("POST", `/duels/${duel.id}/turn`, first.playing.cookie)).json()) as Duel;
  assert.equal(next.turnNumber, 2);
  assert.equal(next.phase, "draw");
  assert.notEqual(next.currentPlayerId, opener, "the turn passed to the other");

  // And it is now the other one who moves it: the turn can be ended from any phase.
  const second = await sides(duel, host, guest);
  await req("POST", `/duels/${duel.id}/phase`, second.playing.cookie);
  const third = (await (await req("POST", `/duels/${duel.id}/turn`, second.playing.cookie)).json()) as Duel;
  assert.equal(third.turnNumber, 3);
  assert.equal(third.currentPlayerId, opener);
});

test("each duellist declares their own life points, and only their own", async () => {
  /**
   * Ange's rule on 2026-09-19: the one who takes the damage says so. It is how
   * it goes at the table, and it removes the one gesture a duel could argue
   * about.
   */
  const { host, guest, duel } = await accepted("duel-life");
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  const { playing } = await sides(duel, host, guest);
  for (const _ of [1, 2, 3]) await req("POST", `/duels/${duel.id}/phase`, playing.cookie); // battle

  // Life points are declared at any moment — whosever turn it is.
  const hit = (await (await req("POST", `/duels/${duel.id}/life`, host.cookie, {
    delta: -1800, note: "Blue-Eyes attaque.",
  })).json()) as Duel;
  assert.equal(hit.host.life, 6200);
  assert.equal(hit.guest.life, 8000);

  const written = hit.events?.at(-1);
  assert.equal(written?.kind, "life");
  assert.equal(written?.phase, "battle", "the phase it happened in, without being asked");
  assert.equal(written?.delta, -1800);
  assert.equal(written?.authorId, host.userId);

  // Reaching across the table is refused, whatever a screen might offer.
  assert.equal(
    (await req("POST", `/duels/${duel.id}/life`, guest.cookie, { playerId: host.userId, delta: -8000 })).status,
    403,
  );
  assert.equal((await duelOf(host.cookie, duel.id)).host.life, 6200, "nothing moved");

  // The other declares their own, and it lands on their side.
  const theirs = (await (await req("POST", `/duels/${duel.id}/life`, guest.cookie, { delta: -1000 })).json()) as Duel;
  assert.equal(theirs.guest.life, 7000);

  // Life points can be given back, and are clamped at zero rather than refused.
  await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: 500 });
  const out = (await (await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: -99_000 })).json()) as Duel;
  assert.equal(out.host.life, 0, "more damage than is left is the end of a duel, not an error");

  assert.equal((await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: 0 })).status, 400);
});

test("the taps of one phase add up into that phase's event", async () => {
  /**
   * Ange, on 2026-09-19: taking 3000 means tapping −1000 three times, and three
   * rows saying “−1000” tell nobody anything — they only make the table grow.
   */
  const { host, guest, duel } = await accepted("duel-merge");
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  const { playing } = await sides(duel, host, guest);

  const lifeEvents = async () =>
    ((await duelOf(host.cookie, duel.id)).events ?? []).filter((event) => event.kind === "life");

  for (const _ of [1, 2, 3]) {
    await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: -1000 });
  }
  let written = await lifeEvents();
  assert.equal(written.length, 1, "one event for the phase, whatever the number of taps");
  assert.equal(written[0]?.delta, -3000);

  // A gain in the same phase comes off the same event.
  await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: 500 });
  written = await lifeEvents();
  assert.equal(written.length, 1);
  assert.equal(written[0]?.delta, -2500);

  // The other duellist's points are their own event, in the same phase.
  await req("POST", `/duels/${duel.id}/life`, guest.cookie, { delta: -800 });
  assert.equal((await lifeEvents()).length, 2);

  // The next phase opens a new one.
  await req("POST", `/duels/${duel.id}/phase`, playing.cookie);
  await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: -200 });
  const byPhase = await lifeEvents();
  assert.equal(byPhase.length, 3);
  assert.deepEqual(
    byPhase.filter((event) => event.phase === "standby").map((event) => event.delta),
    [-200],
  );
});

test("a gain cancelling a loss in the same phase leaves no event", async () => {
  // Nothing happened that phase; a row saying “0” would be noise with a date.
  const { host, guest, duel } = await accepted("duel-cancel");
  await req("POST", `/duels/${duel.id}/start`, host.cookie);

  await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: -500 });
  await req("POST", `/duels/${duel.id}/life`, host.cookie, { delta: 500 });

  const after = await duelOf(host.cookie, duel.id);
  assert.equal(after.host.life, 8000, "back where it started");
  assert.equal((after.events ?? []).filter((event) => event.kind === "life").length, 0);
  void guest;
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
  await req("POST", `/duels/${duel.id}/result`, guest.cookie, { winnerId: host.userId });

  for (const path of ["phase", "turn", "start"]) {
    assert.equal((await req("POST", `/duels/${duel.id}/${path}`, host.cookie)).status, 409, path);
  }
  const frozen = await duelOf(host.cookie, duel.id);
  assert.equal(frozen.phase, null, "a finished duel is nowhere: its history holds the turns");
  assert.ok((frozen.events?.length ?? 0) > 0);
});

test("one duel at a time: a second is refused while one is under way", async () => {
  /**
   * Ange, on 2026-09-19: one plays one duel, at one table. Invitations are not
   * duels under way — they wait in the inbox — but accepting one while a duel
   * is on is refused, on both sides of the table.
   */
  const { host, guest, duel } = await accepted("duel-single");
  const third = await freshSession(app, "duel-single-third");
  await req("POST", `/community/friends/${third.userId}`, host.cookie);
  await req("POST", `/community/friends/${host.userId}/accept`, third.cookie);

  assert.equal(
    (await req("POST", "/duels", host.cookie, { guestId: third.userId })).status,
    409,
    "the host is already at a table",
  );

  // An invitation may still be sent **to** them: it costs nothing until answered.
  const invitation = await req("POST", "/duels", third.cookie, { guestId: host.userId });
  assert.equal(invitation.status, 201);
  const waiting = (await invitation.json()) as Duel;
  assert.equal((await req("POST", `/duels/${waiting.id}/accept`, host.cookie)).status, 409);

  // Once the duel on is recorded, the next one can begin.
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  await req("POST", `/duels/${duel.id}/result`, guest.cookie, { winnerId: host.userId });
  assert.equal((await req("POST", `/duels/${waiting.id}/accept`, host.cookie)).status, 200);
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
  await req("POST", `/duels/${second.id}/result`, host.cookie, { winnerId: host.userId });
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
    ["POST", `/duels/${duel.id}/result`, { winnerId: host.userId }],
    ["POST", `/duels/${duel.id}/phase`, undefined],
    ["POST", `/duels/${duel.id}/turn`, undefined],
    ["POST", `/duels/${duel.id}/life`, { delta: -8000 }],
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
  await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: host.userId });

  // The deck is deleted; the duel still says what was played with.
  assert.equal((await req("DELETE", `/decks/${hostDeck.id}`, host.cookie)).status, 200);
  const kept = await duelOf(guest.cookie, duel.id);
  assert.equal(kept.host.deck.name, "Blue-Eyes");
  assert.equal(kept.host.deck.id, null, "the link is gone, the name is not");
});

test("a deleted account's recorded duels stay with its opponent, its unfinished ones go", async () => {
  /**
   * Decided on 2026-09-22: the other player keeps the duel they played, against
   * a “deleted account”; a duel that did not happen leaves no trace, and does
   * not keep the other player from starting another.
   */
  const table = await accepted("duel-gone");
  const { host, guest, duel } = table;
  await req("POST", `/duels/${duel.id}/start`, host.cookie);
  assert.equal((await req("POST", `/duels/${duel.id}/result`, host.cookie, { winnerId: host.userId })).status, 200);

  // A second, unfinished duel between the same two.
  const pending = (await (await req("POST", "/duels", guest.cookie, { guestId: host.userId })).json()) as Duel;
  assert.equal(pending.status, "proposed");

  assert.equal((await req("DELETE", "/auth/me", host.cookie, { password: "Un-Mot-De-Passe-1!" })).status, 200);

  const kept = await duelOf(guest.cookie, duel.id);
  assert.equal(kept.status, "recorded");
  assert.equal(kept.host.removed, true);
  assert.equal(kept.host.player, null);
  assert.equal(kept.winnerId, null, "the winner was the deleted account");
  assert.deepEqual([kept.host.won, kept.guest.won], [true, false],
    "and the screen is still told who won");
  assert.ok(kept.events?.some((event) => event.authorId === null), "its lines stay, unsigned");

  assert.equal((await req("GET", `/duels/${pending.id}`, guest.cookie)).status, 404, "the unfinished one is gone");
  const past = (await (await req("GET", "/duels?past=1", guest.cookie)).json()) as { items: { id: string }[] };
  assert.ok(past.items.some((one) => one.id === duel.id));
});
