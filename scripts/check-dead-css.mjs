/**
 * Aucune règle CSS ne doit habiller une classe que rien ne pose.
 *
 * Porté d'ATEM-old, où ce contrôle avait trouvé **362 classes déclarées et
 * jamais employées — 2 763 lignes, un tiers des feuilles**. Elles venaient
 * toutes du même mouvement : une version d'écran remplacée par une autre, dont
 * le balisage partait mais dont l'habillage restait.
 *
 * Du CSS mort ne casse rien, et c'est justement le problème : il ne se signale
 * jamais, il alourdit chaque page, et il fait croire qu'une fonctionnalité
 * existe encore.
 *
 * Il compte double ici : on vient de reprendre 10 000 lignes de feuilles
 * validées, écrites pour un périmètre plus large que le nôtre. Tout ce qui
 * habillait les guildes, l'administration ou la boîte de réception est mort
 * chez nous — et doit partir plutôt que d'être traîné.
 *
 * Usage :
 *   node scripts/check-dead-css.mjs           # barrière : échoue s'il en reste
 *   node scripts/check-dead-css.mjs --list    # liste, pour trier
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { files, groupBody, lineOf, readMarkup, rules } from "./lib/dead-css.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");

/**
 * Classes qu'aucun balisage ne pose, et c'est voulu : elles nomment un état que
 * le navigateur applique lui-même.
 */
const HORS_BALISAGE = new Set([]);

const { ruleAlive } = readMarkup(ROOT, HORS_BALISAGE);

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
  console.log("✓ aucune règle CSS morte");
  process.exit(0);
}

console.log(`${deadRules} règles mortes, ~${deadLines} lignes\n`);
for (const [file, dead] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${file} — ${dead.length} règles`);
  if (listOnly) {
    for (const d of dead) {
      console.log(`      ${String(d.line).padStart(5)}  ${d.selector.replace(/\s+/g, " ").slice(0, 90)}`);
    }
  }
}

if (!listOnly) {
  console.log("\n  node scripts/check-dead-css.mjs --list   pour le détail");
}
process.exit(listOnly ? 0 : 1);
