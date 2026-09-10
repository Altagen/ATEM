/**
 * Les captures d'écran de revue.
 *
 * Ce n'est pas un test : rien n'y est asserté. C'est le moyen de **regarder**
 * ce qui a été construit, sur les deux profils, sans avoir à ouvrir un
 * navigateur à la main — et de le refaire à l'identique après chaque
 * changement, pour voir ce qui a bougé.
 *
 * Lancer : pnpm e2e:shots
 */
import { test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

const shot = (name: string, project: string) => `e2e/shots/${project}-${name}.png`;

/**
 * Les captures montrent la barre du bas deux fois.
 *
 * Vérifié plutôt que supposé : le DOM n'en contient qu'une, et couper le
 * `backdrop-filter` fait disparaître la seconde. C'est donc le flou
 * d'arrière-plan qui se compose mal dans une capture sans affichage — pas un
 * défaut de l'écran.
 *
 * Les captures au format réel restent plus fidèles pour juger d'une mise en
 * page : une capture pleine page étire ce qui est fixe.
 */
const viewport = { fullPage: false } as const;

test.describe("Captures de revue", () => {
  test("les écrans principaux", async ({ page }, testInfo) => {
    const profile = testInfo.project.name;
    test.setTimeout(90_000);

    await page.goto("/connexion");
    await page.screenshot({ path: shot("01-connexion", profile), fullPage: true });

    await page.goto("/inscription");
    await page.screenshot({ path: shot("02-inscription", profile), fullPage: true });

    await signUp(page);
    await page.screenshot({ path: shot("03-collection-vide", profile), ...viewport });

    for (const code of ["LTGY-FR008", "LOB-FR001", "SDK-001", "PSV-F088", "ZZZZ-FR999"]) {
      await addBySetCode(page, code);
    }
    await page.screenshot({ path: shot("04-collection", profile), fullPage: true });
    await page.getByRole("button", { name: "Vue galerie" }).click();
    await page.locator(".gallery").waitFor();
    await page.screenshot({ path: shot("04c-galerie", profile), ...viewport });
    await page.getByRole("button", { name: "Vue liste" }).click();
    await page.locator(".item-list").waitFor();
    await page.screenshot({ path: shot("04b-collection-ecran", profile), ...viewport });

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#filter-panel").waitFor();
    await page.screenshot({ path: shot("05-filtres", profile), fullPage: true });
    await page.getByRole("button", { name: "Fermer" }).first().click();

    // La collection s'ouvre en liste : c'est la ligne qu'on ouvre.
    await page.locator(".item-main").first().click();
    await page.locator("#inspect-panel").waitFor();
    await page.screenshot({ path: shot("06-fiche-carte", profile), fullPage: true });
    await page.keyboard.press("Escape");

    // L'écran Catalogue a été supprimé : il doublait une fonction que la
    // collection assure, et n'existait pas dans ATEM-old.
    await page.getByRole("button", { name: /Options/ }).click();
    await page.screenshot({ path: shot("07-ajout-avance", profile), ...viewport });
  });

  test("le scanner", async ({ page }, testInfo) => {
    const profile = testInfo.project.name;
    test.setTimeout(90_000);

    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();
    // La caméra n'existe pas dans un navigateur d'épreuve : l'écran doit rester
    // utilisable et proposer la saisie manuelle. C'est ce que la capture montre.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("08-scanner", profile), fullPage: true });
  });
});
