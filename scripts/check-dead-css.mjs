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
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "apps", "web", "src");
const STYLES = path.join(ROOT, "design");

/**
 * Classes qu'aucun balisage ne pose, et c'est voulu : elles nomment un état que
 * le navigateur applique lui-même.
 */
const HORS_BALISAGE = new Set([]);

/**
 * `design/staged/` contient les feuilles qui attendent leur écran. Elles ne
 * sont importées nulle part, donc pas livrées — les juger ici les déclarerait
 * mortes à juste titre, et on les perdrait pour rien.
 */
const IGNORED = new Set(["staged"]);

function files(dir, ext, acc = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, acc);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

/**
 * Les commentaires ne posent rien.
 *
 * ATEM-old s'est fait avoir quatre fois par ce détail : l'en-tête d'un fichier
 * énumérait « classes reprises de guild.css : .guild-hero-banner… », et cette
 * liste suffisait à les tenir toutes pour vivantes. Retirer le balisage de
 * l'une d'elles ne déclenchait plus rien.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const sources = files(ROOT, ".ts").filter((f) => !f.endsWith(".test.ts"));
const markup = sources.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
const tokens = new Set(markup.match(/[A-Za-z][\w-]*/g) ?? []);

/**
 * Les classes assemblées à l'exécution — `star-badge-${kind}`, `"toast-" + tone`
 * — n'apparaissent nulle part en entier.
 *
 * On relève les fragments littéraux qui précèdent une interpolation, et l'on
 * tient pour vivante toute classe qui commence par l'un d'eux et dont le reste
 * est un jeton du code. Sans cette règle, une première purge chez ATEM-old
 * avait emporté `.toast-ok` et `.toast-err` : le message s'affichait ensuite
 * sans fond, transparent.
 */
const prefixes = new Set();
for (const match of markup.matchAll(/class="([^"]*?)\$\{/g)) {
  const last = match[1].trim().split(/\s+/).at(-1);
  if (last?.endsWith("-")) prefixes.add(last);
}
for (const match of markup.matchAll(/["']([^"'\n]*?[a-z][\w-]*-)["']\s*[+,]/g)) {
  const last = match[1].trim().split(/\s+/).at(-1);
  if (last && /^[a-z][\w-]*-$/.test(last)) prefixes.add(last);
}

function alive(cls) {
  if (tokens.has(cls) || HORS_BALISAGE.has(cls)) return true;
  for (const prefix of prefixes) {
    if (!cls.startsWith(prefix)) continue;
    const rest = cls.slice(prefix.length);
    if (!rest || tokens.has(rest)) return true;
  }
  return false;
}

/**
 * Un sélecteur est vivant si **toutes** ses classes le sont : `.chip.chip-level`
 * ne s'applique jamais si `chip-level` n'est posée nulle part, même si `.chip`
 * l'est. Une règle est vivante dès qu'un seul de ses sélecteurs l'est.
 */
function selectorAlive(selector) {
  const classes = selector.match(/\.(-?[a-zA-Z][\w-]*)/g) ?? [];
  if (classes.length === 0) return true;
  return classes.every((c) => alive(c.slice(1)));
}

const ruleAlive = (selectors) => selectors.split(",").some(selectorAlive);

/** Découpe une feuille en règles de premier niveau, en suivant les accolades. */
function rules(css) {
  const out = [];
  let depth = 0;
  let selectorStart = 0;
  let selector = "";

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) selector = css.slice(selectorStart, i);
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        // `from` pointe le sélecteur, pas l'accolade : c'est ce qui permet à la
        // purge de retirer la règle entière.
        out.push({ selector: selector.trim(), from: selectorStart, to: i + 1 });
        selectorStart = i + 1;
      }
    }
  }
  return out;
}

const lineOf = (css, index) => css.slice(0, index).split("\n").length;

const listOnly = process.argv.includes("--list");
let deadRules = 0;
let deadLines = 0;
const byFile = new Map();

for (const sheet of files(STYLES, ".css")) {
  const css = readFileSync(sheet, "utf8");
  const dead = [];

  for (const rule of rules(css)) {
    // Une règle imbriquée (`@media`, `@supports`) est jugée sur son contenu,
    // pas sur son en-tête : elle ne porte aucune classe elle-même.
    if (rule.selector.startsWith("@")) {
      const inner = css.slice(rule.from + 1, rule.to);
      const offset = rule.from + 1;
      for (const nested of rules(inner)) {
        if (nested.selector.startsWith("@")) continue;
        if (!ruleAlive(nested.selector)) {
          dead.push({
            selector: nested.selector,
            line: lineOf(css, offset + nested.from),
            lines: inner.slice(nested.from, nested.to).split("\n").length,
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
