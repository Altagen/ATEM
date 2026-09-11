/**
 * Deux fichiers de test ne partagent pas un set code.
 *
 * Les épreuves d'API tournent toutes sur **la même base**, créée le temps d'une
 * exécution. Un set code est une identité : `upsertPrint("AAAA-FR001", …)` dans
 * un fichier réécrit l'impression qu'un autre fichier avait posée, et la
 * repointe vers une autre carte.
 *
 * Le défaut ne se voit pas là où il est commis. Un test tout neuf sur les decks
 * a fait tomber une épreuve de la collection écrite trois jours plus tôt, qui
 * attendait « Grande Baleine » et recevait « Carte 70000001 ». On cherche alors
 * la panne dans le module qu'on vient d'écrire, ou pire dans celui qui tombe.
 *
 * Chaque fichier prend donc son propre préfixe. Ce contrôle le vérifie.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "apps/api/src");

/**
 * Les codes venus du vrai catalogue, que plusieurs fichiers peuvent nommer.
 *
 * Ils ne sont pas fabriqués par une épreuve : les poser deux fois donne la même
 * impression, pointant la même carte. C'est l'inverse du défaut qu'on cherche.
 */
const REELS = new Set(["LTGY-FR008", "LOB-FR001", "LOB-EN001", "RA03-FR004", "RA03-EN004"]);

function tests(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) tests(full, acc);
    else if (full.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

/** La forme d'un set code : quatre lettres ou plus, un tiret, une fin. */
const SET_CODE = /"([A-Z]{2,6}-[A-Z]{0,2}\d{1,4}[A-Z]?)"/g;

const parCode = new Map();
for (const file of tests(API)) {
  const relative = path.relative(ROOT, file);
  for (const match of readFileSync(file, "utf8").matchAll(SET_CODE)) {
    const code = match[1];
    if (REELS.has(code)) continue;
    if (!parCode.has(code)) parCode.set(code, new Set());
    parCode.get(code).add(relative);
  }
}

const partagés = [...parCode]
  .filter(([, fichiers]) => fichiers.size > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (partagés.length === 0) {
  console.log(`✓ ${parCode.size} set codes d'épreuve, aucun partagé`);
  process.exit(0);
}

console.log(`${partagés.length} set codes employés par plusieurs fichiers :\n`);
for (const [code, fichiers] of partagés) {
  console.log(`    ${code.padEnd(14)} ${[...fichiers].join(", ")}`);
}
console.log(
  "\n  Les épreuves d'API partagent une base : le second écrase le premier," +
    "\n  et la panne tombe dans le fichier qui n'a rien fait." +
    "\n  Donnez à chaque fichier son propre préfixe.",
);
process.exit(1);
