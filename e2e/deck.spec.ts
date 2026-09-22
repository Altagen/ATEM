import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * Decks — the list and the workshop.
 *
 * What counts here: the screen refuses **with the same rule** as the server.
 * The earlier prototype had the right computation and only used it to grey out a button; a
 * forged request went through. Both sides now call `checkDeckAdd`.
 */

/** Adds cards to the collection, so there is something to draw from. */
async function stockCollection(page: import("@playwright/test").Page, codes: string[]) {
  for (const code of codes) {
    await page.getByLabel(/Ajouter par set code/).fill(code);
    await page.getByRole("button", { name: /Ajouter la carte/ }).click();
    await page.waitForTimeout(450);
  }
}

async function newDeck(page: import("@playwright/test").Page, name: string) {
  await page.goto("/decks");
  await createDeckHere(page, name);
  // The name lives in a field, not a heading: it is the earlier prototype's workshop, where
  // you rename without changing screen.
  await expect(page.locator("#edit-name")).toHaveValue(name);
}

/** The creation window, wherever you are. */
async function createDeckHere(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Construire un deck" }).click();
  await page.locator("#modal-name").fill(name);
  await page.getByRole("button", { name: "Créer" }).click();
}

/** The folder creation window, at the current level. */
async function createFolder(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Nouveau dossier" }).click();
  await page.locator("#modal-name").fill(name);
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator(".folder-name", { hasText: name })).toBeVisible();
}

/** On a phone, the two panels take turns: choose which one to look at. */
async function showPanel(page: import("@playwright/test").Page, which: "collection" | "deck") {
  /**
   * Aim at the attribute, not the role or the name.
   *
   * These buttons carry `role="tab"` — which replaces their implicit role, so
   * `getByRole("button")` does not find them — and their accessible name
   * carries the emoji and the count: “🃏 Mon deck 0”. `data-panel` does not move.
   */
  const toggle = page.locator(".deck-panel-switch");
  if (!(await toggle.isVisible())) return;
  await toggle.locator(`[data-panel="${which === "collection" ? "collection" : "zones"}"]`).click();
}

test("a deck is created and a card from the collection is put in it", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "LTGY-FR008"]);
  await newDeck(page, "First deck");

  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await showPanel(page, "deck");
  await expect(page.locator(".zone-edit-row")).toHaveCount(1);
  await expect(page.locator(".zone-edit-row .deck-stepper-qty")).toHaveText("×1");
  // The Main tab carries the count.
  await expect(page.locator("[data-zone='main']")).toContainText("1");
});

test("the “+” greys out once everything is in", async ({ page }) => {
  /**
   * The ceiling is `min(3, owned)`: two copies owned, two in the deck, and the
   * button offers nothing more. The same function greys out here and refuses on
   * the server.
   */
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "LTGY-FR008"]);
  await newDeck(page, "Ceiling");

  await showPanel(page, "collection");
  const add = page.locator(".js-coll[data-d='1']").first();
  await add.click();
  await page.waitForTimeout(450);
  await add.click();
  await page.waitForTimeout(450);

  await expect(page.locator(".js-coll[data-d='1']").first()).toBeDisabled();
});

test("the deck says it is incomplete until it is playable", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "Incomplete");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await page.goto("/decks");
  await expect(page.locator(".deck-unready")).toBeVisible();
  await expect(page.locator(".deck-ready")).toHaveCount(0);
});

test("removing the last card empties the zone", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "To empty");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  await showPanel(page, "deck");
  await page.locator(".js-zone[data-d='-1']").first().click();
  await page.waitForTimeout(500);
  await expect(page.locator(".zone-edit-row")).toHaveCount(0);
  await expect(page.locator(".zone-edit-empty")).toBeVisible();
});

test("discarding a deck does not touch the collection", async ({ page }) => {
  // A deck is an intention, not a possession.
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "No effect");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await page.waitForTimeout(500);

  // Discarding is a gesture on the object: it lives on the sheet, not in the
  // workshop.
  await page.getByRole("link", { name: "Retour", exact: true }).click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#btn-delete").click();
  await expect(page.getByRole("heading", { name: "Mes decks" })).toBeVisible();

  await page.goto("/collection");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();
});

