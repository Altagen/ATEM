import { test } from "node:test";
import assert from "node:assert/strict";
import {
  banlistMaxCopies, checkDeckAdd, deckIsPlayable, isExtraDeckCard, missingCopies,
  parseBanlistStatus,
} from "./deck.js";

/**
 * Les règles de construction, éprouvées.
 *
 * ATEM-old n'avait **aucun test** sur les decks — ni service, ni dossiers, ni
 * routes — et c'est là qu'on a trouvé deux lacunes fonctionnelles. On commence
 * donc par là.
 */

test("la banlist se lit dans ses deux écritures", () => {
  // YGOPRODeck rend des mots ; certains flux rendent un chiffre. Les deux
  // existent, les avoir vus suffit à savoir qu'on ne choisit pas ce qu'on reçoit.
  for (const [brut, attendu] of [
    ["Banned", 0], ["Forbidden", 0], ["0", 0],
    ["Limited", 1], ["1", 1],
    ["Semi-Limited", 2], ["semi limited", 2], ["2", 2],
    ["", 3], [null, 3], ["n'importe quoi", 3],
  ] as const) {
    assert.equal(banlistMaxCopies(parseBanlistStatus(brut)), attendu, `« ${brut} »`);
  }
});

test("« semi » l'emporte sur « limited », qu'il contient", () => {
  // `Semi-Limited` contient `limited` : tester dans le mauvais ordre le classe
  // « limité à 1 » au lieu de 2.
  assert.equal(parseBanlistStatus("Semi-Limited"), "semi_limited");
});

test("le plafond est le plus bas des trois", () => {
  /**
   * Trois bornes se superposent : la règle du jeu (3), la banlist, et ce qu'on
   * possède. C'est la plus basse qui décide.
   */
  // Possédées en nombre, illimitée : la règle du jeu borne à 3.
  assert.equal(checkDeckAdd({ owned: 10, inDeck: 0 }).remainingLegal, 3);
  // Limitée : la banlist borne à 1.
  assert.equal(checkDeckAdd({ banlistTcg: "Limited", owned: 10, inDeck: 0 }).remainingLegal, 1);
  // Deux possédées seulement : la collection borne à 2.
  assert.equal(checkDeckAdd({ owned: 2, inDeck: 0 }).remainingLegal, 2);
});

test("une carte qu'on ne possède pas ne s'ajoute pas", () => {
  // Décision d'Ange : un deck est borné par la collection, donc jouable par
  // construction.
  const issue = checkDeckAdd({ owned: 0, inDeck: 0 });
  assert.equal(issue.canAdd, false);
  assert.equal(issue.blockedBy, "not_owned");
});

test("une carte interdite se refuse pour la banlist, même si on ne l'a pas", () => {
  /**
   * L'ordre des refus est celui qui explique le mieux : dire « vous ne la
   * possédez pas » d'une carte interdite enverrait l'acheter pour rien.
   */
  const issue = checkDeckAdd({ banlistTcg: "Forbidden", owned: 0, inDeck: 0 });
  assert.equal(issue.blockedBy, "forbidden");
});

test("le total porte sur tout le deck, pas sur une zone", () => {
  /**
   * C'est la lacune n°1 d'ATEM-old : son unicité était
   * `(deck, zone, passcode, set_code)`, si bien que la même carte vivait sur
   * plusieurs lignes et totalisait six exemplaires. Le plafond était vérifié
   * par ligne.
   */
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 3 }).canAdd, false);
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 3 }).blockedBy, "max_copies");
});

test("atteindre le plafond faute d'exemplaires le dit ainsi", () => {
  // Deux possédées, deux au deck : ce n'est pas la règle des trois qui bloque.
  const issue = checkDeckAdd({ owned: 2, inDeck: 2 });
  assert.equal(issue.canAdd, false);
  assert.equal(issue.blockedBy, "not_owned");
});

test("l'Extra Deck se reconnaît au cadre, pas au nom", () => {
  for (const carte of [
    { type: "Fusion Monster", frameType: "fusion" },
    { type: "Synchro Monster", frameType: "synchro" },
    { type: "XYZ Monster", frameType: "xyz" },
    { type: "Link Monster", frameType: "link" },
    // Un Pendule qui est aussi Fusion va à l'Extra : c'est le cadre qui tranche.
    { type: "Pendulum Effect Fusion Monster", frameType: "fusion_pendulum" },
  ]) {
    assert.equal(isExtraDeckCard(carte), true, carte.type);
  }

  for (const carte of [
    { type: "Effect Monster", frameType: "effect" },
    { type: "Normal Monster", frameType: "normal" },
    { type: "Spell Card", frameType: "spell" },
    { type: "Trap Card", frameType: "trap" },
    { type: "Pendulum Effect Monster", frameType: "effect_pendulum" },
  ]) {
    assert.equal(isExtraDeckCard(carte), false, carte.type);
  }
});

test("le manque ne se signale que s'il y en a un", () => {
  /**
   * Précision d'Ange : quatre exemplaires possédés, trois au deck, un vendu —
   * il ne se passe rien. Le silence quand tout va bien.
   */
  assert.equal(missingCopies(3, 4), 0, "plus qu'il n'en faut");
  assert.equal(missingCopies(3, 3), 0, "juste ce qu'il faut");
  assert.equal(missingCopies(3, 1), 2, "deux à retrouver");
  assert.equal(missingCopies(0, 0), 0);
});

test("demander plus que le reste dit quelle borne a parlé", () => {
  /**
   * Le serveur pose un état — « trois au Main » —, pas un incrément. Interrogé
   * sur l'état courant, le contrôle répondait « rien ne bloque » : c'est vrai
   * du *premier* exemplaire. Il fallait alors le réinterroger au bord du
   * plafond pour savoir quoi répondre. `wanted` supprime ce détour.
   */
  // Deux possédées, on en veut trois : c'est la collection qui borne.
  assert.equal(checkDeckAdd({ owned: 2, inDeck: 0, wanted: 3 }).blockedBy, "not_owned");
  // Limitée à une, on en veut deux : c'est la banlist.
  assert.equal(
    checkDeckAdd({ banlistTcg: "Limited", owned: 3, inDeck: 0, wanted: 2 }).blockedBy,
    "banlist",
  );
  // Cinq possédées, on en veut quatre : c'est la règle du jeu.
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 0, wanted: 4 }).blockedBy, "max_copies");
  // Et ce qui passe ne dit rien.
  assert.equal(checkDeckAdd({ owned: 5, inDeck: 0, wanted: 3 }).blockedBy, null);
});

test("un deck n'est jouable que complet et sans manque", () => {
  const plein = { main: 40, extra: 0, side: 0 };
  assert.equal(deckIsPlayable(plein, 0), true);
  // Une carte manquante suffit.
  assert.equal(deckIsPlayable(plein, 1), false);
  // Trop peu au Main.
  assert.equal(deckIsPlayable({ main: 39, extra: 0, side: 0 }, 0), false);
  // Trop au Main.
  assert.equal(deckIsPlayable({ main: 61, extra: 0, side: 0 }, 0), false);
  // L'Extra et le Side ont le droit d'être vides.
  assert.equal(deckIsPlayable({ main: 60, extra: 15, side: 15 }, 0), true);
  assert.equal(deckIsPlayable({ main: 40, extra: 16, side: 0 }, 0), false);
});
