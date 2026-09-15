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
  await creerDeckIci(page, nom);
  // Le nom vit dans un champ, pas dans un titre : c'est l'atelier d'ATEM-old,
  // où l'on renomme sans changer d'écran.
  await expect(page.locator("#edit-name")).toHaveValue(nom);
}

/** La fenêtre de création, là où l'on se trouve. */
async function creerDeckIci(page: import("@playwright/test").Page, nom: string) {
  await page.getByRole("button", { name: "Construire un deck" }).click();
  await page.locator("#modal-name").fill(nom);
  await page.getByRole("button", { name: "Créer" }).click();
}

/** La fenêtre de création de dossier, à l'étage courant. */
async function creerDossier(page: import("@playwright/test").Page, nom: string) {
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
  await page.locator("#modal-name").fill(nom);
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator(".folder-name", { hasText: nom })).toBeVisible();
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

  // Jeter est un geste sur l'objet : il vit sur la fiche, pas dans l'atelier.
  await page.getByRole("link", { name: "← Fiche" }).click();
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

test("le nom s'écrit tout seul, sans bouton", async ({ page }) => {
  /**
   * Ange : « c'est bizarre comme UX de valider automatiquement les cartes mais
   * pas le nom… soit tu mets tout à jour soit tu mets rien à jour mais pas
   * juste la moitié ». On tape, on ne touche à rien, et c'est écrit.
   */
  await signUp(page);
  await nouveauDeck(page, "Avant");

  await page.locator("#edit-name").fill("Après");
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.getByRole("link", { name: "Tous les decks" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("Après");
});

test("l'atelier n'a aucun bouton d'enregistrement", async ({ page }) => {
  /**
   * Signalé trois fois par Ange, de trois façons. Le bouton ne répondait rien
   * quand le nom n'avait pas changé ; appelé « Enregistrer » à côté de cartes
   * qui s'écrivent au « ± », il faisait croire qu'elles attendaient ; et
   * renommé « Renommer », il laissait une moitié de l'écran à valider à la
   * main quand l'autre partait seule. Il n'y en a plus.
   */
  await signUp(page);
  await nouveauDeck(page, "Sans bouton");

  await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Renommer" })).toHaveCount(0);
});

test("l'atelier dit où en est le deck, pas seulement combien", async ({ page }) => {
  /**
   * Ange : « on est à 4/60, on peut mettre "Deck incomplet" ou ce genre de
   * choses ? ». Le compteur est un chiffre : il faut connaître la règle des
   * quarante cartes pour le lire. La phrase la porte, et dit le reste à faire.
   */
  await signUp(page);
  await garnir(page, ["SDCR-FR012"]);
  await nouveauDeck(page, "Verdict");

  // Un deck neuf : « encore 40 au Main » serait exact et inutile.
  await expect(page.locator(".deck-status")).toContainText("Deck vide");

  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();

  const état = page.locator(".deck-status");
  await expect(état).toContainText("Deck incomplet");
  // Le reste à faire, en cartes, pour qu'on n'ait pas à soustraire de tête.
  await expect(état).toContainText("encore 39");
  await expect(état).toHaveClass(/deck-status-short/);
});

test("le deck signale ce qu'il ne peut plus aligner", async ({ page }) => {
  /**
   * Le « + » refuse une carte qu'on ne possède pas, donc un deck est jouable
   * par construction — jusqu'à ce qu'on retire la carte de sa **collection**
   * après l'avoir posée. C'est le seul chemin vers un manque, et il ne doit pas
   * être silencieux.
   */
  await signUp(page);
  await garnir(page, ["SDCR-FR013"]);
  await nouveauDeck(page, "Manque");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  await page.goto("/collection");
  await page
    .locator(".item")
    .first()
    .getByRole("button", { name: "Retirer un exemplaire" })
    .click();
  await expect(page.locator(".item")).toHaveCount(0);

  await page.goto("/decks");
  await page.locator(".deck-tile").click();
  const état = page.locator(".deck-status");
  await expect(état).toContainText("à retrouver");
  await expect(état).toHaveClass(/deck-status-over/);
});

test("l'écran dit que les cartes sont enregistrées", async ({ page }) => {
  /**
   * C'est ce qui manquait : les cartes s'écrivent à chaque « ± », et rien ne le
   * disait. ATEM-old affichait « non enregistré » parce qu'il travaillait sur
   * un brouillon ; nous disons l'inverse, et brièvement.
   */
  await signUp(page);
  await garnir(page, ["LTGY-FR008"]);
  await nouveauDeck(page, "Marque");
  await panneau(page, "Ma collection");

  await expect(page.locator(".deck-saved")).toHaveCount(0);
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");
  // Puis la marque s'efface : permanente, elle deviendrait du décor.
  await expect(page.locator(".deck-saved")).toHaveCount(0, { timeout: 4000 });
});

test("les cartes posées survivent à un rechargement", async ({ page }) => {
  // La question qu'Ange se posait, et à laquelle l'écran ne répondait pas.
  await signUp(page);
  await garnir(page, ["LTGY-FR008", "LTGY-FR008"]);
  await nouveauDeck(page, "Persistance");
  await panneau(page, "Ma collection");

  const plus = page.locator(".js-coll[data-d='1']").first();
  await plus.click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await plus.click();
  await expect(page.locator(".deck-counts")).toContainText("Main 2");

  await panneau(page, "Mon deck");
  await page.locator(".js-zone[data-d='-1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  await page.reload();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
});

test("l'Entrée dans le champ de nom écrit sans attendre", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "Clavier");

  await page.locator("#edit-name").fill("Au clavier");
  await page.locator("#edit-name").press("Enter");
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("Au clavier");
});

test("quitter le champ écrit, sans attendre le délai de frappe", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "Au clic");

  await page.locator("#edit-name").fill("Ailleurs");
  await page.locator("#edit-name").blur();
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("Ailleurs");
});

