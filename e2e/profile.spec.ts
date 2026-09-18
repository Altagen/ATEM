import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * The profile — your own, and anyone's through the link it shares.
 *
 * Each test measures what a person can do and see, never the markup behind it.
 */

const isPhone = () => test.info().project.name === "mobile";

/** My profile, reached the way a person reaches it on this device. */
async function openMyProfile(page: Page) {
  if (isPhone()) {
    await page.getByRole("button", { name: "Mon compte" }).click();
    await page.locator("#account-sheet").getByRole("link", { name: /Mon profil/ }).click();
  } else {
    await page.locator("#user-menu-button").click();
    await page.getByRole("menuitem", { name: /Mon profil/ }).click();
  }
  await page.waitForURL("**/profile");
}

test("my profile is reachable from the navigation, and says what is empty", async ({ page }) => {
  const account = await signUp(page);
  await openMyProfile(page);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(account.displayName);
  await expect(page.getByText(/Pas encore de bio/)).toBeVisible();
  await expect(page.getByText("Aucun duel enregistré")).toBeVisible();
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("editing counts the bio, refuses the overflow, and saves name, bio and avatar together", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Modifier le profil" }).click();

  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", { name: "Enregistrer les modifications" });
  const bio = dialog.getByLabel(/Bio/);

  // Over the bound: the whole text is kept, the counter says how much is too much.
  await bio.fill("x".repeat(258));
  await expect(dialog.getByText("3 caractère(s) de trop — retirez-en pour enregistrer.")).toBeVisible();
  await expect(bio).toHaveValue("x".repeat(258));
  await expect(save).toBeDisabled();

  const renamed = `Profiled ${Date.now().toString().slice(-5)}`;
  await dialog.getByLabel("Pseudo").fill(renamed);
  await bio.fill("Blue-Eyes, always.\nSaturday locals.");
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: /Occulte/ }).click();
  await save.click();

  await expect(page.getByText("Profil enregistré.")).toBeVisible();
  await expect(dialog).toBeHidden();

  // Read back from the server, not from what the screen remembers.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(renamed);
  await expect(page.getByText(/Blue-Eyes, always\./)).toBeVisible();
  await expect(page.getByRole("img", { name: "Occulte" })).toBeVisible();
  if (!isPhone()) {
    // The navigation's avatar button follows the choice, and its menu names you.
    const avatar = page.locator("#user-menu-button");
    await expect(avatar).toHaveText("🔮");
    await expect(avatar).toHaveAttribute("title", new RegExp(`^${renamed} #`));
    await avatar.click();
    await expect(page.locator("#user-menu")).toContainText(renamed);
  }
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("cancelling or pressing Escape leaves the profile as it was", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Modifier le profil" }).click();
  await page.getByRole("dialog").getByLabel(/Bio/).fill("Never saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Modifier le profil" }).click();
  await expect(page.getByRole("dialog").getByLabel(/Bio/)).toHaveValue("");
  await page.getByRole("dialog").getByRole("button", { name: "Annuler" }).click();

  await page.reload();
  await expect(page.getByText("Never saved")).toHaveCount(0);
});

test("the shared link opens the profile for another duellist, who cannot edit it", async ({ page, browser }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const owner = await signUp(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Partager le profil" }).click();
  await expect(page.getByText("Lien du profil copié.")).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/profile\?user=[0-9a-f-]{36}$/);

  const visitorContext = await browser.newContext({
    ...test.info().project.use,
    baseURL: test.info().project.use.baseURL,
  });
  const visitor = await visitorContext.newPage();
  await signUp(visitor);
  await visitor.goto(new URL(link).pathname + new URL(link).search);

  await expect(visitor.getByRole("heading", { level: 1 })).toContainText(owner.displayName);
  // A profile carries no deck list: decided with Ange on 2026-09-18.
  // …“Decks” in the navigation bar is not the profile's doing, hence `main`.
  await expect(visitor.locator("main").getByText("Decks", { exact: true })).toHaveCount(0);
  await expect(visitor.getByRole("button", { name: "Modifier le profil" })).toHaveCount(0);
  // An empty bio is not announced to someone else: the hint is for the owner.
  await expect(visitor.getByText(/Pas encore de bio/)).toHaveCount(0);
  expect(await expectNoHorizontalOverflow(visitor)).toBe(0);
  await visitorContext.close();
});

test("an address that leads to nobody says so", async ({ page }) => {
  await signUp(page);
  await page.goto("/profile?user=0b6f7c1e-7a0e-4c55-9d7e-3f0a6f1b2c3d");
  await expect(page.getByText("Profil introuvable")).toBeVisible();
  await expect(page.getByText("Aucun duelliste ne répond à cette adresse.")).toBeVisible();
});
