import { expect, test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

/**
 * The interface language.
 *
 * It lives on the account, not in the browser: it is a setting chosen once and
 * found again from one device to the next. These tests check what no gate can
 * see — that the switch really reaches the screen, down to the messages the
 * server returns.
 */

/**
 * The switch exists in two places — the top bar and the account sheet — and
 * only one is visible at a time. On a phone, the sheet has to be opened to reach
 * it, then closed.
 */
const switchLanguage = async (page: import("@playwright/test").Page, code: "FR" | "EN") => {
  const onPhone = await page.locator(".global-mobile-bottom-nav").isVisible();
  if (onPhone) await page.getByRole("button", { name: /Mon compte|My account/ }).click();

  const scope = onPhone ? "#account-sheet" : ".app-bar";
  await page.locator(`${scope} .lang-switch-item`, { hasText: code }).click();
  await expect(page.locator(`${scope} .lang-switch-item.is-active`)).toHaveText(code);

  /**
   * On a phone, the sheet closes by itself: changing language rebuilds the whole
   * navigation, and `renderNavigation` closes the sheet before rewriting it. We
   * check it rather than clicking into the void.
   */
  if (onPhone) await expect(page.locator("#account-sheet")).toBeHidden();
};

test("the collection switches to English, and stays there", async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();

  await switchLanguage(page, "EN");
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
  await expect(page.getByPlaceholder("Search for a card…")).toBeVisible();
  await expect(page.getByText("No cards")).toBeVisible();

  // The choice is carried by the account: it survives a full reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();
  await expect(page.locator(".app-bar .lang-switch-item.is-active, #account-sheet .lang-switch-item.is-active").first()).toHaveText("EN");
});

test("the scanlists too", async ({ page }) => {
  await signUp(page);
  await switchLanguage(page, "EN");

  await page.locator(".tools-bar .scanlist-link").click();
  await expect(page.getByRole("heading", { name: "Scanlists" })).toBeVisible();
  await page.getByRole("button", { name: "New batch" }).click();
  await expect(page.getByText("Batch in progress")).toBeVisible();
  await expect(page.getByText("Nothing yet. Scan a card, or type its code.")).toBeVisible();
});

test("the Yu-Gi-Oh! vocabulary returns to its original form", async ({ page }) => {
  /**
   * The API returns `Fish`, `WATER`, `Effect Monster`: in English there is
   * nothing to translate — the raw value **is** the English. So this vocabulary
   * has no place in the general dictionary: “Poisson” is not an interface
   * sentence, it is the French name of a catalogue value.
   */
  await signUp(page);
  await addBySetCode(page, "LTGY-FR008");
  await page.locator(".item-main").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();
  await expect(page.locator(".inspect-info-body")).toContainText("Poisson");

  await page.locator("#inspect-close").click();
  await switchLanguage(page, "EN");
  await page.locator(".item-main").first().click();
  await expect(page.locator(".inspect-info-body")).toContainText("Fish");
  await expect(page.locator(".inspect-info-body")).not.toContainText("Poisson");
});

test("the server's messages are translated too", async ({ page }) => {
  /**
   * The API answers **in English** — its sentence is the dictionary key, and the
   * front translates it before displaying it. A French screen whose errors speak
   * English would be the worst moment not to understand.
   *
   * The reverse was true until 2026-09-14: the key was French.
   */
  await signUp(page);
  await switchLanguage(page, "EN");

  const refusal = await page.evaluate(async () => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A body Zod accepts, refused by the strength rule: it is the service's
      // message we want to see, not the schema's.
      body: JSON.stringify({
        email: `weak-${Date.now()}@example.test`,
        password: "too-short",
        displayName: "Tester",
      }),
    });
    return (await response.json()) as { message?: string };
  });
  // The server does speak English: the front is what translates.
  expect(refusal.message).toContain("password");

  await page.locator(".tools-bar .scanlist-link").click();
  await page.getByRole("button", { name: "New batch" }).click();
  await page.getByRole("button", { name: "Save the batch" }).click();
  await expect(page.getByText("Give the batch a name.")).toBeVisible();
});

test("switching back to French brings all the French back", async ({ page }) => {
  await signUp(page);
  await switchLanguage(page, "EN");
  await expect(page.getByRole("heading", { name: "My collection" })).toBeVisible();

  await switchLanguage(page, "FR");
  await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();
  await expect(page.getByPlaceholder("Rechercher une carte…")).toBeVisible();
});