test("un nom vidé n'écrase rien : le champ reprend celui du deck", async ({ page }) => {
  // Un deck a toujours un nom. Plutôt que d'envoyer une chaîne vide que le
  // serveur refuserait, le champ revient sur ses pas.
  await signUp(page);
  await nouveauDeck(page, "À vider");

  await page.locator("#edit-name").fill("   ");
  await page.locator("#edit-name").blur();
  await expect(page.locator(".toast")).toContainText("Donnez un nom");
  await expect(page.locator("#edit-name")).toHaveValue("À vider");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("À vider");
});

test("le champ de nom porte l'habillage de l'application", async ({ page }) => {
  /**
   * Signalé par Ange : « un fond gris qui dénote de l'UI ». La règle de
   * `.menu-field` ne visait que `select` ; un `input` dans le même bloc tombait
   * sur le gris par défaut du navigateur. ATEM-old avait le même travers, et le
   * transcrire fidèlement l'a rapporté avec.
   */
  await signUp(page);
  await nouveauDeck(page, "Habillage");

  const champ = page.locator("#edit-name");
  const fond = await champ.evaluate((n) => getComputedStyle(n).backgroundColor);
  // Le gris par défaut des navigateurs est clair ; le nôtre est sombre.
  const [r, g, b] = fond.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b, `fond du champ : ${fond}`).toBeLessThan(120);

  // Et il est encadré comme les autres champs, pas nu.
  const bordure = await champ.evaluate((n) => getComputedStyle(n).borderTopWidth);
  expect(bordure).not.toBe("0px");
});

test("un deck porte l'illustration de la carte qu'il joue le plus", async ({ page }) => {
  /**
   * Demandé par Ange avec les dossiers. Le serveur choisit la carte — la plus
   * jouée, son identité — et l'écran la pose. Ce qui compte ici : l'image
   * arrive vraiment, et ce n'est plus le dos de carte.
   */
  await signUp(page);
  await garnir(page, ["SDCR-FR016"]);
  await nouveauDeck(page, "Illustré");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  await page.getByRole("link", { name: "Tous les decks" }).click();
  const jaquette = page.locator(".deck-tile-cover");
  await expect(jaquette).toHaveJSProperty("tagName", "IMG");
  // Chargée, et non simplement demandée : une URL cassée passerait autrement.
  await expect(jaquette).toHaveJSProperty("complete", true);
  await expect(page.locator(".deck-cover-default")).toHaveCount(0);
});

test("un deck vide garde le dos de carte", async ({ page }) => {
  // Le seul cas où il n'y a rien à montrer.
  await signUp(page);
  await nouveauDeck(page, "Sans visage");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await expect(page.locator(".deck-cover-default")).toBeVisible();
  await expect(page.locator("img.deck-tile-cover")).toHaveCount(0);
});

