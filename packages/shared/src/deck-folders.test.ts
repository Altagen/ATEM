import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECK_FOLDER_MAX_DEPTH, folderCanHost, folderDepth, folderIsInside, folderSubtreeHeight,
  type FolderNode,
} from "./deck-folders.js";

/**
 * L'arbre des dossiers, sans base de données.
 *
 * Ces fonctions servent des deux côtés : le serveur refuse avec, l'écran grise
 * avec. Les éprouver ici les éprouve donc une seule fois pour les deux.
 */

//  a
//  └ b
//    └ c
//  d
const arbre: FolderNode[] = [
  { id: "a", parentId: null },
  { id: "b", parentId: "a" },
  { id: "c", parentId: "b" },
  { id: "d", parentId: null },
];

test("la profondeur se compte depuis la racine, qui vaut un", () => {
  assert.equal(folderDepth(arbre, "a"), 1);
  assert.equal(folderDepth(arbre, "b"), 2);
  assert.equal(folderDepth(arbre, "c"), DECK_FOLDER_MAX_DEPTH);
  assert.equal(folderDepth(arbre, null), 0, "la racine n'est pas un dossier");
  assert.equal(folderDepth(arbre, "inconnu"), 0);
});

test("la hauteur compte ce qu'un dossier emporte", () => {
  assert.equal(folderSubtreeHeight(arbre, "a"), 3);
  assert.equal(folderSubtreeHeight(arbre, "b"), 2);
  assert.equal(folderSubtreeHeight(arbre, "c"), 1, "une feuille occupe un étage");
});

test("l'appartenance à une branche se lit dans les deux sens", () => {
  assert.equal(folderIsInside(arbre, "c", "a"), true);
  assert.equal(folderIsInside(arbre, "a", "c"), false);
  assert.equal(folderIsInside(arbre, "a", "a"), true, "un dossier est dans le sien");
  assert.equal(folderIsInside(arbre, "d", "a"), false);
});

test("un dossier ne se dépose ni dans lui-même, ni dans l'un des siens", () => {
  assert.equal(folderCanHost(arbre, "a", "a"), false);
  assert.equal(folderCanHost(arbre, "a", "b"), false);
  assert.equal(folderCanHost(arbre, "a", "c"), false);
});

test("le dépôt compte le sous-arbre, pas le dossier seul", () => {
  // « b » porte « c » : deux étages, posés sur « d » qui est au premier.
  assert.equal(folderCanHost(arbre, "b", "d"), true, "1 + 2 tient dans 3");
  // « a » en porte trois : nulle part sauf à la racine.
  assert.equal(folderCanHost(arbre, "a", "d"), false, "1 + 3 dépasse");
  assert.equal(folderCanHost(arbre, "a", null), true, "la racine accepte toujours");
});

test("un cycle en base ne fait pas tourner les remontées sans fin", () => {
  /**
   * Ce service ne peut pas en créer, mais une écriture SQL à la main le
   * pourrait. Sans garde, la remontée ne rendrait jamais la main : le serveur
   * se figerait sur une requête, l'onglet sur un rendu.
   */
  const cycle: FolderNode[] = [
    { id: "x", parentId: "y" },
    { id: "y", parentId: "x" },
  ];
  assert.equal(folderDepth(cycle, "x"), 2, "elle s'arrête au déjà-vu");
  assert.equal(folderIsInside(cycle, "x", "y"), true);
  assert.equal(folderSubtreeHeight(cycle, "x"), 2);
});
