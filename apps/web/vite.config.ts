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
    proxy: {
      "/api": {
        // The target is configurable: several instances can live on the same
        // machine, and nothing is more confusing than a front silently talking
        // to another project's API.
        target: process.env.ATEM_API_ORIGIN ?? "http://127.0.0.1:3000",
        // `changeOrigin` stays false: the server reads the origin for the CSRF
        // guard, and rewriting it would make every write fail in development.
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
