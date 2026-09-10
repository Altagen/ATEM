import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail, jsonPost } from "../../test-support.js";
import { hashPassword, needsRehash, verifyPassword } from "./password.js";

const { app } = createTestApp();
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  jsonPost(app, path, body, headers);

test("le hachage relit son propre format", async () => {
  const stored = await hashPassword("Un-Mot-De-Passe-1!");
  assert.ok(stored.startsWith("scrypt$65536$8$1$"));
  assert.equal(await verifyPassword("Un-Mot-De-Passe-1!", stored), true);
  assert.equal(await verifyPassword("autre-chose", stored), false);
  assert.equal(needsRehash(stored), false);
});

test("un hachage à l'ancien format reste lisible, et demande à être refait", async () => {
  // C'est ce qui permet de relever le coût sans invalider les comptes existants.
  const { scryptSync, randomBytes } = await import("node:crypto");
  const salt = randomBytes(16).toString("hex");
  const legacy = `${salt}:${scryptSync("mot-de-passe-historique", salt, 64).toString("hex")}`;

  assert.equal(await verifyPassword("mot-de-passe-historique", legacy), true);
  assert.equal(needsRehash(legacy), true);
});

test("un hachage abîmé refuse au lieu de lever", async () => {
  assert.equal(await verifyPassword("x", "scrypt$1$1$1$sel$tronque"), false);
  assert.equal(await verifyPassword("x", "n'importe quoi"), false);
});

test("l'unicité de l'email ignore la casse", async () => {
  const email = freshEmail("casse");
  const first = await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Premier",
  });
  assert.equal(first.status, 201);

  const second = await post("/auth/register", {
    email: email.toUpperCase(), password: "Un-Autre-Mot-Passe-2!", displayName: "Second",
  });
  assert.equal(second.status, 409);
});

test("le refus de connexion ne dit pas si le compte existe", async () => {
  // Deux messages différents révéleraient quelles adresses ont un compte ici.
  const unknown = await post("/auth/login", {
    email: freshEmail("inconnu"), password: "Un-Mot-De-Passe-1!",
  });
  const email = freshEmail("connu");
  await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Connu",
  });
  const wrongPassword = await post("/auth/login", { email, password: "Un-Mauvais-Mot-Passe-9!" });

  assert.equal(unknown.status, 401);
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await unknown.json(), await wrongPassword.json());
});

test("la déconnexion invalide le jeton déjà émis", async () => {
  const email = freshEmail("session");
  const registered = await post("/auth/register", {
    email, password: "Un-Mot-De-Passe-1!", displayName: "Session",
  });
  const cookie = registered.headers.get("set-cookie")?.split(";")[0] ?? "";

  const before = await app.request("/auth/me", { headers: { cookie } });
  assert.equal(before.status, 200);

  await app.request("/auth/logout", { method: "POST", headers: { cookie } });

  // Le même jeton, après déconnexion : la version de session a changé en base.
  const after = await app.request("/auth/me", { headers: { cookie } });
  assert.equal(after.status, 401);
});

test("une session absente refuse l'accès", async () => {
  assert.equal((await app.request("/auth/me")).status, 401);
});

test("le mot de passe doit réunir les quatre familles", async () => {
  // Seize caractères ne suffisent pas : il faut aussi une majuscule, une
  // minuscule, un chiffre et un caractère spécial. La règle vient de
  // `@atem/shared` — la même fonction que la jauge de l'écran applique, ce qui
  // rend impossible qu'elle approuve ce que le serveur refuse.
  const tooSimple = await post("/auth/register", {
    email: freshEmail("simple"),
    password: "aaaaaaaaaaaaaaaaaaaa",
    displayName: "Simple",
  });
  assert.equal(tooSimple.status, 400);

  const tooShort = await post("/auth/register", {
    email: freshEmail("court"),
    password: "Aa1!",
    displayName: "Court",
  });
  assert.equal(tooShort.status, 400);

  const valid = await post("/auth/register", {
    email: freshEmail("valide"),
    password: "Mot-De-Passe-Test-7!",
    displayName: "Valide",
  });
  assert.equal(valid.status, 201);
});

test("la route de santé répond sans session", async () => {
  // Le healthcheck du compose l'interroge en boucle : elle ne doit ni exiger
  // d'authentification, ni dépendre d'un état applicatif.
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("la garde d'origine tient derrière une terminaison TLS", async () => {
  /**
   * Le navigateur annonce `https://…` pendant que l'API, derrière nginx ou le
   * serveur de développement, reçoit du clair et se croit en `http://…`.
   * Comparer les origines entières refusait alors **toute écriture** — avec un
   * 403 opaque, et une connexion qui passait quand même.
   */
  const response = await post(
    "/auth/register",
    {
      email: freshEmail("tls"),
      password: "Mot-De-Passe-Test-7!",
      displayName: "Derriere TLS",
    },
    { Origin: "https://atem.exemple.fr", Host: "atem.exemple.fr" },
  );
  assert.equal(response.status, 201);
});

test("une origine d'un autre hôte reste refusée", async () => {
  const response = await post(
    "/auth/register",
    { email: freshEmail("etranger"), password: "Mot-De-Passe-Test-7!", displayName: "X" },
    { Origin: "https://malveillant.example", Host: "atem.exemple.fr" },
  );
  assert.equal(response.status, 403);
});
