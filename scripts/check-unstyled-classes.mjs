/**
 * Toute classe posée par le balisage doit avoir une règle.
 *
 * C'est le contrôle **inverse** de `check-dead-css.mjs`, et il manquait. L'un
 * cherche des règles sans balisage ; celui-ci cherche du balisage sans règles.
 *
 * Il a été écrit après avoir livré un écran Catalogue dont huit classes sur dix
 * n'existaient plus : les feuilles reprises d'ATEM-old avaient remplacé les
 * miennes, et l'écran s'était retrouvé sans habillage. Rien ne l'avait signalé —
 * ni les types, ni les tests, ni le contrôle de CSS mort, qui regardait dans
 * l'autre sens. Il a fallu le voir à l'œil.
 *
 * Un écran sans style ne lève aucune erreur : il s'affiche, simplement laid.
 * C'est exactement le genre de défaut qui passe une revue et se découvre en
 * production.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "apps/web/src");
const STYLES = path.join(WEB, "design");

/**
 * Classes posées sans qu'une règle leur soit due.
 *
 * Certaines ne servent qu'à être trouvées par le code — un point d'accroche
 * pour un écouteur, un sélecteur d'épreuve — et n'ont rien à habiller.
 */
const SANS_HABILLAGE = new Set([
  "js-open",
  "js-fav",
  "js-delta",
  "js-draft",
]);

function files(dir, ext, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "staged" || name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, ext, acc);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Les classes que déclarent les feuilles livrées. */
const styled = new Set();
for (const sheet of files(STYLES, ".css")) {
  for (const match of readFileSync(sheet, "utf8").matchAll(/\.(-?[a-zA-Z][\w-]*)/g)) {
    styled.add(match[1]);
  }
}

/**
 * Les classes que pose le balisage.
 *
 * Deux formes : l'attribut HTML `class="…"` des gabarits, et l'objet
 * `{ class: "…" }` que prend notre constructeur d'éléments. Les deux comptent.
 */
const used = new Map();
for (const file of files(WEB, ".ts")) {
  if (file.endsWith(".test.ts")) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const relative = path.relative(ROOT, file);

  const record = (value) => {
    for (const cls of value.split(/\s+/)) {
      // Les fragments assemblés à l'exécution — `chip-${kind}` — ne sont pas
      // jugeables ici ; `check-dead-css` porte déjà cette finesse.
      if (!cls || cls.includes("$") || cls.includes("{")) continue;
      if (!/^-?[a-zA-Z][\w-]*$/.test(cls)) continue;
      if (!used.has(cls)) used.set(cls, relative);
    }
  };

  for (const match of source.matchAll(/class="([^"$]*)"/g)) record(match[1]);
  for (const match of source.matchAll(/\bclass:\s*"([^"$]*)"/g)) record(match[1]);
}

const unstyled = [...used]
  .filter(([cls]) => !styled.has(cls) && !SANS_HABILLAGE.has(cls))
  .sort(([a], [b]) => a.localeCompare(b));

if (unstyled.length === 0) {
  console.log(`✓ ${used.size} classes posées, toutes habillées`);
  process.exit(0);
}

console.log(`${unstyled.length} classes posées sans aucune règle :\n`);
for (const [cls, file] of unstyled) {
  console.log(`    .${cls.padEnd(24)} ${file}`);
}
console.log(
  "\n  Un écran sans habillage ne lève rien : il s'affiche, simplement laid." +
    "\n  Soit la règle manque, soit la classe n'a pas lieu d'être posée.",
);
process.exit(1);
