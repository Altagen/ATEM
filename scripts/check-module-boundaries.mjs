/**
 * Un module ne touche jamais les fichiers internes d'un autre.
 *
 * C'est la règle R1 de `docs/05-structure.md`, et elle n'existe pas pour la
 * beauté du geste : chez ATEM-old, `collection` et `decks` écrivaient
 * directement dans les tables du catalogue. Il en est sorti **trois
 * implémentations concurrentes** de « carte pas encore résolue », chacune
 * ignorant les deux autres, et un passcode négatif dont le signe portait un
 * sens métier recopié à la main dans quatre fichiers.
 *
 * La discipline seule ne l'avait pas empêché. Cette barrière, si.
 *
 * Ce qui est autorisé :
 *   - importer `../<autre>/index.js` — la porte d'entrée du module
 *   - importer `../../platform/…` et `../../db/…` — l'infrastructure partagée
 *   - importer `@atem/shared`
 *   - à l'intérieur d'un module, tout
 *
 * Ce qui ne l'est pas : `../<autre>/service.js`, `../<autre>/schema.js`, ou
 * n'importe quel autre fichier interne.
 *
 * L'exception `db/schema.ts` est nommée : c'est l'agrégateur que drizzle-kit
 * lit, il réunit les schémas de tous les modules et ne contient rien d'autre.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODULES_DIR = path.join(ROOT, "apps/api/src/modules");

/** Fichiers autorisés à réunir les modules, par construction. */
const AGGREGATORS = new Set([path.join(ROOT, "apps/api/src/db/schema.ts")]);

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;

const violations = [];

for (const file of files(MODULES_DIR)) {
  if (AGGREGATORS.has(file)) continue;
  const owner = path.relative(MODULES_DIR, file).split(path.sep)[0];
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;

    const resolved = path.resolve(path.dirname(file), specifier);
    if (!resolved.startsWith(MODULES_DIR + path.sep)) continue;

    const target = path.relative(MODULES_DIR, resolved).split(path.sep);
    const targetModule = target[0];
    if (targetModule === owner) continue;

    const entry = target.slice(1).join("/");
    // `index.js` est la porte ; tout le reste est l'intérieur de la maison.
    if (entry === "index.js" || entry === "index.ts" || entry === "index") continue;

    /**
     * Un schéma peut référencer le schéma d'un autre module.
     *
     * Une clé étrangère est une relation **déclarée**, que la base fait
     * respecter — `owned_cards.print_id` doit pointer une impression réelle, et
     * Drizzle a besoin de l'objet table pour l'écrire. Ce n'est pas un
     * contournement : ça ne donne pas le droit d'interroger les tables de
     * l'autre module, seulement de s'y raccrocher.
     *
     * La distinction tient à ceci : un schéma qui en référence un autre dit
     * « ma ligne dépend de la sienne ». Un *service* qui lit le schéma d'un
     * autre dit « je sais comment ses tables sont faites » — et c'est ça qui a
     * produit trois logiques concurrentes chez ATEM-old.
     */
    const isSchemaToSchema =
      file.endsWith(`${path.sep}schema.ts`) && entry === "schema.js";
    if (isSchemaToSchema) continue;

    violations.push({
      file: path.relative(ROOT, file),
      owner,
      target: `${targetModule}/${entry}`,
    });
  }
}

/** Les tests ont le droit de regarder l'intérieur de leur propre module. */
const external = violations.filter((v) => !v.file.endsWith(".test.ts"));
const fromTests = violations.filter((v) => v.file.endsWith(".test.ts"));

if (external.length === 0) {
  const suffix = fromTests.length > 0 ? ` (${fromTests.length} depuis des tests, tolérés)` : "";
  console.log(`✓ frontières de modules respectées${suffix}`);
  process.exit(0);
}

console.log(`${external.length} franchissements de frontière :\n`);
for (const violation of external) {
  console.log(`    ${violation.file}`);
  console.log(`      → ${violation.target}  (le module « ${violation.owner} » entre chez un autre)`);
}
console.log(
  "\n  Un module s'adresse à un autre par son index.ts, jamais par ses fichiers." +
    "\n  Voir docs/05-structure.md, règle R1.",
);
process.exit(1);
