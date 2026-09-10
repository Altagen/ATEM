import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { cardPrints, cards } from "../referential/schema.js";
import { markUnidentified, upsertCard, upsertPrint } from "../referential/index.js";
import {
  adjustQuantity, listCollection, requeuePendingResolves, reresolve, resolveStatus,
  setFavorite, setNotes,
} from "./service.js";
import { configureResolveQueue, drainNow, resetResolveQueue } from "./resolve-queue.js";
import { ownedCards } from "./schema.js";

const { db } = createTestApp();

/**
 * Les comptes sont créés par le service, pas par la route.
 *
 * Ces tests portent sur la collection, pas sur le transport de
 * l'authentification — et la route applique une limitation de débit qui, à la
 * cinquième inscription, ferait échouer des tests qui n'ont rien à voir avec
 * elle. Passer par le service teste ce qu'on veut tester.
 */
async function newUser(): Promise<{ id: string }> {
  const { user } = await registerUser(db, {
    email: freshEmail("collec"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Collectionneur",
  });
  return { id: user.id };
}

/**
 * Vérifie qu'une écriture est rejetée par une contrainte nommée de la base.
 *
 * Drizzle enveloppe l'erreur du pilote : son `message` porte la requête qui a
 * échoué, et le nom de la contrainte vit dans la cause. Sans cette distinction,
 * une assertion sur le message passerait pour n'importe quelle erreur SQL — y
 * compris une faute de frappe dans le test lui-même.
 */
async function assertRejectedBy(constraint: string, write: () => Promise<unknown>) {
  try {
    await write();
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    assert.equal(
      cause?.constraint_name,
      constraint,
      `attendu un rejet par ${constraint}, obtenu ${cause?.constraint_name ?? "aucune contrainte"}`,
    );
    return;
  }
  assert.fail(`l'écriture aurait dû être rejetée par ${constraint}`);
}

/** Une carte et son impression, posées à la main : aucun test ne sort sur le réseau. */
async function seedCard(passcode: number, setCode: string, names: { en: string; fr?: string }) {
  await upsertCard(db, {
    passcode,
    nameEn: names.en,
    nameFr: names.fr ?? null,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Fish", attribute: "WATER", atk: 1000, def: 3000, level: 9, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  return upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
}

test("un code inconnu entre dans l'inventaire sans attendre le réseau", async () => {
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, { setCode: "ZZZZ-FR999", delta: 2 });

  assert.equal(item.quantity, 2);
  assert.equal(item.card, null);
  // La ligne existe, elle est comptée, et elle sait qu'elle attend son identité.
  assert.equal(item.print.resolveStatus, "pending");
});

test("la saisie est normalisée avant d'identifier la ligne", async () => {
  const user = await newUser();
  await seedCard(11111111, "TEST-FR001", { en: "Test Card", fr: "Carte de test" });

  await adjustQuantity(db, user.id, { setCode: "test fr001", delta: 1 });
  const again = await adjustQuantity(db, user.id, { setCode: "  TEST-FR001  ", delta: 2 });

  // Trois écritures approximatives, une seule ligne.
  assert.equal(again.quantity, 3);
  const { total } = await listCollection(db, user.id, {});
  assert.equal(total, 1);
});

test("le nom affiché suit la langue de l'exemplaire, pas celle de l'interface", async () => {
  // Une carte achetée en anglais reste affichée en anglais : c'est ce qui est
  // écrit sur le carton posé sur la table.
  const user = await newUser();
  await seedCard(22222222, "AAAA-EN001", { en: "Great White", fr: "Grande Baleine" });
  await seedCard(22222222, "AAAA-FR001", { en: "Great White", fr: "Grande Baleine" });

  await adjustQuantity(db, user.id, { setCode: "AAAA-EN001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "AAAA-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, { sort: "setCode" });
  const byCode = new Map(items.map((item) => [item.setCode, item.card?.name]));
  assert.equal(byCode.get("AAAA-EN001"), "Great White");
  assert.equal(byCode.get("AAAA-FR001"), "Grande Baleine");
});

test("la quantité ne descend pas sous zéro", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "BBBB-FR001", delta: 1 });
  await assert.rejects(
    () => adjustQuantity(db, user.id, { setCode: "BBBB-FR001", delta: -5 }),
    /moins de zéro/,
  );
});

