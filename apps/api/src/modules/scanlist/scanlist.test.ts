import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestApp, freshEmail } from "../../test-support.js";
import { registerUser } from "../identity/service.js";
import { upsertCard, upsertPrint } from "../referential/index.js";
import { listCollection } from "../collection/service.js";
import { resetResolveQueue } from "../collection/resolve-queue.js";
import {
  createScanlist, deleteScanlist, getScanlist, listScanlists, pourScanlist,
} from "./service.js";
import { scanlistLines } from "./schema.js";

const { db } = createTestApp();

async function newUser(): Promise<{ id: string }> {
  const { user } = await registerUser(db, {
    email: freshEmail("scanlist"),
    password: "Un-Mot-De-Passe-1!",
    displayName: "Sorter",
  });
  return { id: user.id };
}

async function seedCard(passcode: number, setCode: string, name: string) {
  await upsertCard(db, {
    passcode, nameEn: name, nameFr: name,
    descEn: null, descFr: null, type: "Effect Monster", frameType: "effect",
    race: "Fish", attribute: "WATER", atk: 1000, def: 1000, level: 4, scale: null,
    linkValue: null, linkMarkers: null, archetype: null, banlistTcg: null,
    imageUrl: null, imageUrlSmall: null,
  });
  return upsertPrint(db, { setCode, cardPasscode: passcode, rarity: "Rare" });
}

const line = (setCode: string, quantity: number) => ({
  setCode, name: null, passcode: null, quantity,
});

test("a saved batch does not touch the collection", async () => {
  /**
   * This is the module's reason for being. We inventory an arrival without
   * pouring it: the collection must not move by a single copy until the pour
   * has been asked for explicitly.
   */
  const user = await newUser();
  await seedCard(88888801, "SCAN-FR001", "Sorted");

  await createScanlist(db, user.id, { name: "Arrival", lines: [line("SCAN-FR001", 3)] });

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.total, 0, "the collection stays empty");
});

test("lines at zero do not enter a saved batch", async () => {
  /**
   * Zero exists while scanning — it is the floor of “−1”, and it shows what was
   * just cancelled. It is not saved: a line declaring zero copies says nothing.
   */
  const user = await newUser();
  const batch = await createScanlist(db, user.id, {
    name: "With zeros",
    lines: [line("SCAN-FR002", 2), line("SCAN-FR003", 0)],
  });

  assert.equal(batch.lines.length, 1);
  assert.equal(batch.lines[0]?.setCode, "SCAN-FR002");
  assert.equal(batch.copyCount, 2);
});

test("a batch entirely at zero is refused", async () => {
  const user = await newUser();
  await assert.rejects(
    () => createScanlist(db, user.id, { name: "Empty", lines: [line("SCAN-FR004", 0)] }),
    /No cards to save/,
  );
});

test("one code spelled two ways does not break the save", async () => {
  /**
   * The unique index `(batch, code)` would refuse the second insert in the
   * middle of the batch, and the whole scan would be lost. We add up before
   * writing.
   */
  const user = await newUser();
  const batch = await createScanlist(db, user.id, {
    name: "Duplicates",
    lines: [line("scan-fr005", 2), line("SCAN-FR005", 3)],
  });

  assert.equal(batch.lines.length, 1);
  assert.equal(batch.lines[0]?.quantity, 5);
});

test("pouring adds the quantities to the collection", async () => {
  const user = await newUser();
  await seedCard(88888806, "SCAN-FR006", "Poured");
  const batch = await createScanlist(db, user.id, { name: "To pour", lines: [line("SCAN-FR006", 4)] });

  const outcome = await pourScanlist(db, user.id, batch.id);
  assert.equal(outcome.poured, 4);
  assert.equal(outcome.failed, 0);

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.total, 1);
  assert.equal(collection.items[0]?.quantity, 4);
  resetResolveQueue();
});

test("pouring twice is refused", async () => {
  /**
   * Pouring twice would double the collection with nothing signalling it. The
   * date is set in the same write that checks it was null: a double tap cannot
   * slip between the two.
   */
  const user = await newUser();
  await seedCard(88888807, "SCAN-FR007", "Twice");
  const batch = await createScanlist(db, user.id, { name: "Double", lines: [line("SCAN-FR007", 2)] });

  await pourScanlist(db, user.id, batch.id);
  await assert.rejects(() => pourScanlist(db, user.id, batch.id), /already been poured/);

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 2, "the quantity has not doubled");
  resetResolveQueue();
});

