/**
 * No CSS rule may style a class that nothing sets.
 *
 * Ported from the earlier prototype, where this check had found **362 classes declared and
 * never used — 2,763 lines, a third of the sheets**. They all came from the
 * same movement: one version of a screen replaced by another, whose markup left
 * but whose styling stayed.
 *
 * Dead CSS breaks nothing, and that is precisely the problem: it never reports
 * itself, it weighs down every page, and it suggests a feature still exists.
 *
 * It counts double here: we have just taken 10,000 lines of validated sheets,
 * written for a wider scope than ours. Everything that styled guilds,
 * administration or the inbox is dead for us — and must go rather than be
 * dragged along.
 *
 * Usage:
 *   node scripts/check-dead-css.mjs           # gate: fails if any remain
 *   node scripts/check-dead-css.mjs --list    # list, for sorting
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { files, groupBody, lineOf, readMarkup, rules } from "./lib/dead-css.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");

const { ruleAlive } = readMarkup(ROOT);

const listOnly = process.argv.includes("--list");
let deadRules = 0;
let deadLines = 0;
const byFile = new Map();

for (const sheet of files(STYLES, ".css")) {
  const css = readFileSync(sheet, "utf8");
  const dead = [];

  for (const rule of rules(css)) {
    // A group rule (`@media`, `@supports`) is judged on its contents, not on
    // its header: it carries no class itself. An empty one styles nothing.
    const group = groupBody(css, rule);
    if (group) {
      const nestedRules = rules(group.body);
      if (nestedRules.length === 0) {
        dead.push({
          selector: `${group.header} (empty)`,
          line: lineOf(css, rule.from + rule.selector.length),
          lines: css.slice(rule.from, rule.to).split("\n").length,
        });
      }
      for (const nested of nestedRules) {
        if (groupBody(group.body, nested)) continue;
        if (!ruleAlive(nested.selector)) {
          dead.push({
            selector: nested.selector,
            line: lineOf(css, group.offset + nested.from),
            lines: group.body.slice(nested.from, nested.to).split("\n").length,
          });
        }
      }
      continue;
    }
    if (!ruleAlive(rule.selector)) {
      dead.push({
        selector: rule.selector,
        line: lineOf(css, rule.from),
        lines: css.slice(rule.from, rule.to).split("\n").length,
      });
    }
  }

  if (dead.length > 0) {
    byFile.set(path.relative(ROOT, sheet), dead);
    deadRules += dead.length;
    deadLines += dead.reduce((sum, d) => sum + d.lines, 0);
  }
}

if (deadRules === 0) {
  console.log("✓ no dead CSS rule");
  process.exit(0);
}

console.log(`${deadRules} dead rules, ~${deadLines} lines\n`);
for (const [file, dead] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file} — ${dead.length} rules`);
  if (listOnly) {
    for (const d of dead) {
      console.log(`      ${String(d.line).padStart(5)}  ${d.selector.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }
}

if (!listOnly) {
  console.log("\n  node scripts/check-dead-css.mjs --list   for the details");
}
process.exit(listOnly ? 0 : 1);