test("la quantité est plafonnée", async () => {
  // ATEM-old n'avait aucune borne haute : un CSV avec quantity=999999999 passait.
  const user = await newUser();
  await assert.rejects(
    () => adjustQuantity(db, user.id, { setCode: "CCCC-FR001", delta: 1001 }),
    /1000 exemplaires/,
  );
});

test("une ligne tombée à zéro disparaît de la collection", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "DDDD-FR001", delta: 2 });
  await adjustQuantity(db, user.id, { setCode: "DDDD-FR001", delta: -2 });

  const { total } = await listCollection(db, user.id, {});
  assert.equal(total, 0);
});

test("la ligne d'autrui est introuvable, pas interdite", async () => {
  // Un 403 confirmerait que la ligne existe. Un 404 ne dit rien.
  const owner = await newUser();
  const stranger = await newUser();
  const item = await adjustQuantity(db, owner.id, { setCode: "EEEE-FR001", delta: 1 });

  await assert.rejects(() => setFavorite(db, stranger.id, item.id, true), /introuvable/);
  await setFavorite(db, owner.id, item.id, true);
});

test("la collection d'un compte ignore celle des autres", async () => {
  const first = await newUser();
  const second = await newUser();
  await adjustQuantity(db, first.id, { setCode: "FFFF-FR001", delta: 3 });

  assert.equal((await listCollection(db, second.id, {})).total, 0);
  assert.equal((await listCollection(db, first.id, {})).total, 1);
});

test("la consolidation d'une ligne provisoire ne perd aucun exemplaire", async () => {
  // Le chemin normal de chaque carte scannée : la ligne est d'abord provisoire,
  // puis raccrochée à la vraie édition. ATEM-old y perdait des exemplaires
  // quand l'opération n'était pas atomique.
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "GGGG-FR001", delta: 4 });

  const before = await listCollection(db, user.id, {});
  assert.equal(before.items[0]?.card, null);
  assert.equal(before.items[0]?.quantity, 4);

  // La vraie édition apparaît au catalogue, comme après un appel réseau réussi.
  await seedCard(33333333, "GGGG-FR001", { en: "Late Card", fr: "Carte tardive" });
  assert.equal(await reresolve(db, user.id, "GGGG-FR001"), true);

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 1, "une seule ligne après consolidation");
  assert.equal(after.items[0]?.quantity, 4, "les quatre exemplaires sont conservés");
  assert.equal(after.items[0]?.card?.name, "Carte tardive");
});

test("la consolidation fusionne avec une ligne déjà résolue", async () => {
  const user = await newUser();
  await seedCard(44444444, "HHHH-FR001", { en: "Known", fr: "Connue" });
  await adjustQuantity(db, user.id, { setCode: "HHHH-FR001", delta: 2 });

  // Une seconde ligne provisoire sur le même code, comme après un scan qui
  // n'aurait pas trouvé l'édition du premier coup.
  const placeholder = await upsertPrint(db, {
    setCode: "HHHH-FR001", cardPasscode: null, rarity: "Autre",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: placeholder.id, setCode: "HHHH-FR001", quantity: 3,
  });

  await reresolve(db, user.id, "HHHH-FR001");

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 1);
  assert.equal(after.items[0]?.quantity, 5, "2 + 3, rien de perdu");
});

test("les filtres portent sur les valeurs canoniques anglaises", async () => {
  // Les énumérations restent en anglais en base : un filtre reste valide quand
  // l'utilisateur change la langue de son interface.
  const user = await newUser();
  await seedCard(55555555, "IIII-FR001", { en: "Filtered", fr: "Filtrée" });
  await adjustQuantity(db, user.id, { setCode: "IIII-FR001", delta: 1 });

  assert.equal((await listCollection(db, user.id, { attribute: ["WATER"] })).total, 1);
  assert.equal((await listCollection(db, user.id, { attribute: ["DARK"] })).total, 0);
  assert.equal((await listCollection(db, user.id, { levels: ["9"] })).total, 1);
  assert.equal((await listCollection(db, user.id, { levels: ["10"] })).total, 0);
});

