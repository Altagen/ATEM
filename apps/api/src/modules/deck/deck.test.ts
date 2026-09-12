import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { adjustQuantity } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";
import { createDeck, deleteDeck, getDeck, listDecks, renameDeck, setDeckCard } from "./service.js";

const { db } = createTestApp();

/**
 * Les decks — la zone où ATEM-old n'avait **aucun test**, et où le triage avait
 * trouvé deux lacunes fonctionnelles.
 */

async function newUser() {
  const { user } = await registerUser(db, {
    email: freshEmail("deck"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Duelliste",
  });
  return user;
}

/** Une carte au catalogue, et `copies` exemplaires en collection. */
async function seed(
  passcode: number,
  setCode: string,
  options: {
    copies?: number; owner?: string; banlist?: string | null; extra?: boolean;
    image?: string;
  } = {},
) {
  await upsertCard(db, {
    passcode,
    nameEn: `Carte ${passcode}`,
    nameFr: `Carte ${passcode}`,
    descEn: null, descFr: null,
    type: options.extra ? "Fusion Monster" : "Effect Monster",
    frameType: options.extra ? "fusion" : "effect",
    race: "Dragon", attribute: "LIGHT", atk: 1000, def: 1000, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null,
    banlistTcg: options.banlist ?? null,
    imageUrl: null, imageUrlSmall: options.image ?? null,
  });
  await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });

  if (options.owner && options.copies) {
    await adjustQuantity(db, options.owner, { setCode, delta: options.copies, passcode });
    resetResolveQueue();
  }
}

test("un deck compte des cartes, pas des impressions", async () => {
  /**
   * La règle posée par Ange, et ce qui rend le plafond exprimable : trois
   * Dragons Blancs en trois codes d'extension restent trois Dragons Blancs.
   */
  const user = await newUser();
  await seed(70000001, "DKDK-FR001", { owner: user.id, copies: 1 });
  // Deux autres impressions de la **même** carte.
  await upsertPrint(db, { setCode: "DKDK-FR101", cardPasscode: 70000001, rarity: "Ultra Rare" });
  await upsertPrint(db, { setCode: "DKDK-FR102", cardPasscode: 70000001, rarity: "Secret Rare" });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR101", delta: 1, passcode: 70000001 });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR102", delta: 1, passcode: 70000001 });
  resetResolveQueue();

  const deck = await createDeck(db, user.id, "Trois codes, une carte");
  const après = await setDeckCard(db, user.id, deck.id, {
    passcode: 70000001, zone: "main", quantity: 3,
  });

  assert.equal(après.cards.length, 1, "une seule ligne pour la carte");
  assert.equal(après.cards[0]?.owned, 3, "les trois impressions comptent pour trois");
  assert.equal(après.counts.main, 3);
});

test("le quatrième exemplaire est refusé par la base elle-même", async () => {
  /**
   * La lacune n°1 d'ATEM-old : son unicité était
   * `(deck, zone, passcode, set_code)`, si bien que la même carte vivait sur
   * plusieurs lignes et totalisait six exemplaires. Le plafond était vérifié
   * par ligne, jamais agrégé.
   *
   * Ici les trois zones sont trois colonnes, et la contrainte porte sur leur
   * somme : même en contournant le service, la base refuse.
   */
  const user = await newUser();
  await seed(70000002, "DKDK-FR002", { owner: user.id, copies: 5 });
  const deck = await createDeck(db, user.id, "Plafond");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000002, zone: "main", quantity: 3 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000002, zone: "side", quantity: 1 }),
    /pas plus de 3/,
  );

  const relu = await getDeck(db, user.id, deck.id);
  assert.equal(relu.counts.main + relu.counts.extra + relu.counts.side, 3);
});

test("le total porte sur toutes les zones à la fois", async () => {
  const user = await newUser();
  await seed(70000003, "DKDK-FR003", { owner: user.id, copies: 5 });
  const deck = await createDeck(db, user.id, "Réparties");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "main", quantity: 2 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "side", quantity: 1 });

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000003, zone: "side", quantity: 2 }),
    /pas plus de 3|autant/,
  );
});

test("on ne met pas dans un deck une carte qu'on ne possède pas", async () => {
  // Décision d'Ange : un deck est borné par la collection, donc jouable.
  const user = await newUser();
  await seed(70000004, "DKDK-FR004");
  const deck = await createDeck(db, user.id, "Sans la carte");

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000004, zone: "main", quantity: 1 }),
    /ne possédez pas/,
  );
});

