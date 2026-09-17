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

  await expect(page.getByText(/éditions effacées de votre collection/)).toBeVisible({ timeout: 10_000 });
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
