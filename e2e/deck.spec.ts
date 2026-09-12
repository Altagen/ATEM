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
  await page.getByRole("button", { name: "Construire un deck" }).click();
  // Le nom vit dans un champ, pas dans un titre : c'est l'atelier d'ATEM-old,
  // où l'on renomme sans changer d'écran.
  await expect(page.locator("#edit-name")).toHaveValue(nom);
}

/** Sur téléphone, les deux panneaux se relaient : on choisit lequel on regarde. */
async function panneau(page: import("@playwright/test").Page, lequel: "Ma collection" | "Mon deck") {
  /**
   * On vise l'attribut, pas le rôle ni le nom.
   *
   * Ces boutons portent `role="tab"` — ce qui remplace leur rôle implicite, si
   * bien que `getByRole("button")` ne les trouve pas — et leur nom accessible
   * porte l'émoji et le compte : « 🃏 Mon deck 0 ». `data-panel` ne bouge pas.
   */
  const bascule = page.locator(".deck-panel-switch");
  if (!(await bascule.isVisible())) return;
  await bascule.locator(`[data-panel="${lequel === "Ma collection" ? "collection" : "zones"}"]`).click();
}

test("on crée un deck et on y pose une carte de sa collection", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LTGY-FR008"]);
  await nouveauDeck(page, "Premier deck");

  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await panneau(page, "Mon deck");
  await expect(page.locator(".zone-edit-row")).toHaveCount(1);
  await expect(page.locator(".zone-edit-row .deck-stepper-qty")).toHaveText("×1");
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

  await panneau(page, "Ma collection");
  const ajouter = page.locator(".js-coll[data-d='1']").first();
  await ajouter.click();
  await page.waitForTimeout(450);
  await ajouter.click();
  await page.waitForTimeout(450);

  await expect(page.locator(".js-coll[data-d='1']").first()).toBeDisabled();
});

test("le deck se dit incomplet tant qu'il n'est pas jouable", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Incomplet");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await page.goto("/decks");
  await expect(page.locator(".deck-unready")).toBeVisible();
  await expect(page.locator(".deck-ready")).toHaveCount(0);
});

test("retirer la dernière carte vide la zone", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "À vider");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await panneau(page, "Mon deck");
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
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  page.once("dialog", (d) => d.accept());
  await page.locator("#btn-delete").click();
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

  await page.locator('.deck-panel-switch [data-panel="zones"]').click();
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

test("les filtres de l'atelier trient la collection", async ({ page }) => {
  /**
   * Les mêmes catégories que l'écran Collection, plus « Extra » — qui n'y a pas
   * de sens et qui en a un ici : c'est la seule pile qu'on remplit à part.
   */
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "RA03-FR004"]);
  await nouveauDeck(page, "Filtres");
  await panneau(page, "Ma collection");

  const lignes = page.locator(".deck-edit-coll-list .item");
  await expect(lignes).toHaveCount(2);

  // Les deux sont des monstres : « Magie » ne doit rien laisser.
  await page.locator("[data-filter-kind='spell']").click();
  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(0);

  await page.locator("[data-filter-kind='']").click();
  await expect(lignes).toHaveCount(2);

  // L'attribut EAU les garde toutes les deux (Grande Baleine, Diva).
  await page.locator("[data-filter-attr='WATER']").click();
  await expect(lignes).toHaveCount(2);
  // Et TÉNÈBRES n'en garde aucune.
  await page.locator("[data-filter-attr='WATER']").click();
  await page.locator("[data-filter-attr='DARK']").click();
  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(0);
});

test("la galerie montre les mêmes cartes que la liste", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LOB-FR001"]);
  await nouveauDeck(page, "Galerie");
  await panneau(page, "Ma collection");

  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(2);
  await page.locator("[data-coll-view='gallery']").click();
  await expect(page.locator(".deck-edit-coll-list")).toHaveCount(0);
  await expect(page.locator(".deck-edit-gallery .deck-coll-tile")).toHaveCount(2);
});

test("le compteur de zones porte les limites", async ({ page }) => {
  // C'est la seule chose qu'on regarde en construisant : combien il en manque.
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Compteur");

  const compteur = page.locator(".deck-counts");
  await expect(compteur).toContainText("Main");
  await expect(compteur).toContainText("/60");
  await expect(compteur).toContainText("/15");
});