test("on n'en met pas plus qu'on n'en possède", async () => {
  const user = await newUser();
  await seed(70000005, "DKDK-FR005", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "Deux seulement");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000005, zone: "main", quantity: 2 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000005, zone: "main", quantity: 3 }),
    /ne possédez pas/,
  );
});

test("la banlist borne avant la collection", async () => {
  /**
   * `checkDeckAdd` existait dans ATEM-old et faisait ce calcul correctement —
   * il n'était simplement **jamais appelé côté serveur**. C'était un utilitaire
   * d'affichage : l'écran grisait un bouton, rien n'empêchait la requête.
   */
  const user = await newUser();
  await seed(70000006, "DKDK-FR006", { owner: user.id, copies: 3, banlist: "Limited" });
  const deck = await createDeck(db, user.id, "Limitée");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000006, zone: "main", quantity: 1 });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000006, zone: "main", quantity: 2 }),
    /banlist/,
  );
});

test("une carte interdite ne rentre pas, même possédée", async () => {
  const user = await newUser();
  await seed(70000007, "DKDK-FR007", { owner: user.id, copies: 3, banlist: "Forbidden" });
  const deck = await createDeck(db, user.id, "Interdite");

  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000007, zone: "main", quantity: 1 }),
    /interdite/,
  );
});

test("l'Extra Deck n'accepte que ce qui lui revient", async () => {
  const user = await newUser();
  await seed(70000008, "DKDK-FR008", { owner: user.id, copies: 2, extra: true });
  await seed(70000009, "DKDK-FR009", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "Zones");

  // Une Fusion dans le Main Deck est une main morte.
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000008, zone: "main", quantity: 1 }),
    /Extra Deck/,
  );
  // Un monstre à effet dans l'Extra est illégal.
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 70000009, zone: "extra", quantity: 1 }),
    /ne va pas à l'Extra/,
  );

  // Chacune à sa place, en revanche.
  await setDeckCard(db, user.id, deck.id, { passcode: 70000008, zone: "extra", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000009, zone: "main", quantity: 1 });
  const relu = await getDeck(db, user.id, deck.id);
  assert.equal(relu.counts.extra, 1);
  assert.equal(relu.counts.main, 1);
});

test("le Side Deck accepte les deux", async () => {
  // C'est la règle du jeu : le Side sert à remplacer des cartes des deux côtés.
  const user = await newUser();
  await seed(70000010, "DKDK-FR010", { owner: user.id, copies: 1, extra: true });
  await seed(70000011, "DKDK-FR011", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "Side mixte");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000010, zone: "side", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 70000011, zone: "side", quantity: 1 });
  assert.equal((await getDeck(db, user.id, deck.id)).counts.side, 2);
});

test("poser zéro retire la carte du deck", async () => {
  const user = await newUser();
  await seed(70000012, "DKDK-FR012", { owner: user.id, copies: 2 });
  const deck = await createDeck(db, user.id, "À vider");

  await setDeckCard(db, user.id, deck.id, { passcode: 70000012, zone: "main", quantity: 2 });
  const vidé = await setDeckCard(db, user.id, deck.id, {
    passcode: 70000012, zone: "main", quantity: 0,
  });
  assert.equal(vidé.cards.length, 0, "aucune ligne vide ne reste");
});

test("le manque ne se signale que s'il y en a un", async () => {
  /**
   * Précision d'Ange : quatre exemplaires possédés, trois au deck, un vendu —
   * il ne se passe rien. Le deck ne se signale que si une carte manque
   * vraiment.
   */
  const user = await newUser();
  await seed(70000013, "DKDK-FR013", { owner: user.id, copies: 4 });
  const deck = await createDeck(db, user.id, "Dérive");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000013, zone: "main", quantity: 3 });

  assert.equal((await getDeck(db, user.id, deck.id)).missing, 0);

  // On en vend une : il en reste trois, il en faut trois.
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR013", delta: -1, passcode: 70000013 });
  resetResolveQueue();
  assert.equal((await getDeck(db, user.id, deck.id)).missing, 0, "rien ne manque encore");

  // On en vend une deuxième : là, il en manque une.
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR013", delta: -1, passcode: 70000013 });
  resetResolveQueue();
  const après = await getDeck(db, user.id, deck.id);
  assert.equal(après.missing, 1);
  assert.equal(après.cards[0]?.missing, 1);
});