test("the workshop does not overflow", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "LOB-FR001"]);
  await newDeck(page, "Width");
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("on a phone, the two panels take turns", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone-only rule");
  /**
   * Stacking the collection and the zones would force you to cross forty cards
   * to reach your deck. Past 900 px the two fit side by side, and the toggle
   * disappears.
   */
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "Toggle");

  await expect(page.locator(".deck-edit-collection")).toBeVisible();
  await expect(page.locator(".deck-edit-zones")).toBeHidden();

  await page.locator('.deck-panel-switch [data-panel="zones"]').click();
  await expect(page.locator(".deck-edit-zones")).toBeVisible();
  await expect(page.locator(".deck-edit-collection")).toBeHidden();
});

test("on a wide screen, the two panels fit together", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "wide-screen-only rule");
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "Side by side");

  await expect(page.locator(".deck-panel-switch")).toBeHidden();
  const collection = (await page.locator(".deck-edit-collection").boundingBox())!;
  const zones = (await page.locator(".deck-edit-zones").boundingBox())!;
  expect(collection.x + collection.width, "the collection is on the left").toBeLessThanOrEqual(zones.x + 1);
});

test("the workshop's filters sort the collection", async ({ page }) => {
  /**
   * The same categories as the Collection screen, plus “Extra” — which makes no
   * sense there and makes some here: it is the only pile filled separately.
   */
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "RA03-FR004"]);
  await newDeck(page, "Filters");
  await showPanel(page, "collection");

  const rows = page.locator(".deck-edit-coll-list .item");
  await expect(rows).toHaveCount(2);

  // Both are monsters: “Spell” must let nothing through.
  await page.locator("[data-filter-kind='spell']").click();
  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(0);

  await page.locator("[data-filter-kind='']").click();
  await expect(rows).toHaveCount(2);

  // The WATER attribute keeps both (Grande Baleine, Diva).
  await page.locator("[data-filter-attr='WATER']").click();
  await expect(rows).toHaveCount(2);
  // And DARK keeps none.
  await page.locator("[data-filter-attr='WATER']").click();
  await page.locator("[data-filter-attr='DARK']").click();
  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(0);
});

test("the gallery shows the same cards as the list", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "LOB-FR001"]);
  await newDeck(page, "Gallery");
  await showPanel(page, "collection");

  await expect(page.locator(".deck-edit-coll-list .item")).toHaveCount(2);
  await page.locator("[data-coll-view='gallery']").click();
  await expect(page.locator(".deck-edit-coll-list")).toHaveCount(0);
  await expect(page.locator(".deck-edit-gallery .deck-coll-tile")).toHaveCount(2);
});

test("the zone counter carries the limits", async ({ page }) => {
  // It is the only thing you look at while building: how many are missing.
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "Counter");

  const counter = page.locator(".deck-counts");
  await expect(counter).toContainText("Main");
  await expect(counter).toContainText("/60");
  await expect(counter).toContainText("/15");
});

