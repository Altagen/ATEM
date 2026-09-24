/**
 * Every variable compose.yaml reads is written out in .env.example.
 *
 * `compose.yaml` names its tunables as `${VAR:-default}`. Docker expands that;
 * podman-compose 1.3.0 does not and passes the text through verbatim. ATEM
 * 0.1.0 therefore reached a Debian instance with a literal
 * `${ATEM_TRUSTED_PROXIES:-10.89.42.0/24}`, which is not an address: the API
 * trusted no proxy, and every visitor shared one rate-limit bucket — silently
 * (2026-09-23).
 *
 * The fix is that .env.example defines them all, so the expansion never has to
 * happen. This gate keeps it that way: a tunable added to compose.yaml and
 * forgotten here would bring the silence back.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const compose = readFileSync(path.join(ROOT, "compose.yaml"), "utf8");
const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");

/** Set by the operator, not by compose: required values, and compose's own. */
const REQUIRED_OR_COMPOSE_ONLY = new Set([
  "JWT_SECRET",
  "POSTGRES_PASSWORD",
  "ATEM_ADMIN_EMAIL",
  "ATEM_ADMIN_PASSWORD",
  // These shape compose itself — the image tag and the published ports — and
  // have no meaning inside a container.
  "ATEM_VERSION",
  "ATEM_PUBLIC_PORT",
  "ATEM_DB_PORT",
  // Named in compose with a default that is the deployment's own value.
  "ATEM_ADMIN_NAME",
]);

const named = new Set(
  [...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::[-?][^}]*)?\}/g)].map((match) => match[1]),
);
const defined = new Set(
  [...example.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]),
);

const missing = [...named]
  .filter((name) => !REQUIRED_OR_COMPOSE_ONLY.has(name))
  .filter((name) => !defined.has(name))
  .sort();

if (missing.length > 0) {
  console.error(
    "✗ compose.yaml reads these variables, .env.example does not define them:\n" +
      missing.map((name) => `    ${name}`).join("\n") +
      "\n  Write them out with their default — a compose that does not expand " +
      "${VAR:-default} would pass the text through.",
  );
  process.exit(1);
}

console.log(`✓ .env.example defines the ${named.size - REQUIRED_OR_COMPOSE_ONLY.size} tunable(s) compose.yaml reads`);
