import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToDraft, discardDraft, draftCopies, nameDraftLine, scanlistState, startDraft,
} from "./state.js";

/**
 * La règle qui définit cet écran.
 *
 * Le « −1 » d'une scanliste décrémente **sa** ligne, jamais la collection. Le
 * plancher est zéro, la ligne y reste visible, et les « −1 » suivants ne font
 * rien du tout — surtout pas retirer un exemplaire ailleurs. Ce n'est pas une
 * précaution ajoutée après coup : le lot ne quitte pas le navigateur tant qu'on
 * ne l'a pas enregistré, il n'existe donc aucun chemin vers la collection.
 */
test("le « −1 » s'arrête à zéro et n'y descend jamais", () => {
  discardDraft();
  startDraft();

  applyToDraft("LTGY-FR008", 1);
  applyToDraft("LTGY-FR008", 1);
  const ligne = scanlistState().draft!.lines[0]!;
  assert.equal(ligne.quantity, 2, "deux scans, deux exemplaires");

  applyToDraft("LTGY-FR008", -1);
  assert.equal(ligne.quantity, 1);

  applyToDraft("LTGY-FR008", -1);
  assert.equal(ligne.quantity, 0, "le plancher est zéro");

  applyToDraft("LTGY-FR008", -1);
  applyToDraft("LTGY-FR008", -1);
  assert.equal(ligne.quantity, 0, "et l'on n'y descend pas");
});

test("une ligne tombée à zéro reste affichée", () => {
  /**
   * Elle montre ce qu'on vient d'annuler. La faire disparaître laisserait
   * croire à une erreur de manipulation — et rendrait le « +1 » suivant plus
   * long, puisqu'il faudrait rescanner.
   */
  discardDraft();
  startDraft();
  applyToDraft("LOB-FR001", 1);
  applyToDraft("LOB-FR001", -1);

  const lignes = scanlistState().draft!.lines;
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0]?.quantity, 0);
});

test("un « −1 » sur un code jamais scanné ouvre une ligne à zéro", () => {
  // Et non une ligne à −1, ni une erreur : le geste est simplement sans effet.
  discardDraft();
  startDraft();
  applyToDraft("RA03-FR004", -1);

  assert.equal(scanlistState().draft!.lines[0]?.quantity, 0);
});

test("le dernier scanné passe en tête", () => {
  // C'est celui qu'on vérifie du regard après avoir appuyé.
  discardDraft();
  startDraft();
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("BBBB-FR001", 1);

  assert.deepEqual(
    scanlistState().draft!.lines.map((l) => l.setCode),
    ["BBBB-FR001", "AAAA-FR001"],
  );
});

test("le total compte les exemplaires, pas les références", () => {
  discardDraft();
  startDraft();
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("AAAA-FR001", 1);
  applyToDraft("BBBB-FR001", 1);

  const draft = scanlistState().draft!;
  assert.equal(draft.lines.length, 2);
  assert.equal(draftCopies(draft), 3);
});

test("le nom arrivé en retard se pose sur la ligne", () => {
  /**
   * L'ajout ne l'attend pas : la ligne entre avec son set code, que le
   * navigateur tient déjà. Le nom la rejoint s'il arrive à temps.
   */
  discardDraft();
  startDraft();
  applyToDraft("LTGY-FR008", 1);

  assert.equal(nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678), true);
  const ligne = scanlistState().draft!.lines[0]!;
  assert.equal(ligne.name, "Grande Baleine");
  assert.equal(ligne.passcode, 12345678);
});

test("un nom qui arrive après un autre ne l'écrase pas", () => {
  discardDraft();
  startDraft();
  applyToDraft("LTGY-FR008", 1);
  nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678);

  assert.equal(nameDraftLine("LTGY-FR008", "Autre chose", 999), false);
  assert.equal(scanlistState().draft!.lines[0]?.name, "Grande Baleine");
});

test("un nom pour une ligne disparue ne ressuscite rien", () => {
  // La réponse du catalogue peut arriver après qu'on a abandonné le lot.
  discardDraft();
  assert.equal(nameDraftLine("LTGY-FR008", "Grande Baleine", 12345678), false);
  assert.equal(scanlistState().draft, null);
});
