import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail, freshSession, jsonPost, jsonRequest } from "../../test-support.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { deleteAccount, getPublicUser, registerUser, setLocale } from "./service.js";
import { authAttempts, users } from "./schema.js";
import { clearAttempts, enforceLimit, recordAttempt } from "./rate-limit.js";
import { resolveCallerIp } from "../../platform/caller-ip.js";
import { loggableError, violatesConstraint } from "../../platform/errors.js";
import { adjustQuantity, listCollection } from "../collection/service.js";
import { createScanlist, listScanlists } from "../scanlist/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";
import { eq } from "drizzle-orm";

const { app, db } = createTestApp();
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  jsonPost(app, path, body, headers);

test("the hash reads back its own format", async () => {
  const stored = await hashPassword("Un-Mot-De-Passe-1!");
  assert.ok(stored.startsWith("scrypt$65536$8$1$"));
  assert.equal(await verifyPassword("Un-Mot-De-Passe-1!", stored), true);
  assert.equal(await verifyPassword("something-else", stored), false);
  assert.equal(needsRehash(stored), false);
});

test("a hash in the old format stays readable, and asks to be redone", async () => {
  // This is what allows raising the cost without invalidating existing accounts.
  const { scryptSync, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  const legacy = `${salt}:${scryptSync("historical-password", salt, 64).toString("hex")}`;

  assert.equal(await verifyPassword("historical-password", legacy), true);
  assert.equal(needsRehash(legacy), true);
});

test("a damaged hash refuses instead of throwing", async () => {
  assert.equal(await verifyPassword("x", "scrypt$1$1$1$salt$truncated"), false);
  assert.equal(await verifyPassword("x", "anything at all"), false);
});

test("email uniqueness ignores case", async () => {
  const email = freshEmail("case");
  const first = await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "First",
  });
  assert.equal(first.status, 201);

  const second = await post("/auth/register", {
    email: email.toUpperCase(), password: "Un-Autre-Mot-Passe-2!", displayName: "Second",
  });
  assert.equal(second.status, 409);
});

test("the sign-in refusal does not say whether the account exists", async () => {
  // Two different messages would reveal which addresses have an account here.
  const unknown = await post("/auth/login", {
    email: freshEmail("unknown"), password: "Un-Mot-De-Passe-1!",
  });
  const email = freshEmail("known");
  await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Known",
  });
  const wrongPassword = await post("/auth/login", { email, password: "Un-Mauvais-Mot-Passe-9!" });

  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await unknown.json(), await wrongPassword.json());
});

test("signing out invalidates the token already issued", async () => {
  const email = freshEmail("session");
  const registered = await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Session",
  });
  const cookie = registered.headers.get("set-cookie")?.split(";")[0] ?? "";

  const before = await app.request("/auth/me", { headers: { cookie } });
  assert.equal(before.status, 200);

  await app.request("/auth/logout", { method: "POST", headers: { cookie } });

  // The same token, after signing out: the session version changed in the database.
  const after = await app.request("/auth/me", { headers: { cookie } });
  assert.equal(after.status, 401);
});

test("a missing session refuses access", async () => {
  assert.equal((await app.request("/auth/me")).status, 401);
});

test("the password must gather the four families", async () => {
  // Sixteen characters are not enough: an uppercase letter, a lowercase one, a
  // digit and a special character are also required. The rule comes from
  // `@atem/shared` — the very function the screen's meter applies, which makes
  // it impossible for it to approve what the server refuses.
  const tooSimple = await post("/auth/register", {
    email: freshEmail("simple"),
    password: "aaaaaaaaaaaaaaaaaaaa",
    displayName: "Simple",
  });
  assert.equal(tooSimple.status, 400);

  const tooShort = await post("/auth/register", {
    email: freshEmail("short"),
    password: "Aa1!",
    displayName: "Short",
  });
  assert.equal(tooShort.status, 400);

  const valid = await post("/auth/register", {
    email: freshEmail("valid"),
    password: "Mot-De-Passe-Test-7!",
    displayName: "Valid",
  });
  assert.equal(valid.status, 201);
});