test("the name is written by itself, with no button", async ({ page }) => {
  /**
   * Ange: “it is odd UX to validate the cards automatically but not the name…
   * either you update everything or you update nothing, but not just half of
   * it”. You type, you touch nothing else, and it is written.
   */
  await signUp(page);
  await newDeck(page, "Before");

  await page.locator("#edit-name").fill("After");
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.getByRole("link", { name: "Tous les decks" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("After");
});

test("the workshop has no save button", async ({ page }) => {
  /**
   * Reported three times by Ange, in three ways. The button answered nothing
   * when the name had not changed; called “Enregistrer” next to cards written at
   * the “±”, it suggested they were waiting; and renamed “Renommer”, it left
   * one half of the screen to confirm by hand while the other went by itself.
   * There is none any more.
   */
  await signUp(page);
  await newDeck(page, "No button");

  await expect(page.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Renommer" })).toHaveCount(0);
});

test("the workshop says where the deck stands, not only how many", async ({ page }) => {
  /**
   * Ange: “we are at 4/60, could we say ‘Deck incomplete’ or something like
   * that?”. The counter is a number: you have to know the forty-card rule to
   * read it. The sentence carries it, and says what is left to do.
   */
  await signUp(page);
  await stockCollection(page, ["SDCR-FR012"]);
  await newDeck(page, "Verdict");

  // A new deck: “40 more in the Main” would be accurate and useless.
  await expect(page.locator(".deck-status")).toContainText("Deck vide");

  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();

  const status = page.locator(".deck-status");
  await expect(status).toContainText("Deck incomplet");
  // What is left to do, in cards, so nobody has to subtract in their head.
  await expect(status).toContainText("encore 39");
  await expect(status).toHaveClass(/deck-status-short/);
});

test("the deck reports what it can no longer field", async ({ page }) => {
  /**
   * The “+” refuses a card you do not own, so a deck is playable by
   * construction — until the card is removed from the **collection** after
   * being placed. It is the only path to a shortage, and it must not be silent.
   */
  await signUp(page);
  await stockCollection(page, ["SDCR-FR013"]);
  await newDeck(page, "Shortage");
  await showPanel(page, "collection");
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
  const status = page.locator(".deck-status");
  await expect(status).toContainText("à retrouver");
  await expect(status).toHaveClass(/deck-status-over/);
});

test("the screen says the cards are saved", async ({ page }) => {
  /**
   * That is what was missing: cards are written at every “±”, and nothing said
   * so. The earlier prototype displayed “unsaved” because it worked on a draft; we say the
   * reverse, and briefly.
   */
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008"]);
  await newDeck(page, "Mark");
  await showPanel(page, "collection");

  await expect(page.locator(".deck-saved")).toHaveCount(0);
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");
  // Then the mark fades: permanent, it would become decoration.
  await expect(page.locator(".deck-saved")).toHaveCount(0, { timeout: 4000 });
});

test("placed cards survive a reload", async ({ page }) => {
  // The question Ange was asking, and that the screen did not answer.
  await signUp(page);
  await stockCollection(page, ["LTGY-FR008", "LTGY-FR008"]);
  await newDeck(page, "Persistence");
  await showPanel(page, "collection");

  const plus = page.locator(".js-coll[data-d='1']").first();
  await plus.click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await plus.click();
  await expect(page.locator(".deck-counts")).toContainText("Main 2");

  await showPanel(page, "deck");
  await page.locator(".js-zone[data-d='-1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  await page.reload();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
});

test("Enter in the name field writes without waiting", async ({ page }) => {
  await signUp(page);
  await newDeck(page, "Keyboard");

  await page.locator("#edit-name").fill("By keyboard");
  await page.locator("#edit-name").press("Enter");
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("By keyboard");
});

test("leaving the field writes, without waiting for the typing delay", async ({ page }) => {
  await signUp(page);
  await newDeck(page, "By click");

  await page.locator("#edit-name").fill("Elsewhere");
  await page.locator("#edit-name").blur();
  await expect(page.locator(".deck-saved")).toContainText("Enregistré");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("Elsewhere");
});

test("an emptied name overwrites nothing: the field takes the deck's back", async ({ page }) => {
  // A deck always has a name. Rather than sending an empty string the server
  // would refuse, the field goes back to what it was.
  await signUp(page);
  await newDeck(page, "To empty");

  await page.locator("#edit-name").fill("   ");
  await page.locator("#edit-name").blur();
  await expect(page.locator(".toast")).toContainText("Donnez un nom");
  await expect(page.locator("#edit-name")).toHaveValue("To empty");

  await page.reload();
  await expect(page.locator("#edit-name")).toHaveValue("To empty");
});

test("the name field wears the application's styling", async ({ page }) => {
  /**
   * Reported by Ange: “a grey background that clashes with the UI”. The
   * `.menu-field` rule only targeted `select`; an `input` in the same block fell
   * back on the browser's default grey. The earlier prototype had the same flaw, and
   * transcribing it faithfully brought it along.
   */
  await signUp(page);
  await newDeck(page, "Styling");

  const field = page.locator("#edit-name");
  const background = await field.evaluate((n) => getComputedStyle(n).backgroundColor);
  // Browsers' default grey is light; ours is dark.
  const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b, `field background: ${background}`).toBeLessThan(120);

  // And it is framed like the other fields, not bare.
  const border = await field.evaluate((n) => getComputedStyle(n).borderTopWidth);
  expect(border).not.toBe("0px");
});

test("every deck wears the card back, whatever it holds", async ({ page }) => {
  /**
   * Ange, 2026-09-21: the most played card read as a random one, and the earlier prototype's
   * placeholder was asked for instead. A deck with cards and an empty one look
   * the same, and the back is really painted — not a missing URL.
   */
  await signUp(page);
  await stockCollection(page, ["SDCR-FR016"]);
  await newDeck(page, "Illustrated");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await createDeckHere(page, "Faceless");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  const covers = page.locator(".deck-tile-cover");
  await expect(covers).toHaveCount(2);
  await expect(page.locator("img.deck-tile-cover")).toHaveCount(0);
  for (const cover of await covers.all()) {
    await expect(cover).toHaveClass(/deck-cover-default/);
  }
  const painted = await covers.first().evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(painted).toMatch(/back.*\.svg|data:image\/svg/);
  // A built bundle inlines the small SVG; the dev server serves it, and it must be there.
  const source = painted.replace(/^url\("?|"?\)$/g, "");
  if (!source.startsWith("data:")) expect((await page.request.get(source)).ok()).toBe(true);
});

test("the toggle shows rows, and the board comes back", async ({ page }) => {
  // Gallery by default; the list as soon as there are many.
  await signUp(page);
  await newDeck(page, "Toggle");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await expect(page.locator(".deck-tiles")).toBeVisible();
  await page.locator('[data-list-view="list"]').click();
  await expect(page.locator(".drive-row")).toHaveCount(1);
  await expect(page.locator(".deck-tiles")).toHaveCount(0);

  await page.locator('[data-list-view="gallery"]').click();
  await expect(page.locator(".deck-tile")).toHaveCount(1);
});

test("the list's search filters without touching the network", async ({ page }) => {
  /**
   * We come back to the list through its link, not a reload.
   *
   * Two more `goto` per test were enough to trip the development server —
   * `ERR_TOO_MANY_RETRIES`, intermittently. And it is the real gesture anyway:
   * “Tous les decks” is there for that.
   */
  await signUp(page);
  await newDeck(page, "Dragons");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await newDeck(page, "Wizards");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await expect(page.locator(".deck-tile")).toHaveCount(2);
  await page.getByLabel("Rechercher un deck").fill("drag");
  await expect(page.locator(".deck-tile")).toHaveCount(1);
  await expect(page.locator(".deck-tile-name")).toHaveText("Dragons");
});

test("clicking a card in the workshop opens it full size", async ({ page }) => {
  /**
   * Asked for by Ange: “when I click a card from the workshop, it should zoom
   * like in the collection”. It is the same sheet — same component, same
   * classes. What changes is what you can do from there: put a copy in the
   * active zone.
   */
  await signUp(page);
  await stockCollection(page, ["LOB-FR001"]);
  await newDeck(page, "Sheet");
  await showPanel(page, "collection");

  await page.locator(".js-open-card").first().click();
  const sheet = page.locator("#inspect-panel");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".inspect-art")).toBeVisible();
  await expect(sheet).toContainText("Dragon Blanc aux Yeux Bleus");
  // The stats, as in the collection.
  await expect(sheet).toContainText("ATK / DEF");
  await expect(sheet).toContainText("Effet");
  // And what the collection does not have: where the card stands in this deck.
  await expect(sheet).toContainText("Zone active");
});

test("a card is placed from its sheet, without closing it", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LOB-FR001"]);
  await newDeck(page, "From the sheet");
  await showPanel(page, "collection");
  await page.locator(".js-open-card").first().click();

  const sheet = page.locator("#inspect-panel");
  await expect(sheet.locator(".in-deck-qty-label")).toHaveText("×0");
  await sheet.locator(".deck-open-btns .btn-primary").click();

  // The sheet stays open and updates: you carry on without reopening.
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".in-deck-qty-label")).toHaveText("×1");
});