test("une impression non identifiée reste visible et filtrable", async () => {
  // C'est justement la ligne que le joueur veut corriger : elle ne doit pas
  // disparaître parce qu'elle n'a pas de carte.
  const user = await newUser();
  await seedCard(66666666, "JJJJ-FR001", { en: "Resolved", fr: "Résolue" });
  await adjustQuantity(db, user.id, { setCode: "JJJJ-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "KKKK-FR999", delta: 1 });

  assert.equal((await listCollection(db, user.id, {})).total, 2);
  const unresolved = await listCollection(db, user.id, { unresolvedOnly: true });
  assert.equal(unresolved.total, 1);
  assert.equal(unresolved.items[0]?.setCode, "KKKK-FR999");
});

test("la base refuse une impression résolue sans carte", async () => {
  // L'invariant ne repose pas sur la discipline du code : PostgreSQL l'impose.
  await assertRejectedBy("card_prints_resolved_has_card", () =>
    db.insert(cardPrints).values({
      setCode: "LLLL-FR001",
      canonicalSetCode: "LLLL-001",
      cardPasscode: null,
      resolveStatus: "resolved",
    }),
  );
});

test("la base refuse un statut de résolution inventé", async () => {
  await assertRejectedBy("card_prints_status_vocab", () =>
    db.insert(cardPrints).values({
      setCode: "MMMM-FR001",
      canonicalSetCode: "MMMM-001",
      cardPasscode: null,
      resolveStatus: "peut-etre",
    }),
  );
});

test("le catalogue n'est jamais écrit par la collection", async () => {
  // Une carte provisoire ne crée aucune ligne dans `cards` : c'est ce qui
  // remplace les passcodes négatifs d'ATEM-old.
  const user = await newUser();
  const before = await db.select({ passcode: cards.passcode }).from(cards);
  await adjustQuantity(db, user.id, { setCode: "NNNN-FR777", delta: 1 });
  const after = await db.select({ passcode: cards.passcode }).from(cards);

  assert.equal(after.length, before.length, "aucune carte fabriquée");

  const [print] = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.setCode, "NNNN-FR777"))
    .limit(1);
  assert.equal(print?.cardPasscode, null);
  assert.equal(print?.resolveStatus, "pending");
});

test("le code du joueur est matérialisé même si seul l'anglais est au catalogue", async () => {
  // Le cas normal après un import complet : le catalogue ne contient que les
  // codes anglais. Une carte française doit malgré tout produire une ligne
  // portant le code réellement imprimé, et afficher le nom français.
  //
  // Sans ça, la ligne pointait vers l'impression anglaise : nom anglais sur une
  // carte française, et un code jamais saisi rendu à l'export. Défaut vu à
  // l'écran, pas dans le code.
  const user = await newUser();
  await seedCard(77777777, "OOOO-EN001", { en: "Great White", fr: "Grande Baleine" });

  const item = await adjustQuantity(db, user.id, { setCode: "OOOO-FR001", delta: 1 });

  assert.equal(item.print.setCode, "OOOO-FR001", "le code imprimé du joueur");
  assert.equal(item.print.language, "fr");
  assert.equal(item.print.resolveStatus, "resolved", "raccrochée à la carte connue");
  assert.equal(item.card?.name, "Grande Baleine");
});

test("la notation sans région rejoint la notation avec région", async () => {
  // Le dump YGOPRODeck écrit « LOB-001 », cardsetsinfo répond sur « LOB-EN001 »,
  // et les cartes portent l'une ou l'autre selon leur année d'impression.
  const user = await newUser();
  await seedCard(88888888, "PPPP-001", { en: "No Region", fr: "Sans région" });

  const item = await adjustQuantity(db, user.id, { setCode: "PPPP-FR001", delta: 1 });

  assert.equal(item.print.setCode, "PPPP-FR001");
  assert.equal(item.card?.name, "Sans région");
});