test("la bascule rend les rangées, et la planche revient", async ({ page }) => {
  // La galerie par défaut ; la liste dès qu'on en a beaucoup.
  await signUp(page);
  await nouveauDeck(page, "Bascule");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await expect(page.locator(".deck-tiles")).toBeVisible();
  await page.locator('[data-list-view="list"]').click();
  await expect(page.locator(".drive-row")).toHaveCount(1);
  await expect(page.locator(".deck-tiles")).toHaveCount(0);

  await page.locator('[data-list-view="gallery"]').click();
  await expect(page.locator(".deck-tile")).toHaveCount(1);
});

test("la recherche de la liste filtre sans toucher au réseau", async ({ page }) => {
  /**
   * On revient à la liste par son lien, pas par un rechargement.
   *
   * Deux `goto` de plus par épreuve suffisaient à faire trébucher le serveur de
   * développement — `ERR_TOO_MANY_RETRIES`, par intermittence. Et c'est de
   * toute façon le geste réel : « Tous les decks » est là pour ça.
   */
  await signUp(page);
  await nouveauDeck(page, "Dragons");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await nouveauDeck(page, "Sorciers");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await expect(page.locator(".deck-tile")).toHaveCount(2);
  await page.getByLabel("Rechercher un deck").fill("drag");
  await expect(page.locator(".deck-tile")).toHaveCount(1);
  await expect(page.locator(".deck-tile-name")).toHaveText("Dragons");
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

/* ── Les dossiers ─────────────────────────────────────────────────────────
 * Repris d'ATEM-old : on navigue un étage à la fois, les dossiers d'abord, les
 * decks ensuite. Ce qui change, c'est le rangement au menu plutôt qu'au
 * glisser-déposer — viser une cible en maintenant le doigt ne se fait pas.
 */

test("on crée un dossier, on y descend, et l'on en remonte", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Meta");

  await page.locator(".folder-open", { hasText: "Meta" }).click();
  await expect(page.locator(".folder-path-step[aria-current='page']")).toHaveText("Meta");
  await expect(page.locator(".empty-title")).toHaveText("Dossier vide");

  // La case « .. » porte le nom de là où elle mène, pas seulement deux points.
  await page.locator(".folder-tile-parent .folder-open").click();
  await expect(page.locator(".folder-path-step[aria-current='page']")).toHaveText("Racine");
});

test("un deck naît dans le dossier où l'on se trouve", async ({ page }) => {
  // Créer puis déplacer ferait deux écritures et un clignotement.
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Rangement");
  await page.locator(".folder-open", { hasText: "Rangement" }).click();

  await creerDeckIci(page, "Né dedans");
  await expect(page.locator("#edit-name")).toHaveValue("Né dedans");

  await page.getByRole("link", { name: "Tous les decks" }).click();
  // La racine ne montre que le dossier ; le deck est à l'intérieur.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await page.locator(".folder-open", { hasText: "Rangement" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("Né dedans");
});

test("on range un deck dans un dossier depuis son menu", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "À ranger");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await creerDossier(page, "Boîte");

  await page.locator(".deck-tile-wrap .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  // On navigue : c'est l'écran courant qui désigne la destination.
  await expect(page.locator(".move-banner")).toContainText("À ranger");
  await page.locator(".folder-open", { hasText: "Boîte" }).click();
  await expect(page.locator(".move-banner")).toContainText("vers Boîte");
  await page.getByRole("button", { name: "Déplacer ici" }).click();

  // Le bandeau se referme, et le deck est là où l'on regardait.
  await expect(page.locator(".move-banner")).toHaveCount(0);
  await expect(page.locator(".deck-tile-name")).toHaveText("À ranger");

  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  // Il a quitté la racine, et se retrouve dans le dossier.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");
  await page.locator(".folder-open", { hasText: "Boîte" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("À ranger");
});

test("jeter un dossier fait remonter son contenu, sans rien perdre", async ({ page }) => {
  /**
   * La règle d'ATEM-old, et la bonne : un dossier est un rangement, pas un
   * propriétaire. Sa base disait pourtant l'inverse.
   */
  await signUp(page);
  await nouveauDeck(page, "Survivant");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await creerDossier(page, "Éphémère");

  await page.locator(".deck-tile-wrap .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  await page.locator(".folder-open", { hasText: "Éphémère" }).click();
  await page.getByRole("button", { name: "Déplacer ici" }).click();
  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");

  page.once("dialog", (d) => d.accept());
  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Supprimer" }).click();

  await expect(page.locator(".folder-tile")).toHaveCount(0);
  await expect(page.locator(".deck-tile-name")).toHaveText("Survivant");
});

test("un dossier se renomme depuis son menu", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Avant");

  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Renommer" }).click();
  await page.locator("#modal-name").fill("Après");
  await page.getByRole("button", { name: "Renommer" }).click();

  await expect(page.locator(".folder-name")).toHaveText("Après");
});

test("un dossier ne se dépose pas dans lui-même, et le bandeau dit pourquoi", async ({ page }) => {
  /**
   * L'écran refuse avec la phrase du serveur — `folderCanHost`, la même
   * fonction. Le bouton est grisé et non caché : un bouton qui disparaît
   * laisse croire que le mode s'est arrêté.
   */
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Seul");

  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();

  // À la racine, il y est déjà.
  await expect(page.getByRole("button", { name: "Déplacer ici" })).toBeDisabled();
  await expect(page.locator(".move-banner-why")).toHaveText("Déjà ici");

  // Dedans, c'est lui-même.
  await page.locator(".folder-open", { hasText: "Seul" }).click();
  await expect(page.getByRole("button", { name: "Déplacer ici" })).toBeDisabled();
  await expect(page.locator(".move-banner-why")).toContainText("dans lui-même");

  // Et l'on peut renoncer.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".move-banner")).toHaveCount(0);
});

test("en rangées, la pastille tient sa place", async ({ page }, info) => {
  /**
   * Signalé par Ange : « la petite pastille "Incomplet" est bizarre en desktop ».
   * `.drive-main` déclarait trois colonnes pour quatre enfants — la pastille
   * tombait donc sur une ligne implicite, seule, contre le bord gauche, à
   * gauche même de la jaquette. Et le lien n'ayant pas de `text-decoration`,
   * tout y était souligné.
   *
   * Les trois mesures sont prises en un seul passage : trois appels successifs
   * à `boundingBox()` peuvent enjamber une repeinture, et l'on comparerait
   * alors deux états différents.
   */
  await signUp(page);
  await nouveauDeck(page, "Mesuré");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator('[data-list-view="list"]').click();
  await expect(page.locator(".zone-pill")).toBeVisible();

  const mesures = await page.evaluate(() => {
    const rangée = document.querySelector<HTMLElement>(".drive-main[data-drag-deck]")!;
    const boîte = (sélecteur: string) => {
      const { top, bottom, left, right } = rangée.querySelector(sélecteur)!.getBoundingClientRect();
      return { top, bottom, left, right, milieu: (top + bottom) / 2 };
    };
    return {
      nom: boîte(".drive-name"),
      pastille: boîte(".zone-pill"),
      souligné: getComputedStyle(rangée).textDecorationLine,
    };
  });

  // Jamais à gauche du nom : c'était tout le défaut, sur les deux formats.
  expect(mesures.pastille.left).toBeGreaterThanOrEqual(mesures.nom.left - 1);
  expect(mesures.souligné).toBe("none");

  if (info.project.name === "bureau") {
    // Sur écran large, elle tient sur la ligne du deck, après les comptes.
    expect(Math.abs(mesures.pastille.milieu - mesures.nom.milieu)).toBeLessThan(6);
    expect(mesures.pastille.left).toBeGreaterThan(mesures.nom.right);
  } else {
    // Sur téléphone, la rangée s'empile volontairement : la pastille passe
    // dessous, alignée sur le nom.
    expect(mesures.pastille.top).toBeGreaterThan(mesures.nom.bottom - 1);
  }
});

test("on range un deck en le glissant sur un dossier", async ({ page }, info) => {
  /**
   * Demandé par Ange pour le bureau, où le geste est naturel — et qu'ATEM-old
   * avait. Sur un téléphone il n'existe pas : maintenir puis viser ne se fait
   * pas au pouce, et c'est le bandeau qui rend le même service.
   */
  test.skip(info.project.name === "mobile", "le glisser-déposer n'existe pas au doigt");

  await signUp(page);
  await nouveauDeck(page, "Glissé");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await creerDossier(page, "Cible");

  await page.locator(".deck-tile").dragTo(page.locator(".folder-tile"));

  await expect(page.locator(".deck-tile")).toHaveCount(0);
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");
  await page.locator(".folder-open", { hasText: "Cible" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("Glissé");
});

test("en rangées aussi, on glisse un deck sur un dossier", async ({ page }, info) => {
  /**
   * Signalé par Ange : « en mode liste ça ne fonctionne pas le drag and drop ? ».
   * Il avait raison — l'attribut n'avait pas été posé sur la rangée, et mes deux
   * épreuves de glissement regardaient toutes les deux la galerie. Une vue sans
   * épreuve est une vue qui casse en silence.
   */
  test.skip(info.project.name === "mobile", "le glisser-déposer n'existe pas au doigt");

  await signUp(page);
  await nouveauDeck(page, "En rangée");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await creerDossier(page, "Casier");
  await page.locator('[data-list-view="list"]').click();

  await page
    .locator(".drive-main[data-drag-deck]")
    .dragTo(page.locator("li[data-drop]").first());

  await expect(page.locator("[data-drag-deck]")).toHaveCount(0);
  await expect(page.locator(".drive-meta").first()).toHaveText("1 deck");
});

test("en rangées, un dossier se glisse dans un autre", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "le glisser-déposer n'existe pas au doigt");

  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Alpha");
  await creerDossier(page, "Bêta");
  await page.locator('[data-list-view="list"]').click();

  // Alpha vient en premier : on le glisse sur Bêta.
  await page
    .locator("[data-drag-folder]").first()
    .dragTo(page.locator("[data-drag-folder]").last());

  /**
   * La forme tableau, et non la chaîne : tant que le déplacement est en vol,
   * le sélecteur vise encore deux rangées — `toHaveText("Bêta")` lève alors une
   * erreur de mode strict *sans réessayer*, et l'épreuve échoue pour une raison
   * qui n'est pas celle qu'elle mesure. C'est ce qui m'a fait croire un moment
   * que le glissement ne marchait pas en rangées.
   */
  await expect(page.locator(".drive-name")).toHaveText(["Bêta"]);
  await page.locator(".drive-folder").click();
  await expect(page.locator(".drive-name")).toHaveText(["..", "Alpha"]);
});

test("on remonte un deck en le glissant sur le fil d'Ariane", async ({ page }, info) => {
  // Le fil d'Ariane est une cible de dépôt : c'est le chemin le plus court pour
  // sortir d'un dossier.
  test.skip(info.project.name === "mobile", "le glisser-déposer n'existe pas au doigt");

  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Dedans");
  await page.locator(".folder-open", { hasText: "Dedans" }).click();
  await creerDeckIci(page, "À sortir");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator(".folder-open", { hasText: "Dedans" }).click();

  await page.locator(".deck-tile").dragTo(page.locator('.folder-path-step[data-drop=""]'));

  await expect(page.locator(".deck-tile")).toHaveCount(0);
  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("À sortir");
});

test("la recherche traverse les dossiers, et dit d'où sort ce qu'elle trouve", async ({ page }) => {
  /**
   * ATEM-old ne filtrait que l'étage courant : chercher « dragon » et ne rien
   * trouver parce qu'on est dans le mauvais dossier est une réponse fausse à
   * une question simple.
   */
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "Caché");
  await page.locator(".folder-open", { hasText: "Caché" }).click();
  await creerDeckIci(page, "Dragons blancs");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  // On est revenu à la racine, où le deck n'est pas.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await page.getByLabel("Rechercher un deck").fill("dragons");
  await expect(page.locator(".deck-tile-name")).toHaveText("Dragons blancs");
  await expect(page.locator(".deck-tile-meta").first()).toContainText("Caché");
});

test("la fenêtre de création tient dans l'écran", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await page.getByRole("button", { name: "Construire un deck" }).click();

  await expect(page.locator(".deck-modal")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // Échap referme, comme la fiche.
  await page.keyboard.press("Escape");
  await expect(page.locator(".deck-modal")).toHaveCount(0);
});

test("un nom de dossier ne s'exécute pas, il s'affiche", async ({ page }) => {
  /**
   * Le nom d'un dossier est écrit par l'utilisateur et ressort à cinq endroits :
   * la tuile, le fil d'Ariane, la rangée, la liste des destinations et la
   * confirmation de suppression. Le gabarit échappe par défaut — cette épreuve
   * est là pour que ça reste vrai le jour où quelqu'un ajoutera un `raw()`.
   */
  await signUp(page);
  await page.goto("/decks");
  await creerDossier(page, "<img src=x onerror=alert(1)>Piégé");

  await expect(page.locator(".folder-name")).toHaveText("<img src=x onerror=alert(1)>Piégé");
  await expect(page.locator(".folder-tile img")).toHaveCount(0);

  await page.locator(".folder-open").click();
  await expect(page.locator(".folder-path-step[aria-current='page']"))
    .toHaveText("<img src=x onerror=alert(1)>Piégé");
});

/* ── La fiche du deck ─────────────────────────────────────────────────────
 * Proposé par Ange, repris d'ATEM-old : ouvrir un deck le **montre**. C'est
 * aussi ce qui rendra possible de montrer le deck d'un autre joueur sans
 * écrire un second écran — il suffira de ne pas afficher le crayon.
 */

test("ouvrir un deck le montre, sans rien pour écrire", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["SDCR-FR027"]);
  await nouveauDeck(page, "Vitrine");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await page.locator(".deck-tile").click();

  // La carte est là, et le deck se lit.
  await expect(page.locator(".item-main")).toHaveCount(1);
  await expect(page.locator(".qty-pill")).toHaveText("×1");
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  // Rien de ce qui écrit n'existe sur cet écran.
  await expect(page.locator("#edit-name")).toHaveCount(0);
  await expect(page.locator(".js-coll, .js-zone")).toHaveCount(0);
  await expect(page.locator(".deck-stepper")).toHaveCount(0);
});

