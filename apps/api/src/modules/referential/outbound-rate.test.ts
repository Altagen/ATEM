import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resetOutboundRate, retryAfterMs, throttleOutbound, withOutboundSlot,
} from "./outbound-rate.js";

/**
 * Le débit sortant vers YGOPRODeck.
 *
 * ATEM-old s'est fait bloquer une heure pour l'avoir mal compté : il limitait
 * les appels d'API mais pas les téléchargements d'images, qui partaient par un
 * autre chemin. Un limiteur par type d'appel ne protège de rien — c'est le
 * total qui compte, et c'est pourquoi il n'existe qu'un seul seau.
 */
test("les appels sont étalés dans le temps", async () => {
  resetOutboundRate();
  const started = Date.now();

  // Huit jetons par seconde : quatre appels demandent au moins trois
  // intervalles d'attente, le premier partant tout de suite.
  await Promise.all([1, 2, 3, 4].map(() => withOutboundSlot(async () => null)));

  const elapsed = Date.now() - started;
  assert.ok(
    elapsed >= 3 * 125 - 20,
    `quatre appels devraient prendre au moins ~375 ms, pris ${elapsed} ms`,
  );
});

test("l'ordre d'appel est conservé", async () => {
  resetOutboundRate();
  const seen: number[] = [];
  await Promise.all(
    [0, 1, 2, 3].map((index) => withOutboundSlot(async () => void seen.push(index))),
  );
  assert.deepEqual(seen, [0, 1, 2, 3]);
});

test("un appel isolé ne paie pas d'attente", async () => {
  resetOutboundRate();
  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started < 60, "le premier jeton est disponible tout de suite");
});

test("la valeur de la tâche est rendue telle quelle", async () => {
  resetOutboundRate();
  assert.equal(await withOutboundSlot(async () => "charge utile"), "charge utile");
});

test("une tâche qui lève ne bloque pas le seau", async () => {
  resetOutboundRate();
  await assert.rejects(() => withOutboundSlot(async () => Promise.reject(new Error("panne"))));
  // Le jeton suivant doit être servi : sinon une seule panne réseau gèlerait
  // toute résolution de carte jusqu'au redémarrage.
  assert.equal(await withOutboundSlot(async () => "après"), "après");
});

/**
 * La mise au pas après un 429.
 *
 * Un refus pour excès de débit ne concerne pas la requête qui l'a reçu : il dit
 * que l'instance parle trop. La réessayer plus tard pendant que les autres
 * partent à plein débit vaut le blocage d'adresse d'une heure — et pendant
 * cette heure, plus aucune carte ne s'identifie.
 */
test("un 429 retient tout le seau, pas seulement l'appel refusé", async () => {
  resetOutboundRate();
  throttleOutbound(300);

  const started = Date.now();
  await withOutboundSlot(async () => null);
  const elapsed = Date.now() - started;

  assert.ok(elapsed >= 260, `l'appel suivant devrait attendre ~300 ms, pris ${elapsed} ms`);
});

test("une mise au pas plus courte n'écourte pas celle en cours", async () => {
  resetOutboundRate();
  throttleOutbound(400);
  throttleOutbound(10);

  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started >= 360, "la plus longue attente l'emporte");
});

test("la mise au pas est plafonnée", () => {
  resetOutboundRate();
  // Un `Retry-After` d'un jour ne doit pas condamner l'instance jusqu'au
  // lendemain : on plafonne à dix minutes, quitte à retenter pour rien.
  throttleOutbound(24 * 3600_000);
  const started = Date.now();
  throttleOutbound(0);
  assert.ok(Date.now() - started < 50, "la fonction ne bloque pas");
});

test("une mise au pas absurde est ignorée", async () => {
  resetOutboundRate();
  throttleOutbound(Number.NaN);
  throttleOutbound(-5);
  const started = Date.now();
  await withOutboundSlot(async () => null);
  assert.ok(Date.now() - started < 60, "ni NaN ni une valeur négative ne retiennent le seau");
});

/**
 * `Retry-After` existe sous deux formes, et n'en lire qu'une revient à ignorer
 * l'autre en silence — donc à repartir aussitôt, ce que l'en-tête interdisait.
 */
test("« Retry-After » se lit en secondes", () => {
  assert.equal(retryAfterMs("120"), 120_000);
  assert.equal(retryAfterMs(" 30 "), 30_000);
  assert.equal(retryAfterMs("0"), 0);
});

test("« Retry-After » se lit aussi en date HTTP", () => {
  const future = new Date(Date.now() + 5_000).toUTCString();
  const delay = retryAfterMs(future);
  assert.ok(delay !== null && delay > 3_000 && delay <= 6_000, `délai lu : ${delay}`);

  // Une date déjà passée vaut « tout de suite », pas un délai négatif.
  assert.equal(retryAfterMs(new Date(Date.now() - 60_000).toUTCString()), 0);
});

test("un « Retry-After » absent ou illisible ne dit rien", () => {
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs(""), null);
  assert.equal(retryAfterMs("bientôt"), null);
});
