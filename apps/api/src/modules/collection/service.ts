/**
 * The collection module — what the player owns.
 *
 * **Two identities, and they are not the same.**
 *
 * — `ownerId`: whose cards these are. A read takes it, and any session may read
 *   any inventory — that is what will let a duellist look at someone else's
 *   collection.
 * — `viewerId`: who is asking, as the session establishes it. **Every write
 *   takes it, and it alone.** Never an identity coming from the request path.
 *
 * Both used to be the same variable, which made the code safe *by accident*: it
 * held because one could not be someone else. Naming them apart makes every
 * signature say what it talks about, and makes visible the mistake of passing
 * an owner where a viewer is expected — see ADR-009.
 *
 * It never writes into `cards` or `card_prints`: it calls the `referential`
 * module. That is the fix for ATEM-old's deepest flaw, where `collection` and
 * `decks` each created their own catalogue rows, with three competing logics
 * that ignored one another.
 */
import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  LIMITS, normalizeSetCode, type CsvExportLine, type ImportLineError, type ParsedImport,
} from "@atem/shared";
import type { Database } from "../../db/client.js";
import { invalidInput, notFound } from "../../platform/errors.js";
import {
  ensurePlaceholderPrint, printIndex, publicImageUrls, resolvePrintBySetCode,
  type CardDetail, type PrintIndex,
} from "../referential/index.js";
import { enqueueResolve } from "./resolve-queue.js";
import { collectionImports, ownedCards } from "./schema.js";

export type CollectionItem = {
  id: number;
  setCode: string;
  quantity: number;
  isFavorite: boolean;
  notes: string | null;
  print: {
    id: number;
    setCode: string;
    setName: string | null;
    rarity: string;
    language: string;
    resolveStatus: string;
  };
  card: CardDetail | null;
};

