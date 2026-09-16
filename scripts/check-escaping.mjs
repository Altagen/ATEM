/**
 * Nothing reaches the page unescaped except what we wrote ourselves.
 *
 * The `html` template escapes every value it interpolates; `raw()` is the door
 * out of that, and it exists for a reason — an attribute's *name* cannot be
 * escaped, a fragment already built must not be escaped twice. But a `raw()`
 * that interpolates data is a cross-site scripting hole, and it is invisible:
 * the screen looks right until a card is called `<img onerror=…>`.
 *
 * Reading them all once, as an audit does, holds until the next commit. So the
 * rule is stated instead, and it is narrow on purpose — inside `raw(`, an
 * interpolation may only be:
 *
 *   - a call to `t(` — our own dictionary, which we author;
 *   - a string literal, or a ternary between string literals;
 *   - a comparison producing one of those.
 *
 * Anything else fails, including a bare identifier: `raw(cls)` may be perfectly
 * safe today and the check cannot know it, which is exactly why the value
 * should reach the page through `html` instead.
 *
 * Usage:
 *   node scripts/check-escaping.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web/src");
/** Where `raw` is defined: its own file is not a caller. */
const DEFINITION = path.join(WEB, "platform/ui.ts");

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "staged") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

/** The text between the parentheses of a `raw(` call, brackets balanced. */
function callArgument(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return null;
}

/** `${…}` expressions inside a template literal, brackets balanced. */
function interpolations(text) {
  const found = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "$" || text[index + 1] !== "{") continue;
    let depth = 0;
    for (let end = index + 1; end < text.length; end += 1) {
      if (text[end] === "{") depth += 1;
      else if (text[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          found.push(text.slice(index + 2, end).trim());
          index = end;
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Is this expression one we may inject without escaping?
 *
 * Deliberately blunt: it recognises what we already use and nothing more. A
 * legitimate case it refuses is a case to write with `html` instead — which is
 * the point, not a limitation to work around.
 */
function isTrusted(expression) {
  const stripped = expression
    // Our own dictionary, arguments included: `t("…", { n: count })`.
    .replace(/\bt\([^)]*\)/g, "")
    // String literals, single or double quoted.
    .replace(/"[^"]*"|'[^']*'/g, "")
    // Ternaries and comparisons between the above.
    .replace(/[?:!=<>&|]+/g, " ")
    .trim();
  return stripped === "";
}

const faults = [];
const exceptions = [];

for (const file of files(WEB)) {
  if (file === DEFINITION) continue;
  const source = readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);

  for (let index = source.indexOf("raw("); index !== -1; index = source.indexOf("raw(", index + 1)) {
    // `raw(` as a word, not the tail of another name.
    if (/[A-Za-z0-9_$.]/.test(source[index - 1] ?? "")) continue;
    const argument = callArgument(source, index + 3);
    if (argument === null) continue;
    const line = source.slice(0, index).split("\n").length;

    /**
     * A declared exception, on the spot and with its reason.
     *
     * One case cannot be written any other way: an attribute's **name**, which
     * escaping would turn into text. Rather than weaken the rule for everyone,
     * the line says `raw-name:` and why — and the check counts them out loud, so
     * an exception cannot quietly become the habit.
     */
    const context = source.slice(Math.max(0, index - 300), index);
    const marker = context.lastIndexOf("raw-name:");
    // The marker must be the nearest thing before this call: one reason cannot
    // cover the next `raw(` that happens to follow it.
    if (marker !== -1 && !context.slice(marker).includes("raw(")) {
      exceptions.push(`${relative}:${line}`);
      continue;
    }

    // A bare identifier: safe or not, the check cannot tell — and neither can a
    // reader in six months.
    if (/^[A-Za-z_$][\w$]*$/.test(argument.trim())) {
      faults.push(
        `${relative}:${line} — raw(${argument.trim()}) injects a variable. Give it a closed ` +
          `type the compiler can check, or build it with \`html\`.`,
      );
      continue;
    }

    for (const expression of interpolations(argument)) {
      if (!isTrusted(expression)) {
        faults.push(
          `${relative}:${line} — raw(…) interpolates \`${expression}\`, which is neither a ` +
            `literal nor a t(…). Build that fragment with \`html\`, which escapes.`,
        );
      }
    }
  }
}

/**
 * The other door out: writing markup into the page without going through the
 * template at all.
 */
for (const file of files(WEB)) {
  const source = readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file);
  for (const match of source.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)) {
    const assigned = match[1]?.trim() ?? "";
    // `SafeHtml.toString()` is the template's own output, and `""` empties.
    if (/\.toString\(\)$/.test(assigned) || assigned === '""' || assigned === "''") continue;
    const line = source.slice(0, match.index).split("\n").length;
    faults.push(
      `${relative}:${line} — innerHTML is assigned \`${assigned}\`, which did not come from ` +
        `\`html\`. Everything shown is built by the template, which escapes.`,
    );
  }
}

if (faults.length === 0) {
  const note = exceptions.length
    ? ` — ${exceptions.length} declared exception(s): ${exceptions.join(", ")}`
    : "";
  console.log(`✓ nothing reaches the page unescaped${note}`);
  process.exit(0);
}

console.log(`${faults.length} escaping problem(s):\n`);
for (const fault of faults) console.log(`    ${fault}`);
console.log("\n  `html` escapes what it interpolates; `raw` does not. See apps/web/src/platform/ui.ts.");
process.exit(1);