test("la consolidation ne fond pas deux raretés différentes", async () => {
  // L'unité de l'inventaire est (set_code, rareté, langue). Consolider par
  // dessus la rareté ne perd pas d'exemplaire, mais perd son édition — ce qui
  // contredit la raison d'être du module.
  const user = await newUser();
  await seedCard(99999901, "RRRR-FR001", { en: "Two Rarities", fr: "Deux raretés" });

  // Une édition connue, en Ultra Rare.
  const ultra = await upsertPrint(db, {
    setCode: "RRRR-FR001", cardPasscode: 99999901, rarity: "Ultra Rare", language: "fr",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: ultra.id, setCode: "RRRR-FR001", quantity: 3,
  });

  // Et une seconde, en Secret Rare, elle aussi identifiée.
  const secret = await upsertPrint(db, {
    setCode: "RRRR-FR001", cardPasscode: 99999901, rarity: "Secret Rare", language: "fr",
  });
  await db.insert(ownedCards).values({
    userId: user.id, printId: secret.id, setCode: "RRRR-FR001", quantity: 2,
  });

  await reresolve(db, user.id, "RRRR-FR001");

  const after = await listCollection(db, user.id, {});
  assert.equal(after.total, 2, "les deux raretés restent distinctes");
  const quantities = after.items.map((item) => item.quantity).sort();
  assert.deepEqual(quantities, [2, 3]);
});

test("deux ajouts simultanés ne perdent aucun exemplaire", async () => {
  // Un double appui sur « +1 », ou le bouton du scanner pressé deux fois.
  // Le lire-puis-écrire d'origine laissait les deux lire la même quantité et
  // écrire la même somme : un incrément perdu, sans aucune erreur.
  const user = await newUser();
  await seedCard(99999902, "SSSS-FR001", { en: "Concurrent", fr: "Concurrent" });

  await Promise.all(
    Array.from({ length: 8 }, () =>
      adjustQuantity(db, user.id, { setCode: "SSSS-FR001", delta: 1 }),
    ),
  );

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.quantity, 8, "huit ajouts simultanés font huit exemplaires");
});

test("le passcode identifie la carte sans attendre", async () => {
  // Le recours quand le set code est illisible : les huit chiffres en bas à
  // gauche restent lisibles. ATEM-old avait ce champ ; il avait disparu.
  const user = await newUser();
  await seedCard(12345678, "TTTT-EN001", { en: "By Passcode", fr: "Par passcode" });

  const item = await adjustQuantity(db, user.id, {
    setCode: "ZZZZ-FR001",
    delta: 1,
    passcode: 12345678,
  });

  assert.equal(item.print.resolveStatus, "resolved", "identifiée tout de suite");
  assert.equal(item.card?.name, "Par passcode");
  assert.equal(item.setCode, "ZZZZ-FR001", "le code du joueur reste son identité");
});

test("un passcode inconnu n'empêche pas l'ajout", async () => {
  // Aller chercher la carte demanderait un appel réseau, et rien ne sort sur
  // le chemin d'une requête. La ligne entre en attente, comme d'habitude.
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, {
    setCode: "UUUU-FR001",
    delta: 1,
    passcode: 99999999,
  });
  assert.equal(item.print.resolveStatus, "pending");
  assert.equal(item.quantity, 1);
});

test("la recherche trouve aussi par passcode", async () => {
  const user = await newUser();
  await seedCard(24681012, "VVVV-FR001", { en: "Findable", fr: "Trouvable" });
  await adjustQuantity(db, user.id, { setCode: "VVVV-FR001", delta: 1 });

  assert.equal((await listCollection(db, user.id, { query: "24681012" })).total, 1);
  assert.equal((await listCollection(db, user.id, { query: "2468" })).total, 1);
  assert.equal((await listCollection(db, user.id, { query: "99999999" })).total, 0);
});