export type CollectionFilters = {
  /** Searches the card's name as well as the set code. */
  query?: string;
  type?: string[];
  /** Le type d'invocation : normal, effect, fusion, synchro, xyz, link, pendulum. */
  frameType?: string[];
  race?: string[];
  attribute?: string[];
  /**
   * Level, rank and Link rating — three distinct lists.
   *
   * The API files all three under the same `level` field (and `link_value` for
   * the last), but they are not the same thing: a Rank 4 Xyz is not a Level 4
   * monster, and mixing them would produce a filter that means nothing.
   * ATEM-old made three chip blocks of them; we keep that.
   */
  levels?: string[];
  ranks?: string[];
  links?: string[];
  atk?: { min?: number; max?: number };
  archetype?: string;
  language?: string;
  rarity?: string;
  favoritesOnly?: boolean;
  /** Show only what has not been identified yet. */
  unresolvedOnly?: boolean;
  /**
   * The broad family: monster, spell, trap.
   *
   * “Monster” is not a single type on the API side — there are twenty-one. We
   * express it by exclusion, which stays correct on the first type Konami adds.
   * This filter used to be applied on the screen side, **after** pagination: on
   * a collection whose first sixty rows are spells, the grid emptied and the
   * rest became unreachable.
   */
  kind?: "monster" | "spell" | "trap";
  sort?: "name" | "recent" | "quantity" | "setCode";
  /** Sort direction. ATEM-old offered it; without it you sort backwards. */
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

/**
 * An owned row, enriched by the referential's view.
 *
 * The printed name, the card's attributes and the printing's come from
 * `printIndex`: `collection` knows neither `cards` nor `card_prints`, and
 * therefore can neither read nor write them by mistake.
 */
type IndexRow = Awaited<ReturnType<typeof rowsQuery>>[number];

function toItem(row: IndexRow): CollectionItem {
  const hasCard = row.passcode !== null;
  return {
    id: row.owned.id,
    setCode: row.owned.setCode,
    quantity: row.owned.quantity,
    isFavorite: row.owned.isFavorite,
    notes: row.owned.notes,
    print: {
      id: row.printId,
      setCode: row.printSetCode,
      setName: row.setName,
      rarity: row.rarity,
      language: row.language,
      resolveStatus: row.resolveStatus,
    },
    card: hasCard
      ? {
          passcode: row.passcode!,
          // The printed name is computed by the referential, in SQL: that is
          // its rule, and keeping it there allows sorting and searching on it.
          name: row.name,
          desc: (row.language === "fr" ? row.descFr : null) ?? row.descEn,
          frenchPending: row.language === "fr" && !row.nameFr,
          type: row.type,
          frameType: row.frameType,
          race: row.race,
          attribute: row.attribute,
          atk: row.atk,
          def: row.def,
          level: row.level,
          scale: row.scale,
          linkValue: row.linkValue,
          linkMarkers: row.linkMarkers,
          archetype: row.archetype,
          banlistTcg: row.banlistTcg,
          ...publicImageUrls(row.passcode!, row),
        }
      : null,
  };
}

function buildFilters(
  ownerId: string,
  filters: CollectionFilters,
  idx: PrintIndex,
): SQL[] {
  const clauses: SQL[] = [eq(ownedCards.userId, ownerId), gt(ownedCards.quantity, 0)];

  if (filters.query?.trim()) {
    const term = `%${filters.query.trim()}%`;
    /**
     * We search the printed name, in both languages, the set code **and the
     * passcode**.
     *
     * The passcode is the eight digits printed at the bottom left of the card:
     * when the set code is unreadable, it is what remains legible. ATEM-old
     * already compared it; dropping it removed a fallback.
     */
    const matched = or(
      ilike(idx.name, term),
      ilike(idx.nameEn, term),
      ilike(idx.nameFr, term),
      ilike(ownedCards.setCode, term),
      sql`${idx.passcode}::text like ${term}`,
    );
    if (matched) clauses.push(matched);
  }
  if (filters.type?.length) clauses.push(inArray(idx.type, filters.type));
  if (filters.race?.length) clauses.push(inArray(idx.race, filters.race));
  if (filters.attribute?.length) clauses.push(inArray(idx.attribute, filters.attribute));
  if (filters.frameType?.length) clauses.push(inArray(idx.frameType, filters.frameType));
  if (filters.archetype) clauses.push(eq(idx.archetype, filters.archetype));
  if (filters.language) clauses.push(eq(idx.language, filters.language));
  if (filters.rarity) clauses.push(eq(idx.rarity, filters.rarity));
  if (filters.favoritesOnly) clauses.push(eq(ownedCards.isFavorite, true));
  if (filters.unresolvedOnly) clauses.push(isNull(idx.passcode));

  if (filters.kind === "spell") clauses.push(eq(idx.type, "Spell Card"));
  else if (filters.kind === "trap") clauses.push(eq(idx.type, "Trap Card"));
  else if (filters.kind === "monster") {
    clauses.push(
      sql`${idx.passcode} is not null and ${idx.type} not in ('Spell Card', 'Trap Card')`,
    );
  }

  /**
   * A list of numbers, stripped of what is not one.
   *
   * The result may be **empty** — `?level=abc` — and that is the case that
   * mattered: the template then wrote `in ()`, which PostgreSQL refuses, and
   * the whole query went out as a 500 with a stack trace. An unreadable filter
   * value is a request nothing matches, not a server failure; so we return an
   * always-false clause, as `inArray` already does for Link markers.
   */
  const numbers = (values: string[]) => values.map(Number).filter(Number.isFinite);
  const anyOf = (column: PrintIndex["level"], values: number[]) =>
    values.length > 0 ? sql`${column} in ${values}` : sql`false`;

  if (filters.levels?.length) {
    // The level, excluding Xyz: those have a rank.
    clauses.push(
      sql`${anyOf(idx.level, numbers(filters.levels))} and ${idx.type} not like '%XYZ%'`,
    );
  }
  if (filters.ranks?.length) {
    clauses.push(sql`${anyOf(idx.level, numbers(filters.ranks))} and ${idx.type} like '%XYZ%'`);
  }
  if (filters.links?.length) {
    clauses.push(inArray(idx.linkValue, numbers(filters.links)));
  }
  if (filters.atk?.min !== undefined) clauses.push(sql`${idx.atk} >= ${filters.atk.min}`);
  if (filters.atk?.max !== undefined) clauses.push(sql`${idx.atk} <= ${filters.atk.max}`);

  return clauses;
}

const ordering = (
  idx: PrintIndex,
  sort: CollectionFilters["sort"],
  direction: CollectionFilters["sortDir"],
) => {
  // Each criterion has a natural direction: most recent first, but names from A
  // to Z. `sortDir` reverses what was chosen, it does not redefine it.
  const natural = sort === "name" || sort === "setCode" ? "asc" : "desc";
  const wanted = direction ?? natural;
  const order = wanted === "asc" ? asc : desc;

  switch (sort) {
    case "name":
      return order(idx.name);
    case "quantity":
      return order(ownedCards.quantity);
    case "setCode":
      return order(ownedCards.setCode);
    default:
      return order(ownedCards.updatedAt);
  }
};

/**
 * The base query, from which `IndexRow` takes its shape.
 *
 * The view's columns are named one by one: Drizzle refuses selecting a whole
 * subquery as a nested object. It is a little verbose, and it has the advantage
 * of making visible what `collection` actually consumes from the referential.
 */
function rowsQuery(db: Database, idx: PrintIndex) {
  return db
    .select({
      owned: ownedCards,
      printId: idx.printId,
      printSetCode: idx.setCode,
      setName: idx.setName,
      rarity: idx.rarity,
      language: idx.language,
      resolveStatus: idx.resolveStatus,
      passcode: idx.passcode,
      name: idx.name,
      nameFr: idx.nameFr,
      descEn: idx.descEn,
      descFr: idx.descFr,
      type: idx.type,
      frameType: idx.frameType,
      race: idx.race,
      attribute: idx.attribute,
      atk: idx.atk,
      def: idx.def,
      level: idx.level,
      scale: idx.scale,
      linkValue: idx.linkValue,
      linkMarkers: idx.linkMarkers,
      archetype: idx.archetype,
      banlistTcg: idx.banlistTcg,
      imageUrl: idx.imageUrl,
      imageUrlSmall: idx.imageUrlSmall,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId));
}

export async function listCollection(
  db: Database,
  ownerId: string,
  filters: CollectionFilters = {},
): Promise<{ items: CollectionItem[]; total: number }> {
  const idx = printIndex(db);
  const clauses = buildFilters(ownerId, filters, idx);
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await rowsQuery(db, idx)
    .where(and(...clauses))
    .orderBy(ordering(idx, filters.sort, filters.sortDir))
    .limit(limit)
    .offset(offset);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(...clauses));

  return { items: rows.map(toItem), total: counted?.total ?? 0 };
}

