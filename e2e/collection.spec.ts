import { expect, test } from "@playwright/test";
import {
  addBySetCode, expectNoHorizontalOverflow, freshAccount, signUp, useGalleryView,
} from "./helpers.js";

test.describe("Collection", () => {
  test("un compte neuf arrive sur une collection vide", async ({ page }) => {
    await signUp(page);
    await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();
    await expect(page.getByText(/Aucune carte/)).toBeVisible();
  });

  test("ajouter une carte par son set code français", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    // On vise la grille, pas la page : le message de confirmation contient le
    // même nom, et une assertion sur la page entière serait ambiguë.
    const grid = page.locator(".content");
    // Le nom vient du catalogue, en français : c'est ce qui prouve que la
    // bascule vers le code anglais a fonctionné sans perdre la langue.
    await expect(grid.getByText("Grande Baleine")).toBeVisible();
    // La collection s'ouvre en liste, comme ATEM-old.
    await expect(page.locator(".item-list")).toBeVisible();
    await expect(page.locator(".meta-line")).toContainText("1/1");
  });

  test("le nom affiché suit la langue de l'exemplaire", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await addBySetCode(page, "LOB-EN001");

    const grid = page.locator(".content");
    await expect(grid.getByText("Dragon Blanc aux Yeux Bleus")).toBeVisible();
    await expect(grid.getByText("Blue-Eyes White Dragon")).toBeVisible();
  });

  test("les boutons + et − ajustent la quantité", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    await expect(row.locator(".item-meta")).toContainText("×1");

    await row.getByRole("button", { name: "Ajouter un exemplaire" }).click();
    await expect(row.locator(".item-meta")).toContainText("×2");

    await row.getByRole("button", { name: "Retirer un exemplaire" }).click();
    await expect(row.locator(".item-meta")).toContainText("×1");
  });

  test("retirer le dernier exemplaire retire la ligne", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    await row.getByRole("button", { name: "Retirer un exemplaire" }).click();

    await expect(page.locator(".item")).toHaveCount(0);
    await expect(page.getByText("Aucune carte")).toBeVisible();
  });

  test("le favori se pose et se retient", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const favorite = page.locator(".item").first().getByRole("button", { name: "Mettre en favori" });
    await expect(favorite).toHaveAttribute("aria-pressed", "false");
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(
      page.locator(".item").first().getByRole("button", { name: "Mettre en favori" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("un code inconnu entre quand même, marqué en attente", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "ZZZZ-FR999");

    await expect(page.locator(".content").getByText("Carte non identifiée")).toBeVisible();
    await expect(page.locator(".meta-line .warn")).toContainText("en attente");
  });

  test("la fiche s'ouvre en grand et se ferme avec Échap", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await useGalleryView(page);
    await page.locator(".tile").first().click();
    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    // Correspondance exacte : « Eau » est contenu dans « Niveau » et dans le
    // texte de la carte. Une assertion approximative passerait pour de
    // mauvaises raisons, ou échouerait pour de mauvaises raisons.
    await expect(sheet.getByText("Poisson", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Eau", { exact: true })).toBeVisible();
    // Le set code apparaît aussi dans la liste des éditions : on vise la
    // grille d'informations de l'exemplaire.
    await expect(sheet.locator(".detail-grid").getByText("LTGY-FR008")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("la fiche liste les autres éditions de la carte", async ({ page }) => {
    // « Est-ce que je l'ai déjà, et dans quelle édition ? » se pose devant
    // chaque carte qu'on trie. Le Dragon Blanc en compte des dizaines.
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    const editions = page.locator("#inspect-panel .editions-list");
    await expect(editions).toBeVisible();
    // L'édition possédée se distingue de celles qu'on n'a pas.
    await expect(editions.locator(".edition-row.is-owned")).toHaveCount(1);
    await expect(editions.locator(".edition-row")).not.toHaveCount(1);
  });

  test("les filtres proposent les icônes des attributs", async ({ page }) => {
    // Les icônes viennent d'ATEM-old ; leur nom de fichier suit la valeur
    // anglaise. Une image cassée ne se voit pas dans un test de texte.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await page.getByRole("button", { name: "Trier et filtrer" }).click();

    const icon = page.locator("#filter-panel .chip-attr img").first();
    await expect(icon).toBeVisible();
    const loaded = await icon.evaluate((img) => (img as HTMLImageElement).naturalWidth > 0);
    expect(loaded, "l'icône d'attribut doit se charger").toBe(true);
  });

  test("la recherche filtre la collection", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");
    await useGalleryView(page);
    await expect(page.locator(".tile")).toHaveCount(2);

    await page.getByLabel("Rechercher dans la collection").fill("Baleine");
    await expect(page.locator(".tile")).toHaveCount(1);
    await expect(page.locator(".content").getByText("Grande Baleine")).toBeVisible();
  });

  test("la page ne déborde jamais horizontalement", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");

    expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);

    await useGalleryView(page);
    await page.locator(".tile").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();
    expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("les cibles tactiles sont assez grandes", async ({ page }, testInfo) => {
    // 44 px au doigt. À la souris, 32 px suffit et la densité de la liste vaut
    // mieux — c'est pourquoi la règle est portée par `@media (pointer: coarse)`
    // et que l'épreuve ne vaut que sur le profil mobile.
    test.skip(testInfo.project.name !== "mobile", "cible tactile : profil mobile");
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    for (const name of ["Ajouter un exemplaire", "Retirer un exemplaire"]) {
      const box = await row.getByRole("button", { name }).boundingBox();
      expect(box, `${name} doit être mesurable`).not.toBeNull();
      expect(box!.width, `${name} — largeur`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} — hauteur`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Mise en page", () => {
  test("l'en-tête ne se chevauche pas", async ({ page }, testInfo) => {
    // Ce contrôle ne vaut que sur écran large : sous 46 rem, la barre du haut
    // n'existe plus, la barre du bas la remplace — et c'est l'épreuve « une
    // seule barre est visible à la fois » qui le vérifie.
    test.skip(testInfo.project.name !== "bureau", "barre du haut : profil bureau");
    await signUp(page);

    const brand = await page.locator(".app-bar .brand").boundingBox();
    const nav = await page.locator(".app-bar .app-nav").boundingBox();
    const account = await page.locator(".app-bar-right").boundingBox();
    expect(brand && nav && account).toBeTruthy();

    const overlaps = (a: typeof brand, b: typeof brand) =>
      a!.x < b!.x + b!.width && b!.x < a!.x + a!.width &&
      a!.y < b!.y + b!.height && b!.y < a!.y + a!.height;

    expect(overlaps(brand, nav), "marque et navigation").toBe(false);
    expect(overlaps(nav, account), "navigation et compte").toBe(false);
    expect(overlaps(brand, account), "marque et compte").toBe(false);
  });

  test("les actions du scanner restent visibles sans défiler", async ({ page }) => {
    // Ce sont elles qu'on utilise à chaque carte. Les repousser sous la ligne
    // de flottaison rend l'inventaire d'une pile insupportable.
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const viewport = page.viewportSize()!;
    for (const name of ["Lire la carte", "Ajouter un exemplaire"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, `${name} doit être mesurable`).not.toBeNull();
      // La barre d'obturateur est collante au bas de la modale : elle doit
      // rester atteignable sans défiler, c'est le geste répété à chaque carte.
      expect(
        box!.y + box!.height,
        `${name} doit tenir dans la hauteur visible`,
      ).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test("ouvrir et refermer le scanner ne laisse rien derrière", async ({ page }) => {
    /**
     * Le scanner se branchait sur `popstate` et sur `atem:navigated` en
     * `{ once: true }` — donc jamais consommés quand on ferme au bouton. Chaque
     * ouverture laissait donc deux écouteurs vivants, et la navigation suivante
     * rappelait la fermeture autant de fois qu'on avait ouvert le scanner,
     * chacune relançant le rechargement complet de la collection.
     *
     * **La navigation doit être interne.** Un `goto` recharge le document et
     * emporte tous les écouteurs avec lui : la fuite ne se voit que sur un
     * changement de route côté client, celui que fait un clic dans la barre.
     */
    await signUp(page);

    const requêtesDUnChangementDÉcran = async (): Promise<number> => {
      let requêtes = 0;
      const écouter = (request: { url: () => string }) => {
        if (request.url().includes("/api/collection")) requêtes += 1;
      };
      page.on("request", écouter);
      await page.locator("a[href='/collection']").first().dispatchEvent("click");
      await page.waitForTimeout(800);
      page.off("request", écouter);
      return requêtes;
    };

    const référence = await requêtesDUnChangementDÉcran();

    for (let tour = 0; tour < 3; tour += 1) {
      await page.getByRole("button", { name: "Scanner" }).click();
      await page.locator(".scan-modal").waitFor();
      await page.locator(".scan-modal .icon-btn").click();
      await expect(page.locator(".scan-modal")).toHaveCount(0);
    }

    const après = await requêtesDUnChangementDÉcran();
    expect(
      après,
      `trois ouvertures du scanner : le changement d'écran a produit ${après} requêtes contre ${référence}`,
    ).toBeLessThanOrEqual(référence);
  });

  test("le message d'accueil est opaque, et doré", async ({ page }) => {
    /**
     * Il ne l'était pas : `.toast` ne posait aucun fond, et les tons vivaient
     * dans une classe `.toast-ok` que le balisage — qui écrit `data-kind` — n'a
     * jamais posée. Le message flottait par-dessus la collection, illisible, et
     * se lisait comme un défaut d'affichage plutôt que comme une information.
     */
    await signUp(page);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();

    const fond = await toast.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(fond, "le fond ne doit pas être transparent").not.toBe("rgba(0, 0, 0, 0)");
    expect(fond, "aucune transparence partielle non plus").not.toMatch(/^rgba\(.*,\s*0?\.\d+\)$/);

    // Doré, et non le vert réservé à ce qui vient d'être enregistré.
    const texte = await toast.evaluate((node) => getComputedStyle(node).color);
    expect(texte).toBe("rgb(251, 191, 36)");
  });

  test("la barre du scanner : recommencer, et un « +1 » qui se voit", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const champ = page.locator(".scan-code-input");
    await champ.fill("LTGY-FR008");

    // « Recommencer » remet l'écran dans l'état où il s'est ouvert, sans
    // toucher ni à la caméra ni à la collection.
    await page.getByRole("button", { name: "Recommencer" }).click();
    await expect(champ).toHaveValue("");

    /**
     * Le « +1 » n'avait aucune couleur : le navigateur lui donnait son gris par
     * défaut, indistinguable du « −1 » d'à côté — alors que l'un ajoute une
     * carte à l'inventaire et l'autre l'en retire.
     */
    const plus = page.getByRole("button", { name: "Ajouter un exemplaire" });
    const fond = await plus.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(fond, "le « +1 » porte le bleu du « + » de la barre d'ajout").toBe("rgb(110, 200, 255)");

    // Les quatre cibles restent au doigt : 44 px, c'est le minimum tenable pour
    // une barre qu'on vise sans regarder.
    for (const nom of ["Recommencer", "Retirer un exemplaire", "Lire la carte", "Ajouter un exemplaire"]) {
      const boite = (await page.getByRole("button", { name: nom }).boundingBox())!;
      expect(Math.min(boite.width, boite.height), `cible « ${nom} »`).toBeGreaterThanOrEqual(44);
    }
  });

  test("le clavier ne monte pas tout seul dans le scanner", async ({ page }) => {
    /**
     * Un focus sur téléphone fait monter le clavier, qui recouvre la moitié de
     * l'écran — dont la barre de déclenchement. Il fallait taper à côté pour le
     * refermer avant de reprendre une photo, à chaque carte.
     */
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const focalisé = await page.evaluate(() =>
      document.activeElement?.classList.contains("scan-code-input") ?? false,
    );
    expect(focalisé, "le champ ne doit pas s'emparer du focus à l'ouverture").toBe(false);

    // Il le prend quand on le lui demande, évidemment.
    await page.locator(".scan-code-input").click();
    expect(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("scan-code-input") ?? false,
      ),
    ).toBe(true);
  });

  test("la fiche de carte tient dans l'écran", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
  });
});

