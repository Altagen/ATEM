import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { listCollection } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";
import {
  createScanlist, deleteScanlist, getScanlist, listScanlists, pourScanlist,
} from "./service.js";
import { scanlistLines } from "./schema.js";

const { db } = createTestApp();

async function newUser(): Promise<{ id: string }> {
  const { user } = await registerUser(db, {
    email: freshEmail("scanlist"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Trieur",
  });
  return { id: user.id };
}

async function seedCard(passcode: number, setCode: string, name: string) {
  await upsertCard(db, {
    passcode, nameEn: name, nameFr: name,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Fish", attribute: "WATER", atk: 1000, def: 1000, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  return upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
}

const ligne = (setCode: string, quantity: number) => ({
  setCode, name: null, passcode: null, quantity,
});

test("un lot enregistré ne touche pas la collection", async () => {
  /**
   * C'est la raison d'être du module. On inventorie un arrivage sans le
   * verser : la collection ne doit pas bouger d'un exemplaire tant qu'on n'a
   * pas explicitement demandé le versement.
   */
  const user = await newUser();
  await seedCard(88888801, "SCAN-FR001", "Trieuse");

  await createScanlist(db, user.id, { name: "Arrivage", lines: [ligne("SCAN-FR001", 3)] });

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.total, 0, "la collection reste vide");
});

test("les lignes à zéro n'entrent pas dans un lot enregistré", async () => {
  /**
   * Le zéro existe pendant qu'on scanne — c'est le plancher du « −1 », et il
   * montre ce qu'on vient d'annuler. Il ne s'enregistre pas : une ligne qui
   * déclare zéro exemplaire ne dit rien.
   */
  const user = await newUser();
  const lot = await createScanlist(db, user.id, {
    name: "Avec des zéros",
    lines: [ligne("SCAN-FR002", 2), ligne("SCAN-FR003", 0)],
  });

  assert.equal(lot.lines.length, 1);
  assert.equal(lot.lines[0]?.setCode, "SCAN-FR002");
  assert.equal(lot.copyCount, 2);
});

test("un lot entièrement à zéro est refusé", async () => {
  const user = await newUser();
  await assert.rejects(
    () => createScanlist(db, user.id, { name: "Vide", lines: [ligne("SCAN-FR004", 0)] }),
    /No cards to save/,
  );
});

test("un même code écrit de deux façons ne casse pas l'enregistrement", async () => {
  /**
   * L'index unique `(lot, code)` refuserait la seconde insertion au milieu du
   * lot, et tout le scan serait perdu. On additionne avant d'écrire.
   */
  const user = await newUser();
  const lot = await createScanlist(db, user.id, {
    name: "Doublons",
    lines: [ligne("scan-fr005", 2), ligne("SCAN-FR005", 3)],
  });

  assert.equal(lot.lines.length, 1);
  assert.equal(lot.lines[0]?.quantity, 5);
});

test("verser ajoute les quantités à la collection", async () => {
  const user = await newUser();
  await seedCard(88888806, "SCAN-FR006", "Versée");
  const lot = await createScanlist(db, user.id, { name: "À verser", lines: [ligne("SCAN-FR006", 4)] });

  const bilan = await pourScanlist(db, user.id, lot.id);
  assert.equal(bilan.poured, 4);
  assert.equal(bilan.failed, 0);

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.total, 1);
  assert.equal(collection.items[0]?.quantity, 4);
  resetResolveQueue();
});

test("verser deux fois est refusé", async () => {
  /**
   * Verser deux fois doublerait la collection sans que rien ne le signale.
   * La date est posée dans la même écriture qui vérifie qu'elle était nulle :
   * un double appui ne peut pas passer entre les deux.
   */
  const user = await newUser();
  await seedCard(88888807, "SCAN-FR007", "Deux fois");
  const lot = await createScanlist(db, user.id, { name: "Double", lines: [ligne("SCAN-FR007", 2)] });

  await pourScanlist(db, user.id, lot.id);
  await assert.rejects(() => pourScanlist(db, user.id, lot.id), /already been poured/);

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 2, "la quantité n'a pas doublé");
  resetResolveQueue();
});