test("le manque se voit aussi dans la liste des decks", async () => {
  const user = await newUser();
  await seed(70000014, "DKDK-FR014", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "À trous");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000014, zone: "main", quantity: 1 });
  await adjustQuantity(db, user.id, { setCode: "DKDK-FR014", delta: -1, passcode: 70000014 });
  resetResolveQueue();

  const liste = await listDecks(db, user.id);
  const trouvé = liste.find((d) => d.id === deck.id);
  assert.equal(trouvé?.missing, 1, "on voit d'un coup d'œil lesquels sont prêts");
});

test("deux decks du même nom sont refusés", async () => {
  // Deux decks du même nom sont impossibles à distinguer dans une liste, et la
  // confirmation de suppression se tape au nom.
  const user = await newUser();
  await createDeck(db, user.id, "Même nom");
  await assert.rejects(() => createDeck(db, user.id, "Même nom"), /déjà un deck de ce nom/);
});

test("deux personnes peuvent nommer leur deck pareil", async () => {
  // L'unicité est par compte : le nom du voisin ne réserve rien.
  const a = await newUser();
  const b = await newUser();
  await createDeck(db, a.id, "Dragons Blancs");
  assert.ok(await createDeck(db, b.id, "Dragons Blancs"));
});

test("le deck d'autrui est introuvable, pas interdit", async () => {
  const propriétaire = await newUser();
  const autre = await newUser();
  const deck = await createDeck(db, propriétaire.id, "Privé");

  await assert.rejects(() => getDeck(db, autre.id, deck.id), /introuvable/);
  await assert.rejects(() => renameDeck(db, autre.id, deck.id, { name: "Volé" }), /introuvable/);
  await assert.rejects(() => deleteDeck(db, autre.id, deck.id), /introuvable/);
});

test("jeter un deck emporte ses cartes", async () => {
  const user = await newUser();
  await seed(70000015, "DKDK-FR015", { owner: user.id, copies: 1 });
  const deck = await createDeck(db, user.id, "À jeter");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000015, zone: "main", quantity: 1 });

  await deleteDeck(db, user.id, deck.id);
  await assert.rejects(() => getDeck(db, user.id, deck.id), /introuvable/);
});

test("jeter un deck ne touche pas à la collection", async () => {
  // Un deck est une intention, pas une possession.
  const user = await newUser();
  await seed(70000016, "DKDK-FR016", { owner: user.id, copies: 3 });
  const deck = await createDeck(db, user.id, "Sans effet");
  await setDeckCard(db, user.id, deck.id, { passcode: 70000016, zone: "main", quantity: 3 });
  await deleteDeck(db, user.id, deck.id);

  const { listCollection } = await import("../collection/service.js");
  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 3, "les cartes sont toujours là");
});

test("un identifiant de deck mal formé est refusé, pas planté", async () => {
  // Même défaut que pour les scanlistes, trouvé par la même épreuve de route :
  // une colonne `uuid` comparée à n'importe quoi fait tomber la requête.
  const user = await newUser();
  for (const bancal of ["pas-un-uuid", "", "12345"]) {
    await assert.rejects(() => getDeck(db, user.id, bancal), /Identifiant invalide/, `« ${bancal} »`);
    await assert.rejects(() => deleteDeck(db, user.id, bancal), /Identifiant invalide/);
    await assert.rejects(() => renameDeck(db, user.id, bancal, { name: "x" }), /Identifiant invalide/);
  }
});

test("une zone pleine refuse la carte de trop", async () => {
  /**
   * Le maximum se refuse, le minimum se signale : une seizième carte à l'Extra
   * n'est légale dans aucune situation, alors qu'un deck à douze cartes est un
   * deck en cours de construction.
   */
  const user = await newUser();
  const deck = await createDeck(db, user.id, "Extra plein");

  // Quinze cartes d'Extra différentes, une de chaque.
  for (let i = 0; i < 15; i += 1) {
    const passcode = 72000100 + i;
    await seed(passcode, `DKEX-FR${String(100 + i)}`, { owner: user.id, copies: 1, extra: true });
    await setDeckCard(db, user.id, deck.id, { passcode, zone: "extra", quantity: 1 });
  }
  assert.equal((await getDeck(db, user.id, deck.id)).counts.extra, 15);

  await seed(72000200, "DKEX-FR200", { owner: user.id, copies: 1, extra: true });
  await assert.rejects(
    () => setDeckCard(db, user.id, deck.id, { passcode: 72000200, zone: "extra", quantity: 1 }),
    /Extra Deck est plein/,
  );
});

