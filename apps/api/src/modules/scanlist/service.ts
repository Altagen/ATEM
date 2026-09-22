/**
 * The scanlist module — taking stock without pouring into the collection.
 *
 * **A scanlist is not shared.** A batch not yet settled is private by nature:
 * it is a draft decision, not an inventory. All of its services therefore take
 * `viewerId` — the one the session establishes — and none takes an owner. The
 * collection and the decks, for their part, distinguish the two because people
 * will look at each other's (ADR-009).
 *
 * It writes neither into `cards`, nor `card_prints`, nor `owned_cards`:
 * pouring goes through `collection`, which itself goes through `referential`.
 * Same rule as everywhere here, and it matters most at the pour — exactly where
 * The earlier prototype would have been tempted to write directly.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { LIMITS, normalizeSetCode, type PourResult, type ScanlistDetail, type ScanlistLine, type ScanlistSummary } from "@atem/shared";
import type { Database } from "../../db/client.js";
import { conflict, invalidInput, notFound } from "../../platform/errors.js";
import { requireUuid } from "../../platform/identifiers.js";
import { adjustQuantity } from "../collection/index.js";
import { scanlistLines, scanlists, type ScanlistRow } from "./schema.js";

const toSummary = (
  row: ScanlistRow,
  counts: { lineCount: number; copyCount: number },
): ScanlistSummary => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  pouredAt: row.pouredAt?.toISOString() ?? null,
  lineCount: counts.lineCount,
  copyCount: counts.copyCount,
});

/**
 * One person's batches, newest first.
 *
 * Both counters are computed in SQL rather than over loaded rows: the batch
 * list has no business loading two thousand lines to display “47 refs · ×63”.
 */
export async function listScanlists(db: Database, viewerId: string): Promise<ScanlistSummary[]> {
  const rows = await db
    .select({
      scanlist: scanlists,
      lineCount: sql<number>`count(${scanlistLines.id})::int`,
      copyCount: sql<number>`coalesce(sum(${scanlistLines.quantity}), 0)::int`,
    })
    .from(scanlists)
    .leftJoin(scanlistLines, eq(scanlistLines.scanlistId, scanlists.id))
    .where(eq(scanlists.userId, viewerId))
    .groupBy(scanlists.id)
    .orderBy(desc(scanlists.createdAt));

  return rows.map((row) => toSummary(row.scanlist, row));
}

/**
 * A batch and its lines.
 *
 * The `viewerId` filter is **in** the query: someone else's batch is not found,
 * rather than forbidden. A 403 would say it exists.
 */
export async function getScanlist(
  db: Database,
  viewerId: string,
  id: string,
): Promise<ScanlistDetail> {
  requireUuid(id);
  const [row] = await db
    .select()
    .from(scanlists)
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, viewerId)))
    .limit(1);
  if (!row) throw notFound("Scanlist not found.");

  const lines = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, id))
    .orderBy(scanlistLines.setCode);

  return {
    ...toSummary(row, {
      lineCount: lines.length,
      copyCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    }),
    lines: lines.map((line) => ({
      setCode: line.setCode,
      name: line.name,
      passcode: line.passcode,
      quantity: line.quantity,
    })),
  };
}

/**
 * Saves a scanned batch.
 *
 * The batch arrives whole, in one go: while scanning, it never leaves the
 * browser. That is what makes the scanner's “−1” unable to touch the
 * collection — there is no path — and it is also what makes an unsaved batch
 * **die with the tab**. The choice is deliberate: nothing survives without
 * explicit validation, rather than a half-state persisted and found again
 * without knowing what it holds.
 */