test("the sheet closes on the backdrop, the cross and Escape", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["LOB-FR001"]);
  await newDeck(page, "Closing");
  await showPanel(page, "collection");

  const open = async () => {
    await page.locator(".js-open-card").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();
  };

  await open();
  await page.locator("#inspect-close").click();
  await expect(page.locator("#inspect-panel")).toHaveCount(0);

  await open();
  /**
   * `dispatchEvent` rather than `click`: the panel covers the backdrop's
   * centre, so Playwright would aim at the panel. What is tested here is the
   * handler, not the geometry — the backdrop's clickable area is what sticks
   * out around it, and it is visible to the eye.
   */
  await page.locator("#inspect-backdrop").dispatchEvent("click");
  await expect(page.locator("#inspect-panel")).toHaveCount(0);

  await open();
  await page.keyboard.press("Escape");
  await expect(page.locator("#inspect-panel")).toHaveCount(0);
});

test("the workshop's sheet freezes the page behind it", async ({ page }) => {
  /**
   * Same requirement as in the collection: two scrollbars on the same page make
   * you believe you are scrolling down the sheet while it is the workshop that
   * moves — and on closing, you are no longer where you were.
   */
  await signUp(page);
  await stockCollection(page, ["LOB-FR001", "LTGY-FR008", "RA03-FR004"]);
  await newDeck(page, "Lock");
  await showPanel(page, "collection");

  await page.locator(".js-open-card").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();
  // The body is fixed: that is the technique that also holds on iOS Safari.
  expect(await page.evaluate(() => document.body.style.position)).toBe("fixed");

  await page.locator("#inspect-close").click();
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
});

