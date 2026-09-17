import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestApp, freshSession, jsonRequest } from "../../test-support.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { adjustQuantity } from "./service.js";
import { resetResolveQueue } from "./resolve-queue.js";

/**
 * Exporting a collection as CSV, through the route — what a download receives.
 *
 * `docs/ref-csv-formats.md` is authoritative; each test below holds one of its
 * rules, or one of ATEM-old's defects it records.
 */
const { app, db } = createTestApp();

const exportAs = (cookie: string, format?: string) =>
  jsonRequest(app, "GET", `/collection/export${format ? `?format=${format}` : ""}`, undefined, { cookie });

async function owned(userId: string, setCode: string, delta: number, passcode?: number) {
  if (passcode) {
    await upsertCard(db, {
      passcode, nameEn: `Export ${passcode}`, nameFr: `Exporte ${passcode}`, descEn: null, descFr: null,
      type: "Effect Monster", frameType: "effect", race: "Fish", attribute: "WATER",
      atk: 0, def: 0, level: 1, scale: null, linkValue: null, linkMarkers: null,
      archetype: null, banlistTcg: null, imageUrl: null, imageUrlSmall: null,
    });
    await upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Secret Rare" });
  }
  resetResolveQueue();
  return adjustQuantity(db, userId, { setCode, delta });
}

test("the download starts with a BOM, is UTF-8 CSV, and is named for its format", async () => {
  /**
   * ATEM-old added the BOM in the browser, so a direct link gave a file Excel in
   * a French locale read as latin-1. The server writes it now.
   */
  const { cookie, userId } = await freshSession(app, "export-bom");
  await owned(userId, "EXPB-FR001", 1, 76000001);

  const response = await exportAs(cookie, "cardmarket");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv; charset=utf-8/);
  assert.match(response.headers.get("content-disposition") ?? "", /cardmarket_collection\.csv/);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/, "a collection is not shared-cached");

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM");
});

test("the file holds the whole collection, past the list's two-hundred-row page", async () => {
  /**
   * The list stops at two hundred rows, which suits a screen. An export built on
   * it would hand over the first two hundred cards of a larger collection and
   * look complete. This crosses the limit on purpose.
   */
  const { cookie, userId } = await freshSession(app, "export-all");
  for (let index = 1; index <= 205; index += 1) {
    await owned(userId, `EXPA-FR${String(index).padStart(3, "0")}`, 1);
  }

  const text = await (await exportAs(cookie)).text();
  const rows = text.replace(/^﻿/, "").trimEnd().split("\n");
  assert.equal(rows.length - 1, 205, "every owned printing, header excluded");
});

test("an export holds only this person's printings, and none at zero", async () => {
  const mine = await freshSession(app, "export-mine");
  const theirs = await freshSession(app, "export-theirs");
  await owned(mine.userId, "EXPM-FR001", 2);
  await owned(mine.userId, "EXPM-FR002", 1);
  await owned(mine.userId, "EXPM-FR002", -1); // back to zero: kept for its note, not owned
  await owned(theirs.userId, "EXPM-FR999", 4);

  const text = (await (await exportAs(mine.cookie)).text()).replace(/^﻿/, "");
  assert.ok(text.includes("EXPM-FR001"));
  assert.equal(text.includes("EXPM-FR002"), false, "a row at zero is not owned");
  assert.equal(text.includes("EXPM-FR999"), false, "someone else's card never appears");
});

test("the identified card's name and passcode travel with the row", async () => {
  const { cookie, userId } = await freshSession(app, "export-named");
  await owned(userId, "EXPN-FR001", 3, 76000010);

  const [, data] = (await (await exportAs(cookie, "atem")).text()).replace(/^﻿/, "").split("\n");
  assert.equal(data, "EXPN-FR001,Exporte 76000010,3,Secret Rare,fr,76000010,");
});

test("an unknown format is refused rather than guessed", async () => {
  const { cookie } = await freshSession(app, "export-format");
  const response = await exportAs(cookie, "excel");
  assert.equal(response.status, 400);
});
