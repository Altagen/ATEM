/**
 * The catalogue of set prefixes, for the OCR.
 *
 * Recognition does not guess: it compares what it read to what exists. A
 * prefix present in the catalogue is worth +100 to the confidence score, an
 * unknown prefix −80 — that is what separates `LTGY-FR008` from a misread
 * `LTGV-FR0O8`. Without this file, the engine falls back on an emergency list of
 * about 120 sets, and recognition loses a lot.
 *
 * The file is **derived** from the catalogue in the database, never written by
 * hand: it is regenerated after every sync, and so cannot drift from what the
 * reference data really contains.
 *
 * Usage: pnpm --filter @atem/api ocr:build-dict
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseSetCode } from "@atem/shared";
import { createDatabase } from "../src/db/client.js";
import { cardPrints } from "../src/modules/referential/schema.js";

const OUTPUT = resolve(
  import.meta.dirname,
  "../../web/public/ocr/set-prefixes.json",
);

const { db, sql } = createDatabase();

const rows = await db.select({ setCode: cardPrints.setCode }).from(cardPrints);

const prefixes = new Set<string>();
const prints = new Map<string, Set<string>>();

for (const row of rows) {
  const parts = parseSetCode(row.setCode);
  if (!parts) continue;
  prefixes.add(parts.prefix);

  // The engine only keeps purely numeric card numbers, 2 to 4 digits: those are
  // the ones where it allows a one-letter correction. Numbers with a letter
  // prefix (`ENS10`) are too rare to be worth that risk.
  const digits = parts.number.replace(/\D/g, "");
  if (digits.length >= 2 && digits.length <= 4) {
    const bucket = prints.get(parts.prefix) ?? new Set<string>();
    bucket.add(digits);
    prints.set(parts.prefix, bucket);
  }
}

const dict = {
  prefixes: [...prefixes].sort(),
  prints: Object.fromEntries(
    [...prints].map(([prefix, numbers]) => [prefix, [...numbers].sort()]),
  ),
  generated_at: new Date().toISOString(),
  source: "ATEM local catalogue, derived from YGOPRODeck",
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(dict));
await sql.end();

const numbers = [...prints.values()].reduce((sum, set) => sum + set.size, 0);
console.log(
  `[atem] ${dict.prefixes.length} prefixes and ${numbers} numbers written to ${OUTPUT}`,
);
