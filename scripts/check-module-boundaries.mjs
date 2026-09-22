/**
 * A module never touches another module's internal files.
 *
 * It is rule R1 of `docs/05-structure.md`, and it does not exist for style: in
 * The earlier prototype, `collection` and `decks` wrote directly into the catalogue's tables.
 * The result was **three competing implementations** of “card not resolved
 * yet”, each unaware of the other two, and a negative passcode whose sign
 * carried a business meaning copied by hand into four files.
 *
 * Discipline alone had not prevented it. This gate does.
 *
 * What is allowed:
 *   - importing `../<other>/index.js` — the module's front door
 *   - importing `../../platform/…` and `../../db/…` — shared infrastructure
 *   - importing `@atem/shared`
 *   - inside a module, anything
 *
 * What is not: `../<other>/service.js`, `../<other>/schema.js`, or any other
 * internal file.
 *
 * The `db/schema.ts` exception is named: it is the aggregator drizzle-kit reads,
 * it gathers every module's schema and contains nothing else.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODULES_DIR = path.join(ROOT, "apps/api/src/modules");

/** Files allowed to gather modules, by construction. */
const AGGREGATORS = new Set([path.join(ROOT, "apps/api/src/db/schema.ts")]);

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;

const violations = [];

for (const file of files(MODULES_DIR)) {
  if (AGGREGATORS.has(file)) continue;
  const owner = path.relative(MODULES_DIR, file).split(path.sep)[0];
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;

    const resolved = path.resolve(path.dirname(file), specifier);
    if (!resolved.startsWith(MODULES_DIR + path.sep)) continue;

    const target = path.relative(MODULES_DIR, resolved).split(path.sep);
    const targetModule = target[0];
    if (targetModule === owner) continue;

    const entry = target.slice(1).join("/");
    // `index.js` is the door; everything else is the inside of the house.
    if (entry === "index.js" || entry === "index.ts" || entry === "index") continue;

    /**
     * A schema may reference another module's schema.
     *
     * A foreign key is a **declared** relation, which the database enforces —
     * `owned_cards.print_id` must point at a real printing, and Drizzle needs
     * the table object to write it. It is not a workaround: it grants no right
     * to query the other module's tables, only to attach to them.
     *
     * The distinction is this: a schema referencing another says “my row
     * depends on its row”. A *service* reading another's schema says “I know how
     * its tables are built” — and that is what produced three competing logics
     * in the earlier prototype.
     */
    const isSchemaToSchema =
      file.endsWith(`${path.sep}schema.ts`) && entry === "schema.js";
    if (isSchemaToSchema) continue;

    violations.push({
      file: path.relative(ROOT, file),
      owner,
      target: `${targetModule}/${entry}`,
    });
  }
}

/** Tests may reach into another module's internals to set up their state: they are counted, not refused. */
const external = violations.filter((v) => !v.file.endsWith(".test.ts"));
const fromTests = violations.filter((v) => v.file.endsWith(".test.ts"));

if (external.length === 0) {
  const suffix = fromTests.length > 0 ? ` (${fromTests.length} from tests, tolerated)` : "";
  console.log(`✓ module boundaries respected${suffix}`);
  process.exit(0);
}

console.log(`${external.length} boundary crossings:\n`);
for (const violation of external) {
  console.log(`    ${violation.file}`);
  console.log(`      → ${violation.target}  (module “${violation.owner}” walks into another one)`);
}
console.log(
  "\n  A module addresses another through its index.ts, never through its files." +
    "\n  See docs/05-structure.md, rule R1.",
);
process.exit(1);
