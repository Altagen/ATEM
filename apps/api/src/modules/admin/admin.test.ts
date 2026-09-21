import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { createTestApp, freshEmail, freshSession, jsonRequest } from "../../test-support.js";
import { ensureAdministrator, registerUser } from "../identity/service.js";
import { actionLog, setRegistration } from "./service.js";

const { app, db } = createTestApp();

/**
 * The console — scoped with Ange on 2026-09-21: one administrator from the
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
  const changed = await req("POST", "/auth/me/password", {
    currentPassword: "Temporary-Pass-1!", newPassword: "Owners-Own-Pass-2?",
  }, cookie);
  assert.equal(changed.status, 200);
  const fresh = changed.headers.get("set-cookie")?.split(";")[0] ?? cookie;
  assert.equal((await req("GET", "/collection", undefined, fresh)).status, 200, "free once it is theirs");

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
    const recent = (await actionLog(tx)).slice(0, 2).map((one) => one.action);
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