test("le rang Xyz ne se confond pas avec le niveau", async () => {
  // L'API range les deux dans le même champ. Un Xyz de rang 4 n'est pas un
  // monstre de niveau 4 : les mélanger produit un filtre qui ne veut rien dire.
  const user = await newUser();
  await upsertCard(db, {
    passcode: 31415926, nameEn: "Xyz Four", nameFr: null, descEn: null, descFr: null,
    type: "XYZ Monster", frameType: "xyz", race: "Warrior", attribute: "DARK",
    atk: 2000, def: 2000, level: 4, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode: "WWWW-FR001", cardPasscode: 31415926, rarity: "Rare" });
  await seedCard(27182818, "WWWW-FR002", { en: "Level Four", fr: "Niveau quatre" });

  await adjustQuantity(db, user.id, { setCode: "WWWW-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "WWWW-FR002", delta: 1 });

  const byRank = await listCollection(db, user.id, { ranks: ["4"] });
  assert.equal(byRank.total, 1);
  assert.equal(byRank.items[0]?.card?.name, "Xyz Four");

  // La carte de niveau 9 posée par `seedCard` n'a pas de rang 4.
  const byLevel = await listCollection(db, user.id, { levels: ["9"] });
  assert.equal(byLevel.total, 1);
  assert.equal(byLevel.items[0]?.card?.name, "Niveau quatre");
});

test("le sens du tri se renverse", async () => {
  const user = await newUser();
  await seedCard(11111191, "XAAA-FR001", { en: "Alpha", fr: "Alpha" });
  await seedCard(11111192, "XBBB-FR001", { en: "Beta", fr: "Beta" });
  await adjustQuantity(db, user.id, { setCode: "XAAA-FR001", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "XBBB-FR001", delta: 1 });

  const asc = await listCollection(db, user.id, { sort: "setCode", sortDir: "asc" });
  const desc = await listCollection(db, user.id, { sort: "setCode", sortDir: "desc" });

  assert.equal(asc.items[0]?.setCode, "XAAA-FR001");
  assert.equal(desc.items[0]?.setCode, "XBBB-FR001");
});

test("une note s'enregistre et se relit", async () => {
  const user = await newUser();
  const item = await adjustQuantity(db, user.id, { setCode: "YYYY-FR001", delta: 1 });

  await setNotes(db, user.id, item.id, "  Achetée en boutique  ");
  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.notes, "Achetée en boutique", "les espaces de bord sont ôtés");

  await setNotes(db, user.id, item.id, "   ");
  const cleared = await listCollection(db, user.id, {});
  assert.equal(cleared.items[0]?.notes, null, "une note vide est effacée");
});

test("la note d'autrui est introuvable", async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const item = await adjustQuantity(db, owner.id, { setCode: "YZZZ-FR001", delta: 1 });
  await assert.rejects(() => setNotes(db, stranger.id, item.id, "vol"), /introuvable/);
});

