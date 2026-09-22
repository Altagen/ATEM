/**
 * Does the content security policy tell the truth about the application?
 *
 * A policy decays in both directions, and both go unnoticed.
 *
 * Too narrow, it breaks a screen: the browser blocks silently as far as the
 * server is concerned, and the person sees a button that does nothing. No API
 * log shows it, because the request never left.
 *
 * Too wide, it protects nothing — and that is the direction it slides on its
 * own: a library is added, a directive is widened, nobody tightens it again.
 *
 * So this check compares the policy with what the code actually does, and makes
 * sure the policy that is written is the one both nginx and the development
 * server serve — the end-to-end tests run under it (`e2e/security.spec.ts`),
 * and a policy nobody runs under is one that breaks on the day it ships.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const POLICY_FILE = path.join(ROOT, "deploy/security-headers.conf");
const NGINX = path.join(ROOT, "deploy/nginx.conf");
const WEB_CONFIG = path.join(ROOT, "apps/web/vite.config.ts");
const CONTAINER = path.join(ROOT, "Containerfile.web");
const WEB = path.join(ROOT, "apps/web/src");

const faults = [];
const fault = (message) => faults.push(message);

const conf = readFileSync(POLICY_FILE, "utf8");
const line = conf
  .split("\n")
  .find((l) => l.trimStart().startsWith("add_header Content-Security-Policy"));
if (!line) {
  console.error(`✗ no policy in ${path.relative(ROOT, POLICY_FILE)}`);
  process.exit(1);
}
const policy = /"([^"]+)"/.exec(line)?.[1] ?? "";

const directives = new Map();
for (const piece of policy.split(";")) {
  const [name, ...values] = piece.trim().split(/\s+/);
  if (name) directives.set(name, values);
}

/** What must be said, and what must be refused by name. */
const REQUIRED = {
  "default-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
};
for (const [name, expected] of Object.entries(REQUIRED)) {
  const values = directives.get(name);
  if (!values) fault(`the “${name}” directive is missing`);
  else if (values.join(" ") !== expected.join(" ")) {
    fault(`“${name}” is “${values.join(" ")}”, expected “${expected.join(" ")}”`);
  }
}

/**
 * `'unsafe-inline'` on scripts cancels the whole policy: it is exactly what the
 * policy exists against. `'unsafe-eval'` is not needed — `'wasm-unsafe-eval'`
 * is what Tesseract compiles with.
 */
const scriptSrc = directives.get("script-src") ?? [];
if (scriptSrc.includes("'unsafe-inline'")) {
  fault("script-src accepts 'unsafe-inline': the policy no longer protects anything");
}
if (scriptSrc.includes("'unsafe-eval'")) {
  fault("script-src accepts 'unsafe-eval'; 'wasm-unsafe-eval' is enough for Tesseract");
}

// ---- What the application really loads --------------------------------------

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "staged" || name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, acc);
    else if (/\.(ts|css)$/.test(full) && !full.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

const sources = files(WEB).map((file) => ({ file, text: readFileSync(file, "utf8") }));

/**
 * An outside host has to be named — or, better, not be there at all.
 *
 * Card artworks were hot-linked from `images.ygoprodeck.com` until 2026-09-16,
 * which no policy limited to 'self' could have allowed. They are downloaded and
 * served by ATEM now; this is what keeps them that way.
 */
const declared = new Set();
for (const [, values] of directives) {
  for (const value of values) {
    const host = /^https:\/\/(.+)$/.exec(value)?.[1];
    if (host) declared.add(host.toLowerCase());
  }
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

for (const { file, text } of sources) {
  for (const match of stripComments(text).matchAll(/https:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) {
    const host = match[1].toLowerCase();
    if (!declared.has(host)) {
      fault(`${path.relative(ROOT, file)} loads ${host}, which the policy does not allow`);
    }
  }
}

/**
 * `style-src 'self'` and inline styles cannot both be true.
 *
 * The screens carry no `style="…"` attribute; that is what lets the policy stay
 * strict where the earlier prototype had to give up. The day one comes back, the browser
 * refuses it silently — so it is refused here instead.
 */
const inlineStyles = sources
  .filter(({ text }) => /\sstyle="/.test(stripComments(text)))
  .map(({ file }) => path.relative(ROOT, file));
const styleSrc = directives.get("style-src") ?? [];
if (!styleSrc.includes("'unsafe-inline'") && inlineStyles.length > 0) {
  fault(
    `style-src is strict, but an inline style attribute lives in: ${inlineStyles.join(", ")}`,
  );
}

// ---- The policy that is written is the one that is served -------------------

if (!readFileSync(NGINX, "utf8").includes("security-headers.conf")) {
  fault("deploy/nginx.conf does not include security-headers.conf: production serves no policy");
}
if (!readFileSync(WEB_CONFIG, "utf8").includes("security-headers.conf")) {
  fault("apps/web/vite.config.ts does not read security-headers.conf: development runs unprotected");
}
if (!readFileSync(CONTAINER, "utf8").includes("security-headers.conf")) {
  fault("Containerfile.web does not copy security-headers.conf: the image would serve no policy");
}

if (faults.length === 0) {
  console.log(`✓ content security policy consistent — ${directives.size} directives`);
  process.exit(0);
}

console.log(`${faults.length} problem(s) with the content security policy:\n`);
for (const message of faults) console.log(`    ${message}`);
console.log(
  "\n  A policy is only worth what the application really does." +
    "\n  deploy/security-headers.conf explains each directive.",
);
process.exit(1);
