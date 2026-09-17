import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectionCsv, type CsvExportLine } from "./collection-csv.js";
import { parseCollectionFile } from "./collection-import.js";

const exported: CsvExportLine[] = [
  { setCode: "LOB-FR001", name: "Dragon Blanc", quantity: 3, rarity: "Ultra Rare", language: "fr", passcode: 89631139, notes: 'Bête "rare", la\nsecond line; with a semicolon' },
  { setCode: "SDK-001", name: null, quantity: 1, rarity: null, language: "en", passcode: null, notes: null },
];

test("our own export imports back unchanged, in every format", () => {
  /**
   * ATEM-old split the text on line breaks before reading quotes, so a note
   * holding one — which the export quotes — broke its own re-import.
   */
  for (const format of ["atem", "scanflip"] as const) {
    const { rows, errors } = parseCollectionFile(`﻿${buildCollectionCsv(format, exported)}`);
    assert.deepEqual(errors, [], format);
    assert.equal(rows.length, 2, format);
    const first = rows.find((row) => row.setCode === "LOB-FR001")!;
    assert.equal(first.notes, exported[0]!.notes, `${format}: the multi-line note survives`);
    assert.equal(first.quantity, 3);
    assert.equal(first.passcode, 89631139);
    assert.equal(first.language, "fr");
  }
  // Cardmarket carries no passcode, and spells its language out.
  const { rows } = parseCollectionFile(buildCollectionCsv("cardmarket", exported));
  const first = rows.find((row) => row.setCode === "LOB-FR001")!;
  assert.equal(first.language, "fr", "“French” reads back as fr");
  assert.equal(first.passcode, null);
  assert.equal(first.notes, exported[0]!.notes);
});

test("the separator is decided on the header, counting outside quotes", () => {
  const semicolons = parseCollectionFile('Card Name;Card Number;Quantity\n"A, B";LOB-FR001;2\n');
  assert.equal(semicolons.rows[0]?.name, "A, B");
  assert.equal(semicolons.rows[0]?.quantity, 2);
});

test("headers are recognised by alias, French ones included", () => {
  const { rows } = parseCollectionFile("Code;Quantité;Rarité;Langue;Comments\nLOB-FR001;4;Rare;2;ok\n");
  assert.deepEqual(
    { quantity: rows[0]?.quantity, rarity: rows[0]?.rarity, language: rows[0]?.language, notes: rows[0]?.notes },
    { quantity: 4, rarity: "Rare", language: "fr", notes: "ok" },
  );
});

test("only the set code column is required", () => {
  assert.deepEqual(parseCollectionFile("name,quantity\nX,1\n").errors, [{ line: 1, error: "missing_column_set_code" }]);
  const minimal = parseCollectionFile("set_code\n#lob fr001\n");
  assert.equal(minimal.rows[0]?.setCode, "LOB-FR001", "a leading # goes, spaces become dashes");
  assert.equal(minimal.rows[0]?.quantity, 1, "quantity defaults to one");
  assert.equal(minimal.rows[0]?.language, "fr", "language inferred from the set code");
});

test("languages: Konami codes, spelled names, and the unrecognised kept short", () => {
  const read = (language: string) =>
    parseCollectionFile(`set_code,language\nLOB-EN001,${language}\n`).rows[0]?.language;
  assert.equal(read("1"), "en");
  assert.equal(read("7"), "ja");
  assert.equal(read("Deutsch"), "de");
  assert.equal(read("Klingon"), "kl");
});

test("quantity: silently one when unreadable, refused above the bound", () => {
  const { rows, errors } = parseCollectionFile("set_code,quantity\nAAA-FR001,abc\nAAA-FR002,-3\nAAA-FR003,1001\n");
  assert.equal(rows.find((row) => row.setCode === "AAA-FR001")?.quantity, 1);
  assert.equal(rows.find((row) => row.setCode === "AAA-FR002")?.quantity, 1);
  assert.deepEqual(errors, [{ line: 4, setCode: "AAA-FR003", error: "quantity_too_large" }]);
});

test("a set code appearing twice adds up and keeps the first name", () => {
  const { rows, errors } = parseCollectionFile(
    "set_code,name,quantity\nLOB-FR001,,2\nLOB-FR001,Dragon,3\nLOB-FR001,Other,1\n",
  );
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.quantity, 6);
  assert.equal(rows[0]?.name, "Dragon", "the first name actually found");
});

test("a sum past the bound refuses that code, including its later lines", () => {
  const { rows, errors } = parseCollectionFile(
    "set_code,quantity\nLOB-FR001,600\nLOB-FR001,600\nLOB-FR001,1\n",
  );
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 2, "the line that crossed, and the one after");
});

test("a bad line is reported with its file line, and the others still read", () => {
  // The quoted note spans two physical lines: the next record starts on line 4.
  const { rows, errors } = parseCollectionFile('set_code,notes\nLOB-FR001,"one\ntwo"\n,empty code\nLOB-FR002,\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(errors, [{ line: 4, error: "empty_set_code" }]);
});

test("JSON: ATEM-old's scanlist shape and this application's both read", () => {
  const old = parseCollectionFile(JSON.stringify({
    version: 1, scanliste: "Lot", lignes: [{ set_code: "SDRE-FR005", quantity: 3, passcode: 26976414 }],
  }));
  assert.equal(old.rows[0]?.passcode, 26976414);

  const ours = parseCollectionFile(JSON.stringify({
    version: 1, name: "Lot", lines: [{ setCode: "ZZZ-FR999", name: null, passcode: null, quantity: 1 }],
  }));
  assert.equal(ours.rows[0]?.setCode, "ZZZ-FR999");
  assert.equal(ours.rows[0]?.passcode, null, "a null passcode is absent, not zero");

  assert.equal(parseCollectionFile("[{\"set_code\":\"A-FR001\"}]").rows.length, 1, "a bare array");
  assert.deepEqual(parseCollectionFile("{nope").errors, [{ line: 1, error: "invalid_json" }]);
  assert.deepEqual(parseCollectionFile('{"other":[]}').errors, [{ line: 1, error: "expected_array_or_lignes" }]);
});

test("an empty file says so", () => {
  assert.deepEqual(parseCollectionFile("﻿\n\n").errors, [{ line: 1, error: "empty_file" }]);
});
