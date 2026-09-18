import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * A duel, from the invitation to the result, between two accounts.
 *
 * ATEM records a duel played in person (`docs/ref-duels.md`): what these tests
 * measure is the notebook — who may write what, and when.
 */

async function duellist(browser: import("@playwright/test").Browser) {
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

/** Two accounts that are already friends, which is what a duel needs. */
async function befriend(page: Page, other: { page: Page; id: string }) {
  const mine = await page.evaluate(async () =>
    ((await (await fetch("/api/auth/me")).json()) as { user: { id: string } }).user.id);
  await page.evaluate(async (id) => {
    await fetch(`/api/community/friends/${id}`, { method: "POST" });
  }, other.id);
  await other.page.evaluate(async (id) => {
    await fetch(`/api/community/friends/${id}/accept`, { method: "POST" });
  }, mine);
}

test("a duel: invited, accepted, played turn by turn, then recorded", async ({ page, browser }) => {
  const me = await signUp(page);
  const friend = await duellist(browser);
  await befriend(page, friend);

  // The invitation, from the duels screen.
  await page.goto("/duels");
  await expect(page.getByText("Aucun duel pour l'instant")).toBeVisible();
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();
  await expect(page.getByText("Invitation envoyée", { exact: true })).toBeVisible();

  // The other side finds it in their inbox and accepts from the duel.
  await friend.page.goto("/inbox");
  await expect(friend.page.getByText(`${me.displayName} vous invite en duel.`)).toBeVisible();
  await friend.page.goto("/duels");
  await friend.page.locator(".duel-row").first().click();
  await friend.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(friend.page.getByText("Le duel est lancé.")).toBeVisible();

  // Both write into the same history.
  await friend.page.getByRole("button", { name: "Écrire un tour" }).click();
  await friend.page.locator("#turn-guest").fill("5000");
  await friend.page.locator("#turn-note").fill("Attaque directe.");
  await friend.page.getByRole("button", { name: "Écrire le tour" }).click();
  await expect(friend.page.getByText("Tour écrit.")).toBeVisible();

  // Sending the invitation opened the duel, so the list is asked for by name.
  await page.goto("/duels");
  await page.locator(".duel-row").first().click();
  await expect(page.getByText("Attaque directe.")).toBeVisible();
  await page.getByRole("button", { name: "Écrire un tour" }).click();
  await page.locator("#turn-host").fill("4000");
  await page.getByRole("button", { name: "Écrire le tour" }).click();
  await expect(page.locator(".admin-table tbody tr")).toHaveCount(2);

  // The result, recorded by either: the score says who won.
  await page.getByRole("button", { name: "Enregistrer le résultat" }).first().click();
  await page.locator("#result-host").fill("2");
  await page.locator("#result-guest").fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le résultat" }).click();
  await expect(page.getByText("Résultat enregistré.")).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();

  // Recorded means read-only, and counted on the profile.
  await expect(page.getByRole("button", { name: "Écrire un tour" })).toHaveCount(0);
  await page.goto("/profile");
  await expect(page.getByText("1 duel joué, 1 gagné")).toBeVisible();

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await friend.context.close();
});

test("an invitation can be declined, and leaves nothing behind", async ({ page, browser }) => {
  await signUp(page);
  const friend = await duellist(browser);
  await befriend(page, friend);

  await page.goto("/duels");
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();

  await friend.page.goto("/duels");
  await friend.page.locator(".duel-row").first().click();
  await friend.page.getByRole("button", { name: "Refuser" }).click();
  await expect(friend.page.getByText("Aucun duel pour l'instant")).toBeVisible();

  await page.goto("/duels");
  await expect(page.getByText("Aucun duel pour l'instant")).toBeVisible();
  await friend.page.goto("/inbox");
  await expect(friend.page.getByText("Rien en attente")).toBeVisible();
  await friend.context.close();
});

test("without a friend, the screen says where friends are found", async ({ page }) => {
  await signUp(page);
  await page.goto("/duels");
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await expect(page.getByText(/Un duel se joue avec un ami/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" })).toHaveCount(0);
});
