import { expect, test, type Page } from "@playwright/test";
import { addBySetCode, expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * The settings screen — ATEM-old's, onto routes built for it.
 *
 * Each test measures what a person can do and what they see, never the markup
 * that produces it: the screen is free to change shape as long as these hold.
 */

const isPhone = () => test.info().project.name === "mobile";

/** Settings, reached the way a person reaches them on this device. */
async function openSettings(page: Page) {
  if (isPhone()) {
    await page.getByRole("button", { name: "Mon compte" }).click();
    await page.locator("#account-sheet").getByRole("link", { name: /Paramètres/ }).click();
  } else {
    await page.locator("#user-menu-button").click();
    await page.getByRole("menuitem", { name: /Paramètres/ }).click();
  }
  await page.waitForURL("**/settings");
}

test("settings are reachable from the navigation, on a phone and on a computer", async ({ page }) => {
  /**
   * Asked for by Ange. On a computer the top bar showed the name as plain text,
   * so settings could not be reached at all; the phone's account sheet read the
   * account group and found nothing in it.
   */
  await signUp(page);
  await openSettings(page);
  await expect(page.getByRole("heading", { name: /Paramètres/ })).toBeVisible();
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("renaming shows the new name everywhere, and keeps the number", async ({ page }) => {
  const account = await signUp(page);
  await openSettings(page);
  await page.locator('[data-target-view="account"]').click();

  const tagBefore = await page.locator("#form-display-name .legende").first().textContent();
  const renamed = `Renamed ${Date.now().toString().slice(-5)}`;
  await page.locator("#input-display-name").fill(renamed);
  await page.getByRole("button", { name: "Renommer" }).click();

  await expect(page.locator("#input-display-name")).toHaveValue(renamed);
  await expect(page.locator("#form-display-name .legende").first()).toHaveText(tagBefore ?? "");
  expect(account.displayName).not.toBe(renamed);

  // The navigation carries the name too, and must not keep the old one.
  if (!isPhone()) await expect(page.locator("#user-menu-button")).toContainText(renamed);
});

test("a password change keeps you signed in, and the new one opens the door", async ({ page, browser }) => {
  const account = await signUp(page);
  await openSettings(page);
  await page.locator('[data-target-view="security"]').click();

  const next = "Un-Nouveau-Passe-9!!";

  // Mismatched confirmation: refused on the spot, the server is not asked.
  await page.locator("#input-current-password").fill(account.password);
  await page.locator("#input-new-password").fill(next);
  await page.locator("#input-confirm-password").fill(`${next}x`);
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(page.getByText("Les deux nouveaux mots de passe ne correspondent pas.")).toBeVisible();

  await page.locator("#input-confirm-password").fill(next);
  await page.getByRole("button", { name: "Changer le mot de passe" }).click();
  await expect(page.getByText(/Mot de passe changé/)).toBeVisible();

  // Still signed in here: the collection opens without a detour through sign-in.
  await page.goto("/collection");
  await expect(page).toHaveURL(/\/collection/);

  // And from a fresh browser, only the new password works.
  const fresh = await browser.newPage();
  await fresh.goto("/login");
  await fresh.getByLabel("Adresse e-mail").fill(account.email);
  await fresh.getByLabel("Mot de passe").fill(next);
  await fresh.getByRole("button", { name: "Se connecter" }).click();
  await fresh.waitForURL("**/collection");
  await fresh.close();
});

test("erasing the collection can be cancelled until the last second", async ({ page }) => {
  /**
   * ATEM-old's gesture: type “collection”, then five seconds to change your
   * mind, during which nothing has been sent — so cancelling is real, not an
   * apology after the fact.
   */
  await signUp(page);
  await addBySetCode(page, "SDCR-FR010");
  await openSettings(page);
  await page.locator('[data-target-view="danger"]').click();

  await page.locator("#btn-open-clear").click();
  const erase = page.locator("#form-clear button[type=submit]");
  await expect(erase).toBeDisabled();
  await page.locator("#input-clear-word").fill("collection");
  await expect(erase).toBeEnabled();
  await erase.click();

  await expect(page.locator("#clear-undo")).toBeVisible();
  await page.locator("#btn-cancel-clear").click();
  await expect(page.locator("#clear-undo")).toBeHidden();

  // Well past the delay: nothing was erased.
  await page.waitForTimeout(6_000);
  await page.goto("/collection");
  await expect(page.locator(".content").getByText("SDCR-FR010").first()).toBeVisible();
});

test("letting the countdown run erases the collection", async ({ page }) => {
  await signUp(page);
  await addBySetCode(page, "SDCR-FR011");
  await openSettings(page);
  await page.locator('[data-target-view="danger"]').click();

  await page.locator("#btn-open-clear").click();
  await page.locator("#input-clear-word").fill("collection");
  await page.locator("#form-clear button[type=submit]").click();

  // One card was added, so the sentence is the singular one — measured exactly.
  await expect(page.getByText("1 édition effacée de votre collection.")).toBeVisible({ timeout: 10_000 });
  await page.goto("/collection");
  await expect(page.getByText(/Aucune carte/)).toBeVisible();
});

test("deleting the account waits for all three guards, then signs you out for good", async ({ page }) => {
  const account = await signUp(page);
  await openSettings(page);
  await page.locator('[data-target-view="danger"]').click();
  await page.locator("#btn-open-delete").click();

  const confirm = page.locator("#form-delete button[type=submit]");
  await expect(confirm).toBeDisabled();

  // Each guard alone leaves the button inert: a button that would answer 403 is
  // a promise the screen does not keep.
  await page.locator("#input-delete-phrase").fill("supprimer mon compte");
  await expect(confirm).toBeDisabled();
  await page.locator("#input-delete-password").fill(account.password);
  await expect(confirm).toBeDisabled();
  await page.locator("#input-delete-ack").check();
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await page.waitForURL("**/login");

  // The account is gone: its credentials no longer sign anyone in.
  await page.getByLabel("Adresse e-mail").fill(account.email);
  await page.getByLabel("Mot de passe").fill(account.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("the collection downloads as CSV, in the format chosen", async ({ page }) => {
  /**
   * The download is a real link to the route, so this measures what a person
   * gets: a file with a BOM, named for its format, holding their card.
   */
  await signUp(page);
  await addBySetCode(page, "SDCR-FR012");
  await openSettings(page);
  await page.locator('[data-target-view="export"]').click();

  // Choosing Cardmarket changes the preview to its semicolon header.
  await page.locator('input[name="export-format"][value="cardmarket"]').check();
  await expect(page.locator(".export-preview")).toHaveText(
    "Card Name;Card Number;Quantity;Rarity;Language;Comments",
  );

  // Clicking starts a download, named for the format.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#btn-export-run").click(),
  ]);
  expect(download.suggestedFilename()).toBe("cardmarket_collection.csv");

  /**
   * The bytes are read from the link's own address, with this page's session.
   *
   * Reading them from the downloaded file was tried first: in this harness the
   * browser cancelled that download before it was written, in this spec file
   * only, and an identical copy of the test elsewhere did not reproduce it. The
   * cause was not found, so it is stated here rather than guessed. What a person
   * receives is what the link serves, and that is measured directly.
   */
  const href = await page.locator("#btn-export-run").getAttribute("href");
  expect(href).toBe("/api/collection/export?format=cardmarket");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  const bytes = await response.body();
  expect([...bytes.subarray(0, 3)], "UTF-8 BOM").toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  expect(text.split("\n")[0]).toBe("Card Name;Card Number;Quantity;Rarity;Language;Comments");
  expect(text).toContain("SDCR-FR012");

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("a file is read before sending, then imported, and the report says what happened", async ({ page }) => {
  /**
   * The file is read in the browser with the server's own parser, so the panel
   * counts what it will import and names the unreadable lines before anything is
   * sent. ATEM-old counted by splitting on line breaks and showed no error first.
   */
  await signUp(page);
  await openSettings(page);
  await page.locator('[data-target-view="import"]').click();

  const run = page.locator("#btn-import-run");
  await expect(run).toBeDisabled();

  await page.locator("#import-file").setInputFiles({
    name: "ma-collection.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('set_code,quantity,notes\nSDCR-FR010,2,"deux\nlignes"\n,5,\nSDCR-FR011,1,\n'),
  });

  // Two cards to import; the line without a set code is named before sending.
  await expect(page.locator(".import-summary").first()).toContainText("ma-collection.csv");
  await expect(page.locator(".import-summary").first()).toContainText("2 cartes à importer");
  await expect(page.locator(".import-errors").first()).toContainText("Ligne 4");
  await expect(run).toBeEnabled();

  await run.click();
  await expect(page.locator("#import-report")).toContainText("2 importées");

  await page.goto("/collection");
  await expect(page.locator(".content").getByText("SDCR-FR010").first()).toBeVisible();
  await expect(page.locator(".content").getByText("SDCR-FR011").first()).toBeVisible();
});

test("replace warns before it runs, and the history keeps the import across reloads", async ({ page }) => {
  await signUp(page);
  await openSettings(page);
  await page.locator('[data-target-view="import"]').click();

  await page.locator('input[name="import-mode"][value="replace"]').check();
  await page.locator("#import-file").setInputFiles({
    name: "remplacement.csv", mimeType: "text/csv", buffer: Buffer.from("set_code\nSDCR-FR012\n"),
  });
  await expect(page.getByText(/En mode Remplacer, toutes les cartes/)).toBeVisible();
  await page.locator("#btn-import-run").click();
  await expect(page.locator("#import-report")).toContainText("1 importée");

  // The history is the server's: it is still there after a reload.
  await page.reload();
  await page.locator('[data-target-view="history"]').click();
  const table = page.locator(".admin-table");
  await expect(table).toContainText("remplacement.csv");
  await expect(table).toContainText("Remplacer");
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("M3 done: export, erase everything, import back, and the collection is identical", async ({ page }) => {
  /**
   * The milestone's own definition of done (docs/03-roadmap.md), taken literally
   * and on one account, through the screens a person uses.
   */
  await signUp(page);
  for (const code of ["SDCR-FR010", "SDCR-FR011", "SDCR-FR012"]) await addBySetCode(page, code);
  await addBySetCode(page, "SDCR-FR010"); // a second copy: quantities must survive too

  const snapshot = async () => {
    const response = await page.request.get("/api/collection/export?format=atem");
    return (await response.text()).replace(/^﻿/, "");
  };
  const before = await snapshot();
  expect(before).toContain("SDCR-FR010,");

  // 1. Export — the file a person keeps.
  const exported = Buffer.from(await (await page.request.get("/api/collection/export?format=atem")).body());

  // 2. Erase everything, through the danger zone.
  await openSettings(page);
  await page.locator('[data-target-view="danger"]').click();
  await page.locator("#btn-open-clear").click();
  await page.locator("#input-clear-word").fill("collection");
  await page.locator("#form-clear button[type=submit]").click();
  await expect(page.getByText(/effacées? de votre collection/)).toBeVisible({ timeout: 10_000 });
  expect((await snapshot()).trim().split("\n")).toHaveLength(1); // header only

  // 3. Import the file back.
  await page.goto("/settings");
  await page.locator('[data-target-view="import"]').click();
  await page.locator("#import-file").setInputFiles({ name: "collection.csv", mimeType: "text/csv", buffer: exported });
  await page.locator("#btn-import-run").click();
  await expect(page.locator("#import-report")).toContainText("3 importées");

  // 4. Identical.
  expect(await snapshot()).toBe(before);
});
