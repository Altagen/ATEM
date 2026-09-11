import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * Les decks — la liste et l'atelier.
 *
 * Ce qui compte ici : l'écran refuse **avec la même règle** que le serveur.
 * ATEM-old avait le bon calcul et ne s'en servait que pour griser un bouton ;
 * une requête forgée passait. Les deux côtés appellent maintenant `checkDeckAdd`.
 */

/** Ajoute des cartes à la collection, pour avoir de quoi piocher. */
async function garnir(page: import("@playwright/test").Page, codes: string[]) {
  for (const code of codes) {
    await page.getByLabel(/Ajouter par set code/).fill(code);
    await page.getByRole("button", { name: /Ajouter la carte/ }).click();
    await page.waitForTimeout(450);
  }
}

async function nouveauDeck(page: import("@playwright/test").Page, nom: string) {
  await page.goto("/decks");
  page.once("dialog", (d) => d.accept(nom));
  await page.getByRole("button", { name: "Nouveau deck" }).click();
  await expect(page.getByRole("heading", { name: nom })).toBeVisible();
}

/** Sur téléphone, les deux panneaux se relaient : on choisit lequel on regarde. */
async function panneau(page: import("@playwright/test").Page, lequel: "Votre collection" | "Le deck") {
  const bascule = page.locator(".deck-panel-switch");
  if (await bascule.isVisible()) await bascule.getByRole("button", { name: lequel }).click();
}

test("on crée un deck et on y pose une carte de sa collection", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LTGY-FR008"]);
  await nouveauDeck(page, "Premier deck");

  await panneau(page, "Votre collection");
  await page.locator(".js-add").first().click();
  await page.waitForTimeout(500);

  await panneau(page, "Le deck");
  await expect(page.locator(".zone-edit-row")).toHaveCount(1);
  await expect(page.locator(".deck-stepper-qty")).toHaveText("×1");
  // L'onglet Main porte le compte.
  await expect(page.locator("[data-zone='main']")).toContainText("1");
});

test("le « + » se grise quand on a tout mis", async ({ page }) => {
  /**
   * Le plafond est `min(3, possédés)` : deux exemplaires possédés, deux au
   * deck, et le bouton ne propose plus rien. C'est la même fonction qui grise
   * ici et qui refuse côté serveur.
   */
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LTGY-FR008"]);
  await nouveauDeck(page, "Plafond");

  await panneau(page, "Votre collection");
  const ajouter = page.locator(".js-add").first();
  await ajouter.click();
  await page.waitForTimeout(450);
  await ajouter.click();
  await page.waitForTimeout(450);

  await expect(page.locator(".js-add").first()).toBeDisabled();
});

test("le deck se dit incomplet tant qu'il n'est pas jouable", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Incomplet");
  await panneau(page, "Votre collection");
  await page.locator(".js-add").first().click();
  await page.waitForTimeout(500);

  await page.goto("/decks");
  await expect(page.locator(".deck-unready")).toBeVisible();
  await expect(page.locator(".deck-ready")).toHaveCount(0);
});

test("retirer la dernière carte vide la zone", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "À vider");
  await panneau(page, "Votre collection");
  await page.locator(".js-add").first().click();
  await page.waitForTimeout(500);

  await panneau(page, "Le deck");
  await page.locator(".js-zone[data-d='-1']").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator(".zone-edit-row")).toHaveCount(0);
  await expect(page.locator(".zone-edit-empty")).toBeVisible();
});

test("jeter un deck ne touche pas à la collection", async ({ page }) => {
  // Un deck est une intention, pas une possession.
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Sans effet");
  await panneau(page, "Votre collection");
  await page.locator(".js-add").first().click();
  await page.waitForTimeout(500);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Jeter ce deck" }).click();
  await expect(page.getByRole("heading", { name: "Mes decks" })).toBeVisible();

  await page.goto("/collection");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();
});

test("l'atelier ne déborde pas", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LOB-FR001"]);
  await nouveauDeck(page, "Largeur");
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("sur téléphone, les deux panneaux se relaient", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "règle propre au téléphone");
  /**
   * Empiler la collection et les zones obligerait à traverser quarante cartes
   * pour atteindre son deck. Au-delà de 900 px les deux tiennent côte à côte,
   * et la bascule disparaît.
   */
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Bascule");

  await expect(page.locator(".deck-edit-collection")).toBeVisible();
  await expect(page.locator(".deck-edit-zones")).toBeHidden();

  await page.locator(".deck-panel-switch").getByRole("button", { name: "Le deck" }).click();
  await expect(page.locator(".deck-edit-zones")).toBeVisible();
  await expect(page.locator(".deck-edit-collection")).toBeHidden();
});

test("sur écran large, les deux panneaux tiennent ensemble", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "règle propre à l'écran large");
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Côte à côte");

  await expect(page.locator(".deck-panel-switch")).toBeHidden();
  const collection = (await page.locator(".deck-edit-collection").boundingBox())!;
  const zones = (await page.locator(".deck-edit-zones").boundingBox())!;
  expect(collection.x + collection.width, "la collection est à gauche").toBeLessThanOrEqual(zones.x + 1);
});
