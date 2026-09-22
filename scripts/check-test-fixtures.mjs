/**
 * No two test files share a set code.
 *
 * The API tests all run against **the same database**, created for the length
 * of one run. A set code is an identity: `upsertPrint("AAAA-FR001", …)` in one
 * file rewrites the printing another file had set, and points it at another
 * card.
 *
 * The defect does not show where it is committed. A brand new deck test brought
 * down a collection test written three days earlier, which expected
 * “Grande Baleine” and received “Carte 70000001”. You then look for the failure
 * in the module you just wrote, or worse in the one that fails.
 *
 * So each file takes its own prefix. This check verifies it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "apps/api/src");

/**
 * Codes from the real catalogue, which several files may name.
 *
 * They are not made up by a test: setting them twice gives the same printing,
 * pointing at the same card. That is the opposite of the defect we look for.
 */
const REAL_CODES = new Set(["LTGY-FR008", "LOB-FR001", "LOB-EN001", "RA03-FR004", "RA03-EN004"]);

function tests(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) tests(full, acc);
    else if (full.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

/** A set code's shape: a prefix of letters, a dash, an ending. */
const SET_CODE = /"([A-Z]{2,6}-[A-Z]{0,2}\d{1,4}[A-Z]?)"/g;

const filesByCode = new Map();
for (const file of tests(API)) {
  const relative = path.relative(ROOT, file);
  for (const match of readFileSync(file, "utf8").matchAll(SET_CODE)) {
    const code = match[1];
    if (REAL_CODES.has(code)) continue;
    if (!filesByCode.has(code)) filesByCode.set(code, new Set());
    filesByCode.get(code).add(relative);
  }
}

const shared = [...filesByCode]
  .filter(([, files]) => files.size > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (shared.length === 0) {
  console.log(`✓ ${filesByCode.size} test set codes, none shared`);
  process.exit(0);
}

console.log(`${shared.length} set codes used by several files:\n`);
for (const [code, files] of shared) {
  console.log(`    ${code.padEnd(14)} ${[...files].join(", ")}`);
}
console.log(
  "\n  The API tests share a database: the second overwrites the first," +
    "\n  and the failure lands in the file that did nothing." +
    "\n  Give each file its own prefix.",
);
process.exit(1);