test("le crayon ouvre l'atelier, et l'adresse le dit", async ({ page }) => {
  await signUp(page);
  await nouveauDeck(page, "À modifier");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator(".deck-tile").click();

  await page.getByRole("link", { name: "Modifier" }).click();

  await expect(page.locator("#edit-name")).toHaveValue("À modifier");
  expect(page.url()).toContain("workshop=1");

  // Et l'on revient à la fiche par où l'on est venu.
  await page.getByRole("link", { name: "← Fiche" }).click();
  await expect(page.locator("#edit-name")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "À modifier" })).toBeVisible();
});

test("les onglets de la fiche montrent une zone à la fois", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["SDCR-FR028", "SDCR-FR028"]);
  await nouveauDeck(page, "Deux zones");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  // La même carte, au Side cette fois. Les onglets de zone vivent dans le
  // panneau du deck, que le téléphone masque tant qu'on regarde la collection.
  await panneau(page, "Mon deck");
  await page.locator('[data-zone="side"]').click();
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Side 1");

  await page.getByRole("link", { name: "← Fiche" }).click();
  // « Tout » : la même carte occupe deux places, donc deux lignes.
  await expect(page.locator(".item-main")).toHaveCount(2);

  await page.getByRole("tab", { name: /Main/ }).click();
  await expect(page.locator(".item-main")).toHaveCount(1);
  await expect(page.locator(".zone-pill")).toContainText("Main");

  await page.getByRole("tab", { name: /Side/ }).click();
  await expect(page.locator(".zone-pill")).toContainText("Side");
});