/**
 * Every owned printing, as the CSV formats write it — all of them, not a page.
 *
 * `listCollection` stops at two hundred rows, which is right for a screen and
 * wrong for an export: a file that silently holds the first two hundred cards of
 * a two-thousand-card collection looks complete and is not. So this reads the
 * same rows through the same filters, without the limit, and in set-code order
 * so that two exports of an unchanged collection are the same file.
 *
 * Rows at zero stay out, as they do on screen (R9): they are kept for their note
 * and favourite, not owned.
 */
export async function exportLines(db: Database, ownerId: string): Promise<CsvExportLine[]> {
  const idx = printIndex(db);
  const rows = await rowsQuery(db, idx)
    .where(and(...buildFilters(ownerId, {}, idx)))
    .orderBy(asc(ownedCards.setCode));

  return rows.map(toItem).map((item) => ({
    setCode: item.setCode,
    name: item.card?.name ?? null,
    quantity: item.quantity,
    rarity: item.print.rarity || null,
    language: item.print.language || null,
    passcode: item.card?.passcode ?? null,
    notes: item.notes,
  }));
}

/** What an import did, line by line — the summary the screen reports. */
export type ImportResult = {
  mode: "merge" | "replace";
  imported: number;
  removed: number;
  failed: number;
  errors: ImportLineError[];
};