/* ── Folders ──────────────────────────────────────────────────────────────
 * Taken from the earlier prototype: navigation goes one level at a time, folders first,
 * decks next. Filing goes through the “⋯” menu and the move banner everywhere,
 * and through drag and drop on the desktop.
 */

test("a folder is created, entered, and left", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Meta");

  await page.locator(".folder-open", { hasText: "Meta" }).click();
  await expect(page.locator(".folder-path-step[aria-current='page']")).toHaveText("Meta");
  await expect(page.locator(".empty-title")).toHaveText("Dossier vide");

  // The “..” card carries the name of where it leads, not just two dots.
  await page.locator(".folder-tile-parent .folder-open").click();
  await expect(page.locator(".folder-path-step[aria-current='page']")).toHaveText("Racine");
});

test("a deck is born in the folder you are in", async ({ page }) => {
  // Creating then moving would mean two writes and a flicker.
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Storage");
  await page.locator(".folder-open", { hasText: "Storage" }).click();

  await createDeckHere(page, "Born inside");
  await expect(page.locator("#edit-name")).toHaveValue("Born inside");

  await page.getByRole("link", { name: "Tous les decks" }).click();
  // The root only shows the folder; the deck is inside.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await page.locator(".folder-open", { hasText: "Storage" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("Born inside");
});

test("a deck is filed into a folder from its menu", async ({ page }) => {
  await signUp(page);
  await newDeck(page, "To file");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await createFolder(page, "Box");

  await page.locator(".deck-tile-wrap .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  // You navigate: the current screen designates the destination.
  await expect(page.locator(".move-banner")).toContainText("To file");
  await page.locator(".folder-open", { hasText: "Box" }).click();
  await expect(page.locator(".move-banner")).toContainText("vers Box");
  await page.getByRole("button", { name: "Déplacer ici" }).click();

  // The banner closes, and the deck is where you were looking.
  await expect(page.locator(".move-banner")).toHaveCount(0);
  await expect(page.locator(".deck-tile-name")).toHaveText("To file");

  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  // It left the root, and is now in the folder.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");
  await page.locator(".folder-open", { hasText: "Box" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("To file");
});

test("discarding a folder moves its contents up, losing nothing", async ({ page }) => {
  /**
   * The earlier prototype's rule, and the right one: a folder is a filing place, not an
   * owner. Its database said the opposite, though.
   */
  await signUp(page);
  await newDeck(page, "Survivor");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await createFolder(page, "Ephemeral");

  await page.locator(".deck-tile-wrap .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();
  await page.locator(".folder-open", { hasText: "Ephemeral" }).click();
  await page.getByRole("button", { name: "Déplacer ici" }).click();
  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");

  page.once("dialog", (d) => d.accept());
  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Supprimer" }).click();

  await expect(page.locator(".folder-tile")).toHaveCount(0);
  await expect(page.locator(".deck-tile-name")).toHaveText("Survivor");
});

test("a folder is renamed from its menu", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Before");

  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Renommer" }).click();
  await page.locator("#modal-name").fill("After");
  await page.getByRole("button", { name: "Renommer" }).click();

  await expect(page.locator(".folder-name")).toHaveText("After");
});

test("a folder is not dropped into itself, and the banner says why", async ({ page }) => {
  /**
   * The screen refuses with the server's sentence — `folderCanHost`, the same
   * function. The button is greyed out, not hidden: a button that disappears
   * suggests the mode has stopped.
   */
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Alone");

  await page.locator(".folder-tile .folder-menu-btn").click();
  await page.getByRole("menuitem", { name: "Déplacer…" }).click();

  // At the root, it is already there.
  await expect(page.getByRole("button", { name: "Déplacer ici" })).toBeDisabled();
  await expect(page.locator(".move-banner-why")).toHaveText("Déjà ici");

  // Inside, it is itself.
  await page.locator(".folder-open", { hasText: "Alone" }).click();
  await expect(page.getByRole("button", { name: "Déplacer ici" })).toBeDisabled();
  await expect(page.locator(".move-banner-why")).toContainText("dans lui-même");

  // And you can give up.
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".move-banner")).toHaveCount(0);
});

test("in rows, the pill keeps its place", async ({ page }, info) => {
  /**
   * Reported by Ange: “the little ‘Incomplete’ pill looks odd on desktop”.
   * `.drive-main` declared three columns for four children — so the pill fell
   * onto an implicit row, alone, against the left edge, left even of the cover.
   * And the link having no `text-decoration`, everything in it was underlined.
   *
   * The three measurements are taken in a single pass: three successive
   * `boundingBox()` calls can straddle a repaint, and would then compare two
   * different states.
   */
  await signUp(page);
  await newDeck(page, "Measured");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator('[data-list-view="list"]').click();
  await expect(page.locator(".zone-pill")).toBeVisible();

  const measures = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".drive-main[data-drag-deck]")!;
    const box = (selector: string) => {
      const { top, bottom, left, right } = row.querySelector(selector)!.getBoundingClientRect();
      return { top, bottom, left, right, middle: (top + bottom) / 2 };
    };
    return {
      name: box(".drive-name"),
      pill: box(".zone-pill"),
      underline: getComputedStyle(row).textDecorationLine,
    };
  });

  // Never left of the name: that was the whole defect, on both formats.
  expect(measures.pill.left).toBeGreaterThanOrEqual(measures.name.left - 1);
  expect(measures.underline).toBe("none");

  if (info.project.name === "desktop") {
    // On a wide screen, it sits on the deck's line, after the counts.
    expect(Math.abs(measures.pill.middle - measures.name.middle)).toBeLessThan(6);
    expect(measures.pill.left).toBeGreaterThan(measures.name.right);
  } else {
    // On a phone, the row stacks on purpose: the pill moves below, aligned
    // with the name.
    expect(measures.pill.top).toBeGreaterThan(measures.name.bottom - 1);
  }
});

