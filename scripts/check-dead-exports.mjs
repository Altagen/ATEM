/**
 * No export may exist without anything calling it.
 *
 * The counterpart of the dead-CSS check, for TypeScript. It tells apart three
 * defects that are treated differently:
 *
 * — **Dead**: nothing uses it, not elsewhere, not in its own file, not in a
 *   test. This code only adds weight, and suggests a feature exists. It goes.
 *
 * — **Exposed for no reason**: used, but only inside its own file. It is not
 *   dead; it is a boundary pierced for nothing, and it invites the next module
 *   to use it. The `export` keyword goes.
 *
 * — **Alive only through its test**: no production line calls it, but a test
 *   does — which was enough to keep it out of the two previous lists. It is code
 *   only its own check justifies, and the distinction matters: a test hook
 *   (`resetResolveQueue`) is legitimate, a production function nothing calls is
 *   not. Reported without blocking, because the answer depends on which of the
 *   two it is.
 *
 * What the check does **not** read: code staged for the next feature in
 * `design/staged/`. We look for what no longer relates to anything, not for what
 * has not been used yet.
 *
 * Usage:
 *   node scripts/check-dead-exports.mjs           # gate
 *   node scripts/check-dead-exports.mjs --list    # details
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const AREAS = ["apps/api/src", "apps/web/src", "packages/shared/src"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "staged"]);

/**
 * Exports for which having no caller is normal.
 *
 * An entry point is called by nobody: the system launches it. A test hook is
 * only called if the test exists — reporting it would push towards deleting the
 * means of writing that test.
 */
const EXPECTED_UNUSED = new Set([
  // Command entry points.
  "syncCatalogue",
]);

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

const sources = AREAS.flatMap((area) => files(path.join(ROOT, area)));

/** Comments consume nothing — same lesson as for CSS. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * A re-export consumes nothing either.
 *
 * `export { requireAdmin } from "./middleware.js"` mentions the symbol without
 * calling it: it exposes it, that is all. Counting that mention as a use made
 * the check **blind to the whole public surface** — and since the architecture
 * requires that nothing crosses a module except through its `index.ts`, that
 * blind spot covered most of the code.
 *
 * Found by searching by hand for what the gate let through: five dead exports
 * hid there, including an administration guard nobody mounts and the remains of
 * a deleted screen.
 */
const stripReExports = (src) =>
  src.replace(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g, " ");

const contents = new Map(sources.map((f) => [f, readFileSync(f, "utf8")]));
const stripped = new Map(
  [...contents].map(([f, src]) => [f, stripReExports(stripComments(src))]),
);

/** Counts an identifier's occurrences, excluding its own declaration line. */
function countIn(src, symbol, declarationLine) {
  const pattern = new RegExp(`\\b${symbol}\\b`, "g");
  let count = 0;
  for (const line of src.split("\n")) {
    if (line === declarationLine) continue;
    count += (line.match(pattern) ?? []).length;
  }
  return count;
}

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;

const dead = [];
const overExposed = [];
const testOnly = [];

for (const file of sources) {
  const isTest = file.endsWith(".test.ts");
  if (isTest) continue;

  const lines = contents.get(file).split("\n");
  const own = stripped.get(file);

  for (const line of lines) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    const symbol = match[1];
    if (EXPECTED_UNUSED.has(symbol)) continue;

    let outside = 0;
    let inTests = 0;
    for (const [other, src] of stripped) {
      if (other === file) continue;
      const uses = countIn(src, symbol, "");
      if (uses === 0) continue;
      if (other.endsWith(".test.ts")) inTests += uses;
      else outside += uses;
    }

    if (outside > 0) continue;

    /**
     * A type naming an exported function's contract is not over-exposed.
     *
     * `export type DeckDetail` is there to read `getDeck(): Promise<DeckDetail>`:
     * the caller never names it — it receives the object — but removing it
     * would make the signature mute. Reporting it pushed towards damaging what
     * reads well to satisfy a counter.
     */
    const isType = /^export\s+(?:type|interface)\s/.test(line.trim());
    if (isType) {
      /**
       * The signature runs over several lines, and that is the rule here.
       *
       * Reading only the first missed everything written in a column —
       * `export async function getDeck(\n  db: Database,\n  …\n): Promise<DeckDetail>`.
       * So we take from the keyword to the opening brace.
       */
      const signatures =
        own.match(/^export\s+(?:async\s+)?(?:function|const)[\s\S]*?(?:\{|=>|;)/gm) ?? [];
      if (signatures.some((sig) => new RegExp(`\\b${symbol}\\b`).test(sig))) continue;
    }

    const inside = countIn(own, symbol, line.trim());
    const relative = path.relative(ROOT, file);

    if (inside === 0 && inTests === 0) dead.push({ file: relative, symbol });
    else if (inTests === 0) overExposed.push({ file: relative, symbol });
    else if (inside === 0) testOnly.push({ file: relative, symbol });
  }
}

const listOnly = process.argv.includes("--list");

if (dead.length === 0 && overExposed.length === 0 && testOnly.length === 0) {
  console.log("✓ no dead export, none exposed for no reason");
  process.exit(0);
}

if (dead.length > 0) {
  console.log(`${dead.length} dead exports — nothing calls them, anywhere:\n`);
  for (const entry of dead) console.log(`    ${entry.file}  ${entry.symbol}`);
}

if (overExposed.length > 0) {
  console.log(
    `\n${overExposed.length} exports exposed for no reason — only used in their own file:\n`,
  );
  if (listOnly) {
    for (const entry of overExposed) console.log(`    ${entry.file}  ${entry.symbol}`);
  } else {
    console.log("    node scripts/check-dead-exports.mjs --list   for the details");
  }
}

if (testOnly.length > 0) {
  console.log(
    `\n${testOnly.length} exports only their test uses — no production line:\n`,
  );
  for (const entry of testOnly) console.log(`    ${entry.file}  ${entry.symbol}`);
  console.log(
    "\n    A test hook is legitimate; a production function nothing calls" +
      "\n    is not. The answer depends on which one it is.",
  );
}

// Dead exports fail the gate; needless exposure and test-only life are reported
// without blocking — they are boundary or judgement defects, not code that does
// nothing.
process.exit(dead.length > 0 ? 1 : 0);