/**
 * Applies a parsed collection file.
 *
 * **`merge` does not add up** — the reference's least intuitive rule, and the
 * one that makes importing the same file twice harmless: each row's quantity is
 * *aligned* on the file's, so the delta written is `file − owned`. A row whose
 * quantity already matches writes nothing; if only its note differs, only the
 * note is written. Rows the file does not mention are left as they are.
 *
 * **`replace`** does the same, then brings to zero every owned printing whose set
 * code the file does not mention. To zero, not deleted: a row at zero keeps its
 * note and favourite for the day the card comes back (R9), which is the same
 * reason “−1” does not delete. A line that **failed** to read still counts as
 * mentioned — a partly unreadable file must not make cards disappear.
 *
 * Each row stands alone: one that fails is reported with its file line and the
 * others carry on.
 */
export async function importCollection(
  db: Database,
  viewerId: string,
  parsed: ParsedImport,
  mode: "merge" | "replace",
  filename: string,
): Promise<ImportResult> {
  const errors: ImportLineError[] = [...parsed.errors];
  let imported = 0;

  const ownedRows = await db
    .select({ id: ownedCards.id, setCode: ownedCards.setCode, quantity: ownedCards.quantity, notes: ownedCards.notes })
    .from(ownedCards)
    .where(eq(ownedCards.userId, viewerId));
  const owned = new Map<string, { id: number; quantity: number; notes: string | null }>();
  for (const row of ownedRows) {
    const known = owned.get(row.setCode);
    // A code on two printings — two languages, say — is one line of the file:
    // its owned quantity is their sum.
    owned.set(row.setCode, known
      ? { id: known.id, quantity: known.quantity + row.quantity, notes: known.notes ?? row.notes }
      : { id: row.id, quantity: row.quantity, notes: row.notes });
  }

  for (const row of parsed.rows) {
    try {
      const current = owned.get(row.setCode);
      const delta = row.quantity - (current?.quantity ?? 0);
      let id = current?.id;
      if (delta !== 0) {
        const item = await adjustQuantity(db, viewerId, {
          setCode: row.setCode, delta, language: row.language, passcode: row.passcode,
        });
        id = item.id;
      }
      if (row.notes !== null && row.notes !== (current?.notes ?? null) && id !== undefined) {
        await setNotes(db, viewerId, id, row.notes);
      }
      imported += 1;
    } catch (err) {
      errors.push({
        line: row.line,
        setCode: row.setCode,
        error: err instanceof Error ? err.message : "import_failed",
      });
    }
  }

  let removed = 0;
  if (mode === "replace") {
    const mentioned = new Set<string>([
      ...parsed.rows.map((row) => row.setCode),
      ...parsed.errors.flatMap((error) => (error.setCode ? [error.setCode] : [])),
    ]);
    for (const [setCode, current] of owned) {
      if (mentioned.has(setCode) || current.quantity === 0) continue;
      try {
        await adjustQuantity(db, viewerId, { setCode, delta: -current.quantity });
        removed += 1;
      } catch (err) {
        errors.push({ line: 0, setCode, error: err instanceof Error ? err.message : "remove_failed" });
      }
    }
  }

  errors.sort((a, b) => a.line - b.line);
  const result = { mode, imported, removed, failed: errors.length, errors };

  // The history keeps the summary, not the file: its cards are in the collection.
  await db.insert(collectionImports).values({
    userId: viewerId, filename, mode, imported, removed, failed: result.failed,
  });
  return result;
}

export type ImportRecord = {
  filename: string;
  mode: "merge" | "replace";
  imported: number;
  removed: number;
  failed: number;
  createdAt: string;
};

/**
 * One person's recent imports, newest first.
 *
 * Fifty is a screen's worth and more: the history answers “what did I import
 * lately?”, not an audit of every file ever read.
 */
