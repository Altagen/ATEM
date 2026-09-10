/**
 * Aucun appel sortant ne doit échapper au seau à jetons.
 *
 * C'est la barrière qui manquait à ATEM-old, et elle lui a coûté une heure de
 * blocage : il limitait les appels d'API, mais les téléchargements d'images
 * partaient par un autre chemin, sans être comptés. Personne n'avait menti —
 * le limiteur existait, il ne voyait simplement pas tout le trafic.
 *
 * Un limiteur par type d'appel ne protège de rien. Ce qui protège, c'est qu'il
 * n'existe **aucun** moyen d'appeler `fetch` sans passer par
 * `withOutboundSlot`, et c'est ce que ce contrôle rend vrai.
 *
 * Il ne regarde que l'API : le front n'appelle que notre propre serveur, sur
 * son origine, et n'a rien à voir avec la limite de YGOPRODeck.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const AREAS = ["apps/api/src", "apps/api/scripts"];
const IGNORED_DIRS = new Set(["node_modules", "dist"]);

/** Le porteur du seau lui-même n'a personne au-dessus de lui. */
const EXEMPT = new Set(["apps/api/src/modules/referential/outbound-rate.ts"]);

/**
 * La fenêtre dans laquelle `withOutboundSlot(` doit apparaître avant `fetch(`.
 *
 * La forme imposée est `withOutboundSlot(() => fetch(…))` : quelques dizaines
 * de caractères séparent les deux, options de requête comprises. Assez large
 * pour la lisibilité, assez étroite pour qu'un `fetch` d'une autre fonction ne
 * puisse pas se réclamer d'un seau posé dix lignes plus haut.
 */
const WINDOW = 160;

function files(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (/\.m?ts$/.test(full)) acc.push(full);
  }
  return acc;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const offenders = [];

for (const file of AREAS.flatMap((area) => files(path.join(ROOT, area)))) {
  const relative = path.relative(ROOT, file);
  if (EXEMPT.has(relative)) continue;
  if (relative.endsWith(".test.ts")) continue;

  const source = stripComments(readFileSync(file, "utf8"));

  // `.fetch` est une méthode — celle de Hono, notamment — pas l'appel réseau.
  for (const match of source.matchAll(/(?<![.\w])fetch\s*\(/g)) {
    const before = source.slice(Math.max(0, match.index - WINDOW), match.index);
    if (before.includes("withOutboundSlot(")) continue;
    const line = source.slice(0, match.index).split("\n").length;
    offenders.push({ file: relative, line });
  }
}

if (offenders.length === 0) {
  console.log("✓ tout appel sortant passe par le seau à jetons");
  process.exit(0);
}

console.log(`${offenders.length} appel(s) sortant(s) hors du seau à jetons :\n`);
for (const entry of offenders) console.log(`    ${entry.file}:${entry.line}`);
console.log(
  "\n  Dépasser la limite de YGOPRODeck vaut une heure de blocage d'adresse," +
    "\n  pendant laquelle plus aucune carte ne s'identifie." +
    "\n  La forme attendue : withOutboundSlot(() => fetch(…)).",
);
process.exit(1);
