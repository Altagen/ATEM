import { test } from "node:test";
import assert from "node:assert/strict";
import { resetOutboundRate, withOutboundSlot } from "./outbound-rate.js";

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
