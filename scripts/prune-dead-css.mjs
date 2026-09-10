/**
 * Retire du livré les règles que rien ne pose — sans les perdre.
 *
 * Les règles retirées sont écrites dans `design/staged/pruned/`, avec leur
 * feuille d'origine et leur ligne. Elles ne sont plus chargées, donc ne pèsent
 * plus rien ; et le jour où l'écran qu'elles habillaient arrive, on sait où
 * elles sont plutôt que de les redécouvrir dans ATEM-old.
 *
 * Usage : node scripts/prune-dead-css.mjs [--dry]
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { files, readMarkup, rules } from "./lib/dead-css.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");
const PRUNED = path.join(STYLES, "staged", "pruned");
const dry = process.argv.includes("--dry");

// Le même jugement que la barrière, au sens propre : la même fonction.
const { ruleAlive } = readMarkup(ROOT);

let removedRules = 0;

for (const sheet of files(STYLES, ".css")) {
  const css = readFileSync(sheet, "utf8");
  const keep = [];
  const drop = [];
  let cursor = 0;

  for (const rule of rules(css)) {
    /**
     * Un bloc imbriqué (`@media`, `@supports`) est traité de l'intérieur : on
     * en retire les règles mortes une par une, et le bloc entier ne part que
     * s'il ne reste rien. Ne juger que le bloc entier laissait passer une règle
     * morte dès qu'une seule de ses voisines était vivante.
     */
    if (rule.selector.startsWith("@")) {
      const inner = css.slice(rule.from, rule.to);
      const open = inner.indexOf("{");
      const body = inner.slice(open + 1, inner.lastIndexOf("}"));
      const nested = rules(body);
      const deadNested = nested.filter(
        (n) => !n.selector.startsWith("@") && !ruleAlive(n.selector),
      );
      if (deadNested.length === 0) continue;

      if (deadNested.length === nested.length) {
        // Plus rien de vivant : le bloc entier part.
        keep.push(css.slice(cursor, rule.from));
        drop.push(inner);
        cursor = rule.to;
        continue;
      }

      // Bloc partiellement vivant : on le réécrit sans ses règles mortes.
      let innerKeep = "";
      let innerCursor = 0;
      for (const n of deadNested) {
        innerKeep += body.slice(innerCursor, n.from);
        drop.push(`@media (extrait de ${rule.selector.trim()}) {\n${body.slice(n.from, n.to)}\n}`);
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
  console.log(`  ${path.relative(ROOT, sheet)} — ${drop.length} règles retirées`);

  if (dry) continue;

  /**
   * On ajoute, on n'écrase pas.
   *
   * Une seconde passe écrasait sinon ce que la première avait mis de côté :
   * 208 règles conservées, puis remplacées par les 47 suivantes. Le fichier
   * disait la vérité sur la dernière passe, pas sur ce qui avait été retiré.
   */
  const target = path.join(PRUNED, relative);
  if (!existsSync(target)) {
    writeFileSync(
      target,
      `/**\n * Règles retirées de \`design/${path.relative(STYLES, sheet)}\`.\n *\n` +
        ` * Rien ne les posait dans le balisage livré : elles habillaient des écrans\n` +
        ` * qui n'existent pas encore ici (guildes, réglages, administration, accueil).\n` +
        ` * Conservées telles quelles — quand leur écran arrive, elles remontent.\n */\n`,
    );
  }
  appendFileSync(target, `\n${drop.join("\n\n")}\n`);
  writeFileSync(sheet, keep.join("").replace(/\n{3,}/g, "\n\n"));
}

console.log(
  removedRules === 0
    ? "✓ rien à retirer"
    : `\n${removedRules} règles retirées du livré, conservées dans design/staged/pruned/`,
);
