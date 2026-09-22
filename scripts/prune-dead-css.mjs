/**
 * Removes from the shipped sheets the rules nothing sets.
 *
 * They are not set aside: the day a screen needs one again, the history has
 * it, and a folder of rules waiting for screens was dead code by another name
 * (it went before the first release, 2026-09-22).
 *
 * Usage: node scripts/prune-dead-css.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { files, groupBody, readMarkup, rules } from "./lib/dead-css.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");
const dry = process.argv.includes("--dry");

// The same judgement as the gate, literally: the same function.
const { ruleAlive } = readMarkup(ROOT);

let removedRules = 0;

for (const sheet of files(STYLES, ".css")) {
  const css = readFileSync(sheet, "utf8");
  const keep = [];
  const drop = [];
  let cursor = 0;

  for (const rule of rules(css)) {
    /**
     * A nested block (`@media`, `@supports`) is handled from the inside: its
     * dead rules are removed one by one, and the whole block only goes if
     * nothing is left. Judging only the whole block let a dead rule through as
     * soon as a single neighbour was alive.
     */
    const group = groupBody(css, rule);
    if (group) {
      const inner = css.slice(rule.from, rule.to);
      const open = inner.indexOf("{", rule.selector.length);
      const body = group.body;
      const nested = rules(body);
      const deadNested = nested.filter(
        (n) => !groupBody(body, n) && !ruleAlive(n.selector),
      );
      if (nested.length > 0 && deadNested.length === 0) continue;

      if (deadNested.length === nested.length) {
        // Nothing alive left: the whole block goes.
        keep.push(css.slice(cursor, rule.from));
        drop.push(inner);
        cursor = rule.to;
        continue;
      }

      // Partly alive block: rewrite it without its dead rules.
      let innerKeep = "";
      let innerCursor = 0;
      for (const n of deadNested) {
        innerKeep += body.slice(innerCursor, n.from);
        drop.push(`${group.header} {\n${body.slice(n.from, n.to)}\n}`);
        innerCursor = n.to;
      }
      innerKeep += body.slice(innerCursor);

      keep.push(css.slice(cursor, rule.from));
      keep.push(`${inner.slice(0, open + 1)}${innerKeep.replace(/\n{3,}/g, "\n\n")}}`);
      cursor = rule.to;
      continue;
    }

    if (ruleAlive(rule.selector)) continue;
    keep.push(css.slice(cursor, rule.from));
    drop.push(css.slice(rule.from, rule.to));
    cursor = rule.to;
  }

  if (drop.length === 0) continue;
  keep.push(css.slice(cursor));
  removedRules += drop.length;

  const relative = path.relative(STYLES, sheet).replace(/[\\/]/g, "-");
  console.log(`  ${path.relative(ROOT, sheet)} — ${drop.length} rules removed`);

  if (dry) continue;

  writeFileSync(sheet, keep.join("").replace(/\n{3,}/g, "\n\n"));
}

console.log(
  removedRules === 0
    ? "✓ nothing to remove"
    : `\n${removedRules} rules removed from the shipped sheets`,
);