test("a deck is filed by dragging it onto a folder", async ({ page }, info) => {
  /**
   * Asked for by Ange on the desktop, where the gesture is natural — and which
   * The earlier prototype had. On a phone it does not exist: holding then aiming is not a
   * thumb gesture, and the banner renders the same service.
   */
  test.skip(info.project.name === "mobile", "drag and drop does not exist by finger");

  await signUp(page);
  await newDeck(page, "Dragged");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await createFolder(page, "Target");

  await page.locator(".deck-tile").dragTo(page.locator(".folder-tile"));

  await expect(page.locator(".deck-tile")).toHaveCount(0);
  await expect(page.locator(".folder-meta")).toHaveText("1 deck");
  await page.locator(".folder-open", { hasText: "Target" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("Dragged");
});

test("in rows too, a deck is dragged onto a folder", async ({ page }, info) => {
  /**
   * Reported by Ange: “drag and drop does not work in list mode?”. Rightly —
   * the attribute had not been set on the row, and both drag tests looked at
   * the gallery. A view without a test is a view that breaks in silence.
   */
  test.skip(info.project.name === "mobile", "drag and drop does not exist by finger");

  await signUp(page);
  await newDeck(page, "In a row");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await createFolder(page, "Locker");
  await page.locator('[data-list-view="list"]').click();

  await page
    .locator(".drive-main[data-drag-deck]")
    .dragTo(page.locator("li[data-drop]").first());

  await expect(page.locator("[data-drag-deck]")).toHaveCount(0);
  await expect(page.locator(".drive-meta").first()).toHaveText("1 deck");
});

test("in rows, a folder is dragged into another", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "drag and drop does not exist by finger");

  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Alpha");
  await createFolder(page, "Beta");
  await page.locator('[data-list-view="list"]').click();

  // Alpha comes first: drag it onto Beta.
  await page
    .locator("[data-drag-folder]").first()
    .dragTo(page.locator("[data-drag-folder]").last());

  /**
   * The array form, not the string: while the move is in flight, the selector
   * still targets two rows — `toHaveText("Beta")` then throws a strict-mode
   * error *without retrying*, and the test fails for a reason that is not the
   * one it measures. That is what made it look, for a while, as if dragging
   * did not work in rows.
   */
  await expect(page.locator(".drive-name")).toHaveText(["Beta"]);
  await page.locator(".drive-folder").click();
  await expect(page.locator(".drive-name")).toHaveText(["..", "Alpha"]);
});