test("une carte pas encore traduite est signalée", async () => {
  /**
   * 2 863 cartes sur 14 524 n'ont **aucune** donnée française chez YGOPRODeck —
   * ni nom, ni texte. Ce n'est pas définitif : mesuré par extension, les
   * anciennes sont couvertes à 100 % et les récentes à 0-60 %. La source accuse
   * un retard, elle ne renonce pas.
   *
   * L'écran doit pouvoir le dire, et le dire juste : « Aspischool » s'appelle
   * bien « Banc d'aspis », c'est le catalogue qui ne le sait pas encore.
   */
  const user = await newUser();
  await upsertCard(db, {
    passcode: 55555591, nameEn: "English Only", nameFr: null,
    descEn: "Destroy one monster.", descFr: null,
    type: "Effect Monster", frameType: "effect", race: "Fiend", attribute: "DARK",
    atk: 1000, def: 1000, level: 4, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });
  await upsertPrint(db, { setCode: "ZAAA-FR001", cardPasscode: 55555591, rarity: "Rare" });
  await adjustQuantity(db, user.id, { setCode: "ZAAA-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.card?.name, "English Only", "le nom aussi est l'anglais");
  assert.equal(items[0]?.card?.desc, "Destroy one monster.");
  assert.equal(items[0]?.card?.frenchPending, true, "l'écran doit pouvoir le dire");
});

test("une carte traduite ne signale rien", async () => {
  const user = await newUser();
  await seedCard(55555592, "ZBBB-FR001", { en: "Both", fr: "Les deux" });
  await db
    .update(cards)
    .set({ descFr: "Détruisez un monstre." })
    .where(eq(cards.passcode, 55555592));
  await adjustQuantity(db, user.id, { setCode: "ZBBB-FR001", delta: 1 });

  const { items } = await listCollection(db, user.id, {});
  assert.equal(items[0]?.card?.desc, "Détruisez un monstre.");
  assert.equal(items[0]?.card?.frenchPending, false);
});

/**
 * La reprise au démarrage.
 *
 * La file de résolution ne vit qu'en mémoire. Une ligne entrée juste avant un
 * redéploiement — ou un `docker compose down` — restait « en attente
 * d'identification » **pour toujours** : rien ne reprenait le travail, et rien
 * ne le signalait. Le commentaire de la file promettait pourtant l'inverse.
 */

/**
 * Rejoue un redémarrage et rend les codes que la file redemanderait.
 *
 * La base est partagée par toutes les épreuves du fichier : compter les entrées
 * ne dirait rien, puisqu'on y verrait aussi celles des autres. On regarde donc
 * **quels** codes la reprise met en file, et on cherche le nôtre.
 */
async function codesReprisAuDemarrage(): Promise<string[]> {
  resetResolveQueue();
  const demandés: string[] = [];
  configureResolveQueue({
    attempt: async (_userId, setCode) => {
      demandés.push(setCode);
      return true;
    },
    abandon: async () => {},
  });

  await requeuePendingResolves(db);
  await drainNow();
  resetResolveQueue();
  return demandés;
}

test("les lignes encore en attente repartent en file au démarrage", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR001", delta: 1 });

  assert.ok(
    (await codesReprisAuDemarrage()).includes("QQQQ-FR001"),
    "la ligne en attente doit être reprise",
  );
});

test("un code déclaré inexistant n'est pas redemandé au démarrage", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR002", delta: 1 });

  // Ce que fait la file quand YGOPRODeck répond « rien » : une absence, pas
  // une panne. Sans cette marque, chaque redémarrage relançait l'appel.
  assert.equal(await markUnidentified(db, "QQQQ-FR002"), 1);

  assert.ok(
    !(await codesReprisAuDemarrage()).includes("QQQQ-FR002"),
    "on ne redemande pas un code dont on sait qu'il n'existe pas",
  );
});

test("une ligne inexistante reste comptée comme en attente à l'écran", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR003", delta: 1 });
  await markUnidentified(db, "QQQQ-FR003");

  /**
   * L'écran additionne les deux états : pour le joueur, une carte non
   * identifiée reste une carte non identifiée, qu'on ait renoncé ou non. Le
   * partage `pending` / `unidentified` sert la file, pas l'affichage.
   */
  const état = await resolveStatus(db, user.id);
  assert.equal(état.unidentified, 1);
  assert.equal(état.pending, 0);
});

test("marquer un code absent ne défait pas une impression identifiée", async () => {
  await seedCard(99999903, "QQQQ-FR004", { en: "Bien connue", fr: "Bien connue" });

  const marquées = await markUnidentified(db, "QQQQ-FR004");
  assert.equal(marquées, 0, "seules les lignes encore provisoires sont concernées");

  const [print] = await db
    .select()
    .from(cardPrints)
    .where(eq(cardPrints.setCode, "QQQQ-FR004"))
    .limit(1);
  assert.equal(print?.resolveStatus, "resolved");
});

test("une ligne tombée à zéro n'est pas reprise au démarrage", async () => {
  const user = await newUser();
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR005", delta: 1 });
  await adjustQuantity(db, user.id, { setCode: "QQQQ-FR005", delta: -1 });

  assert.ok(
    !(await codesReprisAuDemarrage()).includes("QQQQ-FR005"),
    "plus personne ne la possède : il n'y a rien à identifier",
  );
});
