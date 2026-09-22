import { expect, test } from "@playwright/test";
import { addBySetCode, expectNoHorizontalOverflow, signUp } from "./helpers.js";

/**
 * Scanlists — inventorying a batch without pouring it.
 *
 * The test that matters is the first one: a batch's “−1” must **never** reach
 * the collection, even when the line is already at zero and you keep pressing.
 */

const openBatch = async (page: import("@playwright/test").Page) => {
  await page.goto("/scanlists");
  await page.getByRole("button", { name: "Nouveau lot" }).click();
};

const addToBatch = async (page: import("@playwright/test").Page, code: string) => {
  await page.getByLabel("Ajouter par set code").fill(code);
  await page.getByRole("button", { name: "Ajouter au lot" }).click();
};

test("a batch's “−1” removes nothing from the collection", async ({ page }) => {
  await signUp(page);

  // A real card in the collection, one copy.
  await addBySetCode(page, "LTGY-FR008");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();

  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");
  await addToBatch(page, "LTGY-FR008");
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×2");

  // Three “−1” on two copies: the floor is zero, and the third one must not go
  // looking in the collection.
  const minus = page.locator(".scan-draft-li").getByRole("button", { name: /Retirer un exemplaire/ });
  await minus.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×1");
  await minus.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×0");
  await minus.click();
  await expect(page.locator(".scan-draft-li .scan-line-qty")).toHaveText("×0");

  // The collection is intact: still one row, still one copy.
  await page.goto("/collection");
  const row = page.locator(".content .item").first();
  await expect(row).toBeVisible();
  await expect(row.getByText("×1")).toBeVisible();
  await expect(page.locator(".meta-line span").first()).toContainText("1 ex.");
});

test("a saved batch does not enter the collection until it is poured", async ({ page }) => {
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LOB-FR001");
  await addToBatch(page, "LOB-FR001");
  await page.getByLabel("Nom du lot").fill("Evening delivery");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();

  await expect(page.locator(".scan-list").getByText("Evening delivery")).toBeVisible();
  await expect(page.locator(".scan-state.is-pending").first()).toBeVisible();

  await page.goto("/collection");
  await expect(page.getByText("Aucune carte")).toBeVisible();
});

test("pouring brings the batch in, once only", async ({ page }) => {
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");
  await addToBatch(page, "LTGY-FR008");
  await addToBatch(page, "LTGY-FR008");
  await page.getByLabel("Nom du lot").fill("To pour");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();

  await page.getByRole("link", { name: /To pour/ }).click();
  await expect(page.getByRole("button", { name: "Verser dans la collection" })).toBeEnabled();
  await page.getByRole("button", { name: "Verser dans la collection" }).click();

  await expect(page.getByText(/Versée le/)).toBeVisible();
  // The button is disabled: pouring twice would double the collection.
  await expect(page.getByRole("button", { name: "Verser dans la collection" })).toBeDisabled();

  await page.goto("/collection");
  await expect(page.locator(".content").getByText("LTGY-FR008").first()).toBeVisible();
});

test("the batch in progress does not survive a reload", async ({ page }) => {
  /**
   * Ange's decision: nothing survives without explicit confirmation. No
   * `localStorage`, no half-state found again three days later without knowing
   * what it holds. You scan again.
   */
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");
  await expect(page.locator(".scan-draft-li")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".scan-draft-li")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nouveau lot" })).toBeVisible();
});

test("the batch in progress survives in-app navigation", async ({ page }) => {
  // Going to check a card in your collection must not lose the pile.
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");

  await page.locator("a[href='/collection']").first().dispatchEvent("click");
  await expect(page).toHaveURL(/\/collection/);
  await page.locator("a[href='/scanlists']").first().dispatchEvent("click");

  await expect(page.locator(".scan-draft-li")).toHaveCount(1);
});

test("the scanlists screen does not overflow", async ({ page }) => {
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("the bottom bar does not hide the batch's actions", async ({ page }) => {
  /**
   * The batch panel ends with “Save” — the gesture that decides whether the pile
   * just counted survives. Leaving it under the navigation bar would make it
   * impossible to find at the exact moment it matters.
   */
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");

  // The card's name arrives afterwards and repaints the panel: let it settle
  // before measuring, otherwise we measure an element already replaced.
  await expect(page.locator(".scan-draft-li")).toContainText("Grande Baleine");

  const button = page.getByRole("button", { name: "Enregistrer le lot" });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;

  const bar = page.locator(".global-mobile-bottom-nav");
  if (await bar.isVisible()) {
    const nav = (await bar.boundingBox())!;
    expect(box.y + box.height, "the button must stay above the bar")
      .toBeLessThanOrEqual(nav.y + 1);
  }
  expect(box.width, "and stay finger-sized").toBeGreaterThanOrEqual(44);
});

test("the code field and its buttons fit on one row", async ({ page }) => {
  // A scanner cut off from the field it fills reads as an orphan button.
  await signUp(page);
  await openBatch(page);

  const field = (await page.getByLabel("Ajouter par set code").boundingBox())!;
  const scan = (await page.getByRole("button", { name: "Scanner" }).boundingBox())!;
  const plus = (await page.getByRole("button", { name: "Ajouter au lot" }).boundingBox())!;

  for (const [name, box] of [["Add", plus], ["Scan", scan]] as const) {
    expect(
      Math.abs(box.y + box.height / 2 - (field.y + field.height / 2)),
      `“${name}” must stay on the field's row`,
    ).toBeLessThanOrEqual(4);
  }
});

test("scanlists are reached from the collection, not from a tab", async ({ page }, info) => {
  /**
   * A tab of the same rank as “Collection” suggested two inventories side by
   * side. A scanlist is an antechamber: a batch is filed there **before**
   * deciding whether it enters the collection. That is the place it had in
   * The earlier prototype, and the place carries that reading.
   */
  await signUp(page);
  const bar = info.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

  await expect(page.locator(bar).getByRole("link", { name: /Scanliste/ })).toHaveCount(0);

  const link = page.locator(".tools-bar .scanlist-link");
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/scanlists/);
  await expect(page.getByRole("heading", { name: "Scanlistes" })).toBeVisible();
});

test("on a phone, the link shrinks to its icon", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "phone-only rule");

  await signUp(page);
  const label = page.locator(".scanlist-link-label");
  await expect(label).toHaveCount(1);
  // Hidden in the markup, not shrunk: `font-size: 0` would also swallow the
  // emoji, which is precisely what remains.
  await expect(label).toBeHidden();

  // The toolbar row must not overflow for all that.
  expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("a fully successful pour shows no failure block", async ({ page }) => {
  /**
   * When a pour partly fails, the screen names the failed lines rather than
   * only counting them — “3 lines failed” without saying which leaves nothing
   * to do. This test covers the other side: when nothing failed, the block must
   * not appear for nothing.
   */
  await signUp(page);
  await openBatch(page);
  await addToBatch(page, "LTGY-FR008");
  await page.getByLabel("Nom du lot").fill("Report");
  await page.getByRole("button", { name: "Enregistrer le lot" }).click();

  await page.getByRole("link", { name: /Report/ }).click();
  await page.getByRole("button", { name: "Verser dans la collection" }).click();
  await expect(page.getByText(/Versée le/)).toBeVisible();

  await expect(page.locator(".scan-errors")).toHaveCount(0);
});