test("a deck is moved up by dragging it onto the breadcrumb", async ({ page }, info) => {
  // The breadcrumb is a drop target: it is the shortest way out of a folder.
  test.skip(info.project.name === "mobile", "drag and drop does not exist by finger");

  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Inside");
  await page.locator(".folder-open", { hasText: "Inside" }).click();
  await createDeckHere(page, "To take out");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator(".folder-open", { hasText: "Inside" }).click();

  await page.locator(".deck-tile").dragTo(page.locator('.folder-path-step[data-drop=""]'));

  await expect(page.locator(".deck-tile")).toHaveCount(0);
  await page.locator(".folder-path-step", { hasText: "Racine" }).click();
  await expect(page.locator(".deck-tile-name")).toHaveText("To take out");
});

test("the search crosses folders, and says where each result comes from", async ({ page }) => {
  /**
   * The earlier prototype only filtered the current level: searching “dragon” and finding
   * nothing because you are in the wrong folder is a wrong answer to a simple
   * question.
   */
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "Hidden");
  await page.locator(".folder-open", { hasText: "Hidden" }).click();
  await createDeckHere(page, "White dragons");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  // Back at the root, where the deck is not.
  await expect(page.locator(".deck-tile-name")).toHaveCount(0);
  await page.getByLabel("Rechercher un deck").fill("dragons");
  await expect(page.locator(".deck-tile-name")).toHaveText("White dragons");
  await expect(page.locator(".deck-tile-meta").first()).toContainText("Hidden");
});

test("the creation window fits on the screen", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await page.getByRole("button", { name: "Construire un deck" }).click();

  await expect(page.locator(".deck-modal")).toBeVisible();
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
  // Escape closes it, like the sheet.
  await page.keyboard.press("Escape");
  await expect(page.locator(".deck-modal")).toHaveCount(0);
});

test("a folder name is displayed, never executed", async ({ page }) => {
  /**
   * A folder's name is written by the user and comes back out in five places:
   * the tile, the breadcrumb, the row, the move banner and the delete
   * confirmation. The template escapes by default — this test is here so that
   * it stays true the day someone adds a `raw()`.
   */
  await signUp(page);
  await page.goto("/decks");
  await createFolder(page, "<img src=x onerror=alert(1)>Trapped");

  await expect(page.locator(".folder-name")).toHaveText("<img src=x onerror=alert(1)>Trapped");
  await expect(page.locator(".folder-tile img")).toHaveCount(0);

  await page.locator(".folder-open").click();
  await expect(page.locator(".folder-path-step[aria-current='page']"))
    .toHaveText("<img src=x onerror=alert(1)>Trapped");
});

/* ── The deck sheet ───────────────────────────────────────────────────────
 * Proposed by Ange, taken from the earlier prototype: opening a deck **shows** it. It is also
 * what will make showing another player's deck possible without writing a
 * second screen — it will be enough not to display the pencil.
 */

test("opening a deck shows it, with nothing to write with", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["SDCR-FR027"]);
  await newDeck(page, "Showcase");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "Tous les decks" }).click();

  await page.locator(".deck-tile").click();

  // The card is there, and the deck reads.
  await expect(page.locator(".item-main")).toHaveCount(1);
  await expect(page.locator(".qty-pill")).toHaveText("×1");
  await expect(page.locator(".deck-counts")).toContainText("Main 1");

  // Nothing that writes exists on this screen.
  await expect(page.locator("#edit-name")).toHaveCount(0);
  await expect(page.locator(".js-coll, .js-zone")).toHaveCount(0);
  await expect(page.locator(".deck-stepper")).toHaveCount(0);
});

test("the pencil opens the workshop, and the address says so", async ({ page }) => {
  await signUp(page);
  await newDeck(page, "To edit");
  await page.getByRole("link", { name: "Tous les decks" }).click();
  await page.locator(".deck-tile").click();

  await page.getByRole("link", { name: "Modifier" }).click();

  await expect(page.locator("#edit-name")).toHaveValue("To edit");
  expect(page.url()).toContain("workshop=1");

  // And you come back to the sheet the way you came.
  await page.getByRole("link", { name: "Retour", exact: true }).click();
  await expect(page.locator("#edit-name")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "To edit" })).toBeVisible();
});