test.describe("Redirection après connexion", () => {
  /** Crée un compte depuis `/inscription?suite=…` et rend l'URL d'arrivée. */
  async function inscrireAvecSuite(page: import("@playwright/test").Page, suite: string) {
    const compte = freshAccount();
    await page.goto(`/inscription?suite=${encodeURIComponent(suite)}`);
    await page.getByLabel("Pseudo").fill(compte.displayName);
    await page.getByLabel("Adresse e-mail").fill(compte.email);
    await page.getByLabel("Mot de passe", { exact: false }).first().fill(compte.password);
    await page.getByLabel("Confirmation du mot de passe").fill(compte.password);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.waitForURL(/\/collection/, { timeout: 10_000 });
    return page.url();
  }

  test("une destination de chez nous est suivie", async ({ page }) => {
    const arrivée = await inscrireAvecSuite(page, "/collection?depuis=test");
    expect(arrivée).toContain("/collection?depuis=test");
  });

  test("une destination d'ailleurs ne quitte pas le site", async ({ page }) => {
    /**
     * `?suite=` vient de l'URL, donc de n'importe qui. `pushState` refuse déjà
     * une autre origine — mais en **levant**, ce qui laissait la connexion à
     * moitié faite au lieu de retomber sur la collection. Les trois formes
     * comptent : deux barres, la barre inversée que la normalisation d'URL
     * transforme en barre, et une adresse absolue.
     */
    for (const suite of ["//exemple.invalid", "/\\exemple.invalid", "https://exemple.invalid"]) {
      const arrivée = await inscrireAvecSuite(page, suite);
      expect(arrivée, `suite = ${suite}`).not.toContain("exemple.invalid");
      expect(arrivée).toContain("/collection");
    }
  });
});

