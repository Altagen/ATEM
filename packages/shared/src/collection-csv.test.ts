import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectionCsv, isCsvExportFormat, type CsvExportLine } from "./collection-csv.js";

const line = (overrides: Partial<CsvExportLine> = {}): CsvExportLine => ({
  setCode: "LOB-FR001",
  name: "Dragon Blanc aux Yeux Bleus",
  quantity: 3,
  rarity: "Ultra Rare",
  language: "fr",
  passcode: 89631139,
  notes: null,
  ...overrides,
});

test("each format writes its own header, in its own order", () => {
  const [atem] = buildCollectionCsv("atem", []).split("\n");
  const [scanflip] = buildCollectionCsv("scanflip", []).split("\n");
  const [cardmarket] = buildCollectionCsv("cardmarket", []).split("\n");
  assert.equal(atem, "set_code,name,quantity,rarity,language,passcode,notes");
  assert.equal(scanflip, "Card Name,Set Code,Quantity,Rarity,Language,Passcode,Notes");
  assert.equal(cardmarket, "Card Name;Card Number;Quantity;Rarity;Language;Comments");
});

test("Cardmarket is written with semicolons, header and rows alike", () => {
  /**
   * ATEM-old joined every format with commas and wrote Cardmarket's header with
   * commas too; the reference says real Cardmarket exports use `;`.
   */
  const csv = buildCollectionCsv("cardmarket", [line()]);
  const [, data] = csv.split("\n");
  assert.equal(data, "Dragon Blanc aux Yeux Bleus;LOB-FR001;3;Ultra Rare;French;");
  assert.equal(data?.includes(","), false);
});

test("Cardmarket spells out every language the reference lists", () => {
  const cases: [string, string][] = [
    ["en", "English"], ["fr", "French"], ["de", "German"], ["es", "Spanish"],
    ["it", "Italian"], ["pt", "Portuguese"], ["ja", "Japanese"], ["ko", "Korean"],
  ];
  for (const [code, name] of cases) {
    const [, data] = buildCollectionCsv("cardmarket", [line({ language: code })]).split("\n");
    assert.equal(data?.split(";")[4], name, code);
  }
  // An unknown code is kept rather than guessed.
  const [, unknown] = buildCollectionCsv("cardmarket", [line({ language: "zh" })]).split("\n");
  assert.equal(unknown?.split(";")[4], "zh");
});

test("a cell holding a separator, a quote or a line break is quoted", () => {
  const csv = buildCollectionCsv("atem", [
    line({ name: 'Bête "rare", la', notes: "a;b\nsecond line" }),
  ]);
  const data = csv.slice(csv.indexOf("\n") + 1);
  assert.ok(data.includes('"Bête ""rare"", la"'), "commas and doubled quotes");
  // The semicolon is protected even in a comma file: a French spreadsheet splits on it.
  assert.ok(data.includes('"a;b\nsecond line"'));
});

test("an empty value is an empty cell, and the file ends with a line break", () => {
  const csv = buildCollectionCsv("atem", [
    line({ name: null, rarity: null, language: null, passcode: null, notes: null }),
  ]);
  assert.equal(csv, "set_code,name,quantity,rarity,language,passcode,notes\nLOB-FR001,,3,,,,\n");
});

test("the builder writes no BOM — that is the route's job", () => {
  // A preview must not show one, and a direct link must get one: so the server adds it.
  assert.equal(buildCollectionCsv("atem", [line()]).startsWith("﻿"), false);
});

test("only the three known formats are accepted", () => {
  assert.equal(isCsvExportFormat("atem"), true);
  assert.equal(isCsvExportFormat("cardmarket"), true);
  assert.equal(isCsvExportFormat("excel"), false);
  assert.equal(isCsvExportFormat(""), false);
});
