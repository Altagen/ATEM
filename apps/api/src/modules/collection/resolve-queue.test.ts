import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configureResolveQueue, drainNow, enqueueResolve, pendingCount, resetResolveQueue,
} from "./resolve-queue.js";

/**
 * La file de résolution différée.
 *
 * Elle n'avait aucun test, alors qu'elle porte tout ce qui se passe **après**
 * le « +1 » : une carte scannée entre en collection tout de suite, et c'est
 * cette file qui va ensuite savoir de quoi il s'agit. Quand elle se trompe, le
 * symptôme est une ligne qui reste « en attente d'identification » sans que
 * rien ne l'explique — le défaut le plus difficile à diagnostiquer du module.
 *
 * Ces épreuves ne touchent ni la base ni le réseau : la file ne connaît que
 * deux fonctions qu'on lui donne, et c'est exactement ce qu'on lui substitue.
 */

test("chaque personne a droit à sa propre tentative sur un même code", async () => {
  resetResolveQueue();
  const vus: string[] = [];
  configureResolveQueue({
    attempt: async (userId, setCode) => {
      vus.push(`${userId}|${setCode}`);
      return true;
    },
    abandon: async () => {},
  });

  /**
   * Le bug d'ATEM-old, en une ligne : le dédoublonnage se faisait par code
   * seul. Si A avait déjà mis `LOB-FR001` en file, l'entrée de B était écartée
   * comme un doublon — et la ligne de B restait provisoire indéfiniment. Le
   * travail à faire n'est pas « résoudre ce code », c'est « réparer la ligne de
   * cette personne ».
   */
  enqueueResolve("utilisateur-a", "LOB-FR001");
  enqueueResolve("utilisateur-b", "LOB-FR001");
  await drainNow();

  assert.deepEqual(vus, ["utilisateur-a|LOB-FR001", "utilisateur-b|LOB-FR001"]);
});

test("le même travail demandé deux fois n'est fait qu'une", async () => {
  resetResolveQueue();
  let appels = 0;
  configureResolveQueue({
    attempt: async () => {
      appels += 1;
      return true;
    },
    abandon: async () => {},
  });

  enqueueResolve("utilisateur-a", "LOB-FR001");
  enqueueResolve("utilisateur-a", "LOB-FR001");
  assert.equal(pendingCount(), 1, "une seule entrée en file");

  await drainNow();
  assert.equal(appels, 1);
});

test("une absence est définitive et s'inscrit", async () => {
  resetResolveQueue();
  const abandonnés: string[] = [];
  configureResolveQueue({
    // `false` sans erreur : le code n'existe pas chez YGOPRODeck.
    attempt: async () => false,
    abandon: async (_userId, setCode) => void abandonnés.push(setCode),
  });

  enqueueResolve("utilisateur-a", "RA03-FR004UL");
  await drainNow();

  assert.deepEqual(abandonnés, ["RA03-FR004UL"]);
  assert.equal(pendingCount(), 0, "on ne redemande pas un code dont on sait qu'il n'existe pas");
});

test("une panne est réessayée, et n'inscrit rien", async () => {
  resetResolveQueue();
  let appels = 0;
  let abandons = 0;
  configureResolveQueue({
    attempt: async () => {
      appels += 1;
      throw new Error("réseau injoignable");
    },
    abandon: async () => void (abandons += 1),
  });

  enqueueResolve("utilisateur-a", "LOB-FR001");
  await drainNow();

  assert.equal(appels, 1);
  assert.equal(pendingCount(), 1, "l'entrée reste en file pour un nouvel essai");
  assert.equal(
    abandons,
    0,
    "une coupure réseau n'est pas une carte inexistante : rien ne doit être inscrit",
  );
});

test("la file renonce après quatre pannes, sans déclarer le code absent", async (t) => {
  resetResolveQueue();
  let appels = 0;
  let abandons = 0;
  configureResolveQueue({
    attempt: async () => {
      appels += 1;
      throw new Error("réseau injoignable");
    },
    abandon: async () => void (abandons += 1),
  });

  /**
   * L'horloge est simulée : la file attend jusqu'à 24 s avant sa quatrième
   * tentative, et une épreuve qui dort vraiment aussi longtemps finit par être
   * supprimée ou rendue instable. On avance le temps, on ne le subit pas.
   */
  t.mock.timers.enable({ apis: ["Date"] });

  enqueueResolve("utilisateur-a", "LOB-FR001");
  for (let tour = 0; tour < 5 && pendingCount() > 0; tour += 1) {
    await drainNow();
    t.mock.timers.tick(60_000);
  }

  assert.equal(appels, 4, `quatre tentatives attendues, ${appels} faites`);
  assert.equal(pendingCount(), 0, "la file lâche prise au lieu de tourner indéfiniment");
  assert.equal(
    abandons,
    0,
    "après une panne, la ligne doit repartir en file au démarrage suivant — pas être classée",
  );
});

test("une entrée qui n'est pas encore due n'est pas traitée", async () => {
  resetResolveQueue();
  let appels = 0;
  configureResolveQueue({
    attempt: async () => {
      appels += 1;
      throw new Error("réseau injoignable");
    },
    abandon: async () => {},
  });

  enqueueResolve("utilisateur-a", "LOB-FR001");
  await drainNow();
  assert.equal(appels, 1);

  // Immédiatement après l'échec, l'entrée porte une attente : la repasser ne
  // doit rien déclencher, sinon l'étalement ne sert à rien.
  await drainNow();
  assert.equal(appels, 1, "l'attente entre deux tentatives doit être respectée");

  resetResolveQueue();
});

test("une tâche qui lève ne condamne pas les suivantes", async () => {
  resetResolveQueue();
  const traités: string[] = [];
  configureResolveQueue({
    attempt: async (_userId, setCode) => {
      if (setCode === "RQRQ-FR001") throw new Error("réseau injoignable");
      traités.push(setCode);
      return true;
    },
    abandon: async () => {},
  });

  enqueueResolve("utilisateur-a", "RQRQ-FR001");
  enqueueResolve("utilisateur-a", "RQRQ-FR002");
  await drainNow();

  assert.deepEqual(traités, ["RQRQ-FR002"]);
  resetResolveQueue();
});
