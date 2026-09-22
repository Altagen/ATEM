import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { createTestApp, freshEmail, freshSession, jsonRequest } from "../../test-support.js";
import { ensureAdministrator, registerUser } from "../identity/service.js";
import { actionLog, setRegistration } from "./service.js";

const { app, db } = createTestApp();

/**
 * The console — scoped with the maintainer on 2026-09-21: one administrator from the
 * configuration, who only administers; registration open or closed; accounts
 * created, suspended, deleted; and a log of what was done.
 */

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  jsonRequest(app, method, path, body, cookie ? { cookie } : {});

const PASSWORD = "Admin-Pass-Word-42!";

async function adminSession() {
  const email = freshEmail("admin");
  await ensureAdministrator(db, { email, password: PASSWORD, displayName: "Admin" });
  const response = await req("POST", "/auth/login", { email, password: PASSWORD });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const { user } = (await response.json()) as { user: { id: string } };
  return { cookie, userId: user.id, email };
}

/**
 * The instance's registration is one row every test file shares: closing it
 * through the route would refuse the other files' sign-ups mid-run. What
 * “closed” does is therefore tested inside a transaction that is rolled back.
 */
async function rolledBack(work: (tx: Database) => Promise<void>): Promise<void> {
  const done = Symbol("rolled back");
  try {
    await db.transaction(async (tx) => {
      await work(tx as unknown as Database);
      throw done;
    });
  } catch (err) {
    if (err !== done) throw err;
  }
}

test("the administrator only administers: no player route, no directory, no friends", async () => {
  const admin = await adminSession();
  const player = await freshSession(app, "admin-player");

  assert.equal((await req("GET", "/admin/overview", undefined, admin.cookie)).status, 200);
  for (const [method, path] of [
    ["GET", "/collection"], ["GET", "/decks"], ["GET", "/community/duellists"], ["GET", "/inbox"],
    ["PATCH", "/auth/me"], ["POST", "/auth/me/password"], ["GET", "/auth/me/account"],
  ] as const) {
    assert.equal((await req(method, path, method === "GET" ? undefined : {}, admin.cookie)).status, 403, `${method} ${path}`);
  }
  assert.equal((await req("GET", "/auth/me", undefined, admin.cookie)).status, 200, "its own session");

  // Out of reach for the players.
  const directory = (await (await req("GET", "/community/duellists", undefined, player.cookie)).json()) as {
    items: { id: string }[];
  };
  assert.equal(directory.items.some((one) => one.id === admin.userId), false, "not in the directory");
  assert.equal((await req("GET", `/players/${admin.userId}`, undefined, player.cookie)).status, 404);
  assert.equal((await req("POST", `/community/friends/${admin.userId}`, undefined, player.cookie)).status, 404);

  // And the console does not exist for them.
  assert.equal((await req("GET", "/admin/overview", undefined, player.cookie)).status, 404);
  assert.equal((await req("GET", "/admin/accounts", undefined)).status, 401);
});

test("an account the administrator opens must choose its own password before anything else", async () => {
  const admin = await adminSession();
  const email = freshEmail("admin-created");
  const created = await req("POST", "/admin/accounts", {
    email, displayName: "Opened Account", password: "Temporary-Pass-1!",
  }, admin.cookie);
  assert.equal(created.status, 201);
  const { account } = (await created.json()) as { account: { id: string; mustChangePassword: boolean } };
  assert.equal(account.mustChangePassword, true);

  const login = await req("POST", "/auth/login", { email, password: "Temporary-Pass-1!" });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.equal(((await login.json()) as { user: { mustChangePassword: boolean } }).user.mustChangePassword, true);

  assert.equal((await req("GET", "/collection", undefined, cookie)).status, 403, "held until the change");
  // The session is the proof: the temporary password is not asked again.
  assert.equal((await req("POST", "/auth/me/first-password", { newPassword: "weak" }, cookie)).status, 400);
  const changed = await req("POST", "/auth/me/first-password", { newPassword: "Owners-Own-Pass-2?" }, cookie);
  assert.equal(changed.status, 200);
  const fresh = changed.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  assert.equal((await req("GET", "/collection", undefined, fresh)).status, 200, "free once it is theirs");
  // Once the password is theirs, a session alone no longer changes it.
  assert.equal((await req("POST", "/auth/me/first-password", { newPassword: "Another-Pass-3?!" }, fresh)).status, 403);
  assert.equal((await req("POST", "/auth/login", { email, password: "Owners-Own-Pass-2?" })).status, 200);

  // A weak password is refused here as at sign-up: one rule for every account.
  assert.equal((await req("POST", "/admin/accounts", {
    email: freshEmail("admin-weak"), displayName: "Weak", password: "short",
  }, admin.cookie)).status, 400);
});

