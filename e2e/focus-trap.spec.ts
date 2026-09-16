import { expect, test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

/**
 * The keyboard stays inside an open window.
 *
 * Five surfaces declare `aria-modal="true"` and none of them held the focus:
 * Tab walked out of the window into the page behind, so you typed into a form
 * hidden under a backdrop. Found during the audit of 2026-09-16.
 *
 * What is measured is what a person experiences — where the focus **is** after
 * pressing Tab — never the implementation that puts it there.
 */

/** Tab `times` times, then say whether the focus is still inside the window. */
async function focusStaysInside(page: import("@playwright/test").Page, times = 12) {
  for (let step = 0; step < times; step += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      // `getClientRects`, not `offsetParent`: the latter is null for a
      // `position: fixed` element, which every one of these windows is. Writing
      // it the wrong way here made this test fail against a trap that worked.
      const dialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
        .reverse()
        .find((d) => (d as HTMLElement).getClientRects().length > 0);
      return dialog ? dialog.contains(document.activeElement) : null;
    });
    if (inside !== true) return { escapedAt: step + 1 };
  }
  return { escapedAt: null };
}

test("the deck window keeps the keyboard", async ({ page }) => {
  await signUp(page);
  await page.goto("/decks");
  await page.getByRole("button", { name: "Construire un deck" }).click();
  await expect(page.locator(".deck-modal")).toBeVisible();

  expect(await focusStaysInside(page)).toEqual({ escapedAt: null });
});

test("the filter panel keeps the keyboard", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "Trier et filtrer" }).click();
  await expect(page.locator(".filter-panel")).toBeVisible();

  expect(await focusStaysInside(page, 20)).toEqual({ escapedAt: null });
});

test("the card sheet keeps the keyboard", async ({ page }) => {
  await signUp(page);
  await addBySetCode(page, "SDCR-FR010");
  await page.locator(".item-main").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();

  expect(await focusStaysInside(page)).toEqual({ escapedAt: null });
});

test("closing a window gives the focus back to what opened it", async ({ page }) => {
  /**
   * Without this the focus lands on `<body>` and the next Tab starts again from
   * the top of the page — far from the button you just used.
   */
  await signUp(page);
  const opener = page.getByRole("button", { name: "Trier et filtrer" });
  await opener.click();
  await expect(page.locator(".filter-panel")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".filter-panel")).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a window does not raise the keyboard by itself", async ({ page }) => {
  /**
   * The trap moves the focus into the window; it must never put it in a text
   * field, which on a phone raises the keyboard over a window nobody asked to
   * type in. The container takes it instead.
   */
  await signUp(page);
  await page.getByRole("button", { name: "Trier et filtrer" }).click();
  await expect(page.locator(".filter-panel")).toBeVisible();

  const tag = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement)) return active?.tagName ?? "NONE";
    return `INPUT:${active.type}`;
  });
  expect(tag).not.toMatch(/^INPUT:(text|search|email|password|number|tel|url)$/);
});
