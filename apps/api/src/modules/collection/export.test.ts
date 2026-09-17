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

// ── Import ────────────────────────────────────────────────────────────────

const importFile = (cookie: string, text: string, mode?: string) =>
  app.request(`/collection/import${mode ? `?mode=${mode}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv", cookie },
    body: text,
  });

type Result = { mode: string; imported: number; removed: number; failed: number; errors: { line: number; error: string }[] };

async function quantities(cookie: string): Promise<Record<string, number>> {
  const text = (await (await exportAs(cookie)).text()).replace(/^﻿/, "");
  return Object.fromEntries(
    text.trimEnd().split("\n").slice(1).map((line) => {
      const [setCode, , quantity] = line.split(",");
      return [setCode!, Number(quantity)];
    }),
  );
}

test("merging the same file twice aligns quantities, it does not add them up", async () => {
  /**
   * The reference's least intuitive rule, and the one that makes a repeated
   * import harmless: each row is brought to the file's quantity.
   */
  const { cookie } = await freshSession(app, "import-merge");
  const file = "set_code,quantity\nIMPM-FR001,3\nIMPM-FR002,1\n";

  const first = (await (await importFile(cookie, file)).json()) as Result;
  assert.equal(first.imported, 2);
  await importFile(cookie, file);

  assert.deepEqual(await quantities(cookie), { "IMPM-FR001": 3, "IMPM-FR002": 1 });
});

test("merge leaves the cards the file does not mention", async () => {
  const { cookie, userId } = await freshSession(app, "import-keep");
  await owned(userId, "IMPK-FR009", 5);
  await importFile(cookie, "set_code,quantity\nIMPK-FR001,2\n");
  assert.deepEqual(await quantities(cookie), { "IMPK-FR001": 2, "IMPK-FR009": 5 });
});

test("replace brings the unmentioned to zero, but a failed line spares its card", async () => {
  /**
   * To zero rather than deleted, as “−1” does (R9). And a line that failed to
   * read still counts as mentioned: a partly unreadable file must not make cards
   * disappear.
   */
  const { cookie, userId } = await freshSession(app, "import-replace");
  await owned(userId, "IMPR-FR001", 4); // mentioned, kept at the file's 2
  await owned(userId, "IMPR-FR002", 3); // not mentioned: goes
  await owned(userId, "IMPR-FR003", 6); // mentioned on a line that fails: spared

  const result = (await (await importFile(
    cookie, "set_code,quantity\nIMPR-FR001,2\nIMPR-FR003,5000\n", "replace",
  )).json()) as Result;

  assert.equal(result.mode, "replace");
  assert.equal(result.removed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.errors.map((e) => e.error), ["quantity_too_large"]);
  assert.deepEqual(await quantities(cookie), { "IMPR-FR001": 2, "IMPR-FR003": 6 });
});

test("an exported collection imports back identically on another account", async () => {
  const source = await freshSession(app, "import-source");
  await owned(source.userId, "IMPT-FR001", 3, 76000020);
  await owned(source.userId, "IMPT-FR002", 1);
  const file = await (await exportAs(source.cookie, "atem")).text();

  const target = await freshSession(app, "import-target");
  const result = (await (await importFile(target.cookie, file)).json()) as Result;
  assert.equal(result.failed, 0);
  assert.deepEqual(await quantities(target.cookie), await quantities(source.cookie));
});

test("a bad line is reported with its line, and the others are imported", async () => {
  const { cookie } = await freshSession(app, "import-partial");
  const result = (await (await importFile(cookie, "set_code,quantity\nIMPP-FR001,2\n,3\nIMPP-FR002,1\n")).json()) as Result;
  assert.equal(result.imported, 2);
  assert.deepEqual(result.errors, [{ line: 3, error: "empty_set_code" }]);
});

test("a file over five megabytes is refused, and an unknown mode too", async () => {
  const { cookie } = await freshSession(app, "import-limits");
  const huge = `set_code\n${"IMPL-FR001\n".repeat(500_000)}`;
  assert.equal((await importFile(cookie, huge)).status, 400);
  assert.equal((await importFile(cookie, "set_code\nA-FR001\n", "overwrite")).status, 400);
});

test("each import is recorded on the server, newest first, for this account only", async () => {
  /**
   * ATEM-old kept the history in the browser, so an import from a phone never
   * showed on the computer. It is the account's now, read from anywhere.
   */
  const mine = await freshSession(app, "history-mine");
  const theirs = await freshSession(app, "history-theirs");
  await app.request("/collection/import?mode=merge&filename=first.csv", {
    method: "POST", headers: { cookie: mine.cookie }, body: "set_code,quantity\nHIST-FR001,1\n",
  });
  await app.request("/collection/import?mode=replace&filename=second.csv", {
    method: "POST", headers: { cookie: mine.cookie }, body: "set_code,quantity\nHIST-FR002,2\n,bad\n",
  });
  await app.request("/collection/import?filename=not-mine.csv", {
    method: "POST", headers: { cookie: theirs.cookie }, body: "set_code\nHIST-FR009\n",
  });

  const { items } = (await (await jsonRequest(app, "GET", "/collection/imports", undefined, { cookie: mine.cookie })).json()) as {
    items: { filename: string; mode: string; imported: number; removed: number; failed: number }[];
  };
  assert.deepEqual(items.map((i) => i.filename), ["second.csv", "first.csv"]);
  assert.deepEqual(
    { mode: items[0]!.mode, imported: items[0]!.imported, removed: items[0]!.removed, failed: items[0]!.failed },
    { mode: "replace", imported: 1, removed: 1, failed: 1 },
  );
});