test("the health route answers without a session", async () => {
  // The compose healthcheck polls it in a loop: it must neither require
  // authentication nor depend on application state.
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("the origin guard holds behind a TLS termination", async () => {
  /**
   * The browser announces `https://…` while the API, behind nginx or the
   * development server, receives cleartext and believes it is on `http://…`.
   * Comparing whole origins then refused **every write** — with an opaque 403,
   * and a sign-in that went through anyway.
   */
  const response = await post(
    "/auth/register",
    {
      email: freshEmail("tls"),
      password: "Mot-De-Passe-Test-7!",
      displayName: "Behind TLS",
    },
    { Origin: "https://atem.example.com", Host: "atem.example.com" },
  );
  assert.equal(response.status, 201);
});

test("an origin from another host stays refused", async () => {
  const response = await post(
    "/auth/register",
    { email: freshEmail("foreign"), password: "Mot-De-Passe-Test-7!", displayName: "X" },
    { Origin: "https://malicious.example", Host: "atem.example.com" },
  );
  assert.equal(response.status, 403);
});

test("the account language changes, and reads back", async () => {
  const { user } = await registerUser(db, {
    email: freshEmail("language"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Bilingual",
  });
  assert.equal(user.locale, "fr", "French is the default value");

  const changed = await setLocale(db, user.id, "en");
  assert.equal(changed.locale, "en");
  assert.equal((await getPublicUser(db, user.id)).locale, "en");
});

test("an unknown language is refused before the database", async () => {
  /**
   * The `users_locale_vocab` constraint would refuse it anyway, but with a
   * constraint error nobody knows how to read. We return a message.
   */
  const { user } = await registerUser(db, {
    email: freshEmail("language"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Bilingual",
  });
  await assert.rejects(() => setLocale(db, user.id, "kr"), /Unknown language/);
  assert.equal((await getPublicUser(db, user.id)).locale, "fr", "nothing moved");
});

/**
 * Deleting an account.
 *
 * “Everything has been erased” must be true, not roughly true.
 */
async function stockedAccount() {
  const email = freshEmail("erase");
  const { user } = await registerUser(db, {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Leaving",
  });
  await adjustQuantity(db, user.id, { setCode: "DELX-FR001", delta: 2 });
  await createScanlist(db, user.id, {
    name: "A batch",
    lines: [{ setCode: "DELX-FR002", name: null, passcode: null, quantity: 1 }],
  });
  resetResolveQueue();
  return { user, email };
}

test("deleting your account takes the collection and the batches with it", async () => {
  const { user } = await stockedAccount();
  assert.equal((await listCollection(db, user.id, {})).total, 1);
  assert.equal((await listScanlists(db, user.id)).length, 1);

  await deleteAccount(db, user.id, "Un-Mot-De-Passe-1!");

  await assert.rejects(() => getPublicUser(db, user.id), /not found/);
  assert.equal((await listCollection(db, user.id, {})).total, 0);
  assert.equal((await listScanlists(db, user.id)).length, 0);
});

test("deleting your account also takes the attempts carrying your address", async () => {
  /**
   * `auth_attempts` has no `user_id`: no cascade reaches it. But its key carries
   * the address — `email:someone@example.com` — and that is personal data.
   * Forgetting it would make “everything has been erased” a lie.
   */
  const { user, email } = await stockedAccount();
  await db.insert(authAttempts).values({ bucket: `email:${email.toLowerCase()}`, action: "login" });

  const before = await db
    .select()
    .from(authAttempts)
    .where(eq(authAttempts.bucket, `email:${email.toLowerCase()}`));
  assert.ok(before.length > 0, "the trace does exist beforehand");

  await deleteAccount(db, user.id, "Un-Mot-De-Passe-1!");

  const after = await db
    .select()
    .from(authAttempts)
    .where(eq(authAttempts.bucket, `email:${email.toLowerCase()}`));
  assert.equal(after.length, 0);
});

test("a wrong password erases nothing", async () => {
  // A session is enough for everything else; not for an irreversible gesture.
  const { user } = await stockedAccount();

  await assert.rejects(() => deleteAccount(db, user.id, "Pas-Le-Bon-Mot-1!"), /Incorrect password/);

  assert.ok(await getPublicUser(db, user.id), "the account is still there");
  assert.equal((await listCollection(db, user.id, {})).total, 1, "so is the collection");
});

test("the catalogue survives an account deletion", async () => {
  /**
   * Printings belong to nobody: `card_prints.card_passcode` is `set null`, and
   * an edition recorded by someone who leaves still benefits everyone else.
   */
  const { user } = await stockedAccount();
  await deleteAccount(db, user.id, "Un-Mot-De-Passe-1!");

  const { prints } = await import("../referential/schema.js").then(async (m) => ({
    prints: await db.select().from(m.cardPrints).where(eq(m.cardPrints.setCode, "DELX-FR001")),
  }));
  assert.equal(prints.length, 1, "the printing stays in the catalogue");
});

test("the caller's address is never taken from a header a stranger can write", async () => {
  /**
   * The earlier prototype found this in production: `X-Forwarded-For` is written by the
   * client, so forging a new address on every request kept its counter at zero.
   * Here the header is read only from a declared proxy.
   */
  const previous = process.env.ATEM_TRUSTED_PROXIES;
  try {
    delete process.env.ATEM_TRUSTED_PROXIES;
    assert.equal(resolveCallerIp("203.0.113.9", "198.51.100.7"), "203.0.113.9",
      "no declared proxy: the header is ignored");

    // Declared by range, which is the only form usable in a container: compose
    // gives the proxy a different address on every recreation.
    process.env.ATEM_TRUSTED_PROXIES = "10.89.42.0/24";
    assert.equal(resolveCallerIp("10.89.42.7", "198.51.100.7"), "198.51.100.7",
      "the declared proxy is believed");
    assert.equal(resolveCallerIp("10.89.43.7", "198.51.100.7"), "10.89.43.7",
      "a neighbour outside the range is not");

    // Node reports an IPv4 address in its mapped form when the socket listens
    // on both families — the normal case. Unmapped, it would match no range.
    assert.equal(resolveCallerIp("::ffff:10.89.42.7", "198.51.100.7"), "198.51.100.7");

    // A malformed declaration trusts nobody rather than everybody.
    process.env.ATEM_TRUSTED_PROXIES = "not-an-address";
    assert.equal(resolveCallerIp("10.89.42.7", "198.51.100.7"), "10.89.42.7");
  } finally {
    if (previous === undefined) delete process.env.ATEM_TRUSTED_PROXIES;
    else process.env.ATEM_TRUSTED_PROXIES = previous;
  }
});

test("sign-in attempts are capped, per address and per account", async () => {
  /**
   * The limit existed and nothing measured it — and the development `.env`
   * raises it to a hundred thousand, so a failure would have stayed invisible
   * here too. Both buckets are checked: counting the address alone lets a
   * network of machines try one password each; counting the account alone lets
   * one address sweep accounts one by one.
   */
  const email = freshEmail("rate-limit");
  await registerUser(db, { email, displayName: "Limited", password: "Un-Mot-De-Passe-1!" });

  const bucket = `email:${email.toLowerCase()}`;
  const rule = { max: 3, windowMs: 15 * 60 * 1000 };

  for (let attempt = 0; attempt < rule.max; attempt += 1) {
    await enforceLimit(db, "login", [bucket], rule);
    await recordAttempt(db, "login", [bucket]);
  }
  await assert.rejects(
    () => enforceLimit(db, "login", [bucket], rule),
    /Too many attempts/,
    "the ceiling refuses instead of letting the sweep continue",
  );

  // A successful sign-in clears the account's attempts: ten legitimate
  // sign-ins in fifteen minutes must not lock out a normal person.
  await clearAttempts(db, "login", [bucket]);
  await enforceLimit(db, "login", [bucket], rule);

  // And a different account is untouched by this one's failures.
  const other = `email:${freshEmail("rate-other").toLowerCase()}`;
  await enforceLimit(db, "login", [other], rule);
});

test("a taken address is refused without saying it is taken", async () => {
  /**
   * Asked for by the maintainer: the screen stays vague, the log keeps the reason. It
   * removes the plain membership test — “is this address registered here?” —
   * that the old wording answered for anyone who asked.
   *
   * It does not close enumeration, and the test says so rather than pretending:
   * the attempt still fails where it would have succeeded. What is measured is
   * only that the answer no longer spells it out.
   */
  const email = freshEmail("enumeration");
  await registerUser(db, { email, displayName: "First", password: "Un-Mot-De-Passe-1!" });

  const response = await post("/auth/register", {
    email, displayName: "Second", password: "Un-Autre-Passe-2!",
  });
  assert.equal(response.status, 409);
  const body = (await response.json()) as { message?: string };
  assert.equal(body.message, "An account cannot be created with this email address.");
  assert.doesNotMatch(
    String(body.message),
    /already|in use|exists|taken|déjà/i,
    "the refusal must not hand over the answer",
  );
});

test("a constraint violation is recognised from the cause, never from the message", async () => {
  /**
   * The defect this pins down cost us a fortnight of intermittent test failures
   * and would have cost a stranger their registration.
   *
   * `(display name, tag)` is unique and the tag is drawn at random from ten
   * thousand, so two people sharing a display name collide now and then — by
   * design, and `registerUser` retries eight times for exactly that. The
   * condition read `err.message`, which Drizzle fills with the failed query and
   * never with the constraint's name: the retry had been dead since the wrapping
   * was introduced, and every collision surfaced as a 500.
   *
   * So the error is provoked against the real database rather than shaped by
   * hand: what regressed was the shape the driver produces, and a hand-made
   * error would have kept passing throughout.
   */
  const displayName = `Shape ${Date.now()}`;
  const shared = { passwordHash: "x", displayName, tag: "4242" };
  await db.insert(users).values({ email: freshEmail("shape-a"), ...shared });

  let captured: unknown;
  try {
    await db.insert(users).values({ email: freshEmail("shape-b"), ...shared });
    assert.fail("the unique index should have refused the second row");
  } catch (err) {
    captured = err;
  }

  assert.equal(violatesConstraint(captured, "users_name_tag_uidx"), true);
  assert.equal(violatesConstraint(captured, "users_email_uidx"), false, "and it does not match any constraint");
  assert.equal(
    String((captured as Error).message).includes("users_name_tag_uidx"),
    false,
    "the message really does not carry the name — that is the whole trap",
  );
});

test("a display name shared by many people still registers", async () => {
  /**
   * The retry, end to end. Forty accounts under one display name: with ten
   * thousand tags the odds of at least one collision are about one in twelve,
   * so this does not fail on demand — but it runs on every suite, and the
   * defect above made it fail once in six.
   */
  const displayName = `Crowd ${Date.now()}`;
  for (let index = 0; index < 40; index += 1) {
    const { user } = await registerUser(db, {
      email: freshEmail(`crowd-${index}`),
      displayName,
      password: "Un-Mot-De-Passe-1!",
    });
    assert.equal(user.displayName, displayName);
    assert.match(user.tag, /^\d{4}$/);
  }
});

test("a password hash never reaches the log", async () => {
  /**
   * `console.error("…", err)` was writing them there. Drizzle puts the failed
   * query **and its parameters** in the message, and for a registration the
   * parameters are the scrypt hash beside the address it belongs to. Measured
   * on 2026-09-16: `err.message` carried the hash, and so did `String(err)`.
   *
   * A hash is not a password, but it is the material an offline attack needs,
   * and logs travel — rotated, shipped, pasted into an issue.
   *
   * The error is provoked against the real database, like the constraint test:
   * what leaks is the shape the driver produces, and an error built by hand
   * would prove nothing about it.
   */
  const marker = "scrypt$LEAK-CANARY-DO-NOT-LOG";
  const shared = { passwordHash: marker, displayName: `Leak ${Date.now()}`, tag: "9191" };
  await db.insert(users).values({ email: freshEmail("leak-a"), ...shared });

  let captured: unknown;
  try {
    await db.insert(users).values({ email: freshEmail("leak-b"), ...shared });
    assert.fail("the unique index should have refused the second row");
  } catch (err) {
    captured = err;
  }

  // The raw error does carry it — that is the whole danger, and it is measured
  // rather than assumed, so this test still means something if Drizzle changes.
  assert.ok(String((captured as Error).message).includes(marker), "the driver really does expose it");

  const logged = loggableError(captured);
  assert.doesNotMatch(logged, /LEAK-CANARY/, "what we log must not");
  // And it still says enough to be worth logging.
  assert.match(logged, /users_name_tag_uidx/);
  assert.match(logged, /23505/);
});

const patch = (path: string, body: unknown, cookie: string) =>
  jsonRequest(app, "PATCH", path, body, { cookie });

test("renaming keeps your number when it is free under the new name", async () => {
  /**
   * `(display name, tag)` is unique, not the name. `Yugi#0042` becoming
   * `YugiMaster` stays `#0042` — the number people give out.
   */
  const session = await freshSession(app, "rename");
  const before = (await (await jsonRequest(app, "GET", "/auth/me", undefined, { cookie: session.cookie })).json()) as {
    user: { tag: string };
  };

  const name = `Renamed ${Date.now()}`;
  const response = await patch("/auth/me", { displayName: name }, session.cookie);
  assert.equal(response.status, 200);
  const { user } = (await response.json()) as { user: { displayName: string; tag: string } };
  assert.equal(user.displayName, name);
  assert.equal(user.tag, before.user.tag, "the number follows the person");
});

test("renaming onto a taken name and number draws a new number", async () => {
  const name = `Clash ${Date.now()}`;
  const holder = await registerUser(db, {
    email: freshEmail("clash-holder"), displayName: name, password: "Un-Mot-De-Passe-1!",
  });
  // Give the second account the holder's number under another name first.
  const mover = await freshSession(app, "clash-mover");
  await db.update(users).set({ tag: holder.user.tag }).where(eq(users.id, mover.userId));

  const response = await patch("/auth/me", { displayName: name }, mover.cookie);
  assert.equal(response.status, 200);
  const { user } = (await response.json()) as { user: { tag: string } };
  assert.notEqual(user.tag, holder.user.tag, "two people cannot share a name and a number");
});

test("an email already in use is refused without saying so", async () => {
  // ADR-011 applies here exactly as at registration.
  const taken = freshEmail("taken-by-other");
  await registerUser(db, { email: taken, displayName: "Owner", password: "Un-Mot-De-Passe-1!" });
  const session = await freshSession(app, "wants-it");

  const response = await post("/auth/me/email", { email: taken, password: "Un-Mot-De-Passe-1!" }, { cookie: session.cookie });
  assert.equal(response.status, 409);
  const body = (await response.json()) as { message: string };
  assert.doesNotMatch(body.message, /already|in use|exists|taken|déjà/i);
});

test("the email changes only with the password, and signing in follows it", async () => {
  /**
   * Whoever changes the address takes the account, so a session is not enough.
   * The earlier prototype's window asked for the password and its server never read it.
   */
  const session = await freshSession(app, "email-change");
  const next = freshEmail("email-changed");

  const wrong = await post("/auth/me/email", { email: next, password: "not-the-password" }, { cookie: session.cookie });
  assert.equal(wrong.status, 401);
  const missing = await post("/auth/me/email", { email: next }, { cookie: session.cookie });
  assert.equal(missing.status, 400);
  // The profile route no longer takes an address at all.
  const sideDoor = await patch("/auth/me", { email: next }, session.cookie);
  assert.equal(sideDoor.status, 400);
  assert.equal((await post("/auth/login", { email: session.email, password: "Un-Mot-De-Passe-1!" })).status, 200, "nothing moved");

  const done = await post("/auth/me/email", { email: next.toUpperCase(), password: "Un-Mot-De-Passe-1!" }, { cookie: session.cookie });
  assert.equal(done.status, 200);
  assert.equal((await post("/auth/login", { email: next, password: "Un-Mot-De-Passe-1!" })).status, 200);
  assert.equal((await post("/auth/login", { email: session.email, password: "Un-Mot-De-Passe-1!" })).status, 401);
  // The session that changed it is still valid: the password did not change.
  assert.equal((await jsonRequest(app, "GET", "/auth/me", undefined, { cookie: session.cookie })).status, 200);
});

test("a wrong password is refused before the address is looked at", async () => {
  // Otherwise a stolen session could tell, address by address, which have an account.
  const taken = freshEmail("probe-target");
  await registerUser(db, { email: taken, displayName: "Target", password: "Un-Mot-De-Passe-1!" });
  const session = await freshSession(app, "prober");

  const response = await post("/auth/me/email", { email: taken, password: "guessing" }, { cookie: session.cookie });
  assert.equal(response.status, 401, "the same answer as for a free address");
});

test("an empty change is refused rather than silently ignored", async () => {
  const session = await freshSession(app, "empty-change");
  const response = await patch("/auth/me", {}, session.cookie);
  assert.equal(response.status, 400);
});

test("changing the password signs out everywhere else, and not here", async () => {
  /**
   * The gesture exists because a password may have leaked, so every session
   * issued before it must stop — except the one doing the change, which would
   * otherwise be signed out on the very screen where it happened.
   */
  const email = freshEmail("pw-change");
  const oldPassword = "Un-Mot-De-Passe-1!";
  const newPassword = "Un-Autre-Passe-2!!";
  await registerUser(db, { email, displayName: "Changer", password: oldPassword });

  // Two sessions, as if signed in on a phone and a computer.
  const signIn = async () =>
    (await post("/auth/login", { email, password: oldPassword })).headers.get("set-cookie")!.split(";")[0]!;
  const phone = await signIn();
  const computer = await signIn();

  const response = await jsonRequest(app, "POST", "/auth/me/password", {
    currentPassword: oldPassword, newPassword,
  }, { cookie: computer });
  assert.equal(response.status, 200);
  const renewed = response.headers.get("set-cookie")!.split(";")[0]!;

  const me = (cookie: string) => jsonRequest(app, "GET", "/auth/me", undefined, { cookie });
  assert.equal((await me(phone)).status, 401, "the other device is signed out");
  assert.equal((await me(renewed)).status, 200, "the device that changed it stays in");

  assert.equal((await post("/auth/login", { email, password: oldPassword })).status, 401);
  assert.equal((await post("/auth/login", { email, password: newPassword })).status, 200);
});

test("the current password is required, and a wrong one changes nothing", async () => {
  // Otherwise an unlocked screen is enough to lock the owner out of their account.
  const email = freshEmail("pw-wrong");
  const password = "Un-Mot-De-Passe-1!";
  await registerUser(db, { email, displayName: "Wrong", password });
  const cookie = (await post("/auth/login", { email, password })).headers.get("set-cookie")!.split(";")[0]!;

  const response = await jsonRequest(app, "POST", "/auth/me/password", {
    currentPassword: "not-the-password", newPassword: "Un-Autre-Passe-2!!",
  }, { cookie });
  assert.equal(response.status, 401);
  assert.equal((await post("/auth/login", { email, password })).status, 200, "the old one still works");
});

test("a weak new password is refused, and says which rule is unmet", async () => {
  const email = freshEmail("pw-weak");
  const password = "Un-Mot-De-Passe-1!";
  await registerUser(db, { email, displayName: "Weak", password });
  const cookie = (await post("/auth/login", { email, password })).headers.get("set-cookie")!.split(";")[0]!;

  const response = await jsonRequest(app, "POST", "/auth/me/password", {
    currentPassword: password, newPassword: "short",
  }, { cookie });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { details?: { hasMinLength?: boolean } };
  assert.equal(body.details?.hasMinLength, false, "the screen can point at what is missing");
});

test("your own details include your email, and the public shape never does", async () => {
  /**
   * `PublicUser` is what other people will see once the duellist list exists.
   * The email lives in a separate shape, on a route that only ever answers
   * about the caller — so that screen cannot publish every address by accident.
   */
  const session = await freshSession(app, "own-details");
  const account = await jsonRequest(app, "GET", "/auth/me/account", undefined, { cookie: session.cookie });
  assert.equal(account.status, 200);
  const { account: details } = (await account.json()) as { account: { email: string } };
  assert.equal(details.email, session.email.toLowerCase());

  const me = (await (await jsonRequest(app, "GET", "/auth/me", undefined, { cookie: session.cookie })).json()) as {
    user: Record<string, unknown>;
  };
  assert.equal("email" in me.user, false, "the public shape carries no email");
});