test("the sheet's tabs show one zone at a time", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["SDCR-FR028", "SDCR-FR028"]);
  await newDeck(page, "Two zones");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  // The same card, in the Side this time. The zone tabs live in the deck
  // panel, which the phone hides while you look at the collection.
  await showPanel(page, "deck");
  await page.locator('[data-zone="side"]').click();
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Side 1");

  await page.getByRole("link", { name: "Retour", exact: true }).click();
  // “All zones”: the same card holds two places, so two rows.
  await expect(page.locator(".item-main")).toHaveCount(2);

  await page.getByRole("tab", { name: /Main/ }).click();
  await expect(page.locator(".item-main")).toHaveCount(1);
  await expect(page.locator(".zone-pill")).toContainText("Main");

  await page.getByRole("tab", { name: /Side/ }).click();
  await expect(page.locator(".zone-pill")).toContainText("Side");
});

test("clicking a card on the sheet opens it full size", async ({ page }) => {
  /**
   * A deck row only carries its name, its artwork and its banlist status: the
   * full record is requested on opening, once per card.
   */
  await signUp(page);
  await stockCollection(page, ["SDCR-FR029"]);
  await newDeck(page, "Zoom");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "Retour", exact: true }).click();

  await page.locator(".item-main").click();
  await expect(page.locator(".inspect-panel")).toBeVisible();
  // The detail comes from the catalogue, not the row: the ATK proves it.
  await expect(page.locator(".inspect-panel")).toContainText("ATK");
  // And nothing to place a card: this sheet only shows.
  await expect(page.locator(".deck-open-actions")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.locator(".inspect-panel")).toHaveCount(0);
});

test("the deck sheet does not overflow", async ({ page }) => {
  await signUp(page);
  await stockCollection(page, ["SDCR-FR030"]);
  await newDeck(page, "A deck name long enough to put the layout to the test");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();
  await expect(page.locator(".deck-counts")).toContainText("Main 1");
  await page.getByRole("link", { name: "Retour", exact: true }).click();

  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.locator('[data-sheet-view="gallery"]').click();
  await expect(page.locator(".tile")).toHaveCount(1);
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("the size a deck aims for is the player's, and it moves the finish line", async ({ page }) => {
  /**
   * The rules allow 40 to 60 and both ends are playable, so which one a deck is
   * built towards is a decision only the player can make. What is measured here
   * is that the decision is **kept** and that it **changes the verdict** — a
   * picker that saves nothing would be the hollow affordance the earlier prototype had.
   */
  await signUp(page);
  await stockCollection(page, ["SDCR-FR014"]);
  await newDeck(page, "Aimed at sixty");
  await showPanel(page, "collection");
  await page.locator(".js-coll[data-d='1']").first().click();

  // Aimed at forty by default: one card in, thirty-nine to go.
  await expect(page.locator(".deck-status")).toContainText("encore 39");

  await page.getByRole("button", { name: "Options" }).click();
  await page.locator("#modal-target-main").selectOption("60");
  await page.getByRole("button", { name: "Appliquer" }).click();

  // The same deck, the same card: only the finish line moved.
  const status = page.locator(".deck-status");
  await expect(status).toContainText("encore 59");
  await expect(status).toContainText("objectif 60");
  await expect(status).toHaveClass(/deck-status-short/);

  // The denominator stays the rules' ceiling: it answers “how many more may I
  // legally add?”, which the target does not change.
  await expect(page.locator(".deck-counts")).toContainText("Main 1/60");

  // And it survives a reload: it was written, not just displayed.
  await page.reload();
  await expect(page.locator(".deck-status")).toContainText("objectif 60");
});

test("a deck aimed at forty is ready at forty, and the window opens on its own value", async ({ page }) => {
  /**
   * The other half of the promise: the target says when the deck is finished,
   * and reopening the window shows what was chosen rather than the default.
   */
  await signUp(page);
  await newDeck(page, "Kept choice");

  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.locator("#modal-target-main")).toHaveValue("40");
  await page.locator("#modal-target-main").selectOption("45");
  await page.getByRole("button", { name: "Appliquer" }).click();

  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.locator("#modal-target-main")).toHaveValue("45");

  // Cancelling writes nothing — the window closes on the value already saved.
  await page.locator("#modal-target-main").selectOption("60");
  await page.getByRole("button", { name: "Annuler" }).click();
  await page.getByRole("button", { name: "Options" }).click();
  await expect(page.locator("#modal-target-main")).toHaveValue("45");
});

test("the options window fits on the screen", async ({ page }) => {
  // The same measurement as the creation window: a native select is exactly
  // what pushes a modal past the viewport on a phone.
  await signUp(page);
  await newDeck(page, "Window size");
  await page.getByRole("button", { name: "Options" }).click();

  const modal = page.locator(".deck-modal");
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
});