test("le nom se renomme sans changer d'écran", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "Avant");

  await page.locator("#edit-name").fill("Après");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator("#edit-name")).toHaveValue("Après");

  await page.goto("/decks");
  await expect(page.locator(".drive-name")).toHaveText("Après");
});

test("la recherche de la liste filtre sans toucher au réseau", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "Dragons");
  await page.goto("/decks");
  await nouveauDeck(page, "Sorciers");
  await page.goto("/decks");

  await expect(page.locator(".drive-row")).toHaveCount(2);
  await page.getByLabel("Rechercher un deck").fill("drag");
  await expect(page.locator(".drive-row")).toHaveCount(1);
  await expect(page.locator(".drive-name")).toHaveText("Dragons");
});

test("cliquer une carte de l'atelier l'ouvre en grand", async ({ page }) => {
  /**
   * Demandé par Ange : « quand je clique sur une carte depuis l'atelier, il
   * faudrait que ça zoome comme dans la collection ». C'est la même fiche —
   * même composant, mêmes classes. Ce qui change, c'est ce qu'on peut faire
   * depuis là : poser un exemplaire dans la zone active.
   */
  await signUp(page);
  await garnir(page, ["LOB-FR001"]);
  await nouveauDeck(page, "Fiche");
  await panneau(page, "Ma collection");

  await page.locator(".js-open-card").first().click();
  const fiche = page.locator("#inspect-panel");
  await expect(fiche).toBeVisible();
  await expect(fiche.locator(".inspect-art")).toBeVisible();
  await expect(fiche).toContainText("Dragon Blanc aux Yeux Bleus");
  // Les caractéristiques, comme dans la collection.
  await expect(fiche).toContainText("ATK / DEF");
  await expect(fiche).toContainText("Effet");
  // Et ce que la collection n'a pas : où en est la carte dans ce deck.
  await expect(fiche).toContainText("Zone active");
});

test("on pose une carte depuis sa fiche, sans la refermer", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LOB-FR001"]);
  await nouveauDeck(page, "Depuis la fiche");
  await panneau(page, "Ma collection");
  await page.locator(".js-open-card").first().click();

  const fiche = page.locator("#inspect-panel");
  await expect(fiche.locator(".in-deck-qty-label")).toHaveText("×0");
  await fiche.locator(".deck-open-btns .btn-primary").click();

  // La fiche reste ouverte et se met à jour : on enchaîne sans rouvrir.
  await expect(fiche).toBeVisible();
  await expect(fiche.locator(".in-deck-qty-label")).toHaveText("×1");
});

test("la fiche se referme au fond, à la croix et à Échap", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["LOB-FR001"]);
  await nouveauDeck(page, "Fermeture");
  await panneau(page, "Ma collection");

  const ouvrir = async () => {
    await page.locator(".js-open-card").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();
  };

  await ouvrir();
  await page.locator("#inspect-close").click();
  await expect(page.locator("#inspect-panel")).toHaveCount(0);

  await ouvrir();
  /**
   * `dispatchEvent` et non `click` : le panneau couvre le centre du fond, et
   * Playwright viserait donc le panneau. Ce qu'on éprouve ici c'est le
   * gestionnaire, pas la géométrie — la zone cliquable du fond est ce qui
   * dépasse autour, et elle se voit à l'œil.
   */
  await page.locator("#inspect-backdrop").dispatchEvent("click");
  await expect(page.locator("#inspect-panel")).toHaveCount(0);

  await ouvrir();
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspect-panel")).toHaveCount(0);
});

test("la fiche de l'atelier fige la page derrière elle", async ({ page }) => {
  /**
   * Même exigence que dans la collection : deux barres de défilement sur la
   * même page font croire qu'on descend dans la fiche alors que c'est l'atelier
   * qui bouge — et en refermant, on ne se retrouve plus où l'on était.
   */
  await signUp(page);
  await garnir(page, ["LOB-FR001", "LTGY-FR008", "RA03-FR004"]);
  await nouveauDeck(page, "Verrou");
  await panneau(page, "Ma collection");

  await page.locator(".js-open-card").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();
  // Le corps est fixé : c'est la technique qui tient aussi sur iOS Safari.
  expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");

  await page.locator("#inspect-close").click();
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
});
