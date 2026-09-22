import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * The inbox: what is waiting, and what answering it does.
 *
 * The rule under all of it: a line never outlives what it talks about.
 */

const isPhone = () => test.info().project.name === "mobile";

/** The inbox, reached the way a person reaches it on this device. */
async function openInbox(page: Page) {
  if (isPhone()) {
    await page.getByRole("button", { name: "Mon compte" }).click();
    await page.locator("#account-sheet").getByRole("link", { name: /Boîte de réception/ }).click();
  } else {
    await page.locator(".app-bar-right").getByRole("link", { name: /Boîte de réception/ }).click();
  }
  await page.waitForURL("**/inbox");
}

async function otherDuellist(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL: test.info().project.use.baseURL,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const account = await signUp(page);
  const id = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  return { context, page, account, id };
}

test("a friend request waits in the inbox, is accepted there, and the sender is told", async ({ page, browser }) => {
  const me = await signUp(page);
  const asker = await otherDuellist(browser);

  const mine = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  await asker.page.evaluate(async (target) => {
    await fetch(`/api/community/friends/${target}`, { method: "POST" });
  }, mine);

  // The count reaches the navigation without a reload… within the minute.
  await page.reload();
  await openInbox(page);
  await expect(page.getByText(`${asker.account.displayName} souhaite vous ajouter en ami.`)).toBeVisible();

  await page.getByRole("button", { name: "Accepter" }).click();
  await expect(page.getByText("Demande d'ami acceptée.")).toBeVisible();
  // Answered: the line that offered to accept it is gone.
  await expect(page.getByText("Rien en attente")).toBeVisible();

  // And the sender learns it, in their own inbox.
  await asker.page.goto("/inbox");
  await expect(asker.page.getByText(`${me.displayName} a accepté votre demande d'ami.`)).toBeVisible();

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await asker.context.close();
});

test("declining leaves nothing behind, on either side", async ({ page, browser }) => {
  await signUp(page);
  const asker = await otherDuellist(browser);
  const mine = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  await asker.page.evaluate(async (target) => {
    await fetch(`/api/community/friends/${target}`, { method: "POST" });
  }, mine);

  await page.goto("/inbox");
  await page.getByRole("button", { name: "Refuser" }).click();
  await expect(page.getByText("Demande d'ami refusée.")).toBeVisible();
  await expect(page.getByText("Rien en attente")).toBeVisible();

  // The other side is back to being able to ask again.
  await asker.page.goto("/community");
  await asker.page.locator("#duellist-search").fill(mine);
  await asker.page.goto("/inbox");
  await expect(asker.page.getByText("Rien en attente")).toBeVisible();
  await asker.context.close();
});

test("the badge appears on its own, without reloading the page", async ({ page, browser }) => {
  /**
   * The maintainer, on 2026-09-19: he was on another screen when a request arrived and
   * had to refresh to see it. The count is asked for every five seconds now.
   */
  await signUp(page);
  await page.goto("/collection");
  await expect(page.locator(".app-inbox-dot")).toHaveCount(0);

  const asker = await otherDuellist(browser);
  const mine = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  await asker.page.evaluate(async (target) => {
    await fetch(`/api/community/friends/${target}`, { method: "POST" });
  }, mine);

  if (isPhone()) {
    // On a phone the count is in the account sheet; the bar has no bell.
    await expect.poll(async () => {
      await page.getByRole("button", { name: "Mon compte" }).click();
      const seen = await page.locator(".account-sheet-count").count();
      await page.locator("#account-sheet .icon-btn").click();
      return seen;
    }, { timeout: 15_000 }).toBe(1);
  } else {
    // No reload, no navigation: the page was left alone.
    await expect(page.locator(".app-inbox-dot")).toHaveText("1", { timeout: 15_000 });
  }
  await asker.context.close();
});

test("an empty inbox says so, and a read one stops claiming to be waiting", async ({ page, browser }) => {
  await signUp(page);
  await page.goto("/inbox");
  await expect(page.getByText("Rien en attente")).toBeVisible();

  const asker = await otherDuellist(browser);
  const mine = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  await asker.page.evaluate(async (target) => {
    await fetch(`/api/community/friends/${target}`, { method: "POST" });
  }, mine);

  // The badge appears where this device shows it — seen from another screen,
  // since opening the inbox is what clears it.
  await page.goto("/collection");
  if (isPhone()) {
    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(page.locator(".account-sheet-count")).toHaveText("1");
    await page.locator("#account-sheet").getByRole("link", { name: /Boîte de réception/ }).click();
  } else {
    await expect(page.locator(".app-inbox-dot")).toHaveText("1");
    await page.locator(".app-bar-right").getByRole("link", { name: /Boîte de réception/ }).click();
  }
  await page.waitForURL("**/inbox");

  // Opening it is reading it: the badge goes, here and after a reload.
  await expect(page.locator(".app-inbox-dot")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".app-inbox-dot")).toHaveCount(0);

  // And a line can be thrown away.
  await page.getByRole("button", { name: "Supprimer cette notification" }).click();
  await expect(page.getByText("Rien en attente")).toBeVisible();
  await asker.context.close();
});