test("cliquer une carte de la fiche l'ouvre en grand", async ({ page }) => {
  /**
   * Une ligne de deck ne porte que son nom, son illustration et sa banlist :
   * la fiche complète se demande à l'ouverture, une fois par carte.
   */
  await signUp(page);
  await garnir(page, ["SDCR-FR029"]);
  await nouveauDeck(page, "Zoom");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "← Fiche" }).click();

  await page.locator(".item-main").click();
  await expect(page.locator(".inspect-panel")).toBeVisible();
  // Le détail vient du catalogue, pas de la ligne : l'ATK en est la preuve.
  await expect(page.locator(".inspect-panel")).toContainText("ATK");
  // Et rien pour poser une carte : cette fiche-ci ne fait que montrer.
  await expect(page.locator(".deck-open-actions")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".inspect-panel")).toHaveCount(0);
});

test("la fiche du deck ne déborde pas", async ({ page }) => {
  await signUp(page);
  await garnir(page, ["SDCR-FR030"]);
  await nouveauDeck(page, "Un nom de deck assez long pour éprouver la mise en page");
  await panneau(page, "Ma collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "← Fiche" }).click();

  await expectNoHorizontalOverflow(page);
  await page.locator('[data-sheet-view="gallery"]').click();
  await expect(page.locator(".tile")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});