export async function createScanlist(
  db: Database,
  viewerId: string,
  input: { name: string; lines: ScanlistLine[] },
): Promise<ScanlistDetail> {
  const name = input.name.trim();
  if (!name) throw invalidInput("Give the batch a name.");

  /**
   * Codes are normalised **and merged** here.
   *
   * The browser already keeps one counter per code, but nothing guarantees that
   * two spellings of the same code — `ltgy-fr008` and `LTGY-FR008` — did not
   * arrive separately. The unique index would refuse them in the middle of the
   * insert, and the batch would be lost after the scan. So we add them up.
   */
  const merged = new Map<string, ScanlistLine>();
  for (const line of input.lines) {
    const setCode = normalizeSetCode(line.setCode);
    if (!setCode) continue;
    if (line.quantity <= 0) continue;

    const existing = merged.get(setCode);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + line.quantity, LIMITS.quantity.max);
      existing.name ??= line.name;
      existing.passcode ??= line.passcode;
    } else {
      merged.set(setCode, {
        setCode,
        name: line.name ?? null,
        passcode: line.passcode ?? null,
        quantity: Math.min(line.quantity, LIMITS.quantity.max),
      });
    }
  }

  const lines = [...merged.values()];
  if (lines.length === 0) throw invalidInput("No cards to save.");
  if (lines.length > LIMITS.scanlist.maxLines) {
    throw invalidInput(`A batch holds no more than ${LIMITS.scanlist.maxLines} references.`);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.insert(scanlists).values({ userId: viewerId, name }).returning();
    if (!row) throw new Error("insert returned nothing");

    await tx.insert(scanlistLines).values(
      lines.map((line) => ({
        scanlistId: row.id,
        setCode: line.setCode,
        name: line.name,
        passcode: line.passcode,
        quantity: line.quantity,
      })),
    );

    return {
      ...toSummary(row, {
        lineCount: lines.length,
        copyCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      }),
      lines,
    };
  });
}

/**
 * Pours a batch into the collection.
 *
 * **Line by line, and without an overall transaction.** That is deliberate, and
 * the opposite of the reflex: each line may require a network resolution, and
 * holding a transaction open across two thousand YGOPRODeck calls would lock
 * the collection for several minutes. A line that fails is counted and named in
 * the outcome; the others go in.
 *
 * The pour date is set **before** pouring, in the same write that checks it was
 * null. Two simultaneous calls — a double tap — therefore cannot pour twice:
 * the second finds no batch left to reserve and comes back with a conflict.
 */
export async function pourScanlist(
  db: Database,
  viewerId: string,
  id: string,
): Promise<PourResult> {
  requireUuid(id);
  const [reserved] = await db
    .update(scanlists)
    .set({ pouredAt: new Date() })
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, viewerId), sql`${scanlists.pouredAt} is null`))
    .returning();

  if (!reserved) {
    // Telling the two apart: an already-poured batch is not a bad request, it
    // is a state that refuses it — and saying so spares hunting for a bug.
    const [exists] = await db
      .select({ pouredAt: scanlists.pouredAt })
      .from(scanlists)
      .where(and(eq(scanlists.id, id), eq(scanlists.userId, viewerId)))
      .limit(1);
    if (!exists) throw notFound("Scanlist not found.");
    throw conflict("This batch has already been poured.");
  }

  const lines = await db
    .select()
    .from(scanlistLines)
    .where(eq(scanlistLines.scanlistId, id))
    .orderBy(scanlistLines.setCode);

  let poured = 0;
  let failed = 0;
  const errors: PourResult["errors"] = [];

  for (const line of lines) {
    try {
      await adjustQuantity(db, viewerId, {
        setCode: line.setCode,
        delta: line.quantity,
        passcode: line.passcode,
      });
      poured += line.quantity;
    } catch (err) {
      failed += 1;
      errors.push({
        setCode: line.setCode,
        error: err instanceof Error ? err.message : "Unknown failure.",
      });
    }
  }

  return {
    poured,
    failed,
    pouredAt: reserved.pouredAt!.toISOString(),
    errors,
  };
}

/** Discarding a batch. Filing and destroying are not the same gesture. */
export async function deleteScanlist(db: Database, viewerId: string, id: string): Promise<void> {
  requireUuid(id);
  const deleted = await db
    .delete(scanlists)
    .where(and(eq(scanlists.id, id), eq(scanlists.userId, viewerId)))
    .returning({ id: scanlists.id });
  if (deleted.length === 0) throw notFound("Scanlist not found.");
}
