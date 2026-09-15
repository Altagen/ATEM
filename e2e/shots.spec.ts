/**
 * Review screenshots.
 *
 * This is not a test: nothing is asserted. It is the way to **look** at what
 * was built, on both profiles, without opening a browser by hand — and to do it
 * again identically after every change, to see what moved.
 *
 * Run: pnpm e2e:shots
 */
import { test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

const shot = (name: string, project: string) => `e2e/shots/${project}-${name}.png`;

/**
 * The screenshots show the bottom bar twice.
 *
 * Checked rather than assumed: the DOM holds only one, and turning off
 * `backdrop-filter` makes the second disappear. So it is the background blur
 * compositing badly in a headless capture — not a defect of the screen.
 *
 * Viewport-sized captures stay more faithful for judging a layout: a full-page
 * capture stretches what is fixed.
 */
const viewport = { fullPage: false } as const;

test.describe("Review screenshots", () => {
  test("the main screens", async ({ page }, testInfo) => {
    const profile = testInfo.project.name;
    test.setTimeout(90_000);

    await page.goto("/login");
    await page.screenshot({ path: shot("01-login", profile), fullPage: true });

    await page.goto("/register");
    await page.screenshot({ path: shot("02-register", profile), fullPage: true });

    await signUp(page);
    await page.screenshot({ path: shot("03-collection-empty", profile), ...viewport });

    for (const code of ["LTGY-FR008", "LOB-FR001", "SDK-001", "PSV-F088", "ZZZZ-FR999"]) {
      await addBySetCode(page, code);
    }
    await page.screenshot({ path: shot("04-collection", profile), fullPage: true });
    await page.getByRole("button", { name: "Vue galerie" }).click();
    await page.locator(".gallery").waitFor();
    await page.screenshot({ path: shot("04c-gallery", profile), ...viewport });
    await page.getByRole("button", { name: "Vue liste" }).click();
    await page.locator(".item-list").waitFor();
    await page.screenshot({ path: shot("04b-collection-viewport", profile), ...viewport });

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#filter-panel").waitFor();
    await page.screenshot({ path: shot("05-filters", profile), fullPage: true });
    await page.getByRole("button", { name: "Fermer" }).first().click();

    // The collection opens as a list: it is the row that gets opened.
    await page.locator(".item-main").first().click();
    await page.locator("#inspect-panel").waitFor();
    await page.screenshot({ path: shot("06-card-sheet", profile), fullPage: true });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Options/ }).click();
    await page.screenshot({ path: shot("07-advanced-add", profile), ...viewport });
  });

  test("the scanner", async ({ page }, testInfo) => {
    const profile = testInfo.project.name;
    test.setTimeout(90_000);

    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();
    // There is no camera in a test browser: the screen must stay usable and
    // offer manual entry. That is what the capture shows.
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("08-scanner", profile), fullPage: true });
  });
});
