import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp } from "../../test-support.js";
import { listPrintsForCard, upsertCard, upsertPrint } from "./index.js";

const { db } = createTestApp();

const card = (passcode: number, nameEn: string) =>
  upsertCard(db, {
    passcode, nameEn, nameFr: nameEn, descEn: null, descFr: null,
    type: "Normal Monster", frameType: "normal", race: "Dragon", attribute: "LIGHT",
    atk: 3000, def: 2500, level: 8, scale: null, linkValue: null, linkMarkers: null,
    archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
  });

test("the printings of a card are found by its name, not by its passcode", async () => {
  /**
   * YGOPRODeck registers an alternate artwork as its own card, and files
   * printings under it. Measured with the real catalogue on 2026-09-19:
   * `LOB-FR001` — the 2002 French Blue-Eyes — sat alone under passcode
   * 89631146 while its 78 other printings sat under 89631139. Keyed on the
   * passcode, the sheet told whoever owns the French one that it has no other.
   */
  const name = `Prints Dragon ${Date.now()}`;
  await card(91000001, name);
  await card(91000002, name);
  await card(91000003, `${name} of the Other Kind`);

  await upsertPrint(db, { setCode: "PRNT-EN001", cardPasscode: 91000001, rarity: "Ultra Rare" });
  await upsertPrint(db, { setCode: "PRNT-EN002", cardPasscode: 91000001, rarity: "Rare" });
  await upsertPrint(db, { setCode: "PRNT-FR001", cardPasscode: 91000002, rarity: "Ultra Rare" });
  await upsertPrint(db, { setCode: "PRNT-EN003", cardPasscode: 91000003, rarity: "Rare" });

  // Asked from the alternate registration — the case that failed.
  const fromAlternate = await listPrintsForCard(db, 91000002);
  assert.deepEqual(
    fromAlternate.map((print) => print.setCode),
    ["PRNT-EN001", "PRNT-EN002", "PRNT-FR001"],
    "every printing of that card, whichever registration it was filed under",
  );

  // And from the original: the same list.
  const fromOriginal = await listPrintsForCard(db, 91000001);
  assert.deepEqual(fromOriginal.map((print) => print.setCode), fromAlternate.map((print) => print.setCode));

  // A card whose name merely starts the same is another card.
  assert.deepEqual((await listPrintsForCard(db, 91000003)).map((p) => p.setCode), ["PRNT-EN003"]);
});

test("an unknown passcode has no printings, and does not fail", async () => {
  assert.deepEqual(await listPrintsForCard(db, 91999999), []);
});
