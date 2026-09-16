import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const certFile = path.join(rootDir, ".certs/dev-cert.pem");
const keyFile = path.join(rootDir, ".certs/dev-key.pem");

/**
 * HTTPS in development, when a certificate is there.
 *
 * `getUserMedia` — so scanning — only exists in a secure context. The browser
 * makes an exception for `localhost`, but **not** for the network address:
 * trying the scanner from a phone on the local network, over HTTP, ends in a
 * camera refusal that nothing on screen explains.
 *
 * And that is precisely where it must be tried: scanning happens on a phone, a
 * pile of cards in the other hand.
 *
 * `./scripts/dev-cert.sh` makes the certificate; without it, we fall back to
 * HTTP and everything works except the camera outside `localhost`.
 */
const https =
  fs.existsSync(certFile) && fs.existsSync(keyFile)
    ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
    : undefined;

/**
 * The very policy nginx serves, read from `deploy/security-headers.conf`.
 *
 * Development runs under production's policy, so the end-to-end tests exercise
 * it: a CSP only fails in a browser, silently, and a policy nobody runs under
 * is a policy that breaks a screen on the day it ships.
 *
 * One directive is relaxed here, and only here: in development Vite injects
 * stylesheets as inline `<style>` elements, which `style-src 'self'` refuses.
 * The built front carries no inline style — `scripts/check-csp.mjs` fails if a
 * `style="…"` attribute ever appears — so production keeps the strict form.
 */
function securityHeaders(): Record<string, string> {
  const conf = fs.readFileSync(path.join(rootDir, "../../deploy/security-headers.conf"), "utf8");
  const headers: Record<string, string> = {};
  for (const line of conf.split("\n")) {
    const match = /^\s*add_header\s+([\w-]+)\s+"([^"]*)"/.exec(line);
    if (match?.[1] && match[2] !== undefined) headers[match[1]] = match[2];
  }
  const policy = headers["Content-Security-Policy"];
  if (policy) {
    headers["Content-Security-Policy"] = policy.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
  }
  return headers;
}

/**
 * Where the API listens, according to the same file the API itself reads.
 *
 * `.env` sets `ATEM_PORT`, and the API is started with `--env-file`. Vite is
 * not: its configuration only sees the shell's environment, so the proxy used
 * to point at a hard-coded 3000 while the API listened on 3010. `pnpm dev` then
 * served a front that could not sign anyone in, with nothing on screen saying
 * why — the request simply reached no one.
 *
 * So the same file decides for both. `ATEM_API_ORIGIN` still wins, for the case
 * the proxy exists for: another instance already holding the port.
 */
function apiOrigin(): string {
  if (process.env.ATEM_API_ORIGIN) return process.env.ATEM_API_ORIGIN;
  let port = process.env.ATEM_PORT;
  if (!port) {
    try {
      const env = fs.readFileSync(path.join(rootDir, "../../.env"), "utf8");
      port = /^\s*ATEM_PORT\s*=\s*(\d+)/m.exec(env)?.[1];
    } catch {
      // No `.env` at all is the normal case in CI: the default below holds.
    }
  }
  return `http://127.0.0.1:${port ?? 3000}`;
}

export default defineConfig({
  build: {
    /**
     * Vite's default target is older than the language we write, and the build
     * fails on `??=` combined with destructuring. ES2022 covers Safari 15.4
     * (March 2022) and Chrome 94 — well beyond the mobile fleet we care about,
     * and scanning needs a recent browser to reach the camera anyway.
     */
    target: "es2022",
  },
  server: {
    port: 5173,
    https,
    headers: securityHeaders(),
    proxy: {
      "/api": {
        // The target is configurable: several instances can live on the same
        // machine, and nothing is more confusing than a front silently talking
        // to another project's API.
        target: apiOrigin(),
        // `changeOrigin` stays false: the server reads the origin for the CSRF
        // guard, and rewriting it would make every write fail in development.
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // Card images, served by the API from its own disk (`referential/media.ts`).
      // Same target; no rewrite, the API mounts them on `/media` itself.
      "/media": {
        target: apiOrigin(),
        changeOrigin: false,
      },
    },
  },
});
