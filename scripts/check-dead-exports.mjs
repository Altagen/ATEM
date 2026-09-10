/**
 * Aucun export ne doit exister sans que rien ne l'appelle.
 *
 * Pendant du contrôle de CSS mort, pour le TypeScript. Il distingue deux
 * défauts qui se soignent différemment :
 *
 * — **Mort** : rien ne s'en sert, ni ailleurs, ni dans son propre fichier, ni
 *   dans un test. Ce code ne fait rien qu'alourdir, et il fait croire qu'une
 *   fonctionnalité existe. Il part.
 *
 * — **Exposé sans raison** : utilisé, mais seulement à l'intérieur de son
 *   fichier. Ce n'est pas mort ; c'est une frontière percée pour rien, et ça
 *   invite le prochain module à s'en servir. Le mot-clé `export` part.
 *
 * Ce que le contrôle **ne** signale pas : le code qui prépare la fonctionnalité
 * suivante et qui vit dans `design/staged/` ou derrière un module réservé. On
 * cherche ce qui n'a plus de rapport avec rien, pas ce qui n'a pas encore servi.
 *
 * Usage :
 *   node scripts/check-dead-exports.mjs           # barrière
 *   node scripts/check-dead-exports.mjs --list    # détail
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const AREAS = ["apps/api/src", "apps/web/src", "packages/shared/src"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "staged"]);

/**
 * Exports dont l'absence d'appelant est normale.
 *
 * Un point d'entrée n'est appelé par personne : c'est le système qui le lance.
 * Un crochet de test n'est appelé que si le test existe — le signaler
 * pousserait à supprimer le moyen d'écrire ce test.
 */
const EXPECTED_UNUSED = new Set([
  // Points d'entrée de commande.
  "syncCatalogue",
]);

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

const sources = AREAS.flatMap((area) => files(path.join(ROOT, area)));

/** Les commentaires ne consomment rien — même leçon que pour le CSS. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * Un ré-export ne consomme rien non plus.
 *
 * `export { requireAdmin } from "./middleware.js"` mentionne le symbole sans
 * l'appeler : il l'expose, c'est tout. Compter cette mention comme un usage
 * rendait le contrôle **aveugle à toute la surface publique** — et comme
 * l'architecture impose que rien ne traverse un module autrement que par son
 * `index.ts`, cet angle mort couvrait l'essentiel du code.
 *
 * Trouvé en cherchant à la main ce que la barrière laissait passer : cinq
 * exports morts s'y cachaient, dont une garde d'administration que personne ne
 * monte et le reste d'un écran supprimé.
 */
const stripReExports = (src) =>
  src.replace(/export\s*\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g, " ");

const contents = new Map(sources.map((f) => [f, readFileSync(f, "utf8")]));
const stripped = new Map(
  [...contents].map(([f, src]) => [f, stripReExports(stripComments(src))]),
);

/** Compte les occurrences d'un identifiant, hors sa propre ligne de déclaration. */
function countIn(src, symbol, declarationLine) {
  const pattern = new RegExp(`\\b${symbol}\\b`, "g");
  let count = 0;
  for (const line of src.split("\n")) {
    if (line === declarationLine) continue;
    count += (line.match(pattern) ?? []).length;
  }
  return count;
}

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;

const dead = [];
const overExposed = [];

for (const file of sources) {
  const isTest = file.endsWith(".test.ts");
  if (isTest) continue;

  const lines = contents.get(file).split("\n");
  const own = stripped.get(file);

  for (const line of lines) {
    const match = EXPORT_RE.exec(line.trim());
    if (!match) continue;
    const symbol = match[1];
    if (EXPECTED_UNUSED.has(symbol)) continue;

    let outside = 0;
    let inTests = 0;
    for (const [other, src] of stripped) {
      if (other === file) continue;
      const uses = countIn(src, symbol, "");
      if (uses === 0) continue;
      if (other.endsWith(".test.ts")) inTests += uses;
      else outside += uses;
    }

    if (outside > 0) continue;

    const inside = countIn(own, symbol, line.trim());
    const relative = path.relative(ROOT, file);

    if (inside === 0 && inTests === 0) dead.push({ file: relative, symbol });
    else if (inTests === 0) overExposed.push({ file: relative, symbol });
  }
}

const listOnly = process.argv.includes("--list");

if (dead.length === 0 && overExposed.length === 0) {
  console.log("✓ aucun export mort ni exposé sans raison");
  process.exit(0);
}

if (dead.length > 0) {
  console.log(`${dead.length} exports morts — rien ne les appelle, nulle part :\n`);
  for (const entry of dead) console.log(`    ${entry.file}  ${entry.symbol}`);
}

if (overExposed.length > 0) {
  console.log(
    `\n${overExposed.length} exports exposés sans raison — utilisés seulement chez eux :\n`,
  );
  if (listOnly) {
    for (const entry of overExposed) console.log(`    ${entry.file}  ${entry.symbol}`);
  } else {
    console.log("    node scripts/check-dead-exports.mjs --list   pour le détail");
  }
}

// Les exports morts font échouer ; l'exposition inutile est signalée sans
// bloquer — c'est un défaut de frontière, pas du code qui ne sert à rien.
process.exit(dead.length > 0 ? 1 : 0);
