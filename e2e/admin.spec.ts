import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, freshAccount, signUp } from "./helpers.js";

/**
 * The console — the instance's one administrator, declared in `.env`
 * (`scripts/e2e.sh` loads it), who only administers.
 */

const ADMIN = {
  email: process.env.ATEM_ADMIN_EMAIL ?? "",
  password: process.env.ATEM_ADMIN_PASSWORD ?? "",
};

async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function otherBrowser(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, ignoreHTTPSErrors: true });
  return { context, page: await context.newPage() };
}

test.beforeAll(() => {
  if (!ADMIN.email || !ADMIN.password) {
    throw new Error("ATEM_ADMIN_EMAIL and ATEM_ADMIN_PASSWORD must be set — run through `pnpm e2e`.");
  }
});

test("the administrator lands on the console, and has nothing else", async ({ page }) => {
  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.waitForURL("**/admin");
  await expect(page.getByRole("heading", { name: /Administration/ })).toBeVisible();
  await expect(page.locator(".admin-figures .showcase-stat")).toHaveCount(3);
  await expect(page.locator(".app-inbox")).toHaveCount(0);

  // A player's screen sends it back to the console.
  await page.goto("/collection");
  await page.waitForURL("**/admin");
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
});

test("an account the administrator opens starts by choosing its own password", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.waitForURL("**/admin");
  await page.getByRole("button", { name: /Comptes/ }).click();
  await page.getByRole("button", { name: /Créer un compte/ }).click();

  const player = freshAccount();
  const temporary = "Temporary-Pass-42!";
  await page.getByLabel("Adresse e-mail").fill(player.email);
  await page.getByLabel("Pseudo").fill(player.displayName);
  await page.getByLabel("Mot de passe temporaire").fill(temporary);
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page.getByText(/peut maintenant se connecter/)).toBeVisible();
  const row = page.locator(".player-card-row-full").filter({ hasText: player.email });
  await expect(row.getByText("Ne s'est pas encore connecté")).toBeVisible();
  expect(await expectNoHorizontalOverflow(page)).toBe(0);

  const other = await otherBrowser(browser);
  await signInAs(other.page, player.email, temporary);
  await other.page.waitForURL("**/change-password");
  await expect(other.page.locator(".app-bar, .global-mobile-bottom-nav")).toHaveCount(0);
  await other.page.goto("/decks");
  await other.page.waitForURL("**/change-password");
  await other.page.getByLabel("Mot de passe donné par l'administrateur").fill(temporary);
  await other.page.getByLabel("Nouveau mot de passe").fill(player.password);
  await other.page.getByLabel("Confirmation du mot de passe").fill(player.password);
  await other.page.getByRole("button", { name: "Choisir ce mot de passe" }).click();
  await other.page.waitForURL("**/collection");
  await other.context.close();
});

test("suspending shuts a player out, restoring lets them back, deleting erases them", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const other = await otherBrowser(browser);
  const player = await signUp(other.page);

  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.waitForURL("**/admin");
  await page.getByRole("button", { name: /Comptes/ }).click();
  await page.locator("#account-search").fill(player.email);
  const row = page.locator(".player-card-row-full").filter({ hasText: player.email });
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: "Suspendre" }).click();
  await expect(row.getByText(/Suspendu le/)).toBeVisible();
  // The suspended player's session is over: the next screen asks them to sign in.
  await other.page.goto("/decks");
  await other.page.waitForURL("**/login**");

  await row.getByRole("button", { name: "Réactiver" }).click();
  await expect(row.getByRole("button", { name: "Suspendre" })).toBeVisible();

  await row.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page.getByText(/est supprimé/)).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.getByRole("button", { name: /Journal/ }).click();
  await expect(page.locator(".admin-log-line").filter({ hasText: player.displayName }).first())
    .toContainText("Compte supprimé");
  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await other.context.close();
});

test("closed registration is said on the sign-up page, and reopening brings the form back", async ({ page, browser }) => {
  await signInAs(page, ADMIN.email, ADMIN.password);
  await page.waitForURL("**/admin");
  const visitor = await otherBrowser(browser);
  try {
    await page.locator('input[name="registration"][value="closed"]').check();
    await expect(page.getByText("Les inscriptions sont fermées.")).toBeVisible();
    await visitor.page.goto("/register");
    await expect(visitor.page.locator("[data-registration-closed]")).toBeVisible();
    await expect(visitor.page.getByRole("button", { name: "Créer mon compte" })).toHaveCount(0);
  } finally {
    // The instance is shared by every test: it is reopened whatever happened.
    await page.locator('input[name="registration"][value="open"]').check();
    await expect(page.getByText("Les inscriptions sont ouvertes.")).toBeVisible();
  }
  await visitor.page.goto("/register");
  await expect(visitor.page.getByRole("button", { name: "Créer mon compte" })).toBeVisible();
  await visitor.context.close();
});

test("a player never reaches the console", async ({ page }) => {
  await signUp(page);
  await page.goto("/admin");
  await page.waitForURL("**/collection");
  await expect(page.getByRole("link", { name: /Administration/ })).toHaveCount(0);
});
