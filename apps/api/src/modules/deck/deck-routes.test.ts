import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { adjustQuantity } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";

const { app, db } = createTestApp();

/**
 * Les routes des decks — ce que le service ne peut pas éprouver seul.
 *
 * Le service reçoit déjà une identité ; ces épreuves vérifient **d'où elle
 * vient**. C'est la question que la couture `ownerId` / `viewerId` a rendue
 * explicite (ADR-009), et celle qu'Ange a posée : un autre joueur ne doit rien
 * pouvoir modifier.
 */

const req = (method: string, path: string, body?: unknown, cookie?: string) =>
  jsonRequest(app, method, path, body, cookie ? { cookie } : {});

async function carteEnCollection(passcode: number, setCode: string, userId: string, copies = 3) {
  await upsertCard(db, {
    passcode, nameEn: `Route ${passcode}`, nameFr: `Route ${passcode}`,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Dragon", attribute: "LIGHT", atk: 1, def: 1, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
  await adjustQuantity(db, userId, { setCode, delta: copies, passcode });
  resetResolveQueue();
}

test("aucune route de deck ne répond sans session", async () => {
  // La garde est montée sur le sous-ensemble entier : en oublier une seule
  // suffirait à exposer les decks de tout le monde.
  for (const [method, path, body] of [
    ["GET", "/decks", undefined],
    ["POST", "/decks", { name: "Sans session" }],
    ["GET", "/decks/00000000-0000-0000-0000-000000000000", undefined],
    ["PATCH", "/decks/00000000-0000-0000-0000-000000000000", { name: "x" }],
    ["DELETE", "/decks/00000000-0000-0000-0000-000000000000", undefined],
    ["PUT", "/decks/00000000-0000-0000-0000-000000000000/cartes",
      { passcode: 1, zone: "main", quantity: 1 }],
  ] as const) {
    const response = await req(method, path, body);
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("le cycle complet d'un deck passe par ses routes", async () => {
  const { cookie } = await freshSession(app, "deckroute");

  const créé = await req("POST", "/decks", { name: "Mon premier deck" }, cookie);
  assert.equal(créé.status, 201);
  const deck = (await créé.json()) as { id: string; name: string };
  assert.equal(deck.name, "Mon premier deck");

  const liste = await req("GET", "/decks", undefined, cookie);
  assert.equal(liste.status, 200);
  assert.equal(((await liste.json()) as { items: unknown[] }).items.length, 1);

  const renommé = await req("PATCH", `/decks/${deck.id}`, { name: "Renommé" }, cookie);
  assert.equal(renommé.status, 200);
  const relu = await req("GET", `/decks/${deck.id}`, undefined, cookie);
  assert.equal(((await relu.json()) as { name: string }).name, "Renommé");

  assert.equal((await req("DELETE", `/decks/${deck.id}`, undefined, cookie)).status, 200);
  assert.equal((await req("GET", `/decks/${deck.id}`, undefined, cookie)).status, 404);
});

test("on n'écrit pas dans le deck d'un autre, même en connaissant son identifiant", async () => {
  /**
   * C'est la garantie qu'Ange a demandée. L'identité d'écriture vient de la
   * **session**, jamais du chemin : connaître l'identifiant d'un deck ne donne
   * aucun droit dessus.
   *
   * Et le refus est un 404, pas un 403 : un 403 confirmerait que le deck
   * existe.
   */
  const propriétaire = await freshSession(app, "proprio");
  const intrus = await freshSession(app, "intrus");
  await carteEnCollection(71000001, "RTRT-FR001", propriétaire.userId);
  await carteEnCollection(71000001, "RTRT-FR002", intrus.userId);

  const créé = await req("POST", "/decks", { name: "À moi" }, propriétaire.cookie);
  const deck = (await créé.json()) as { id: string };

  for (const [method, path, body] of [
    ["PATCH", `/decks/${deck.id}`, { name: "Volé" }],
    ["DELETE", `/decks/${deck.id}`, undefined],
    ["PUT", `/decks/${deck.id}/cartes`, { passcode: 71000001, zone: "main", quantity: 1 }],
    ["GET", `/decks/${deck.id}`, undefined],
  ] as const) {
    const response = await req(method, path, body, intrus.cookie);
    assert.equal(response.status, 404, `${method} ${path}`);
  }

  // Et le deck n'a pas bougé.
  const relu = await req("GET", `/decks/${deck.id}`, undefined, propriétaire.cookie);
  const état = (await relu.json()) as { name: string; cards: unknown[] };
  assert.equal(état.name, "À moi");
  assert.equal(état.cards.length, 0);
});

test("poser une carte deux fois de suite laisse le même deck", async () => {
  /**
   * `PUT` déclare un état — « trois exemplaires au Main » — et non un
   * incrément. Un double appui ne peut donc pas doubler la quantité, sans
   * compteur à réconcilier.
   */
  const { cookie, userId } = await freshSession(app, "idempot");
  await carteEnCollection(71000002, "RTRT-FR003", userId);
  const deck = (await (await req("POST", "/decks", { name: "Idempotent" }, cookie)).json()) as { id: string };

  const corps = { passcode: 71000002, zone: "main", quantity: 2 };
  await req("PUT", `/decks/${deck.id}/cartes`, corps, cookie);
  const seconde = await req("PUT", `/decks/${deck.id}/cartes`, corps, cookie);

  assert.equal(seconde.status, 200);
  const état = (await seconde.json()) as { counts: { main: number } };
  assert.equal(état.counts.main, 2);
});

test("un corps invalide est refusé avant d'atteindre la base", async () => {
  const { cookie } = await freshSession(app, "invalide");
  const deck = (await (await req("POST", "/decks", { name: "Validation" }, cookie)).json()) as { id: string };

  for (const corps of [
    { passcode: 1, zone: "cimetière", quantity: 1 },
    { passcode: 1, zone: "main", quantity: 4 },
    { passcode: 1, zone: "main", quantity: -1 },
    { passcode: -5, zone: "main", quantity: 1 },
    { zone: "main", quantity: 1 },
  ]) {
    const response = await req("PUT", `/decks/${deck.id}/cartes`, corps, cookie);
    assert.equal(response.status, 400, JSON.stringify(corps));
  }
});

test("un nom de deck vide est refusé", async () => {
  const { cookie } = await freshSession(app, "nomvide");
  for (const corps of [{ name: "" }, { name: "   " }, {}]) {
    assert.equal((await req("POST", "/decks", corps, cookie)).status, 400, JSON.stringify(corps));
  }
});

test("un corps illisible ne fait pas tomber la route", async () => {
  // Un client qui envoie du JSON tronqué mérite un 400, pas une erreur interne.
  const { cookie } = await freshSession(app, "illisible");
  const response = await app.request("/decks", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: "{ceci n'est pas du JSON",
  });
  assert.equal(response.status, 400);
});

test("la garde d'origine protège les écritures de deck", async () => {
  /**
   * `SameSite=Strict` fait déjà l'essentiel ; la garde d'origine est la seconde
   * serrure. Elle est montée pour toute l'application — cette épreuve vérifie
   * qu'un module ajouté après coup en hérite bien.
   */
  const { cookie } = await freshSession(app, "csrfdeck");
  const response = await app.request("/decks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
      Origin: "https://ailleurs.exemple",
      Host: "atem.exemple.fr",
    },
    body: JSON.stringify({ name: "Depuis ailleurs" }),
  });
  assert.equal(response.status, 403);
});

test("un identifiant qui n'est pas un UUID ne fait pas tomber la route", async () => {
  // La colonne est un `uuid` : PostgreSQL refuse la comparaison, et sans garde
  // le refus remonte en erreur interne.
  const { cookie } = await freshSession(app, "pasuuid");
  const response = await req("GET", "/decks/pas-un-uuid", undefined, cookie);
  assert.ok(
    response.status === 400 || response.status === 404,
    `attendu 400 ou 404, reçu ${response.status}`,
  );
});