test("deux versements simultanés ne versent qu'une fois", async () => {
  const user = await newUser();
  await seedCard(88888808, "SCAN-FR008", "Concurrente");
  const lot = await createScanlist(db, user.id, { name: "Course", lines: [ligne("SCAN-FR008", 5)] });

  const issues = await Promise.allSettled([
    pourScanlist(db, user.id, lot.id),
    pourScanlist(db, user.id, lot.id),
  ]);
  const réussis = issues.filter((i) => i.status === "fulfilled");
  assert.equal(réussis.length, 1, "un seul versement aboutit");

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 5);
  resetResolveQueue();
});

test("un lot survit à son versement, daté", async () => {
  const user = await newUser();
  await seedCard(88888809, "SCAN-FR009", "Trace");
  const lot = await createScanlist(db, user.id, { name: "Trace", lines: [ligne("SCAN-FR009", 1)] });
  await pourScanlist(db, user.id, lot.id);

  const relu = await getScanlist(db, user.id, lot.id);
  assert.ok(relu.pouredAt, "la date de versement est gardée");
  assert.equal(relu.lines.length, 1, "les lignes aussi");
  resetResolveQueue();
});

test("le lot d'autrui est introuvable, pas interdit", async () => {
  const propriétaire = await newUser();
  const autre = await newUser();
  const lot = await createScanlist(db, propriétaire.id, {
    name: "Privé", lines: [ligne("SCAN-FR010", 1)],
  });

  // Un 403 dirait qu'il existe. Il ne doit rien dire du tout.
  await assert.rejects(() => getScanlist(db, autre.id, lot.id), /not found/);
  await assert.rejects(() => pourScanlist(db, autre.id, lot.id), /not found/);
  await assert.rejects(() => deleteScanlist(db, autre.id, lot.id), /not found/);
});

test("la liste ne montre que ses propres lots", async () => {
  const user = await newUser();
  const autre = await newUser();
  await createScanlist(db, user.id, { name: "Le mien", lines: [ligne("SCAN-FR011", 1)] });
  await createScanlist(db, autre.id, { name: "Le sien", lines: [ligne("SCAN-FR012", 1)] });

  const lots = await listScanlists(db, user.id);
  assert.equal(lots.length, 1);
  assert.equal(lots[0]?.name, "Le mien");
  assert.equal(lots[0]?.lineCount, 1);
  assert.equal(lots[0]?.copyCount, 1);
});

test("jeter un lot emporte ses lignes", async () => {
  const user = await newUser();
  const lot = await createScanlist(db, user.id, { name: "À jeter", lines: [ligne("SCAN-FR013", 2)] });

  await deleteScanlist(db, user.id, lot.id);

  const restantes = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, lot.id));
  assert.equal(restantes.length, 0);
  await assert.rejects(() => getScanlist(db, user.id, lot.id), /not found/);
});

test("une ligne que le catalogue ne place pas est comptée, sans bloquer les autres", async () => {
  /**
   * Une scanliste versée à moitié doit se lire comme telle. La quantité
   * plafonnée à 1000 fait échouer la ligne sans emporter le reste du lot.
   */
  const user = await newUser();
  await seedCard(88888814, "SCAN-FR014", "Bonne");
  const lot = await createScanlist(db, user.id, {
    name: "Mixte",
    lines: [ligne("SCAN-FR014", 2), ligne("", 3), ligne("SCAN-FR015", 1)],
  });

  // La ligne au code vide est écartée dès l'enregistrement : elle n'a pas
  // d'identité, et l'inventaire n'a rien à en faire.
  assert.equal(lot.lines.length, 2);

  const bilan = await pourScanlist(db, user.id, lot.id);
  assert.equal(bilan.poured, 3, "les deux lignes valides sont versées");
  assert.equal(bilan.failed, 0);
  resetResolveQueue();
});

test("un identifiant qui n'est pas un UUID est refusé, pas planté", async () => {
  /**
   * La colonne est un `uuid` : PostgreSQL refuse la comparaison avec une chaîne
   * quelconque, et sans garde ce refus remontait en **erreur interne** — un 500
   * pour une adresse mal tapée.
   *
   * La première version de cette épreuve cherchait « invalid input syntax »
   * dans le message et passait : Drizzle y met la requête échouée, pas la
   * plainte de PostgreSQL, qui vit dans la cause. Elle vérifie donc maintenant
   * que c'est bien **notre** refus qu'on reçoit.
   */
  const user = await newUser();
  for (const bancal of ["pas-un-uuid", "", "12345", "00000000-0000-0000-0000-00000000000"]) {
    await assert.rejects(
      () => getScanlist(db, user.id, bancal),
      /Invalid identifier/,
      `« ${bancal} »`,
    );
  }
});