test("remplacer une quantité dans une zone pleine reste possible", async () => {
  // Le total se calcule **hors de la ligne qu'on réécrit** : passer de 3 à 2
  // dans une zone au maximum ne doit pas être refusé comme un ajout.
  const user = await newUser();
  const deck = await createDeck(db, user.id, "Side au max");
  for (let i = 0; i < 5; i += 1) {
    const passcode = 72000300 + i;
    await seed(passcode, `DKSD-FR${String(300 + i)}`, { owner: user.id, copies: 3 });
    await setDeckCard(db, user.id, deck.id, { passcode, zone: "side", quantity: 3 });
  }
  assert.equal((await getDeck(db, user.id, deck.id)).counts.side, 15);

  // La zone est pleine, mais on réduit : c'est permis.
  const réduit = await setDeckCard(db, user.id, deck.id, {
    passcode: 72000300, zone: "side", quantity: 1,
  });
  assert.equal(réduit.counts.side, 13);
});

test("la couverture d'un deck est la carte qu'il joue le plus", async () => {
  /**
   * Une couverture choisie à la main demanderait une colonne, un sélecteur, et
   * de la reprendre quand la carte quitte le deck. Celle-ci se déduit : la
   * carte la plus jouée **est** l'identité du deck.
   */
  const user = await newUser();
  await seed(72000400, "DKCV-FR400", { owner: user.id, copies: 3, image: "/i/400.jpg" });
  await seed(72000401, "DKCV-FR401", { owner: user.id, copies: 3, image: "/i/401.jpg" });

  const deck = await createDeck(db, user.id, "Couverture");
  assert.equal(deck.cover, null, "un deck neuf n'a pas de visage");

  await setDeckCard(db, user.id, deck.id, { passcode: 72000400, zone: "main", quantity: 1 });
  await setDeckCard(db, user.id, deck.id, { passcode: 72000401, zone: "main", quantity: 3 });

  // Le nombre d'exemplaires l'emporte, et non l'ordre des lignes ni le passcode
  // — c'est ici le plus grand des deux qui gagne.
  const [sommaire] = await listDecks(db, user.id);
  assert.equal(sommaire?.cover?.passcode, 72000401);
  assert.equal(sommaire?.cover?.image, "/i/401.jpg");
  assert.equal(sommaire?.cover?.name, "Carte 72000401");

  // La fiche complète répond la même chose : une seule règle, deux écrans.
  assert.equal((await getDeck(db, user.id, deck.id)).cover?.passcode, 72000401);
});

test("à égalité d'exemplaires, la couverture ne change pas d'une requête à l'autre", async () => {
  // Sans départage, l'ordre des lignes rendues par la base ferait varier
  // l'illustration à chaque rafraîchissement.
  const user = await newUser();
  await seed(72000410, "DKCV-FR410", { owner: user.id, copies: 2, image: "/i/410.jpg" });
  await seed(72000411, "DKCV-FR411", { owner: user.id, copies: 2, image: "/i/411.jpg" });

  const deck = await createDeck(db, user.id, "Égalité");
  await setDeckCard(db, user.id, deck.id, { passcode: 72000411, zone: "main", quantity: 2 });
  await setDeckCard(db, user.id, deck.id, { passcode: 72000410, zone: "main", quantity: 2 });

  const [sommaire] = await listDecks(db, user.id);
  assert.equal(sommaire?.cover?.passcode, 72000410, "le plus petit passcode tranche");
});

test("un deck qui n'a que de l'Extra a quand même un visage", async () => {
  // Le Main d'abord, parce que c'est ce qu'on joue ; mais un deck en cours de
  // construction ne doit pas rester sans illustration.
  const user = await newUser();
  await seed(72000420, "DKCV-FR420", { owner: user.id, copies: 1, extra: true, image: "/i/420.jpg" });

  const deck = await createDeck(db, user.id, "Extra seul");
  await setDeckCard(db, user.id, deck.id, { passcode: 72000420, zone: "extra", quantity: 1 });

  const [sommaire] = await listDecks(db, user.id);
  assert.equal(sommaire?.cover?.passcode, 72000420);
});
