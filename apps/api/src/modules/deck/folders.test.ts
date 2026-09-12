import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshEmail, freshSession, jsonRequest } from "../../test-support.js";
import { registerUser, deleteAccount } from "../identity/service.js";
import { createDeck, listDecks, updateDeck } from "./service.js";
import { createFolder, deleteFolder, listFolders, updateFolder } from "./folders.js";

const { app, db } = createTestApp();

/**
 * Les dossiers de decks.
 *
 * ATEM-old avait la bonne logique — profondeur, cycles, réattache — et **aucune
 * épreuve**. C'est précisément le genre de code qu'on ne relit jamais et qui se
 * défait au premier remaniement : trois règles qui parlent d'un arbre, dont
 * aucune ne tient dans une contrainte de colonne.
 */

async function newUser() {
  const { user } = await registerUser(db, {
    email: freshEmail("dossier"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Rangeur",
  });
  return user;
}

test("un dossier se crée à la racine, et porte son chemin", async () => {
  const user = await newUser();
  const meta = await createFolder(db, user.id, { name: "Meta" });

  assert.equal(meta.parentId, null);
  assert.deepEqual(meta.path, ["Meta"]);
  assert.equal(meta.depth, 1, "la racine est le premier étage");

  const tier1 = await createFolder(db, user.id, { name: "Tier 1", parentId: meta.id });
  assert.deepEqual(tier1.path, ["Meta", "Tier 1"]);
  assert.equal(tier1.depth, 2);

  const tous = await listFolders(db, user.id);
  assert.deepEqual(tous.map((f) => f.path.join(" / ")), ["Meta", "Meta / Tier 1"]);
});

test("deux dossiers du même nom ne se rangent pas côte à côte", async () => {
  /**
   * `nulls not distinct` est ce qui fait que la règle vaut **aussi à la
   * racine**. Sans lui, Postgres tient deux `parent_id` nuls pour différents et
   * l'on peut créer deux « Meta » à la racine — là où l'on crée le plus.
   */
  const user = await newUser();
  await createFolder(db, user.id, { name: "Doublon" });
  await assert.rejects(
    () => createFolder(db, user.id, { name: "Doublon" }),
    /déjà rangé au même endroit/,
  );

  // Le même nom ailleurs reste permis : c'est un chemin différent.
  const autre = await createFolder(db, user.id, { name: "Ailleurs" });
  const dedans = await createFolder(db, user.id, { name: "Doublon", parentId: autre.id });
  assert.deepEqual(dedans.path, ["Ailleurs", "Doublon"]);
});

test("on ne s'emboîte pas au-delà du dernier étage", async () => {
  const user = await newUser();
  const un = await createFolder(db, user.id, { name: "Un" });
  const deux = await createFolder(db, user.id, { name: "Deux", parentId: un.id });
  const trois = await createFolder(db, user.id, { name: "Trois", parentId: deux.id });
  assert.equal(trois.depth, 3);

  await assert.rejects(
    () => createFolder(db, user.id, { name: "Quatre", parentId: trois.id }),
    /dernier étage/,
  );
});

test("un dossier ne se range ni dans lui-même, ni dans l'un des siens", async () => {
  /**
   * Le cas qui perd une branche sans rien effacer : le sous-arbre déplacé sous
   * son propre descendant n'est plus joignable depuis la racine, et il ne reste
   * qu'un cycle que plus aucune remontée ne quitte.
   */
  const user = await newUser();
  const parent = await createFolder(db, user.id, { name: "Parent" });
  const enfant = await createFolder(db, user.id, { name: "Enfant", parentId: parent.id });

  await assert.rejects(
    () => updateFolder(db, user.id, parent.id, { parentId: parent.id }),
    /dans lui-même/,
  );
  await assert.rejects(
    () => updateFolder(db, user.id, parent.id, { parentId: enfant.id }),
    /dans l'un des siens/,
  );
});

test("un dossier déplacé emmène ses étages avec lui", async () => {
  /**
   * Le contrôle naïf regarde la profondeur du dossier déplacé. Ce qui compte
   * est la hauteur de **son sous-arbre** : un dossier d'un étage qui en porte un
   * second en occupe deux là où il arrive.
   */
  const user = await newUser();
  const accueil = await createFolder(db, user.id, { name: "Accueil" });
  const sousAccueil = await createFolder(db, user.id, { name: "Sous-accueil", parentId: accueil.id });

  const porteur = await createFolder(db, user.id, { name: "Porteur" });
  await createFolder(db, user.id, { name: "Porté", parentId: porteur.id });

  // Deux étages posés sur un dossier au deuxième : ça ferait quatre.
  await assert.rejects(
    () => updateFolder(db, user.id, porteur.id, { parentId: sousAccueil.id }),
    /dépasseraient/,
  );

  // Un étage plus haut, ça tient tout juste.
  const déplacé = await updateFolder(db, user.id, porteur.id, { parentId: accueil.id });
  assert.deepEqual(déplacé.path, ["Accueil", "Porteur"]);
});

test("effacer un dossier remonte ce qu'il contient, sans rien perdre", async () => {
  /**
   * La règle d'ATEM-old, et la bonne — mais sa base disait l'inverse : le
   * `parent_id` cascadait pendant que son service réattachait. Deux réponses
   * contradictoires, et c'est la base qui gagne dès qu'une suppression passe
   * ailleurs. Ici la base ne répond rien, la transaction fait tout.
   */
  const user = await newUser();
  const grand = await createFolder(db, user.id, { name: "Grand" });
  const milieu = await createFolder(db, user.id, { name: "Milieu", parentId: grand.id });
  const petit = await createFolder(db, user.id, { name: "Petit", parentId: milieu.id });

  const deck = await createDeck(db, user.id, "Rangé au milieu");
  await updateDeck(db, user.id, deck.id, { folderId: milieu.id });

  await deleteFolder(db, user.id, milieu.id);

  const restants = await listFolders(db, user.id);
  assert.deepEqual(
    restants.map((f) => f.path.join(" / ")).sort(),
    ["Grand", "Grand / Petit"],
    "le sous-dossier a remonté d'un étage",
  );

  const [sommaire] = await listDecks(db, user.id);
  assert.equal(sommaire?.folderId, grand.id, "le deck aussi, et il existe toujours");
  assert.equal(restants.find((f) => f.id === petit.id)?.parentId, grand.id);
});

test("effacer un dossier de la racine remet son contenu à la racine", async () => {
  const user = await newUser();
  const racine = await createFolder(db, user.id, { name: "À jeter" });
  const dedans = await createFolder(db, user.id, { name: "Dedans", parentId: racine.id });
  const deck = await createDeck(db, user.id, "Sans dossier bientôt");
  await updateDeck(db, user.id, deck.id, { folderId: racine.id });

  await deleteFolder(db, user.id, racine.id);

  const restants = await listFolders(db, user.id);
  assert.equal(restants.find((f) => f.id === dedans.id)?.parentId, null);
  assert.equal((await listDecks(db, user.id))[0]?.folderId, null);
});

test("un enfant qui remonte sur un homonyme fait refuser la suppression", async () => {
  /**
   * On ne renomme pas d'office : le nom appartient à celui qui l'a écrit, et
   * deux « Tier 1 » côte à côte seraient sa surprise, pas son choix.
   */
  const user = await newUser();
  const haut = await createFolder(db, user.id, { name: "Haut" });
  const intermédiaire = await createFolder(db, user.id, { name: "Intermédiaire", parentId: haut.id });
  await createFolder(db, user.id, { name: "Jumeau", parentId: haut.id });
  await createFolder(db, user.id, { name: "Jumeau", parentId: intermédiaire.id });

  await assert.rejects(
    () => deleteFolder(db, user.id, intermédiaire.id),
    /l'étage du dessus/,
  );
  // Et rien n'a bougé : la transaction est repartie en arrière.
  assert.equal((await listFolders(db, user.id)).length, 4);
});

test("le dossier d'un autre est introuvable, pas interdit", async () => {
  // Un 403 dirait qu'il existe. Le filtre est dans la requête.
  const moi = await newUser();
  const autre = await newUser();
  const sien = await createFolder(db, autre.id, { name: "Le sien" });

  await assert.rejects(() => updateFolder(db, moi.id, sien.id, { name: "Volé" }), /introuvable/);
  await assert.rejects(() => deleteFolder(db, moi.id, sien.id), /introuvable/);

  const deck = await createDeck(db, moi.id, "Mon deck");
  await assert.rejects(
    () => updateDeck(db, moi.id, deck.id, { folderId: sien.id }),
    /introuvable/,
    "on ne dépose pas son deck chez un inconnu en devinant un UUID",
  );
});

test("un identifiant qui n'est pas un UUID est refusé, pas planté", async () => {
  const user = await newUser();
  await assert.rejects(
    () => updateFolder(db, user.id, "pas-un-uuid", { name: "x" }),
    /Identifiant invalide/,
  );
  await assert.rejects(() => deleteFolder(db, user.id, "../../etc"), /Identifiant invalide/);
});

test("effacer son compte emporte ses dossiers", async () => {
  /**
   * Le `parent_id` ne cascade pas — c'est voulu — et il ne doit pas pour autant
   * bloquer l'effacement du compte, qui supprime toute la branche d'un coup.
   * La contrainte est vérifiée en fin d'instruction : l'épreuve le prouve.
   */
  const user = await newUser();
  const haut = await createFolder(db, user.id, { name: "Haut" });
  const bas = await createFolder(db, user.id, { name: "Bas", parentId: haut.id });
  await createFolder(db, user.id, { name: "Plus bas", parentId: bas.id });

  await deleteAccount(db, user.id, "Un-Mot-De-Passe-1!");
  assert.equal((await listFolders(db, user.id)).length, 0);
});

test("la liste des dossiers passe avant celle d'un deck", async () => {
  /**
   * Hono essaie les routes dans l'ordre de déclaration : `/decks/dossiers`
   * déclarée après `/decks/:id` serait avalée, et répondrait « identifiant
   * invalide » pour une liste de dossiers. Quelques lignes déplacées suffisent
   * à le défaire, sans rien casser d'autre — donc on le tient ici.
   */
  const { cookie } = await freshSession(app, "routes-dossiers");
  const réponse = await jsonRequest(app, "GET", "/decks/dossiers", undefined, { cookie });

  assert.equal(réponse.status, 200);
  assert.deepEqual(await réponse.json(), { items: [] });
});

test("les dossiers se créent, se renomment et se jettent par la route", async () => {
  const { cookie } = await freshSession(app, "routes-crud");

  const créé = await jsonRequest(app, "POST", "/decks/dossiers", { name: "Par la route" }, { cookie });
  assert.equal(créé.status, 201);
  const dossier = (await créé.json()) as { id: string; name: string };
  assert.equal(dossier.name, "Par la route");

  const renommé = await jsonRequest(
    app, "PATCH", `/decks/dossiers/${dossier.id}`, { name: "Renommé" }, { cookie },
  );
  assert.equal(renommé.status, 200);
  assert.equal(((await renommé.json()) as { name: string }).name, "Renommé");

  const jeté = await jsonRequest(
    app, "DELETE", `/decks/dossiers/${dossier.id}`, undefined, { cookie },
  );
  assert.equal(jeté.status, 200);

  const liste = await jsonRequest(app, "GET", "/decks/dossiers", undefined, { cookie });
  assert.deepEqual(await liste.json(), { items: [] });
});