test.describe("Navigation", () => {
  test("la barre principale mène aux écrans déclarés", async ({ page }, testInfo) => {
    // Les destinations viennent du routeur : une entrée n'existe que si sa
    // route existe. Ce qui compte ici, c'est qu'elles mènent quelque part.
    await signUp(page);
    const bar = testInfo.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

    await expect(page.locator(bar).getByRole("link", { name: /Collection/ })).toBeVisible();
    await expect(page.locator(`${bar} [aria-current="page"]`)).toContainText("Collection");
  });

  test("la destination courante est marquée", async ({ page }, testInfo) => {
    await signUp(page);
    const bar = testInfo.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

    const current = page.locator(`${bar} [aria-current="page"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Collection");
  });

  test("une seule barre est visible à la fois", async ({ page }, testInfo) => {
    // La barre du haut cède **entièrement** la place à celle du bas sur
    // téléphone : garder les deux, c'est deux navigations à tenir d'accord,
    // et l'une des deux finit par mentir sur la page courante.
    await signUp(page);
    const onMobile = testInfo.project.name === "mobile";

    await expect(page.locator(".app-bar")).toBeVisible({ visible: !onMobile });
    await expect(page.locator(".global-mobile-bottom-nav")).toBeVisible({ visible: onMobile });
  });

  test("l'état du service est affiché", async ({ page }, testInfo) => {
    // Quand le serveur ne répond plus, chaque geste échoue avec un message
    // différent. Une pastille répond à la question avant qu'on la pose.
    await signUp(page);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Mon compte" }).click();
      await expect(page.locator("#account-sheet .api-pill")).toHaveText("En ligne");
    } else {
      await expect(page.locator(".app-bar .api-pill")).toHaveText("En ligne");
    }
  });

  test("la feuille de compte s'ouvre et se ferme", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "feuille de compte : profil mobile");
    await signUp(page);

    const sheet = page.locator("#account-sheet");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Testeur");

    await sheet.getByRole("button", { name: "Fermer" }).click();
    await expect(sheet).toBeHidden();
  });

  test("le fond referme la feuille de compte", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "feuille de compte : profil mobile");
    await signUp(page);

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(page.locator("#account-sheet")).toBeVisible();

    // La feuille est modale : elle recouvre la barre du bas, et c'est son fond
    // qu'on touche pour en sortir.
    await page.locator("#account-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.locator("#account-sheet")).toBeHidden();
  });

  test("revenir en arrière referme la feuille de compte", async ({ page }, testInfo) => {
    // Elle est posée sur le corps de page, que le routeur ne remplace pas :
    // sans fermeture explicite elle resterait par-dessus l'écran suivant.
    test.skip(testInfo.project.name !== "mobile", "feuille de compte : profil mobile");
    await signUp(page);

    // On quitte l'écran puis on y revient : la feuille ne doit pas survivre.
    await page.goto("/connexion");
    await page.goBack();
    await page.waitForURL("**/collection");

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(page.locator("#account-sheet")).toBeVisible();

    await page.goForward();
    await expect(page.locator("#account-sheet")).toBeHidden();
  });

  test("la barre du bas ne cache pas la fin de la liste", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "barre du bas : profil mobile");
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const bar = (await page.locator(".global-mobile-bottom-nav").boundingBox())!;
    const padding = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    expect(padding, "le corps de page réserve la hauteur de la barre").toBeGreaterThanOrEqual(
      bar.height - 12,
    );
  });
});


test.describe("Parité avec ATEM-old", () => {
  test("le passcode identifie une carte au code illisible", async ({ page }) => {
    // Le recours quand le set code ne se lit pas : les huit chiffres en bas à
    // gauche. Le champ existait dans ATEM-old et avait disparu.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: /Options/ }).click();
    await page.getByLabel("Passcode de la carte").fill("18322364");
    await page.getByLabel("Ajouter par set code").fill("ABIME-FR001");
    await page.getByRole("button", { name: "Ajouter la carte" }).click();

    // Identifiée tout de suite, sans passer par « en attente ».
    await expect(page.locator(".content").getByText("Grande Baleine")).toHaveCount(2);
  });

  test("la recherche trouve par passcode", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByLabel("Rechercher dans la collection").fill("18322364");
    await expect(page.locator(".item")).toHaveCount(1);
  });

  test("le sens du tri se renverse", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#sort").selectOption("setCode");
    await page.locator("#sort-dir").selectOption("asc");
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".item-text code").first()).toHaveText("LOB-FR001");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#sort-dir").selectOption("desc");
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".item-text code").first()).toHaveText("LTGY-FR008");
  });

  test("la densité compacte s'applique au corps de page", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#density").selectOption("compact");
    await expect(page.locator("body")).toHaveClass(/density-compact/);
  });

  test("la collection sort dans l'ordre du tri, sans regroupement", async ({ page }) => {
    // C'est le comportement par défaut d'ATEM-old, et le bon : découper par
    // famille impose une seconde clé d'ordre par-dessus celle qu'on a choisie,
    // et l'on ne retrouve plus ce qu'on cherche.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");

    await expect(page.locator(".group-header")).toHaveCount(0);
    // Tri par nom croissant : « Dragon Blanc… » avant « Grande Baleine ».
    await expect(page.locator(".item-text strong").first()).toContainText("Dragon Blanc");
  });

  test("le regroupement par type s'active à la demande", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await expect(page.locator(".group-header")).toHaveCount(0);

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#group-monster").check();
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".group-header").first()).toContainText("Poisson");
  });

  test("une carte pas encore traduite le dit à l'écran", async ({ page }) => {
    // `ALIN-FR010` vient d'Alliance Insight, extension récente que la source
    // n'a pas encore traduite. Son nom et son texte s'affichent en anglais.
    await signUp(page);
    await addBySetCode(page, "ALIN-FR010");
    await page.locator(".item-main").first().click();

    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Traduction pas encore disponible/)).toBeVisible();
  });

  test("le compteur d'attente suit la suppression", async ({ page }) => {
    // Retirer la dernière carte d'une ligne non identifiée laissait
    // « 1 en attente » à l'écran jusqu'au rechargement complet.
    await signUp(page);
    await addBySetCode(page, "NEXISTEPAS-FR999");
    await expect(page.locator(".meta-line .warn")).toContainText("en attente");

    await page.locator(".item").first()
      .getByRole("button", { name: "Retirer un exemplaire" }).click();

    await expect(page.locator(".meta-line .warn")).toHaveText("");
  });

  test("une note s'enregistre depuis la fiche", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    await page.getByLabel("Note").fill("Achetée en boutique");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Note enregistrée.")).toBeVisible();

    await page.keyboard.press("Escape");
    await useGalleryView(page);
    await page.locator(".tile").first().click();
    await expect(page.getByLabel("Note")).toHaveValue("Achetée en boutique");
  });
});

test("le bloc de compte ne se chevauche pas", async ({ page }, testInfo) => {
  // Le pseudo venait toucher le bouton de déconnexion : la mise en page du
  // bloc de droite vivait dans un attribut `style` chez ATEM-old, pas dans sa
  // feuille — et n'a donc pas été reprise avec elle.
  test.skip(testInfo.project.name !== "bureau", "barre du haut : profil bureau");
  await signUp(page);

  const pseudo = (await page.locator(".app-bar-right .muted").boundingBox())!;
  const bouton = (await page.locator(".app-bar-right button").boundingBox())!;
  expect(pseudo.x + pseudo.width).toBeLessThanOrEqual(bouton.x);
});

test.describe("Verrou de défilement", () => {
  /**
   * Une collection qui dépasse l'écran.
   *
   * On raccourcit la fenêtre plutôt que d'ajouter vingt cartes : ce qu'on
   * éprouve ici est le verrou, pas la capacité à charger une liste longue, et
   * chaque ajout coûte un aller-retour.
   */
  async function collectionDefilante(page: import("@playwright/test").Page): Promise<void> {
    await signUp(page);
    for (const code of ["LTGY-FR008", "LOB-FR001", "SDK-001", "PSV-F088", "LOB-EN001"]) {
      await addBySetCode(page, code);
    }

    const largeur = page.viewportSize()!.width;
    await page.setViewportSize({ width: largeur, height: 420 });

    const defilable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(defilable, "la page doit dépasser l'écran pour que l'épreuve ait un sens").toBe(true);
  }

  test("la fiche de carte fige la page derrière elle", async ({ page }) => {
    // Deux barres de défilement cohabitaient : celle de la fiche et celle de la
    // collection. On croyait descendre dans la carte et c'est la page qui
    // bougeait — et en refermant, on ne se retrouvait plus où l'on était.
    await collectionDefilante(page);

    await page.evaluate(() => window.scrollTo(0, 220));
    const avant = await page.evaluate(() => window.scrollY);

    // On repère une ligne à l'écran : c'est son déplacement qu'on voit, pas la
    // valeur de `scrollY` — qui vaut zéro pendant le verrou, par construction,
    // puisque le corps est fixé et non plus défilé.
    const ligne = page.locator(".item").first();
    const positionAvant = (await ligne.boundingBox())!.y;

    /**
     * `click()` ferait défiler la ligne dans la vue avant de cliquer, et
     * remettrait la page à zéro juste avant le verrou : l'épreuve mesurerait
     * son propre effet de bord. `dispatchEvent` déclenche l'événement sans
     * toucher au défilement.
     */
    await page.locator(".item-main").first().dispatchEvent("click");
    await expect(page.locator("#inspect-panel")).toBeVisible();

    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);

    const positionPendant = (await ligne.boundingBox())!.y;
    expect(
      Math.abs(positionPendant - positionAvant),
      "la collection derrière ne doit pas bouger d'un pixel",
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(page.locator("#inspect-panel")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.scrollY),
      "on revient exactement où l'on était",
    ).toBe(avant);
  });

  test("le panneau de filtres fige aussi", async ({ page }) => {
    await collectionDefilante(page);
    await page.evaluate(() => window.scrollTo(0, 180));
    const avant = await page.evaluate(() => window.scrollY);
    const ligne = page.locator(".item").first();
    const positionAvant = (await ligne.boundingBox())!.y;

    await page.getByRole("button", { name: "Trier et filtrer" }).dispatchEvent("click");
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    expect(Math.abs((await ligne.boundingBox())!.y - positionAvant)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "OK" }).dispatchEvent("click");
    expect(
      await page.evaluate(() => window.scrollY),
      "la position est rendue à la fermeture",
    ).toBe(avant);
  });

  test("cliquer les filtres ne dérègle pas le verrou", async ({ page }) => {
    // `setFilterPanel(true)` est rappelé à chaque puce : compter deux fois ne
    // se rattraperait jamais, et la page resterait figée après fermeture.
    await collectionDefilante(page);

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator('[data-filter-kind="monster"]').click();
    await page.locator('[data-filter-kind=""]').click();
    await page.getByRole("button", { name: "OK" }).click();

    await page.evaluate(() => window.scrollTo(0, 200));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("changer d'écran rend toujours le défilement", async ({ page }) => {
    await collectionDefilante(page);
    await page.locator(".item-main").first().dispatchEvent("click");
    await expect(page.locator("#inspect-panel")).toBeVisible();

    // On quitte sans refermer : le routeur emporte la fiche avec la racine.
    await page.goto("/connexion");
    await page.goBack();
    await page.waitForURL("**/collection");

    await page.evaluate(() => window.scrollTo(0, 150));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe("Mise en page de la fiche", () => {
  test("l'étiquette de la note s'aligne sur son champ", async ({ page }) => {
    // Trois éléments sur une ligne, trois alignements différents : l'étiquette
    // s'étirait sur toute la hauteur et son texte se posait en haut.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await page.locator(".item-main").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();

    /**
     * Les trois centres se lisent d'un seul coup.
     *
     * « Autres éditions » est inséré par un appel qui revient après le rendu de
     * la fiche, et `.inspect-info-col` défile : trois `boundingBox()` successifs
     * pouvaient tomber de part et d'autre de cette insertion et comparer deux
     * mises en page différentes. L'écart ainsi mesuré ne dit rien de
     * l'alignement — il dit seulement que la page a bougé entre deux mesures.
     */
    await expect(page.locator("#inspect-panel .editions")).toBeVisible();

    const { etiquette, champ, bouton } = await page.evaluate(() => {
      const centre = (selecteur: string) => {
        const box = document.querySelector(selecteur)!.getBoundingClientRect();
        return box.y + box.height / 2;
      };
      return {
        etiquette: centre(".inspect-notes > label"),
        champ: centre("#notes-input"),
        bouton: centre("#btn-save-notes"),
      };
    });

    expect(Math.abs(etiquette - champ), "étiquette et champ").toBeLessThanOrEqual(2);
    expect(Math.abs(bouton - champ), "bouton et champ").toBeLessThanOrEqual(2);
  });

  test("« Autres éditions » se détache de la note", async ({ page }) => {
    // Les deux blocs se touchaient : on ne voyait pas où l'un finissait, alors
    // que c'est l'information qu'on vient chercher devant une carte qu'on trie.
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await page.locator(".item-main").first().click();

    const editions = page.locator("#inspect-panel .editions");
    await expect(editions).toBeVisible();

    const notes = (await page.locator(".inspect-notes").boundingBox())!;
    const bloc = (await editions.boundingBox())!;
    expect(
      bloc.y - (notes.y + notes.height),
      "un espace franc sépare la note des éditions",
    ).toBeGreaterThanOrEqual(16);
  });
});