test("two simultaneous pours pour only once", async () => {
  const user = await newUser();
  await seedCard(88888808, "SCAN-FR008", "Concurrent");
  const batch = await createScanlist(db, user.id, { name: "Race", lines: [line("SCAN-FR008", 5)] });

  const outcomes = await Promise.allSettled([
    pourScanlist(db, user.id, batch.id),
    pourScanlist(db, user.id, batch.id),
  ]);
  const succeeded = outcomes.filter((o) => o.status === "fulfilled");
  assert.equal(succeeded.length, 1, "only one pour goes through");

  const collection = await listCollection(db, user.id, {});
  assert.equal(collection.items[0]?.quantity, 5);
  resetResolveQueue();
});

test("a batch survives its pour, dated", async () => {
  const user = await newUser();
  await seedCard(88888809, "SCAN-FR009", "Trace");
  const batch = await createScanlist(db, user.id, { name: "Trace", lines: [line("SCAN-FR009", 1)] });
  await pourScanlist(db, user.id, batch.id);

  const read = await getScanlist(db, user.id, batch.id);
  assert.ok(read.pouredAt, "the pour date is kept");
  assert.equal(read.lines.length, 1, "so are the lines");
  resetResolveQueue();
});

test("someone else's batch is not found, rather than forbidden", async () => {
  const owner = await newUser();
  const other = await newUser();
  const batch = await createScanlist(db, owner.id, {
    name: "Private", lines: [line("SCAN-FR010", 1)],
  });

  // A 403 would say it exists. It must say nothing at all.
  await assert.rejects(() => getScanlist(db, other.id, batch.id), /not found/);
  await assert.rejects(() => pourScanlist(db, other.id, batch.id), /not found/);
  await assert.rejects(() => deleteScanlist(db, other.id, batch.id), /not found/);
});

test("the list shows only one's own batches", async () => {
  const user = await newUser();
  const other = await newUser();
  await createScanlist(db, user.id, { name: "Mine", lines: [line("SCAN-FR011", 1)] });
  await createScanlist(db, other.id, { name: "Theirs", lines: [line("SCAN-FR012", 1)] });

  const batches = await listScanlists(db, user.id);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.name, "Mine");
  assert.equal(batches[0]?.lineCount, 1);
  assert.equal(batches[0]?.copyCount, 1);
});

test("discarding a batch takes its lines with it", async () => {
  const user = await newUser();
  const batch = await createScanlist(db, user.id, { name: "To discard", lines: [line("SCAN-FR013", 2)] });

  await deleteScanlist(db, user.id, batch.id);

  const left = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, batch.id));
  assert.equal(left.length, 0);
  await assert.rejects(() => getScanlist(db, user.id, batch.id), /not found/);
});

test("a line the catalogue cannot place is counted, without blocking the others", async () => {
  /**
   * A half-poured scanlist must read as such. The quantity capped at 1000 makes
   * the line fail without carrying away the rest of the batch.
   */
  const user = await newUser();
  await seedCard(88888814, "SCAN-FR014", "Good one");
  const batch = await createScanlist(db, user.id, {
    name: "Mixed",
    lines: [line("SCAN-FR014", 2), line("", 3), line("SCAN-FR015", 1)],
  });

  // The empty-code line is dropped at save time: it has no identity, and the
  // inventory has no use for it.
  assert.equal(batch.lines.length, 2);

  const outcome = await pourScanlist(db, user.id, batch.id);
  assert.equal(outcome.poured, 3, "both valid lines are poured");
  assert.equal(outcome.failed, 0);
  resetResolveQueue();
});

test("an identifier that is not a UUID is refused, not crashed on", async () => {
  /**
   * The column is a `uuid`: PostgreSQL refuses the comparison with an arbitrary
   * string, and without a guard that refusal surfaced as an **internal error** —
   * a 500 for a mistyped address.
   *
   * The first version of this test looked for “invalid input syntax” in the
   * message and passed: Drizzle puts the failed query there, not PostgreSQL's
   * complaint, which lives in the cause. So it now checks that what comes back
   * is really **our** refusal.
   */
  const user = await newUser();
  for (const crooked of ["not-a-uuid", "", "12345", "00000000-0000-0000-0000-00000000000"]) {
    await assert.rejects(
      () => getScanlist(db, user.id, crooked),
      /Invalid identifier/,
      `“${crooked}”`,
    );
  }
});
