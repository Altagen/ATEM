import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSetCode,
  languageFromSetCode,
  normalizeSetCode,
  parseSetCode,
  toEnglishLookupSetCode,
} from "./set-code.js";

test("normalises case and whitespace", () => {
  assert.equal(normalizeSetCode("  ltgy fr008 "), "LTGY-FR008");
  assert.equal(normalizeSetCode("lob-en001"), "LOB-EN001");
});

test("splits the common shape", () => {
  assert.deepEqual(parseSetCode("LOB-EN001"), {
    prefix: "LOB", region: "EN", number: "001",
  });
});

test("splits a number that starts with a letter", () => {
  // The earlier prototype could not read these codes: its shape required digits after the
  // region. 5,249 real printings out of 44,517 fell into that case.
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

test("splits the one-letter European editions", () => {
  // Two-letter regions are tried first: otherwise “E0” would be taken for a
  // region and the number would be wrong.
  assert.deepEqual(parseSetCode("PSV-E088"), {
    prefix: "PSV", region: "E", number: "088",
  });
});

test("accepts a code without a region", () => {
  assert.deepEqual(parseSetCode("BPT-001"), {
    prefix: "BPT", region: null, number: "001",
  });
});

test("refuses what is not a set code", () => {
  // Malformed entries present in the YGOPRODeck data: no dash. They must go to
  // manual correction, not be guessed at.
  assert.equal(parseSetCode("DB13"), null);
  assert.equal(parseSetCode(""), null);
  assert.equal(parseSetCode("LOB-"), null);
});

test("deduces the language from the printed code", () => {
  assert.equal(languageFromSetCode("LTGY-FR008"), "fr");
  assert.equal(languageFromSetCode("SDRE-EN005"), "en");
  assert.equal(languageFromSetCode("PSV-F088"), "fr");
  // No region: the first editions existed in English only.
  assert.equal(languageFromSetCode("BPT-001"), "en");
});

test("switches to the English code for lookups", () => {
  // Measured against the API: LOB-FR001 and SDK-FR001 return “No card
  // matching”. Only English codes are indexed at YGOPRODeck.
  assert.equal(toEnglishLookupSetCode("LTGY-FR008"), "LTGY-EN008");
  assert.equal(toEnglishLookupSetCode("SDK-FR001"), "SDK-EN001");
  // Old European editions keep their one-letter region.
  assert.equal(toEnglishLookupSetCode("PSV-F088"), "PSV-E088");
});

test("leaves an already-English or region-less code untouched", () => {
  assert.equal(toEnglishLookupSetCode("LOB-EN001"), "LOB-EN001");
  assert.equal(toEnglishLookupSetCode("BPT-001"), "BPT-001");
  assert.equal(toEnglishLookupSetCode("DB13"), "DB13");
});

test("brings together the two notations of one printing", () => {
  // The YGOPRODeck dump writes “LOB-001”, cardsetsinfo.php answers on
  // “LOB-EN001”, and physical cards carry one shape or the other depending on
  // their print year. Without a canonical key, two halves of the catalogue
  // ignore each other — seen by running the real import.
  assert.equal(canonicalSetCode("LOB-001"), "LOB-001");
  assert.equal(canonicalSetCode("LOB-EN001"), "LOB-001");
  assert.equal(canonicalSetCode("LOB-FR001"), "LOB-001");
  assert.equal(canonicalSetCode("PSV-E088"), "PSV-088");
  assert.equal(canonicalSetCode("NECH-ENS10"), "NECH-S10");
});

test("the canonical key and the lookup code are two different things", () => {
  // One joins locally, the other goes over the network. Confusing them was the
  // defect: joining on the English code separated “LOB-001” from “LOB-EN001”.
  assert.equal(canonicalSetCode("LTGY-FR008"), "LTGY-008");
  assert.equal(toEnglishLookupSetCode("LTGY-FR008"), "LTGY-EN008");
});
