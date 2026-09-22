/**
 * No outbound call may escape the token bucket.
 *
 * It is the gate the earlier prototype lacked, and it cost an hour of being blocked: it
 * limited API calls, but image downloads went out by another path, uncounted.
 * Nobody had lied — the limiter existed, it simply did not see all the traffic.
 *
 * A limiter per kind of call protects nothing. What protects is that there is
 * **no** way to call `fetch` without going through `withOutboundSlot`, and that
 * is what this check makes true.
 *
 * It only looks at the API: the front only calls our own server, on its origin,
 * and has nothing to do with YGOPRODeck's limit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const AREAS = ["apps/api/src", "apps/api/scripts"];
const IGNORED_DIRS = new Set(["node_modules", "dist"]);

/** The bucket's own holder has nobody above it. */
const EXEMPT = new Set(["apps/api/src/modules/referential/outbound-rate.ts"]);

/**
 * The window in which `withOutboundSlot(` must appear before `fetch(`.
 *
 * The required shape is `withOutboundSlot(() => fetch(…))`: a few dozen
 * characters separate the two, request options included. Wide enough for
 * readability, narrow enough that a `fetch` in another function cannot claim a
 * bucket set ten lines above.
 */
const WINDOW = 160;

function files(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (/\.m?ts$/.test(full)) acc.push(full);
  }
  return acc;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const offenders = [];

for (const file of AREAS.flatMap((area) => files(path.join(ROOT, area)))) {
  const relative = path.relative(ROOT, file);
  if (EXEMPT.has(relative)) continue;
  if (relative.endsWith(".test.ts")) continue;

  const source = stripComments(readFileSync(file, "utf8"));

  // `.fetch` is a method — Hono's, notably — not the network call.
  for (const match of source.matchAll(/(?<![.\w])fetch\s*\(/g)) {
    const before = source.slice(Math.max(0, match.index - WINDOW), match.index);
    if (before.includes("withOutboundSlot(")) continue;
    const line = source.slice(0, match.index).split("\n").length;
    offenders.push({ file: relative, line });
  }
}

if (offenders.length === 0) {
  console.log("✓ every outbound call goes through the token bucket");
  process.exit(0);
}

console.log(`${offenders.length} outbound call(s) outside the token bucket:\n`);
for (const entry of offenders) console.log(`    ${entry.file}:${entry.line}`);
console.log(
  "\n  Exceeding YGOPRODeck's limit earns a one-hour address ban," +
    "\n  during which no card gets identified at all." +
    "\n  The expected shape: withOutboundSlot(() => fetch(…)).",
);
process.exit(1);
