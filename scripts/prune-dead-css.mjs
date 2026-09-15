/**
 * Removes from the shipped sheets the rules nothing sets — without losing them.
 *
 * Removed rules are written to `design/staged/pruned/`, one file per original
 * sheet. They are no longer loaded, so they weigh nothing; and the day the
 * screen they styled arrives, we know where they are instead of rediscovering
 * them in ATEM-old.
 *
 * Usage: node scripts/prune-dead-css.mjs [--dry]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { files, groupBody, readMarkup, rules } from "./lib/dead-css.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");
const PRUNED = path.join(STYLES, "staged", "pruned");
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

  /**
   * Append, do not overwrite.
   *
   * Otherwise a second pass overwrote what the first had set aside: 208 rules
   * kept, then replaced by the next 47. The file told the truth about the last
   * pass, not about what had been removed.
   */
  const target = path.join(PRUNED, relative);
  if (!existsSync(target)) {
    writeFileSync(
      target,
      `/**\n * Rules removed from \`design/${path.relative(STYLES, sheet)}\`.\n *\n` +
        ` * Nothing set them in the shipped markup: they styled screens that do not\n` +
        ` * exist here yet (guilds, settings, administration, landing page).\n` +
        ` * Kept as they were — when their screen arrives, they move back up.\n */\n`,
    );
  }
  appendFileSync(target, `\n${drop.join("\n\n")}\n`);
  writeFileSync(sheet, keep.join("").replace(/\n{3,}/g, "\n\n"));
}

console.log(
  removedRules === 0
    ? "✓ nothing to remove"
    : `\n${removedRules} rules removed from the shipped sheets, kept in design/staged/pruned/`,
);
