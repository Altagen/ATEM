import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const certFile = path.join(rootDir, ".certs/dev-cert.pem");
const keyFile = path.join(rootDir, ".certs/dev-key.pem");

/**
 * HTTPS en développement, quand un certificat est là.
 *
 * `getUserMedia` — donc le scan — n'existe que dans un contexte sécurisé. Le
 * navigateur fait une exception pour `localhost`, mais **pas** pour l'adresse
 * réseau : essayer le scanner depuis un téléphone sur le réseau local, en
 * HTTP, se solde par un refus de caméra que rien n'explique à l'écran.
 *
 * Or c'est précisément là qu'il faut l'essayer : le scan se fait au téléphone,
 * une pile de cartes dans l'autre main.
 *
 * `./scripts/dev-cert.sh` fabrique le certificat ; sans lui, on repart en HTTP
 * et tout fonctionne sauf la caméra hors de `localhost`.
 */
const https =
  fs.existsSync(certFile) && fs.existsSync(keyFile)
    ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
    : undefined;

export default defineConfig({
  build: {
    /**
     * La cible par défaut de Vite est plus ancienne que le langage qu'on écrit,
     * et le build échoue sur `??=` combiné à une déstructuration. ES2022 couvre
     * Safari 15.4 (mars 2022) et Chrome 94 — largement au-delà du parc mobile
     * qui nous intéresse, et le scan a de toute façon besoin d'un navigateur
     * récent pour accéder à la caméra.
     */
    target: "es2022",
  },
  server: {
    port: 5173,
    https,
    proxy: {
      "/api": {
        // La cible est configurable : plusieurs instances peuvent cohabiter sur
        // la même machine, et rien n'est plus déroutant qu'un front qui parle
        // sans le dire à l'API d'un autre projet.
        target: process.env.ATEM_API_ORIGIN ?? "http://127.0.0.1:3000",
        // `changeOrigin` reste à false : le serveur lit l'origine pour la garde
        // CSRF, et la réécrire ferait échouer toute écriture en développement.
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
