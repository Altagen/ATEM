import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail, jsonPost } from "../../test-support.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";
import { deleteAccount, getPublicUser, registerUser, setLocale } from "./service.js";
import { authAttempts } from "./schema.js";
import { clearAttempts, enforceLimit, recordAttempt } from "./rate-limit.js";
import { resolveCallerIp } from "../../platform/caller-ip.js";
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
   * the address — `email:ange@example.com` — and that is personal data.
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
   * ATEM-old found this in production: `X-Forwarded-For` is written by the
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
