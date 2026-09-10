import { defineConfig, devices } from "@playwright/test";

/**
 * Les épreuves de bout en bout.
 *
 * **Chaque test tourne sur les deux profils.** Valider le bureau puis découvrir
 * le mobile à l'intégration est exactement l'erreur qu'on ne refait pas : une
 * grille qui déborde, une cible tactile trop petite ou une modale qui sort de
 * l'écran ne se voient pas à 1440 px de large, et se corrigent bien plus cher
 * une fois l'écran considéré comme terminé.
 *
 * Le mobile compte double ici : le scan se fait au téléphone, une pile de
 * cartes dans l'autre main.
 */
const baseURL = process.env.ATEM_E2E_URL ?? "https://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  // Les épreuves partagent une instance : les lancer en parallèle ferait
  // dépendre leur résultat de leur ordre d'exécution.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL,
    // Le serveur de développement sert en HTTPS avec un certificat auto-signé,
    // sans quoi la caméra du scanner est refusée hors de `localhost`.
    ignoreHTTPSErrors: true,
    // La trace et la capture ne sont gardées qu'en cas d'échec : c'est le seul
    // moment où elles servent, et les garder toujours noie le diagnostic.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "bureau",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        // Le scan a besoin de la caméra. En épreuve, on l'accorde d'office :
        // la boîte de dialogue de permission n'est pas ce qu'on teste, et la
        // refuser bloquerait l'écran avant qu'on ait pu le regarder.
        permissions: ["camera"],
      },
    },
  ],
});
