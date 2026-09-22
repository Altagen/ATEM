import { expect, test, type Browser, type Page } from "@playwright/test";
import { addBySetCode, expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * Someone else's collection and decks — M4, closed on 2026-09-21.
 *
 * Each duellist chooses who may look: friends by default, everyone, or nobody
 * else. What is shown is read-only: nothing on these screens may write.
 */

async function secondDuellist(browser: Browser) {
  const context = await browser.newContext({ ...test.info().project.use, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const account = await signUp(page);
  return { context, page, account };
}

const idOf = async (page: Page): Promise<string> =>
  ((await (await page.request.get("/api/auth/me")).json()) as { user: { id: string } }).user.id;

async function befriend(asker: Page, askedName: string, asked: Page, askerName: string) {
  await asker.goto("/community");
  await asker.locator("#duellist-search").fill(askedName);
  await asker.locator(".player-card-row-full").filter({ hasText: askedName })
    .getByRole("button", { name: /Ajouter en ami/ }).click();
  await expect(asker.getByText(/Demande d'ami envoyée/)).toBeVisible();
  await asked.goto("/community");
  await asked.locator("#duellist-search").fill(askerName);
  await asked.locator(".player-card-row-full").filter({ hasText: askerName })
    .getByRole("button", { name: "Accepter" }).click();
  await expect(asked.getByText(/Vous êtes désormais amis/)).toBeVisible();
}

test("a friend reads the collection and the decks, and can write nothing there", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const owner = await signUp(page);
  await addBySetCode(page, "LTGY-FR008");
  await page.goto("/decks");
  await page.getByRole("button", { name: "Construire un deck" }).click();
  await page.locator("#modal-name").fill("Shown deck");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("#edit-name")).toHaveValue("Shown deck");
  const ownerId = await idOf(page);

  const friend = await secondDuellist(browser);
  await befriend(friend.page, owner.displayName, page, friend.account.displayName);

  // The profile leads to both shelves.
  await friend.page.goto(`/profile?user=${ownerId}`);
  await friend.page.locator(".profile-shelves").getByRole("link", { name: /Collection/ }).click();
  await expect(friend.page.locator(".collection-visitor")).toContainText(`Collection de ${owner.displayName}`);
  await expect(friend.page.locator(".content").getByText("LTGY-FR008")).toBeVisible();
  // Read-only: no way to add, no “+”, no scanlist.
  await expect(friend.page.getByLabel("Ajouter par set code")).toHaveCount(0);
  await expect(friend.page.locator(".js-delta, .js-fav")).toHaveCount(0);
  await expect(friend.page.getByRole("link", { name: /Scanlistes/ })).toHaveCount(0);
  expect(await expectNoHorizontalOverflow(friend.page)).toBe(0);

  await friend.page.goto(`/profile?user=${ownerId}`);
  await friend.page.locator(".profile-shelves").getByRole("link", { name: /Decks/ }).click();
  await expect(friend.page.getByRole("heading", { name: `Decks de ${owner.displayName}` })).toBeVisible();
  await expect(friend.page.getByRole("button", { name: "Construire un deck" })).toHaveCount(0);
  await expect(friend.page.getByRole("button", { name: "Nouveau dossier" })).toHaveCount(0);
  await expect(friend.page.locator(".folder-menu-btn")).toHaveCount(0);
  await friend.page.getByRole("link", { name: /Shown deck/ }).click();
  await expect(friend.page.getByRole("heading", { name: "Shown deck" })).toBeVisible();
  await expect(friend.page.locator("#btn-edit-deck, #btn-delete")).toHaveCount(0);
  // Even asked for by its address, the workshop does not open on someone else's deck.
  await friend.page.goto(`${friend.page.url()}&workshop=1`);
  await expect(friend.page.locator("#edit-name")).toHaveCount(0);
  await expect(friend.page.getByRole("heading", { name: "Shown deck" })).toBeVisible();
  expect(await expectNoHorizontalOverflow(friend.page)).toBe(0);

  await friend.context.close();
});

test("a stranger is told nothing is shared, until the owner opens it to everyone", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const owner = await signUp(page);
  const ownerId = await idOf(page);
  const stranger = await secondDuellist(browser);

  await stranger.page.goto(`/profile?user=${ownerId}`);
  await expect(stranger.page.getByText(`${owner.displayName} ne partage ni sa collection ni ses decks avec vous.`))
    .toBeVisible();
  await stranger.page.goto(`/collection?user=${ownerId}`);
  await expect(stranger.page.getByText(`${owner.displayName} ne partage pas sa collection avec vous.`)).toBeVisible();

  // The owner opens the collection, and only it.
  await page.goto("/settings");
  await page.getByRole("button", { name: /Confidentialité/ }).click();
  await page.locator('input[name="visibility-collection"][value="everyone"]').check();
  await expect(page.getByText("Enregistré")).toBeVisible();
  expect(await expectNoHorizontalOverflow(page)).toBe(0);

  await stranger.page.goto(`/profile?user=${ownerId}`);
  await expect(stranger.page.locator(".profile-shelves").getByRole("link", { name: /Collection/ })).toBeVisible();
  await expect(stranger.page.locator(".profile-shelves").getByRole("link", { name: /Decks/ })).toHaveCount(0);
  await stranger.page.goto(`/decks?user=${ownerId}`);
  await expect(stranger.page.getByText(`${owner.displayName} ne partage pas ses decks avec vous.`)).toBeVisible();

  await stranger.context.close();
});