export async function listImports(db: Database, ownerId: string): Promise<ImportRecord[]> {
  const rows = await db
    .select()
    .from(collectionImports)
    .where(eq(collectionImports.userId, ownerId))
    .orderBy(desc(collectionImports.createdAt), desc(collectionImports.id))
    .limit(50);
  return rows.map((row) => ({
    filename: row.filename,
    mode: row.mode as "merge" | "replace",
    imported: row.imported,
    removed: row.removed,
    failed: row.failed,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * Adds or removes copies of a set code.
 *
 * **No network call here.** The player has just scanned their card and is
 * waiting for their “+1”: the row is written right away, on a provisional
 * printing if the code is unknown, and resolution goes out in the background —
 * but only **after** the transaction commits, otherwise resolution races a
 * write that is not visible yet.
 */
export async function adjustQuantity(
  db: Database,
  viewerId: string,
  input: {
    setCode: string;
    delta: number;
    language?: string | null;
    passcode?: number | null;
  },
): Promise<CollectionItem> {
  const setCode = normalizeSetCode(input.setCode);
  if (!setCode) throw invalidInput("Empty set code.");
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw invalidInput("The change must be a non-zero whole number.");
  }

  const print = await ensurePlaceholderPrint(db, setCode, {
    language: input.language ?? null,
    passcode: input.passcode ?? null,
  });

  const needsResolution = print.resolveStatus !== "resolved";

  /**
   * One single write, not a read-then-write.
   *
   * The previous version read the row then updated it, without a lock. Two
   * simultaneous “+1” — a double tap, or the scanner's “+1” pressed twice —
   * read the same quantity and wrote the same sum: one increment lost. On a
   * non-existent row, the two inserts raced and one died on the unique index,
   * as a 500.
   *
   * PostgreSQL now does the addition itself. The bounds are checked **after**
   * the write, inside the transaction: going past them rolls it back, and the
   * user gets a message saying what was wrong rather than a quantity silently
   * clipped.
   */
  const item = await db.transaction(async (tx) => {
    const [written] = await tx
      .insert(ownedCards)
      .values({ userId: viewerId, printId: print.id, setCode, quantity: input.delta })
      .onConflictDoUpdate({
        target: [ownedCards.userId, ownedCards.printId],
        set: {
          quantity: sql`${ownedCards.quantity} + ${input.delta}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!written) throw invalidInput("The adjustment wrote nothing.");
    if (written.quantity < 0) {
      throw invalidInput("You cannot own fewer than zero copies.");
    }
    if (written.quantity > LIMITS.quantity.max) {
      throw invalidInput(`At most ${LIMITS.quantity.max} copies of one edition.`);
    }
    return written;
  });

  if (needsResolution) enqueueResolve(viewerId, setCode);

  const idx = printIndex(db);
  const [row] = await rowsQuery(db, idx).where(eq(ownedCards.id, item.id)).limit(1);
  if (!row) throw notFound("Collection entry not found after writing.");
  return toItem(row);
}

/**
 * A row's free-form note.
 *
 * ATEM-old offered it at the bottom of the card sheet: the copy's condition,
 * its provenance, what was paid for it. It also travels in the CSV export,
 * where it occupies the `notes` column.
 */
export async function setNotes(
  db: Database,
  viewerId: string,
  ownedId: number,
  notes: string | null,
): Promise<void> {
  const result = await db
    .update(ownedCards)
    .set({ notes: notes?.trim() || null, updatedAt: new Date() })
    .where(and(eq(ownedCards.id, ownedId), eq(ownedCards.userId, viewerId)))
    .returning({ id: ownedCards.id });

  if (result.length === 0) throw notFound("Collection entry not found.");
}

export async function setFavorite(
  db: Database,
  viewerId: string,
  ownedId: number,
  isFavorite: boolean,
): Promise<void> {
  const result = await db
    .update(ownedCards)
    .set({ isFavorite, updatedAt: new Date() })
    .where(and(eq(ownedCards.id, ownedId), eq(ownedCards.userId, viewerId)))
    .returning({ id: ownedCards.id });

  // The `viewerId` filter is **in** the query, not after it: a row that does
  // not belong to the caller is not found, rather than forbidden. A 403 would
  // reveal that it exists.
  if (result.length === 0) throw notFound("Collection entry not found.");
}

/** How many rows are still waiting to be identified. */
/**
 * Empties one person's collection, in a single statement.
 *
 * ATEM-old did this from the browser, one `DELETE /:id` per card: two thousand
 * requests for a two-thousand-card collection, and a failure halfway through left
 * it half erased with nothing to say so. Here it is one `DELETE … WHERE user_id`,
 * so it happens entirely or not at all.
 *
 * Only the collection: decks, folders and batches are left alone, because that is
 * what the person asked to erase. A deck then reports what it can no longer field,
 * which is exactly the “missing” state it already knows how to show.
 *
 * Returns how many printings were removed, so the screen can say so rather than
 * announce a success it did not measure.
 */
export async function clearCollection(db: Database, viewerId: string): Promise<number> {
  const removed = await db
    .delete(ownedCards)
    .where(eq(ownedCards.userId, viewerId))
    .returning({ id: ownedCards.id });
  return removed.length;
}

export async function resolveStatus(
  db: Database,
  ownerId: string,
): Promise<{ pending: number; unidentified: number }> {
  const idx = printIndex(db);
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${idx.resolveStatus} = 'pending')::int`,
      unidentified: sql<number>`count(*) filter (where ${idx.resolveStatus} = 'unidentified')::int`,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(eq(ownedCards.userId, ownerId), gt(ownedCards.quantity, 0)));

  return { pending: row?.pending ?? 0, unidentified: row?.unidentified ?? 0 };
}

/**
 * How many copies of a card, **across all printings**.
 *
 * This is the rule Ange set for decks: we count by card, not by set code. Three
 * Blue-Eyes as `LOB-FR001`, `MAGO-FR001` and `SDBE-FR001` make three Blue-Eyes
 * — that is what the three-copy rule looks at, and what bounds a deck.
 *
 * Exposed for the `deck` module, which does not touch the collection's tables.
 * Returning a table rather than one count at a time: a forty-card deck would
 * otherwise ask forty questions.
 */
export async function ownedByPasscode(
  db: Database,
  ownerId: string,
  passcodes: number[],
): Promise<Map<number, number>> {
  if (passcodes.length === 0) return new Map();

  const idx = printIndex(db);
  const rows = await db
    .select({
      passcode: idx.passcode,
      owned: sql<number>`sum(${ownedCards.quantity})::int`,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(
      and(
        eq(ownedCards.userId, ownerId),
        gt(ownedCards.quantity, 0),
        inArray(idx.passcode, passcodes),
      ),
    )
    .groupBy(idx.passcode);

  const total = new Map<number, number>();
  for (const row of rows) {
    if (row.passcode !== null) total.set(row.passcode, row.owned);
  }
  return total;
}

/**
 * Queues again everything that was still waiting, at startup.
 *
 * A row enters the collection immediately, as `pending`, and the queue
 * identifies it afterwards. If the process stops in between — a redeploy, a
 * `docker compose down`, a power cut — the queue dies with it: it lives in
 * memory only. **Nothing picked that work up again**, and the row stayed
 * “awaiting identification” forever, with nothing signalling it. The comment in
 * `resolve-queue.ts` promised it would be “picked up at the next startup”.
 *
 * Codes already declared `unidentified` are left where they are: we know they
 * do not exist, and asking again at every startup would needlessly saturate the
 * API we take care to spare.
 */
export async function requeuePendingResolves(db: Database): Promise<number> {
  const idx = printIndex(db);
  const rows = await db
    .selectDistinct({ userId: ownedCards.userId, setCode: ownedCards.setCode })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(
      and(
        gt(ownedCards.quantity, 0),
        eq(idx.resolveStatus, "pending"),
      ),
    );

  for (const row of rows) enqueueResolve(row.userId, row.setCode);
  return rows.length;
}

/**
 * Picks up a printing left provisional, and re-attaches the rows that pointed
 * at it to the real edition.
 *
 * **Everything holds in one transaction.** ATEM-old lived the failure: between
 * deleting the provisional row and writing the consolidated one, an
 * interruption lost copies. That is not a rare case — it is the normal path of
 * every scanned card: “on an import of eight hundred cards, the window opens
 * eight hundred times”.
 */
export async function reresolve(
  db: Database,
  viewerId: string,
  rawSetCode: string,
): Promise<boolean> {
  const setCode = normalizeSetCode(rawSetCode);
  const resolved = await resolvePrintBySetCode(db, setCode);
  if (!resolved || resolved.cardPasscode === null) return false;

  const pendingPrintIds = printIndex(db);

  await db.transaction(async (tx) => {
    /**
     * The rows to consolidate are those of the same set code **still
     * pending**, and not merely those pointing at another printing.
     *
     * Without that restriction, a player already owning `LOB-EN001` in Ultra
     * Rare saw their Secret Rare row, scanned afterwards, melted into the
     * first: the copy was not lost, its edition was. Yet the unit of the
     * inventory is indeed `(set_code, rarity, language)` — consolidating across
     * rarity contradicts the module's reason for being.
     *
     * So we merge only what has no identity yet: the provisional rows.
     */
    const pendingPrints = tx
      .select({ id: pendingPrintIds.printId })
      .from(pendingPrintIds)
      .where(eq(pendingPrintIds.resolveStatus, "pending"));

    const lines = await tx
      .select()
      .from(ownedCards)
      .where(
        and(
          eq(ownedCards.userId, viewerId),
          eq(ownedCards.setCode, setCode),
          sql`${ownedCards.printId} <> ${resolved.id}`,
          inArray(ownedCards.printId, pendingPrints),
        ),
      );
    if (lines.length === 0) return;

    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    const favorite = lines.some((line) => line.isFavorite);

    await tx.delete(ownedCards).where(inArray(ownedCards.id, lines.map((line) => line.id)));

    const [existing] = await tx
      .select()
      .from(ownedCards)
      .where(and(eq(ownedCards.userId, viewerId), eq(ownedCards.printId, resolved.id)))
      .limit(1);

    if (existing) {
      await tx
        .update(ownedCards)
        .set({
          quantity: Math.min(existing.quantity + total, LIMITS.quantity.max),
          isFavorite: existing.isFavorite || favorite,
          updatedAt: new Date(),
        })
        .where(eq(ownedCards.id, existing.id));
    } else {
      await tx.insert(ownedCards).values({
        userId: viewerId,
        printId: resolved.id,
        setCode,
        quantity: Math.min(total, LIMITS.quantity.max),
        isFavorite: favorite,
      });
    }
  });

  return true;
}

/**
 * The values actually present in the collection, to populate the filters.
 *
 * We only offer what the player owns: offering “Dragon” to someone who has none
 * produces nothing but an empty screen.
 *
 * `race` is split into two lists, because the API makes it a single field for
 * two notions: a monster's type (Dragon, Warrior) and a Spell's or Trap's
 * property (Continuous, Equip). A “Normal” Trap is not a Normal monster —
 * mixing them would produce a filter that means nothing.
 */
export async function collectionFacets(db: Database, ownerId: string) {
  const idx = printIndex(db);
  const rows = await db
    .selectDistinct({
      type: idx.type,
      frameType: idx.frameType,
      race: idx.race,
      attribute: idx.attribute,
      rarity: idx.rarity,
      language: idx.language,
    })
    .from(ownedCards)
    .innerJoin(idx, eq(ownedCards.printId, idx.printId))
    .where(and(eq(ownedCards.userId, ownerId), gt(ownedCards.quantity, 0)));

  const collect = (pick: (row: (typeof rows)[number]) => string | null) =>
    [...new Set(rows.map(pick).filter((value): value is string => Boolean(value)))].sort();

  const isSpellTrap = (type: string | null) =>
    type === "Spell Card" || type === "Trap Card";

  return {
    types: collect((row) => row.type),
    frameTypes: collect((row) => row.frameType),
    races: collect((row) => (isSpellTrap(row.type) ? null : row.race)),
    properties: collect((row) => (isSpellTrap(row.type) ? row.race : null)),
    attributes: collect((row) => row.attribute),
    rarities: collect((row) => row.rarity),
    languages: collect((row) => row.language),
  };
}
