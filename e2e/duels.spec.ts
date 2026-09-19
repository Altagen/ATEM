import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * A duel, from the invitation to the result, between two accounts.
 *
 * ATEM records a duel played in person (`docs/ref-duels.md`): what these tests
 * measure is the notebook — the decks, the coin, the phases, the life points.
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

/** A deck to bring: a duel does not start without one on each side. */
async function deck(page: Page, name: string) {
  await page.evaluate(async (deckName) => {
    await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: deckName }),
    });
  }, name);
}

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

test("a duel: decks, coin flip, phases, life points, result", async ({ page, browser }) => {
  const me = await signUp(page);
  await deck(page, "Blue-Eyes");
  const friend = await duellist(browser);
  await deck(friend.page, "Harpies");
  await befriend(page, friend);

  // The invitation, with the deck brought along.
  await page.goto("/duels");
  await expect(page.getByText("Aucun duel pour l'instant")).toBeVisible();
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await page.getByRole("dialog").locator("#invite-deck").selectOption({ label: "Blue-Eyes" });
  await page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();

  // The other side answers from their inbox, then chooses their own deck.
  await friend.page.goto("/inbox");
  await expect(friend.page.getByText(`${me.displayName} vous invite en duel.`)).toBeVisible();
  await friend.page.goto("/duels");
  await friend.page.locator(".duel-row").first().click();
  await friend.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(friend.page.getByText("Prêt à commencer")).toBeVisible();

  // Nothing starts before both decks are named.
  await expect(friend.page.getByRole("button", { name: /Lancer la pièce/ })).toBeDisabled();
  await friend.page.getByRole("button", { name: "Choisir mon deck" }).click();
  await friend.page.locator("#duel-deck").selectOption({ label: "Harpies" });
  await friend.page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(friend.page.getByText("Deck enregistré.")).toBeVisible();

  // The coin is flipped by the server: one of the two begins.
  await friend.page.getByRole("button", { name: /Lancer la pièce/ }).click();
  // The coin turns, then settles on a name.
  await expect(friend.page.locator(".duel-coin")).toBeVisible();
  await expect(friend.page.locator(".duel-coin-name.is-settled")).toBeVisible({ timeout: 10_000 });
  await expect(friend.page.locator(".duel-coin")).toHaveCount(0, { timeout: 10_000 });
  await expect(friend.page.locator(".duel-turn")).toHaveText("Tour 1");
  await expect(friend.page.locator(".duel-phase.is-current")).toHaveText("Draw Phase");

  /**
   * The phases are moved by the duellist whose turn it is (Ange, 2026-09-19).
   * The coin decides who that is, so the test asks rather than assumes — from
   * the tab that has just seen it fall.
   */
  await page.goto("/duels");
  await page.locator(".duel-row").first().click();
  await expect(page.locator(".duel-life.is-playing")).toHaveCount(1);

  const friendPlays = await friend.page.locator(".duel-life.is-mine.is-playing").count() > 0;
  const playing = friendPlays ? friend.page : page;
  const waiting = friendPlays ? page : friend.page;
  await expect(waiting.getByRole("button", { name: "Phase suivante" })).toBeDisabled();
  await expect(waiting.getByRole("button", { name: "Finir le tour" })).toBeDisabled();
  await expect(playing.getByRole("button", { name: "Phase suivante" })).toBeEnabled();

  for (const phase of ["Standby Phase", "Main Phase 1", "Battle Phase"]) {
    await playing.getByRole("button", { name: "Phase suivante" }).click();
    await expect(playing.locator(".duel-phase.is-current")).toHaveText(phase);
  }

  /**
   * Life points are declared by the one who takes them (Ange, 2026-09-19).
   * The other duellist's card carries no button at all.
   */
  const theirOwnCard = friend.page.locator(".duel-life.is-mine");
  await expect(theirOwnCard).toContainText(friend.account.displayName);
  await expect(friend.page.locator(".duel-life").filter({ hasText: me.displayName }).getByRole("button"))
    .toHaveCount(0);

  await theirOwnCard.getByRole("button", { name: "−1000" }).click();
  await expect(friend.page.getByText("Points de vie retirés.")).toBeVisible();
  await expect(theirOwnCard.locator(".duel-life-value")).toHaveText("7000");

  // Halving rounds up: 7000 → 3500.
  await theirOwnCard.getByRole("button", { name: "÷2" }).click();
  await expect(theirOwnCard.locator(".duel-life-value")).toHaveText("3500");

  // The other device finds the duel where it was left — without a reload.
  await page.goto("/duels");
  await page.locator(".duel-row").first().click();
  await expect(page.locator(".duel-phase.is-current")).toHaveText("Battle Phase");
  await expect(page.locator(".duel-life").filter({ hasText: friend.account.displayName })
    .locator(".duel-life-value")).toHaveText("3500");

  // The turn passes, ended by the duellist playing it, and the panel says whose it is.
  await playing.reload();
  await playing.getByRole("button", { name: "Finir le tour" }).click();
  await expect(playing.getByText("Le tour passe.")).toBeVisible();
  // The other tab learns it on its own: it polls, it was not reloaded.
  await expect(page.locator(".duel-turn")).toHaveText("Tour 2", { timeout: 15_000 });
  await expect(page.locator(".duel-life.is-playing")).toHaveCount(1);

  // The history is folded away; it opens on demand.
  await page.getByText(/Tour par tour/).click();
  await expect(page.locator(".admin-table tbody tr").first()).toContainText("Draw Phase");

  // The result, recorded by either: the score says who won.
  await page.getByRole("button", { name: "Enregistrer le résultat" }).first().click();
  await page.locator("#result-host").fill("2");
  await page.locator("#result-guest").fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le résultat" }).click();
  await expect(page.getByText("Résultat enregistré.")).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();

  // Recorded means nothing more is played, and counted on the profile.
  await expect(page.getByRole("button", { name: "Phase suivante" })).toHaveCount(0);
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