test("suspending ends the sessions and hides the account; restoring brings it back", async () => {
  const admin = await adminSession();
  const player = await freshSession(app, "admin-suspended");

  const suspended = await req("POST", `/admin/accounts/${player.userId}/suspend`, undefined, admin.cookie);
  assert.equal(suspended.status, 200);
  assert.equal((await req("GET", "/collection", undefined, player.cookie)).status, 401, "the session is over");
  const login = await req("POST", "/auth/login", { email: player.email, password: "Un-Mot-De-Passe-1!" });
  assert.equal(login.status, 401);

  const overview = (await (await req("GET", "/admin/overview", undefined, admin.cookie)).json()) as {
    players: number; online: number; suspended: number; registrationOpen: boolean;
  };
  assert.ok(overview.suspended >= 1);
  assert.ok(overview.players >= overview.suspended);

  assert.equal((await req("POST", `/admin/accounts/${player.userId}/restore`, undefined, admin.cookie)).status, 200);
  assert.equal((await req("POST", "/auth/login", { email: player.email, password: "Un-Mot-De-Passe-1!" })).status, 200);
  // The old session stays dead: a restore does not bring back tokens.
  assert.equal((await req("GET", "/collection", undefined, player.cookie)).status, 401);
});

test("deleting an account erases it, and the log keeps its name", async () => {
  const admin = await adminSession();
  const player = await freshSession(app, "admin-deleted");

  const listed = (await (await req("GET", `/admin/accounts?q=${encodeURIComponent(player.email)}`, undefined, admin.cookie))
    .json()) as { items: { id: string; email: string }[] };
  assert.deepEqual(listed.items.map((one) => one.id), [player.userId]);

  assert.equal((await req("DELETE", `/admin/accounts/${player.userId}`, undefined, admin.cookie)).status, 200);
  assert.equal((await req("POST", "/auth/login", { email: player.email, password: "Un-Mot-De-Passe-1!" })).status, 401);
  assert.equal((await req("DELETE", `/admin/accounts/${player.userId}`, undefined, admin.cookie)).status, 404);

  const log = (await (await req("GET", "/admin/log", undefined, admin.cookie)).json()) as {
    items: { action: string; targetId: string | null; targetLabel: string | null }[];
  };
  const line = log.items.find((one) => one.action === "account_deleted" && one.targetId === player.userId);
  assert.ok(line, "the deletion is logged");
  assert.match(line.targetLabel ?? "", /^Tester admin-deleted#\d{4}$/);

  // The console never acts on the administrator's own account.
  assert.equal((await req("DELETE", `/admin/accounts/${admin.userId}`, undefined, admin.cookie)).status, 404);
  assert.equal((await req("POST", `/admin/accounts/${admin.userId}/suspend`, undefined, admin.cookie)).status, 404);
});

test("closed registration refuses sign-ups, is logged once, and the route says where it stands", async () => {
  const admin = await adminSession();
  assert.deepEqual(await (await req("GET", "/auth/registration")).json(), { open: true });
  // Saying “open” to an open instance changes nothing, and logs nothing.
  const same = await req("PATCH", "/admin/settings", { registrationOpen: true }, admin.cookie);
  assert.deepEqual(await same.json(), { registrationOpen: true });

  await rolledBack(async (tx) => {
    assert.equal(await setRegistration(tx, false), false);
    assert.equal(await setRegistration(tx, false), false);
    await assert.rejects(
      registerUser(tx, { email: freshEmail("closed"), password: "Un-Mot-De-Passe-1!", displayName: "Closed" }),
      /Registration is closed/,
    );
    // Closed twice, logged once: a line per change, not per click. (Inside the
    // transaction nothing else writes, so the newest line is ours.)
    const recent = (await actionLog(tx)).items.slice(0, 2).map((one) => one.action);
    assert.equal(recent[0], "registration_closed");
    assert.notEqual(recent[1], "registration_closed");
  });
});

test("the configuration's administrator is the only one, and wins at every start", async () => {
  await rolledBack(async (tx) => {
    const first = freshEmail("admin-first");
    const second = freshEmail("admin-second");
    assert.deepEqual(await ensureAdministrator(tx, { email: first, password: PASSWORD, displayName: "First" }), { created: true });
    assert.deepEqual(await ensureAdministrator(tx, { email: first, password: PASSWORD, displayName: "First" }), { created: false });
    await ensureAdministrator(tx, { email: second, password: PASSWORD, displayName: "Second" });

    const admins = await tx.execute<{ email: string }>(
      sql`select email from users where role = 'admin'`);
    assert.deepEqual([...admins].map((row) => row.email), [second]);

    // A player's address is refused, not promoted; a weak password too.
    const player = await registerUser(tx, { email: freshEmail("admin-taken"), password: "Un-Mot-De-Passe-1!", displayName: "Taken" });
    const taken = (await tx.execute<{ email: string }>(
      sql`select email from users where id = ${player.user.id}`))[0]!.email;
    await assert.rejects(ensureAdministrator(tx, { email: taken, password: PASSWORD, displayName: "X" }), /belongs to a player/);
    await assert.rejects(ensureAdministrator(tx, { email: freshEmail("weak"), password: "weak", displayName: "X" }), /16 characters/);
  });
});

test("deleting an account flushes everything it held, and nothing the catalogue holds", async () => {
  /**
   * The maintainer, 2026-09-22: a deleted account must leave nothing behind — collection,
   * scanlists, decks and folders, settings, friends, blocks, inbox, duels —
   * while the catalogue's cards stay, the other players need them. Every table
   * pointing at an account is listed here: a new one forgotten in a cascade
   * would fail this test rather than keep a deleted person's data.
   */
  const admin = await adminSession();
  const gone = await freshSession(app, "flush-gone");
  const friend = await freshSession(app, "flush-friend");
  const blocked = await freshSession(app, "flush-blocked");
  const cookie = gone.cookie;

  await req("POST", "/collection/adjust", { setCode: "ZZZZ-FR997", delta: 2 }, cookie);
  assert.equal((await req("POST", "/scanlists", {
    name: "Box", lines: [{ setCode: "ZZZZ-FR997", quantity: 1 }],
  }, cookie)).status, 201);
  const folder = (await (await req("POST", "/decks/folders", { name: "Folder" }, cookie)).json()) as { id: string };
  assert.ok(folder.id);
  assert.equal((await req("POST", "/decks", { name: "Deck" }, cookie)).status, 201);
  await req("PATCH", "/auth/me/visibility", { collection: "everyone" }, cookie);
  await req("POST", `/community/friends/${friend.userId}`, undefined, cookie);
  await req("POST", `/community/friends/${gone.userId}/accept`, undefined, friend.cookie);
  await req("POST", `/community/blocks/${blocked.userId}`, undefined, cookie);
  assert.equal((await req("POST", "/duels", { guestId: friend.userId }, cookie)).status, 201);

  const printsBefore = (await db.execute<{ n: number }>(sql`select count(*)::int as n from card_prints`))[0]!.n;

  assert.equal((await req("DELETE", `/admin/accounts/${gone.userId}`, undefined, admin.cookie)).status, 200);

  const id = gone.userId;
  const left = await db.execute<{ what: string; n: number }>(sql`
    select 'users' as what, count(*)::int as n from users where id = ${id}
    union all select 'owned_cards', count(*)::int from owned_cards where user_id = ${id}
    union all select 'collection_imports', count(*)::int from collection_imports where user_id = ${id}
    union all select 'scanlists', count(*)::int from scanlists where user_id = ${id}
    union all select 'decks', count(*)::int from decks where user_id = ${id}
    union all select 'deck_folders', count(*)::int from deck_folders where user_id = ${id}
    union all select 'friend_edges', count(*)::int from friend_edges where user_a = ${id} or user_b = ${id} or requester_id = ${id}
    union all select 'blocks', count(*)::int from blocks where user_id = ${id} or blocked_user_id = ${id}
    union all select 'notifications', count(*)::int from notifications where user_id = ${id} or actor_id = ${id}
    union all select 'duels', count(*)::int from duels where host_id = ${id} or guest_id = ${id}
    union all select 'duel_events', count(*)::int from duel_events where author_id = ${id}
    union all select 'auth_attempts', count(*)::int from auth_attempts where bucket = ${`email:${gone.email.toLowerCase()}`}`);
  for (const row of left) assert.equal(row.n, 0, `${row.what} still holds the deleted account`);

  const printsAfter = (await db.execute<{ n: number }>(sql`select count(*)::int as n from card_prints`))[0]!.n;
  assert.equal(printsAfter >= printsBefore, true, "the catalogue keeps its printings");
});

test("the accounts and the log come a page at a time, and the pages join without a gap", async () => {
  const admin = await adminSession();
  const marker = `page${Date.now()}`;
  for (let n = 0; n < 53; n += 1) await freshSession(app, `${marker}-${n}`);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const query: string = `?q=${marker}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = (await (await req("GET", `/admin/accounts${query}`, undefined, admin.cookie)).json()) as {
      items: { id: string }[]; nextCursor: string | null;
    };
    assert.ok(page.items.length <= 50);
    seen.push(...page.items.map((one) => one.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 53);
  assert.equal(new Set(seen).size, 53, "no account twice");

  const log = (await (await req("GET", "/admin/log", undefined, admin.cookie)).json()) as {
    items: unknown[]; nextCursor: string | null;
  };
  assert.ok(log.items.length <= 50);
  assert.equal((await req("GET", "/admin/log?cursor=not-a-cursor", undefined, admin.cookie)).status, 200,
    "a malformed cursor is no cursor");
});
