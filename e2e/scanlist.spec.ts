import { expect, test } from "@playwright/test";
import { addBySetCode, expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * Les scanlistes — inventorier un lot sans le verser.
 *
 * L'épreuve qui compte est la première : le « −1 » d'un lot ne doit **jamais**
 * atteindre la collection, même quand la ligne est déjà à zéro et qu'on insiste.
 */

const ouvrirLot = async (page: import("@playwright/test").Page) => {
  await page.goto("/scanlistes");
  await page.getByRole("button", { name: "Nouveau lot" }).click();
};

const ajouter = async (page: import("@playwright/test").Page, code: string) => {
  await page.getByLabel("Ajouter par set code").fill(code);
  await page.getByRole("button", { name: "Ajouter au lot" }).click();
};

test("le « −1 » d'un lot ne retire rien de la collection", async ({ page }) => {
  await signUp(page);

  // Une carte bien réelle en collection, à un exemplaire.
  await addBySetCode(page, "LTGY-FR008");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();

  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");
  await ajouter(page, "LTGY-FR008");
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×2");

  // Trois « −1 » sur deux exemplaires : le plancher est zéro, et le troisième
  // ne doit surtout pas aller chercher dans la collection.
  const moins = page.locator(".scan-draft-li").getByRole("button", { name: /Retirer un exemplaire/ });
  await moins.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×1");
  await moins.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×0");
  await moins.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×0");

  // La collection est intacte : toujours une ligne, toujours un exemplaire.
  await page.goto("/collection");
  const ligne = page.locator(".content .item").first();
  await expect(ligne).toBeVisible();
  await expect(ligne.getByText("×1")).toBeVisible();
  await expect(page.locator(".meta-line span").first()).toContainText("1 ex.");
});

test("un lot enregistré n'entre pas en collection tant qu'on ne le verse pas", async ({ page }) => {
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LOB-FR001");
  await ajouter(page, "LOB-FR001");
  await page.getByLabel("Nom du lot").fill("Arrivage du soir");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();

  await expect(page.locator(".scan-list").getByText("Arrivage du soir")).toBeVisible();
  await expect(page.locator(".scan-state.is-pending").first()).toBeVisible();

  await page.goto("/collection");
  await expect(page.getByText("Aucune carte")).toBeVisible();
});

test("verser fait entrer le lot, une seule fois", async ({ page }) => {
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");
  await ajouter(page, "LTGY-FR008");
  await ajouter(page, "LTGY-FR008");
  await page.getByLabel("Nom du lot").fill("À verser");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();

  await page.getByRole("link", { name: /À verser/ }).click();
  await expect(page.getByRole("button", { name: "Verser dans la collection" })).toBeEnabled();
  await page.getByRole("button", { name: "Verser dans la collection" }).click();

  await expect(page.getByText(/Versée le/)).toBeVisible();
  // Le bouton est désactivé : verser deux fois doublerait la collection.
  await expect(page.getByRole("button", { name: "Verser dans la collection" })).toBeDisabled();

  await page.goto("/collection");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();
});

test("le lot en cours ne survit pas à un rechargement", async ({ page }) => {
  /**
   * Décision d'Ange : rien ne survit sans validation explicite. Pas de
   * `localStorage`, pas de demi-état qu'on retrouve trois jours plus tard sans
   * savoir ce qu'il contient. On rescanne.
   */
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");
  await expect(page.locator(".scan-draft-li")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".scan-draft-li")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nouveau lot" })).toBeVisible();
});

test("le lot en cours traverse une navigation interne", async ({ page }) => {
  // Aller vérifier une carte dans sa collection ne doit pas perdre la pile.
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");

  await page.locator("a[href='/collection']").first().dispatchEvent("click");
  await expect(page).toHaveURL(/\/collection/);
  await page.locator("a[href='/scanlistes']").first().dispatchEvent("click");

  await expect(page.locator(".scan-draft-li")).toHaveCount(1);
});

test("l'écran des scanlistes ne déborde pas", async ({ page }) => {
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("la barre du bas ne cache pas les actions du lot", async ({ page }) => {
  /**
   * Le panneau du lot se termine par « Enregistrer » — le geste qui décide si
   * la pile qu'on vient de compter survit. Le laisser sous la barre de
   * navigation le rendrait introuvable au moment exact où il compte.
   */
  await signUp(page);
  await ouvrirLot(page);
  await ajouter(page, "LTGY-FR008");

  // Le nom de la carte arrive après coup et repeint le panneau : on le laisse
  // se poser avant de mesurer, sinon on mesure un élément déjà remplacé.
  await expect(page.locator(".scan-draft-li")).toContainText("Grande Baleine");

  const bouton = page.getByRole("button", { name: "Enregistrer le lot" });
  await bouton.scrollIntoViewIfNeeded();
  const boîte = (await bouton.boundingBox())!;

  const barre = page.locator(".global-mobile-bottom-nav");
  if (await barre.isVisible()) {
    const nav = (await barre.boundingBox())!;
    expect(boîte.y + boîte.height, "le bouton doit rester au-dessus de la barre")
      .toBeLessThanOrEqual(nav.y + 1);
  }
  expect(boîte.width, "et rester au doigt").toBeGreaterThanOrEqual(44);
});

test("le champ de code et ses boutons tiennent sur une rangée", async ({ page }) => {
  // Le scanner détaché du champ qu'il remplit se lit comme un bouton orphelin.
  await signUp(page);
  await ouvrirLot(page);

  const champ = (await page.getByLabel("Ajouter par set code").boundingBox())!;
  const scan = (await page.getByRole("button", { name: "Scanner" }).boundingBox())!;
  const plus = (await page.getByRole("button", { name: "Ajouter au lot" }).boundingBox())!;

  for (const [nom, boîte] of [["Ajouter", plus], ["Scanner", scan]] as const) {
    expect(
      Math.abs(boîte.y + boîte.height / 2 - (champ.y + champ.height / 2)),
      `« ${nom} » doit rester sur la rangée du champ`,
    ).toBeLessThanOrEqual(4);
  }
});

test("les scanlistes se rejoignent depuis la collection, pas par un onglet", async ({ page }, info) => {
  /**
   * Un onglet de même rang que « Collection » laissait croire à deux
   * inventaires côte à côte. Une scanliste est une antichambre : on y range un
   * lot **avant** de décider s'il entre en collection. C'est la place qu'elle
   * avait dans ATEM-old, et elle porte cette lecture.
   */
  await signUp(page);
  const barre = info.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

  await expect(page.locator(barre).getByRole("link", { name: /Scanliste/ })).toHaveCount(0);

  const lien = page.locator(".tools-bar .scanlist-link");
  await expect(lien).toBeVisible();
  await lien.click();
  await expect(page).toHaveURL(/\/scanlistes/);
  await expect(page.getByRole("heading", { name: "Scanlistes" })).toBeVisible();
});

test("sur téléphone, le lien se réduit à son icône", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "règle propre au téléphone");

  await signUp(page);
  const libellé = page.locator(".scanlist-link-label");
  await expect(libellé).toHaveCount(1);
  // Masqué dans le balisage, pas rétréci : `font-size: 0` avalerait aussi
  // l'emoji, qui est justement ce qui reste.
  await expect(libellé).toBeHidden();

  // La rangée d'outils ne doit pas déborder pour autant.
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});
