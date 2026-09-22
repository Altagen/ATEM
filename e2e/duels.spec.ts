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
  await expect(page.getByText("Aucun duel en cours")).toBeVisible();
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await page.getByRole("dialog").locator("#invite-deck").selectOption({ label: "Blue-Eyes" });
  await page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();

  /**
   * The other side answers from their inbox: an invitation is not listed on the
   * duels screen — one duel at a time — so its line is the way in.
   */
  await friend.page.goto("/duels");
  await expect(friend.page.getByText("Aucun duel en cours")).toBeVisible();
  await friend.page.goto("/inbox");
  await expect(friend.page.getByText(`${me.displayName} vous invite en duel.`)).toBeVisible();
  await friend.page.getByRole("link", { name: "Voir le duel" }).click();
  await friend.page.waitForURL("**/duels?duel=**");
  await friend.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(friend.page.getByText("Prêt à commencer")).toBeVisible();

  // Nothing starts before both decks are named.
  await expect(friend.page.getByRole("button", { name: /Lancer la pièce/ })).toBeDisabled();
  await friend.page.getByRole("button", { name: "Choisir mon deck" }).click();
  await friend.page.locator("#duel-deck").selectOption({ label: "Harpies" });
  await friend.page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
  await expect(friend.page.getByText("Deck enregistré.")).toBeVisible();

  // The coin is flipped by the server: one of the two begins.
  // The other duellist is on the duel, waiting, and touches nothing.
  await page.goto(`/duels?duel=${new URL(friend.page.url()).searchParams.get("duel")}`);

  await friend.page.getByRole("button", { name: /Lancer la pièce/ }).click();
  // The coin turns, then settles on a name.
  await expect(friend.page.locator(".duel-coin")).toBeVisible();
  await expect(friend.page.locator(".duel-coin-name.is-settled")).toBeVisible({ timeout: 10_000 });
  await expect(friend.page.locator(".duel-coin")).toHaveCount(0, { timeout: 10_000 });
  await expect(friend.page.locator(".duel-turn")).toHaveText("Tour 1");

  // The one who did not flip it sees it fall too, without reloading.
  await expect(page.locator(".duel-coin-name.is-settled")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".duel-turn")).toHaveText("Tour 1", { timeout: 15_000 });
  await expect(friend.page.locator(".duel-phase.is-current")).toHaveText("Draw Phase");

  /**
   * The phases are moved by the duellist whose turn it is (the maintainer, 2026-09-19).
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
   * Life points are declared by the one who takes them (the maintainer, 2026-09-19).
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

  // The history is folded away; it opens on demand, and reads in either order.
  await page.getByText(/Tour par tour/).click();
  await expect(page.locator(".admin-table tbody tr").first()).toContainText("Draw Phase");
  const newestFirst = await page.locator(".admin-table tbody tr").first().textContent();
  await page.getByRole("button", { name: /Du plus ancien/ }).click();
  await expect(page.locator(".admin-table tbody tr").first()).not.toHaveText(newestFirst ?? "");
  await expect(page.locator(".admin-table tbody tr").first()).toContainText(/gagne le lancer/);

  /**
   * Zero life points ends the duel: the winner's screen takes the panel's
   * place, names the decks, and offers to record — with the score it already
   * knows (the maintainer, 2026-09-19).
   */
  await page.locator(".duel-life.is-mine").getByRole("button", { name: "Autre…" }).click();
  await page.locator("#life-amount").fill("8000");
  await page.getByRole("button", { name: "Les retirer" }).click();
  await expect(page.getByText(/l'emporte/)).toBeVisible();
  await expect(page.locator(".duel-victory")).toContainText("Blue-Eyes");
  await expect(page.locator(".duel-victory")).toContainText("Harpies");
  await expect(page.getByRole("button", { name: "Phase suivante" })).toHaveCount(0);

  // A life total reaches zero by a mistyped figure as easily as by an attack.
  await page.getByRole("button", { name: "Corriger les points de vie" }).click();
  await expect(page.getByRole("button", { name: "Phase suivante" })).toBeVisible();
  await page.locator(".duel-life.is-mine").getByRole("button", { name: "+1000" }).click();
  await expect(page.getByText(/l'emporte/)).toHaveCount(0);

  // Back to zero, and this time it is recorded.
  await page.locator(".duel-life.is-mine").getByRole("button", { name: "Autre…" }).click();
  await page.locator("#life-amount").fill("8000");
  await page.getByRole("button", { name: "Les retirer" }).click();
  await page.getByRole("button", { name: "Enregistrer le résultat" }).first().click();
  // A winner, not a score — and the duellist still standing is proposed.
  await expect(page.getByRole("dialog").locator(".chip-btn.is-active"))
    .toHaveText(friend.account.displayName);
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le résultat" }).click();
  await expect(page.getByText("Résultat enregistré.")).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();

  // A recorded duel leaves the table and joins the ones already played, where
  // it says who won and who lost rather than a score.
  await page.goto("/duels");
  await expect(page.getByText("Aucun duel en cours")).toBeVisible();
  await page.getByRole("button", { name: /Anciens duels/ }).click();
  await expect(page.locator(".duel-row")).toHaveCount(1);
  await expect(page.locator(".duel-row")).toContainText("Blue-Eyes");
  // One word, for the person reading: this duel was lost here.
  await expect(page.locator(".duel-outcome")).toHaveText("Perdant");
  await expect(page.locator(".duel-verdict")).toHaveCount(0, { timeout: 1_000 });
  // One's own name is picked out, so the eye finds itself first.
  await expect(page.locator(".duel-side-text strong.is-you")).toHaveText(me.displayName);

  // Opening it is where who beat whom is read.
  await page.locator(".duel-row").click();
  await expect(page.locator(".duel-verdict.is-won")).toHaveText("Vainqueur");
  await expect(page.locator(".duel-verdict.is-lost")).toHaveText("Perdant");
  await page.getByText(/Tour par tour/).click();
  await expect(page.locator(".admin-table .is-you").first()).toHaveText(me.displayName);

  // And coming back lands on the list one was reading, in one click.
  await page.getByRole("link", { name: "← Duels" }).click();
  await page.waitForURL("**/duels?past=1");
  await expect(page.locator(".duel-row")).toHaveCount(1);

  // Recorded means nothing more is played, and counted on the profile.
  await expect(page.getByRole("button", { name: "Phase suivante" })).toHaveCount(0);
  await page.goto("/profile");
  // The duel was lost here: the other duellist was the one still standing.
  await expect(page.getByText("1 duel joué, 0 gagnés")).toBeVisible();

  expect(await expectNoHorizontalOverflow(page)).toBe(0);
  await friend.context.close();
});

test("focus shows the board alone, and the duel ends from it", async ({ page, browser }) => {
  /**
   * The maintainer, on a phone: a duel is followed between two hands and a mat, and the
   * summary above and the log below are two scrolls from the life points. And
   * after correcting a total off zero there was no way back to the result but
   * to take the points down again.
   */
  const me = await signUp(page);
  await deck(page, "Blue-Eyes");
  const friend = await duellist(browser);
  await deck(friend.page, "Harpies");
  await befriend(page, friend);

  await page.evaluate(async (id) => {
    const decks = await (await fetch("/api/decks")).json();
    await fetch("/api/duels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId: id, deckId: decks.items[0].id }),
    });
  }, friend.id);
  await friend.page.evaluate(async () => {
    const duels = await (await fetch("/api/duels?past=0")).json();
    const decks = await (await fetch("/api/decks")).json();
    await fetch(`/api/duels/${duels.items[0].id}/accept`, { method: "POST" });
    await fetch(`/api/duels/${duels.items[0].id}/deck`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId: decks.items[0].id }),
    });
    await fetch(`/api/duels/${duels.items[0].id}/start`, { method: "POST" });
  });

  await page.goto("/duels");
  await page.locator(".duel-row").click();
  await expect(page.locator(".duel-board")).toBeVisible();

  // Focus: the board, and nothing above or below it.
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".duel-focused")).toBeVisible();
  await expect(page.getByRole("link", { name: "← Duels" })).toHaveCount(0);
  await expect(page.getByText(/Tour par tour/)).toHaveCount(0);

  await page.getByRole("button", { name: "Quitter le focus" }).click();
  await expect(page.getByRole("link", { name: "← Duels" })).toBeVisible();

  // Ending the duel is one gesture from the board, without reaching zero.
  await page.getByRole("button", { name: "Terminer le duel" }).click();
  await page.getByRole("dialog").getByRole("button", { name: me.displayName }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enregistrer le résultat" }).click();
  await expect(page.getByText("Résultat enregistré.")).toBeVisible();
  await expect(page.getByText("Enregistré", { exact: true })).toBeVisible();
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

  await friend.page.goto("/inbox");
  await friend.page.getByRole("link", { name: "Voir le duel" }).click();
  await friend.page.getByRole("button", { name: "Refuser" }).click();
  await expect(friend.page.getByText("Aucun duel en cours")).toBeVisible();

  await page.goto("/duels");
  await expect(page.getByText("Aucun duel en cours")).toBeVisible();
  await friend.page.goto("/inbox");
  await expect(friend.page.getByText("Rien en attente")).toBeVisible();
  await friend.context.close();
});

