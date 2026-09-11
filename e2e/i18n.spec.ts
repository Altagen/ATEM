import { expect, test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

/**
 * La langue de l'interface.
 *
 * Elle vit sur le compte, pas dans le navigateur : c'est un réglage qu'on
 * choisit une fois et qu'on retrouve d'un appareil à l'autre. Ces épreuves
 * vérifient ce qu'aucune barrière ne peut voir — que la bascule atteint
 * réellement l'écran, jusqu'aux messages que renvoie le serveur.
 */

/**
 * Le sélecteur existe à deux endroits — la barre du haut et la feuille de
 * compte — et un seul est visible à la fois. Sur téléphone, il faut ouvrir la
 * feuille pour l'atteindre, puis la refermer.
 */
const basculer = async (page: import("@playwright/test").Page, code: "FR" | "EN") => {
  const surTéléphone = await page.locator(".global-mobile-bottom-nav").isVisible();
  if (surTéléphone) await page.getByRole("button", { name: /Mon compte|My account/ }).click();

  const groupe = surTéléphone ? "#account-sheet" : ".app-bar";
  await page.locator(`${groupe} .lang-switch-item`, { hasText: code }).click();
  await expect(page.locator(`${groupe} .lang-switch-item.is-active`)).toHaveText(code);

  /**
   * Sur téléphone, la feuille se referme d'elle-même : le changement de langue
   * reconstruit toute la navigation, et `renderNavigation` referme la feuille
   * avant de la réécrire. On le vérifie plutôt que de cliquer dans le vide.
   */
  if (surTéléphone) await expect(page.locator("#account-sheet")).toBeHidden();
};

test("la collection bascule en anglais, et y reste", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();

  await basculer(page, "EN");
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
  await expect(page.getByPlaceholder("Search for a card…")).toBeVisible();
  await expect(page.getByText("No cards")).toBeVisible();

  // Le choix est porté par le compte : il survit à un rechargement complet.
  await page.reload();
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
  await expect(page.locator(".app-bar .lang-switch-item.is-active, #account-sheet .lang-switch-item.is-active").first()).toHaveText("EN");
});

test("les scanlistes aussi", async ({ page }) => {
  await signUp(page);
  await basculer(page, "EN");

  await page.locator(".tools-bar .scanlist-link").click();
  await expect(page.getByRole("heading", { name: "Scanlists" })).toBeVisible();
  await page.getByRole("button", { name: "New batch" }).click();
  await expect(page.getByText("Batch in progress")).toBeVisible();
  await expect(page.getByText("Nothing yet. Scan a card, or type its code.")).toBeVisible();
});

test("le vocabulaire Yu-Gi-Oh! reprend sa forme d'origine", async ({ page }) => {
  /**
   * L'API rend `Fish`, `WATER`, `Effect Monster` : en anglais, il n'y a rien à
   * traduire — la valeur brute **est** l'anglais. Ce vocabulaire n'a donc pas
   * sa place dans le dictionnaire général : « Poisson » n'est pas une phrase
   * d'interface, c'est le nom français d'une valeur du catalogue.
   */
  await signUp(page);
  await addBySetCode(page, "LTGY-FR008");
  await page.locator(".item-main").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();
  await expect(page.locator(".inspect-info-body")).toContainText("Poisson");

  await page.locator("#inspect-close").click();
  await basculer(page, "EN");
  await page.locator(".item-main").first().click();
  await expect(page.locator(".inspect-info-body")).toContainText("Fish");
  await expect(page.locator(".inspect-info-body")).not.toContainText("Poisson");
});

test("les messages du serveur sont traduits eux aussi", async ({ page }) => {
  /**
   * L'API répond en français. Traduire le front sans elle laisserait un écran
   * anglais dont les erreurs parlent français — et ce sont justement les
   * moments où l'on a besoin de comprendre.
   */
  await signUp(page);
  await basculer(page, "EN");

  // Une adresse déjà prise : le serveur refuse, en français, et l'écran traduit.
  const compte = await page.evaluate(async () => {
    const réponse = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Un corps valide pour Zod, refusé par la règle de force : c'est le
      // message du service qu'on veut voir, pas celui du schéma.
      body: JSON.stringify({
        email: `faible-${Date.now()}@exemple.test`,
        password: "trop-court",
        displayName: "Testeur",
      }),
    });
    return (await réponse.json()) as { message?: string };
  });
  // Le serveur parle bien français : c'est le front qui traduit.
  expect(compte.message).toContain("mot de passe");

  await page.locator(".tools-bar .scanlist-link").click();
  await page.getByRole("button", { name: "New batch" }).click();
  await page.getByRole("button", { name: "Save the batch" }).click();
  await expect(page.getByText("Give the batch a name.")).toBeVisible();
});

test("revenir au français rend tout le français", async ({ page }) => {
  await signUp(page);
  await basculer(page, "EN");
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();

  await basculer(page, "FR");
  await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher une carte…")).toBeVisible();
});
