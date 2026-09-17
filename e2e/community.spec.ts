import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * The duellist directory, and the relations it carries.
 *
 * Friendship is one row for two people: nearly everything that can go wrong is a
 * matter of symmetry, so these tests always look from both sides.
 */

/** A second signed-in duellist, in their own browser. */
async function otherDuellist(browser: import("@playwright/test").Browser, page: Page) {
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL: test.info().project.use.baseURL,
    ignoreHTTPSErrors: true,
  });
  const tab = await context.newPage();
  const account = await signUp(tab);
  void page;
  return { context, page: tab, account };
}

const row = (page: Page, name: string) =>
  page.locator(".player-card-row-full").filter({ hasText: name });

const search = async (page: Page, text: string) => {
  await page.locator("#duellist-search").fill(text);
  await expect(page.locator(".player-card-row-full")).toHaveCount(1);
};

test("a friendship goes: asked, waiting, accepted — seen from both sides", async ({ page, browser }) => {
  const asker = await signUp(page);
  const asked = await otherDuellist(browser, page);

  await page.goto("/community");
  await search(page, asked.account.displayName);
  await row(page, asked.account.displayName).getByRole("button", { name: /Ajouter en ami/ }).click();
  await expect(page.getByText(/Demande d'ami envoyée/)).toBeVisible();
  await expect(row(page, asked.account.displayName).getByRole("button", { name: /Annuler la demande/ })).toBeVisible();

  // The other side sees a request to answer, not one they sent.
  await asked.page.goto("/community");
  await search(asked.page, asker.displayName);
  const theirs = row(asked.page, asker.displayName);
  await expect(theirs.getByRole("button", { name: "Accepter" })).toBeVisible();
  await theirs.getByRole("button", { name: "Accepter" }).click();
  await expect(asked.page.getByText(/Vous êtes désormais amis/)).toBeVisible();

  // And the first sees it after a reload, with the star and the friends chip.
  await page.reload();
  await search(page, asked.account.displayName);
  await expect(row(page, asked.account.displayName).getByText("⭐")).toBeVisible();
  await page.locator("#duellist-search").fill("");
  await page.getByRole("button", { name: /Mes amis \(1\)/ }).click();
  await expect(page.locator(".player-card-row-full")).toHaveCount(1);

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await asked.context.close();
});

test("blocking hides the duellist on both sides, and unblocking brings them back", async ({ page, browser }) => {
  const blocker = await signUp(page);
  const other = await otherDuellist(browser, page);

  // Blocking is done from the profile: it is where you are when you decide to.
  await page.goto("/community");
  await search(page, other.account.displayName);
  await row(page, other.account.displayName).getByRole("link", { name: other.account.displayName }).click();
  await page.waitForURL("**/profile?user=**");
  await page.getByRole("button", { name: /Bloquer/ }).click();
  await expect(page.getByText(/a été bloqué/)).toBeVisible();

  // Gone from the directory, and their profile is not reachable any more.
  await page.goto("/community");
  await page.locator("#duellist-search").fill(other.account.displayName);
  await expect(page.getByText("Aucun duelliste")).toBeVisible();

  // The other side no longer sees us either.
  await other.page.goto("/community");
  await other.page.locator("#duellist-search").fill(blocker.displayName);
  await expect(other.page.getByText("Aucun duelliste")).toBeVisible();

  await page.getByRole("button", { name: /Bloqués/ }).click();
  await expect(page.locator(".player-card-row-full")).toHaveCount(1);
  await page.getByRole("button", { name: "Débloquer" }).click();
  await expect(page.getByText(/est débloqué/)).toBeVisible();

  await page.getByRole("button", { name: /Tous les duellistes/ }).click();
  await search(page, other.account.displayName);
  await expect(row(page, other.account.displayName).getByRole("button", { name: /Ajouter en ami/ })).toBeVisible();
  await other.context.close();
});

test("the directory is reachable from the navigation and searches by number", async ({ page, browser }) => {
  await signUp(page);
  const other = await otherDuellist(browser, page);

  await page.goto("/collection");
  await page.getByRole("link", { name: /Communauté/ }).click();
  await page.waitForURL("**/community");

  // The number, as people give it out.
  const tag = await other.page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { tag: string } }).user.tag);
  await page.locator("#duellist-search").fill(`#${tag}`);
  await expect(row(page, other.account.displayName)).toBeVisible();

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await other.context.close();
});
