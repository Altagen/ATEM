import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSetCode,
  languageFromSetCode,
  normalizeSetCode,
  parseSetCode,
  toEnglishLookupSetCode,
} from "./set-code.js";

test("normalise la casse et les espaces", () => {
  assert.equal(normalizeSetCode("  ltgy fr008 "), "LTGY-FR008");
  assert.equal(normalizeSetCode("lob-en001"), "LOB-EN001");
});

test("découpe la forme courante", () => {
  assert.deepEqual(parseSetCode("LOB-EN001"), {
    prefix: "LOB", region: "EN", number: "001",
  });
});

test("découpe un numéro qui commence par une lettre", () => {
  // ATEM-old ne savait pas lire ces codes : sa forme exigeait des chiffres après
  // la région. 5 249 impressions réelles sur 44 517 tombaient dans ce cas.
  assert.deepEqual(parseSetCode("NECH-ENS10"), {
    prefix: "NECH", region: "EN", number: "S10",
  });
  assert.deepEqual(parseSetCode("25YC-ENP01"), {
    prefix: "25YC", region: "EN", number: "P01",
  });
  assert.deepEqual(parseSetCode("SOI-ENSE1"), {
    prefix: "SOI", region: "EN", number: "SE1",
  });
});

test("découpe les éditions européennes à une lettre", () => {
  // On essaie les régions à deux lettres d'abord : sinon « E0 » serait pris pour
  // une région et le numéro serait faux.
  assert.deepEqual(parseSetCode("PSV-E088"), {
    prefix: "PSV", region: "E", number: "088",
  });
});

test("accepte un code sans région", () => {
  assert.deepEqual(parseSetCode("BPT-001"), {
    prefix: "BPT", region: null, number: "001",
  });
});

test("refuse ce qui n'est pas un set code", () => {
  // Entrées malformées présentes dans la base YGOPRODeck : pas de tiret.
  // Elles doivent partir vers la correction manuelle, pas être devinées.
  assert.equal(parseSetCode("DB13"), null);
  assert.equal(parseSetCode(""), null);
  assert.equal(parseSetCode("LOB-"), null);
});

test("déduit la langue du code imprimé", () => {
  assert.equal(languageFromSetCode("LTGY-FR008"), "fr");
  assert.equal(languageFromSetCode("SDRE-EN005"), "en");
  assert.equal(languageFromSetCode("PSV-F088"), "fr");
  // Sans région : les premières éditions n'existaient qu'en anglais.
  assert.equal(languageFromSetCode("BPT-001"), "en");
});

test("bascule vers le code anglais pour l'interrogation", () => {
  // Mesuré contre l'API : LOB-FR001 et SDK-FR001 renvoient « No card matching ».
  // Seuls les codes anglais sont indexés chez YGOPRODeck.
  assert.equal(toEnglishLookupSetCode("LTGY-FR008"), "LTGY-EN008");
  assert.equal(toEnglishLookupSetCode("SDK-FR001"), "SDK-EN001");
  // Les éditions européennes anciennes gardent leur région à une lettre.
  assert.equal(toEnglishLookupSetCode("PSV-F088"), "PSV-E088");
});

test("laisse intact un code déjà anglais ou sans région", () => {
  assert.equal(toEnglishLookupSetCode("LOB-EN001"), "LOB-EN001");
  assert.equal(toEnglishLookupSetCode("BPT-001"), "BPT-001");
  assert.equal(toEnglishLookupSetCode("DB13"), "DB13");
});

test("réunit les deux notations d'une même impression", () => {
  // Le dump YGOPRODeck écrit « LOB-001 », cardsetsinfo.php répond sur
  // « LOB-EN001 », et les cartes physiques portent l'une ou l'autre forme selon
  // leur année d'impression. Sans clé canonique, deux moitiés du catalogue
  // s'ignorent — constaté en exécutant l'import réel.
  assert.equal(canonicalSetCode("LOB-001"), "LOB-001");
  assert.equal(canonicalSetCode("LOB-EN001"), "LOB-001");
  assert.equal(canonicalSetCode("LOB-FR001"), "LOB-001");
  assert.equal(canonicalSetCode("PSV-E088"), "PSV-088");
  assert.equal(canonicalSetCode("NECH-ENS10"), "NECH-S10");
});

test("la clé canonique et le code d'interrogation sont deux choses", () => {
  // L'une joint en local, l'autre part sur le réseau. Les confondre était le
  // défaut : joindre sur le code anglais séparait « LOB-001 » de « LOB-EN001 ».
  assert.equal(canonicalSetCode("LTGY-FR008"), "LTGY-008");
  assert.equal(toEnglishLookupSetCode("LTGY-FR008"), "LTGY-EN008");
});
