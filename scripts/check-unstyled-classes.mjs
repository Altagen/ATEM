/**
 * Every class the markup sets must have a rule.
 *
 * It is the **reverse** check of `check-dead-css.mjs`, and it was missing. One
 * looks for rules without markup; this one looks for markup without rules.
 *
 * It was written after shipping a Catalogue screen where eight classes out of
 * ten no longer existed: the sheets taken from the earlier prototype had replaced ours, and
 * the screen was left unstyled. Nothing had reported it — not the types, not the
 * tests, not the dead-CSS check, which looked the other way. It had to be seen
 * by eye.
 *
 * An unstyled screen raises no error: it displays, simply ugly. It is exactly
 * the kind of defect that passes a review and is discovered in production.
 *
 * **What it cannot see.** A class chosen through a variable —
 * `const cls = over ? "count-over" : "count-short"` then `class="${cls}"` — is
 * indistinguishable from any other string. `count-short` got through that way,
 * with no rule, and the zone counter displayed without its colour. The reverse
 * check, `check-dead-css.mjs`, catches that case from the other end: a rule set
 * nowhere shows up as dead there.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web/src");
const STYLES = path.join(WEB, "design");

/**
 * Classes set without being owed a rule.
 *
 * Some only exist to be found by the code — a hook for a listener, a test
 * selector — and have nothing to style.
 */
const HOOK_ONLY = new Set([
  "js-open",
  "js-fav",
  "js-delta",
  "js-draft",
  "js-coll",
  "js-zone",
]);

function files(dir, ext, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, acc);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** The classes the shipped sheets declare. */
const styled = new Set();
for (const sheet of files(STYLES, ".css")) {
  for (const match of readFileSync(sheet, "utf8").matchAll(/\.(-?[a-zA-Z][\w-]*)/g)) {
    styled.add(match[1]);
  }
}

/**
 * The classes the markup sets.
 *
 * Two shapes: the templates' HTML `class="…"` attribute, and the
 * `{ class: "…" }` object our element builder takes. Both count.
 */
const used = new Map();
for (const file of files(WEB, ".ts")) {
  if (file.endsWith(".test.ts")) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const relative = path.relative(ROOT, file);

  const record = (value) => {
    for (const cls of value.split(/\s+/)) {
      // Fragments assembled at runtime — `chip-${kind}` — cannot be judged
      // here; `check-dead-css` already handles that subtlety.
      if (!cls || cls.includes("$") || cls.includes("{")) continue;
      if (!/^-?[a-zA-Z][\w-]*$/.test(cls)) continue;
      if (!used.has(cls)) used.set(cls, relative);
    }
  };

  for (const match of source.matchAll(/class="([^"$]*)"/g)) record(match[1]);
  for (const match of source.matchAll(/\bclass:\s*"([^"$]*)"/g)) record(match[1]);
}

const unstyled = [...used]
  .filter(([cls]) => !styled.has(cls) && !HOOK_ONLY.has(cls))
  .sort(([a], [b]) => a.localeCompare(b));

if (unstyled.length === 0) {
  console.log(`✓ ${used.size} classes set, all styled`);
  process.exit(0);
}

console.log(`${unstyled.length} classes set without any rule:\n`);
for (const [cls, file] of unstyled) {
  console.log(`    .${cls.padEnd(24)} ${file}`);
}
console.log(
  "\n  An unstyled screen raises nothing: it displays, simply ugly." +
    "\n  Either the rule is missing, or the class has no business being set.",
);
process.exit(1);
