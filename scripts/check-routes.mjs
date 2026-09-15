/**
 * Every served route must be reached by something.
 *
 * A route nobody calls is surface exposed for nothing: it authenticates, it
 * reads the database, it ages — and the day it has a defect, nobody notices
 * since nobody uses it.
 *
 * “Reached” means: called by the front, or exercised by a test. Both count, for
 * different reasons — one proves it is useful, the other that it works. A route
 * with neither has no reason to be deployed.
 *
 * ATEM-old had the reverse check (routes declared but never mounted) and was
 * caught out by a detail handled here: **a route quoted in a comment counted as
 * reached**. Comments call nothing.
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

/** The mount prefixes, read from `app.ts`: `app.route("/auth", …)`. */
const appSource = stripComments(readFileSync(path.join(API, "app.ts"), "utf8"));
const mounts = new Map();
for (const match of appSource.matchAll(/app\.route\(\s*["']([^"']+)["']\s*,\s*(\w+)\(/g)) {
  mounts.set(match[2], match[1]);
}

/** The routes declared in each module, with their method. */
const METHOD_RE = /app\.(get|post|patch|put|delete)\(\s*["']([^"']+)["']/g;
const routes = [];

// Routes served directly by `app.ts` (health, etc.).
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
      path: `${path.relative(ROOT, file)} (never mounted)`,
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

/** What the front requests, and what the tests exercise. */
const webCalls = files(WEB)
  .map((f) => stripComments(readFileSync(f, "utf8")))
  .join("\n");
const testCalls = files(API)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => stripComments(readFileSync(f, "utf8")))
  .join("\n");

/**
 * A route is reached if its path, parameters replaced by a wildcard, appears in
 * a call. `/collection/:id/favorite` matches `` `/collection/${id}/favorite` ``
 * as well as `"/collection/12/favorite"`.
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
  console.log(`✓ ${routes.length} routes, all reached`);
  process.exit(0);
}

if (unmounted.length > 0) {
  console.log(`${unmounted.length} route files never mounted:\n`);
  for (const route of unmounted) console.log(`    ${route.path}`);
}

if (unreached.length > 0) {
  console.log(`\n${unreached.length} routes nothing reaches:\n`);
  for (const route of unreached) {
    console.log(`    ${route.method.padEnd(6)} ${route.path.padEnd(34)} ${route.source}`);
  }
  console.log(
    "\n  A route with no caller and no test has no reason to be served:" +
      "\n  either the front uses it, or a test covers it, or it goes.",
  );
}
process.exit(1);