test("a duel called off elsewhere takes the other duellist back to the list", async ({ page, browser }) => {
  /**
   * The maintainer, on 2026-09-19: he called a duel off and the other screen sat there
   * until it was reloaded by hand.
   */
  await signUp(page);
  const friend = await duellist(browser);
  await befriend(page, friend);

  await page.goto("/duels");
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByText("Invitation envoyée.")).toBeVisible();

  // The other duellist opens it from their inbox, and stays on it.
  await friend.page.goto("/inbox");
  await friend.page.getByRole("link", { name: "Voir le duel" }).click();
  await friend.page.waitForURL("**/duels?duel=**");

  await page.getByRole("button", { name: "Annuler l'invitation" }).click();
  await expect(page.getByText("Le duel a été annulé.")).toBeVisible();

  // No reload here: the screen notices on its own and goes back.
  await friend.page.waitForURL("**/duels", { timeout: 15_000 });
  await expect(friend.page.getByText("Ce duel a été annulé.")).toBeVisible();
  await expect(friend.page.getByText("Aucun duel en cours")).toBeVisible();
  await friend.context.close();
});

test("without a friend, the screen says where friends are found", async ({ page }) => {
  await signUp(page);
  await page.goto("/duels");
  await page.getByRole("button", { name: "Inviter un ami" }).click();
  await expect(page.getByText(/Un duel se joue avec un ami/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Envoyer l'invitation" })).toHaveCount(0);
});
