import type { Page } from "@playwright/test";

/**
 * A fresh account per test.
 *
 * The tests share one instance: reusing an account would make each outcome
 * depend on what the previous tests left in it, and an isolated failure would
 * become impossible to read.
 */
export function freshAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `e2e-${stamp}@example.test`,
    // Sixteen characters and all four families: the server's rule, which is
    // also the one the meter displays.
    password: "Test-Password-Strong-7!",
    displayName: `Tester ${stamp.slice(-4)}`,
  };
}

export async function signUp(page: Page): Promise<ReturnType<typeof freshAccount>> {
  const account = freshAccount();
  await page.goto("/register");
  await page.getByLabel("Pseudo").fill(account.displayName);
  await page.getByLabel("Adresse e-mail").fill(account.email);
  await page.getByLabel("Mot de passe", { exact: false }).first().fill(account.password);
  await page.getByLabel("Confirmation du mot de passe").fill(account.password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("**/collection");
  return account;
}

/** Adds a card by its set code, from the collection screen. */
export async function addBySetCode(page: Page, setCode: string): Promise<void> {
  await page.getByLabel("Ajouter par set code").fill(setCode);
  await page.getByRole("button", { name: "Ajouter la carte" }).click();
  // Wait for the grid to settle: without this, the next assertion may read the
  // state from before the reload.
  await page.locator(".content").getByText(setCode, { exact: true }).first().waitFor();
}

/**
 * Returns how far the page overflows horizontally.
 *
 * It is the most common and the quietest mobile defect: a slightly wide grid or
 * table, and the whole page starts sliding sideways. It breaks nothing, it just
 * makes the screen unpleasant — and nobody sees it on a desktop monitor.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/**
 * Switches to gallery view.
 *
 * The collection opens as a **list**, like the earlier prototype: that is where the “+1” and
 * “−1” buttons live. The gallery is a browsing view, where you open the card to
 * act.
 */
export async function useGalleryView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Vue galerie" }).click();
  await page.locator(".gallery").waitFor();
}
