/**
 * Toute route servie doit être atteinte par quelque chose.
 *
 * Une route que personne n'appelle est une surface exposée pour rien : elle
 * s'authentifie, elle lit la base, elle vieillit — et le jour où elle a un
 * défaut, personne ne s'en aperçoit puisque personne ne l'emprunte.
 *
 * « Atteinte » veut dire : appelée par le front, ou exercée par un test. Les
 * deux comptent, et pour des raisons différentes — l'une prouve qu'elle sert,
 * l'autre qu'elle marche. Une route qui n'a ni l'un ni l'autre n'a pas de
 * raison d'être déployée.
 *
 * ATEM-old avait le contrôle inverse (des routes déclarées jamais montées) et
 * s'était fait avoir par un détail qu'on reprend ici : **une route citée dans
 * un commentaire passait pour atteinte**. Les commentaires n'appellent rien.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "apps/api/src");
const WEB = path.join(ROOT, "apps/web/src");

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "staged") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Les préfixes de montage, lus dans `app.ts` : `app.route("/auth", …)`. */
const appSource = stripComments(readFileSync(path.join(API, "app.ts"), "utf8"));
const mounts = new Map();
for (const match of appSource.matchAll(/app\.route\(\s*["']([^"']+)["']\s*,\s*(\w+)\(/g)) {
  mounts.set(match[2], match[1]);
}

/** Les routes déclarées dans chaque module, avec leur méthode. */
const METHOD_RE = /app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g;
const routes = [];

// Les routes servies directement par `app.ts` (santé, etc.).
for (const match of appSource.matchAll(METHOD_RE)) {
  routes.push({ method: match[1].toUpperCase(), path: match[2], source: "app.ts" });
}

for (const file of files(API)) {
  if (!file.endsWith("routes.ts")) continue;
  const source = stripComments(readFileSync(file, "utf8"));
  const factory = /export function (\w+)\(/.exec(source)?.[1];
  const prefix = factory ? (mounts.get(factory) ?? "") : "";
  if (factory && !mounts.has(factory)) {
    routes.push({
      method: "—",
      path: `${path.relative(ROOT, file)} (jamais monté)`,
      source: path.relative(ROOT, file),
      unmounted: true,
    });
    continue;
  }
  for (const match of source.matchAll(METHOD_RE)) {
    const suffix = match[2] === "/" ? "" : match[2];
    routes.push({
      method: match[1].toUpperCase(),
      path: `${prefix}${suffix}`,
      source: path.relative(ROOT, file),
    });
  }
}

/** Ce que le front demande, et ce que les tests exercent. */
const webCalls = files(WEB)
  .map((f) => stripComments(readFileSync(f, "utf8")))
  .join("\n");
const testCalls = files(API)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => stripComments(readFileSync(f, "utf8")))
  .join("\n");

/**
 * Une route est atteinte si son chemin, paramètres remplacés par un joker,
 * apparaît dans un appel. `/collection/:id/favorite` correspond à
 * `` `/collection/${id}/favorite` `` comme à `"/collection/12/favorite"`.
 */
function reaches(source, routePath) {
  const pattern = routePath
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? "[^/\"'`]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(pattern.replace(/\[\^\/"'`\]\+/g, "(?:\\$\\{[^}]*\\}|[^/\"'`]+)")).test(source);
}

const unreached = [];
const unmounted = routes.filter((r) => r.unmounted);

for (const route of routes) {
  if (route.unmounted) continue;
  const byWeb = reaches(webCalls, route.path);
  const byTest = reaches(testCalls, route.path);
  if (!byWeb && !byTest) unreached.push(route);
}

if (unreached.length === 0 && unmounted.length === 0) {
  console.log(`✓ ${routes.length} routes, toutes atteintes`);
  process.exit(0);
}

if (unmounted.length > 0) {
  console.log(`${unmounted.length} fichiers de routes jamais montés :\n`);
  for (const route of unmounted) console.log(`    ${route.path}`);
}

if (unreached.length > 0) {
  console.log(`\n${unreached.length} routes que rien n'atteint :\n`);
  for (const route of unreached) {
    console.log(`    ${route.method.padEnd(6)} ${route.path.padEnd(34)} ${route.source}`);
  }
  console.log(
    "\n  Une route sans appelant ni test n'a pas de raison d'être servie :" +
      "\n  soit le front doit s'en servir, soit un test doit la couvrir, soit elle part.",
  );
}
process.exit(1);
