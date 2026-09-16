import { expect, test } from "@playwright/test";
import {
  addBySetCode, expectNoHorizontalOverflow, freshAccount, signUp, useGalleryView,
} from "./helpers.js";

test.describe("Collection", () => {
  test("the gallery keeps two columns on a phone, however narrow", async ({ page }) => {
    /**
     * Reported by Ange: in gallery view the cards were nearly fullscreen, where
     * ATEM-old showed four — two columns, two rows.
     *
     * The cause was not the tile, which is identical to ATEM-old's, but the
     * base rule: `auto-fill, minmax(150px, 1fr)` needs 316 px to fit two, and a
     * Pixel 5 gives the grid 321. It passed by five pixels — and a narrower
     * phone, or the same one with the text zoomed, fell to a single column.
     *
     * Whether two cards sit side by side must not depend on five pixels, so the
     * narrowest phones are measured here rather than the comfortable one.
     */
    await signUp(page);
    await addBySetCode(page, "SDCR-FR010");
    await useGalleryView(page);

    const columns = async () =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".gallery") as HTMLElement)
            .gridTemplateColumns.split(" ").length,
      );

    const viewport = page.viewportSize();
    if (viewport && viewport.width <= 480) {
      expect(await columns()).toBe(2);
      // The narrowest phones still in use, where auto-fill gave up entirely.
      for (const width of [320, 360]) {
        await page.setViewportSize({ width, height: viewport.height });
        await page.waitForTimeout(150);
        expect(await columns(), `${width}px`).toBe(2);
      }
      await page.setViewportSize(viewport);
    } else {
      // On a wide screen the grid is free to fit as many as it can.
      expect(await columns()).toBeGreaterThan(2);
    }
  });

  test("in list view, a card's text takes the width instead of stacking", async ({ page }) => {
    /**
     * Reported by Ange on a phone: the list's rows were as tall as the
     * gallery's cards, which defeats the list.
     *
     * Measured on a Pixel 5 before the fix: of 321 px, the three quantity
     * buttons took 143 and the text was left with 92 — so the title wrapped in
     * two and each of the five attributes fell onto its own line. 215 px per
     * card, against 123 on a wide screen with the same markup.
     *
     * What is asserted is the outcome, not the rule that produces it: the title
     * on one line, the attributes flowing rather than stacking. A later layout
     * that keeps both is free to replace this one.
     */
    await signUp(page);
    await addBySetCode(page, "SDCR-FR010");

    const title = page.locator(".item-text strong").first();
    const stats = page.locator(".item .stats-line").first();
    await title.waitFor();

    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    // One line at 0.98rem is ~24 px; two would be ~47.
    expect(titleBox!.height).toBeLessThan(32);

    const statsBox = await stats.boundingBox();
    expect(statsBox).not.toBeNull();
    // Five attributes on five lines was ~95 px; flowing, two lines at most.
    expect(statsBox!.height).toBeLessThan(48);

    if (test.info().project.name === "mobile") {
      // The text claims the width rather than fitting its content — the buttons
      // moved to their own line to give it back.
      const text = await page.locator(".item-text").first().boundingBox();
      const row = await page.locator(".item-row").first().boundingBox();
      expect(text!.width).toBeGreaterThan(row!.width * 0.7);
    }
  });

  test("arriving at the collection does not raise the keyboard", async ({ page }) => {
    /**
     * Reported by Ange on a phone: opening the collection to *look* at it put
     * the focus in the set code field, so the keyboard rose over half the
     * screen for a field nobody had asked for. The same defect had already been
     * fixed on the scanner, for the same reason.
     *
     * There is no way to observe a virtual keyboard from a test — so what is
     * measured is its cause: the focus.
     */
    await signUp(page);
    await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();

    const field = page.getByLabel("Ajouter par set code");
    await expect(field).toBeVisible();
    await expect(field).not.toBeFocused();
    // Nothing else grabbed it either: the page arrives with focus nowhere.
    expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).not.toBe("INPUT");
  });

  test("but the field keeps the focus once you are typing in it", async ({ page }) => {
    /**
     * The other half of the rule, and the reason this is not simply “never
     * focus”: entering a pile of codes is one hand on the phone and the same
     * field over and over. Whoever just submitted a code asked for it.
     */
    await signUp(page);
    const field = page.getByLabel("Ajouter par set code");
    await field.click();
    await expect(field).toBeFocused();

    await addBySetCode(page, "SDCR-FR010");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
  });

  test("a new account lands on an empty collection", async ({ page }) => {
    await signUp(page);
    await expect(page.getByRole("heading", { name: "Ma collection" })).toBeVisible();
    await expect(page.getByText(/Aucune carte/)).toBeVisible();
  });

  test("adding a card by its French set code", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    // Aim at the grid, not the page: the confirmation message holds the same
    // name, and an assertion on the whole page would be ambiguous.
    const grid = page.locator(".content");
    // The name comes from the catalogue, in French: that proves the switch to
    // the English code worked without losing the language.
    await expect(grid.getByText("Grande Baleine")).toBeVisible();
    // The collection opens as a list, like ATEM-old.
    await expect(page.locator(".item-list")).toBeVisible();
    await expect(page.locator(".meta-line")).toContainText("1/1");
  });

  test("the displayed name follows the copy's language", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await addBySetCode(page, "LOB-EN001");

    const grid = page.locator(".content");
    await expect(grid.getByText("Dragon Blanc aux Yeux Bleus")).toBeVisible();
    await expect(grid.getByText("Blue-Eyes White Dragon")).toBeVisible();
  });

  test("the + and − buttons adjust the quantity", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    await expect(row.locator(".item-meta")).toContainText("×1");

    await row.getByRole("button", { name: "Ajouter un exemplaire" }).click();
    await expect(row.locator(".item-meta")).toContainText("×2");

    await row.getByRole("button", { name: "Retirer un exemplaire" }).click();
    await expect(row.locator(".item-meta")).toContainText("×1");
  });

  test("removing the last copy removes the row", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    await row.getByRole("button", { name: "Retirer un exemplaire" }).click();

    await expect(page.locator(".item")).toHaveCount(0);
    await expect(page.getByText("Aucune carte")).toBeVisible();
  });

  test("a favourite is set and remembered", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const favorite = page.locator(".item").first().getByRole("button", { name: "Mettre en favori" });
    await expect(favorite).toHaveAttribute("aria-pressed", "false");
    await favorite.click();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(
      page.locator(".item").first().getByRole("button", { name: "Mettre en favori" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("an unknown code still gets in, marked as pending", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "ZZZZ-FR999");

    await expect(page.locator(".content").getByText("Carte non identifiée")).toBeVisible();
    await expect(page.locator(".meta-line .warn")).toContainText("en attente");
  });

  test("the sheet opens full size and closes with Escape", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await useGalleryView(page);
    await page.locator(".tile").first().click();
    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    // Exact match: “Eau” is contained in “Niveau” and in the card's text. A
    // loose assertion would pass for the wrong reasons, or fail for the wrong
    // reasons.
    await expect(sheet.getByText("Poisson", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Eau", { exact: true })).toBeVisible();
    // The set code also appears in the list of printings: aim at the copy's
    // detail grid.
    await expect(sheet.locator(".detail-grid").getByText("LTGY-FR008")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("the sheet lists the card's other printings", async ({ page }) => {
    // “Do I already have it, and in which printing?” comes up in front of every
    // card being sorted. Blue-Eyes has dozens.
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    const editions = page.locator("#inspect-panel .editions-list");
    await expect(editions).toBeVisible();
    // The owned printing stands out from those not owned.
    await expect(editions.locator(".edition-row.is-owned")).toHaveCount(1);
    await expect(editions.locator(".edition-row")).not.toHaveCount(1);
  });

  test("the filters offer the attribute icons", async ({ page }) => {
    // The icons come from ATEM-old; their file name follows the English value. A
    // broken image does not show in a text test.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await page.getByRole("button", { name: "Trier et filtrer" }).click();

    const icon = page.locator("#filter-panel .chip-attr img").first();
    await expect(icon).toBeVisible();
    const loaded = await icon.evaluate((img) => (img as HTMLImageElement).naturalWidth > 0);
    expect(loaded, "the attribute icon must load").toBe(true);
  });

  test("the search filters the collection", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");
    await useGalleryView(page);
    await expect(page.locator(".tile")).toHaveCount(2);

    await page.getByLabel("Rechercher dans la collection").fill("Baleine");
    await expect(page.locator(".tile")).toHaveCount(1);
    await expect(page.locator(".content").getByText("Grande Baleine")).toBeVisible();
  });

  test("the page never overflows horizontally", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");

    expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);

    await useGalleryView(page);
    await page.locator(".tile").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();
    expect(await expectNoHorizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test("touch targets are large enough", async ({ page }, testInfo) => {
    // 44 px by finger. With a mouse, 32 px is enough and the list's density
    // matters more — which is why the rule lives in `@media (pointer: coarse)`
    // and the test only applies to the mobile profile.
    test.skip(testInfo.project.name !== "mobile", "touch target: mobile profile");
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const row = page.locator(".item").first();
    for (const name of ["Ajouter un exemplaire", "Retirer un exemplaire"]) {
      const box = await row.getByRole("button", { name }).boundingBox();
      expect(box, `${name} must be measurable`).not.toBeNull();
      expect(box!.width, `${name} — width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} — height`).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Layout", () => {
  test("the header does not overlap itself", async ({ page }, testInfo) => {
    // This check only holds on a wide screen: below 46 rem, the top bar no
    // longer exists, the bottom bar replaces it — and the “only one bar is
    // visible at a time” test checks that.
    test.skip(testInfo.project.name !== "desktop", "top bar: desktop profile");
    await signUp(page);

    const brand = await page.locator(".app-bar .brand").boundingBox();
    const nav = await page.locator(".app-bar .app-nav").boundingBox();
    const account = await page.locator(".app-bar-right").boundingBox();
    expect(brand && nav && account).toBeTruthy();

    const overlaps = (a: typeof brand, b: typeof brand) =>
      a!.x < b!.x + b!.width && b!.x < a!.x + a!.width &&
      a!.y < b!.y + b!.height && b!.y < a!.y + a!.height;

    expect(overlaps(brand, nav), "brand and navigation").toBe(false);
    expect(overlaps(nav, account), "navigation and account").toBe(false);
    expect(overlaps(brand, account), "brand and account").toBe(false);
  });

  test("the scanner's actions stay visible without scrolling", async ({ page }) => {
    // They are what gets used for every card. Pushing them below the fold makes
    // inventorying a pile unbearable.
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const viewport = page.viewportSize()!;
    for (const name of ["Lire la carte", "Ajouter un exemplaire"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, `${name} must be measurable`).not.toBeNull();
      // The shutter bar sticks to the bottom of the modal: it must stay
      // reachable without scrolling, it is the gesture repeated for every card.
      expect(
        box!.y + box!.height,
        `${name} must fit within the visible height`,
      ).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test("opening and closing the scanner leaves nothing behind", async ({ page }) => {
    /**
     * The scanner hooked onto `popstate` and `atem:navigated` with
     * `{ once: true }` — so never consumed when closing with the button. Each
     * opening therefore left two live listeners, and the next navigation called
     * the close as many times as the scanner had been opened, each one
     * relaunching a full reload of the collection.
     *
     * **The navigation must be in-app.** A `goto` reloads the document and takes
     * every listener with it: the leak only shows on a client-side route change,
     * the kind a click in the bar makes.
     */
    await signUp(page);

    const requestsForOneScreenChange = async (): Promise<number> => {
      let requests = 0;
      const listen = (request: { url: () => string }) => {
        if (request.url().includes("/api/collection")) requests += 1;
      };
      page.on("request", listen);
      await page.locator("a[href='/collection']").first().dispatchEvent("click");
      await page.waitForTimeout(800);
      page.off("request", listen);
      return requests;
    };

    const baseline = await requestsForOneScreenChange();

    for (let round = 0; round < 3; round += 1) {
      await page.getByRole("button", { name: "Scanner" }).click();
      await page.locator(".scan-modal").waitFor();
      await page.locator(".scan-modal .icon-btn").click();
      await expect(page.locator(".scan-modal")).toHaveCount(0);
    }

    const after = await requestsForOneScreenChange();
    expect(
      after,
      `three scanner openings: the screen change produced ${after} requests against ${baseline}`,
    ).toBeLessThanOrEqual(baseline);
  });

  test("the welcome message is opaque, and gold", async ({ page }) => {
    /**
     * It was not: `.toast` set no background, and the tones lived in a
     * `.toast-ok` class that the markup — which writes `data-kind` — never set.
     * The message floated over the collection, unreadable, and read as a display
     * glitch rather than as information.
     */
    await signUp(page);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();

    const background = await toast.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(background, "the background must not be transparent").not.toBe("rgba(0, 0, 0, 0)");
    expect(background, "no partial transparency either").not.toMatch(/^rgba\(.*,\s*0?\.\d+\)$/);

    // Gold, not the green reserved for what has just been saved.
    const text = await toast.evaluate((node) => getComputedStyle(node).color);
    expect(text).toBe("rgb(251, 191, 36)");
  });

  test("a favourite speaks with one voice, and it holds", async ({ page }) => {
    /**
     * A favourite shows in two places: the star button lights up, and a “★”
     * pill sits next to the name. Only the button was toggled by hand; the pill
     * waited for the next repaint. The screen gave two different answers about
     * the same fact, which read as a favourite that had not been saved — it had
     * been, though.
     */
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const star = page.locator(".js-fav").first();
    await expect(page.locator(".fav-tag")).toHaveCount(0);

    await star.click();
    await expect(page.locator(".js-fav").first()).toHaveClass(/is-fav/);
    await expect(page.locator(".fav-tag"), "the pill follows the button, without waiting")
      .toHaveCount(1);

    // And the server did keep it.
    await page.reload();
    await expect(page.locator(".js-fav").first()).toHaveClass(/is-fav/);
    await expect(page.locator(".fav-tag")).toHaveCount(1);

    // Undoing holds on both sides too.
    await page.locator(".js-fav").first().click();
    await expect(page.locator(".js-fav").first()).not.toHaveClass(/is-fav/);
    await expect(page.locator(".fav-tag")).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".js-fav").first()).not.toHaveClass(/is-fav/);
  });

  test("the message does not cover what is being handled", async ({ page }, info) => {
    /**
     * The toast sits under the top bar. On a phone that bar does not exist: it
     * landed right on the add bar, hiding the code field at the very moment you
     * come to use it.
     */
    await signUp(page);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();

    const message = (await toast.boundingBox())!;
    const field = (await page.getByLabel("Ajouter par set code").boundingBox())!;

    const overlaps =
      message.y < field.y + field.height && field.y < message.y + message.height;
    expect(overlaps, `${info.project.name}: the message must cover nothing`).toBe(false);
  });

  test("the scanner bar: start over, and a “+1” that shows", async ({ page }) => {
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const field = page.locator(".scan-code-input");
    await field.fill("LTGY-FR008");

    // “Start over” puts the screen back in the state it opened in, touching
    // neither the camera nor the collection.
    await page.getByRole("button", { name: "Recommencer" }).click();
    await expect(field).toHaveValue("");

    /**
     * The “+1” had no colour: the browser gave it its default grey,
     * indistinguishable from the “−1” next to it — although one adds a card to
     * the inventory and the other removes it.
     */
    const plus = page.getByRole("button", { name: "Ajouter un exemplaire" });
    const background = await plus.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(background, "the “+1” wears the blue of the add bar's “+”").toBe("rgb(110, 200, 255)");

    // All four targets stay finger-sized: 44 px is the workable minimum for a
    // bar aimed at without looking.
    for (const name of ["Recommencer", "Retirer un exemplaire", "Lire la carte", "Ajouter un exemplaire"]) {
      const box = (await page.getByRole("button", { name }).boundingBox())!;
      expect(Math.min(box.width, box.height), `target “${name}”`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the keyboard does not pop up by itself in the scanner", async ({ page }) => {
    /**
     * Focus on a phone raises the keyboard, which covers half the screen —
     * including the shutter bar. You had to tap beside it to dismiss it before
     * taking another photo, for every card.
     */
    await signUp(page);
    await page.getByRole("button", { name: "Scanner" }).click();
    await page.locator(".scan-modal").waitFor();

    const focused = await page.evaluate(() =>
      document.activeElement?.classList.contains("scan-code-input") ?? false,
    );
    expect(focused, "the field must not grab focus on opening").toBe(false);

    // It takes it when asked to, of course.
    await page.locator(".scan-code-input").click();
    expect(
      await page.evaluate(() =>
        document.activeElement?.classList.contains("scan-code-input") ?? false,
      ),
    ).toBe(true);
  });

  test("the card sheet fits on the screen", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
  });
});

test.describe("Redirect after sign-in", () => {
  /** Creates an account from `/register?next=…` and returns the landing URL. */
  async function registerWithNext(page: import("@playwright/test").Page, next: string) {
    const account = freshAccount();
    await page.goto(`/register?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Pseudo").fill(account.displayName);
    await page.getByLabel("Adresse e-mail").fill(account.email);
    await page.getByLabel("Mot de passe", { exact: false }).first().fill(account.password);
    await page.getByLabel("Confirmation du mot de passe").fill(account.password);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await page.waitForURL(/\/collection/, { timeout: 10_000 });
    return page.url();
  }

  test("a destination on our own site is followed", async ({ page }) => {
    const landing = await registerWithNext(page, "/collection?from=test");
    expect(landing).toContain("/collection?from=test");
  });

  test("a destination elsewhere does not leave the site", async ({ page }) => {
    /**
     * `?next=` comes from the URL, so from anyone. `pushState` already refuses
     * another origin — but by **throwing**, which left the sign-in half done
     * instead of falling back on the collection. All three shapes count: two
     * slashes, the backslash URL normalisation turns into a slash, and an
     * absolute address.
     */
    for (const next of ["//example.invalid", "/\\example.invalid", "https://example.invalid"]) {
      const landing = await registerWithNext(page, next);
      expect(landing, `next = ${next}`).not.toContain("example.invalid");
      expect(landing).toContain("/collection");
    }
  });
});

test.describe("Navigation", () => {
  test("the main bar leads to the declared screens", async ({ page }, testInfo) => {
    // The destinations come from the router: an entry only exists if its route
    // exists. What counts here is that they lead somewhere.
    await signUp(page);
    const bar = testInfo.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

    await expect(page.locator(bar).getByRole("link", { name: /Collection/ })).toBeVisible();
    await expect(page.locator(`${bar} [aria-current="page"]`)).toContainText("Collection");
  });

  test("the current destination is marked", async ({ page }, testInfo) => {
    await signUp(page);
    const bar = testInfo.project.name === "mobile" ? ".global-mobile-bottom-nav" : ".app-bar";

    const current = page.locator(`${bar} [aria-current="page"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Collection");
  });

  test("only one bar is visible at a time", async ({ page }, testInfo) => {
    // The top bar gives way **entirely** to the bottom one on a phone: keeping
    // both means two navigations to keep in agreement, and one of them ends up
    // lying about the current page.
    await signUp(page);
    const onMobile = testInfo.project.name === "mobile";

    await expect(page.locator(".app-bar")).toBeVisible({ visible: !onMobile });
    await expect(page.locator(".global-mobile-bottom-nav")).toBeVisible({ visible: onMobile });
  });

  test("the service status is displayed", async ({ page }, testInfo) => {
    // When the server stops answering, every gesture fails with a different
    // message. A pill answers the question before it is asked.
    await signUp(page);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Mon compte" }).click();
      await expect(page.locator("#account-sheet .api-pill")).toHaveText("En ligne");
    } else {
      await expect(page.locator(".app-bar .api-pill")).toHaveText("En ligne");
    }
  });

  test("the account sheet opens and closes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "account sheet: mobile profile");
    await signUp(page);

    const sheet = page.locator("#account-sheet");
    await expect(sheet).toBeHidden();

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Tester");

    await sheet.getByRole("button", { name: "Fermer" }).click();
    await expect(sheet).toBeHidden();
  });

  test("the backdrop closes the account sheet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "account sheet: mobile profile");
    await signUp(page);

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(page.locator("#account-sheet")).toBeVisible();

    // The sheet is modal: it covers the bottom bar, and its backdrop is what you
    // touch to get out.
    await page.locator("#account-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(page.locator("#account-sheet")).toBeHidden();
  });

  test("going back closes the account sheet", async ({ page }, testInfo) => {
    // It sits on the page body, which the router does not replace: without an
    // explicit close it would stay over the next screen.
    test.skip(testInfo.project.name !== "mobile", "account sheet: mobile profile");
    await signUp(page);

    // Leave the screen and come back: the sheet must not survive.
    await page.goto("/login");
    await page.goBack();
    await page.waitForURL("**/collection");

    await page.getByRole("button", { name: "Mon compte" }).click();
    await expect(page.locator("#account-sheet")).toBeVisible();

    await page.goForward();
    await expect(page.locator("#account-sheet")).toBeHidden();
  });

  test("the bottom bar does not hide the end of the list", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "bottom bar: mobile profile");
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    const bar = (await page.locator(".global-mobile-bottom-nav").boundingBox())!;
    const padding = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    expect(padding, "the page body reserves the bar's height").toBeGreaterThanOrEqual(
      bar.height - 12,
    );
  });
});


test.describe("Parity with ATEM-old", () => {
  test("the passcode identifies a card whose code cannot be read", async ({ page }) => {
    // The fallback when the set code cannot be read: the eight digits at the
    // bottom left. The field existed in ATEM-old and had disappeared.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: /Options/ }).click();
    await page.getByLabel("Passcode de la carte").fill("18322364");
    await page.getByLabel("Ajouter par set code").fill("WORN-FR001");
    await page.getByRole("button", { name: "Ajouter la carte" }).click();

    // Identified right away, without going through “pending”.
    await expect(page.locator(".content").getByText("Grande Baleine")).toHaveCount(2);
  });

  test("the search finds by passcode", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByLabel("Rechercher dans la collection").fill("18322364");
    await expect(page.locator(".item")).toHaveCount(1);
  });

  test("the sort direction reverses", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#sort").selectOption("setCode");
    await page.locator("#sort-dir").selectOption("asc");
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".item-text code").first()).toHaveText("LOB-FR001");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#sort-dir").selectOption("desc");
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".item-text code").first()).toHaveText("LTGY-FR008");
  });

  test("compact density applies to the page body", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#density").selectOption("compact");
    await expect(page.locator("body")).toHaveClass(/density-compact/);
  });

  test("the collection comes out in sort order, without grouping", async ({ page }) => {
    // It is ATEM-old's default behaviour, and the right one: cutting by family
    // imposes a second ordering key on top of the chosen one, and you no longer
    // find what you are looking for.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await addBySetCode(page, "LOB-FR001");

    await expect(page.locator(".group-header")).toHaveCount(0);
    // Sorted by name ascending: “Dragon Blanc…” before “Grande Baleine”.
    await expect(page.locator(".item-text strong").first()).toContainText("Dragon Blanc");
  });

  test("grouping by type turns on when asked", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await expect(page.locator(".group-header")).toHaveCount(0);

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator("#group-monster").check();
    await page.getByRole("button", { name: "OK" }).click();

    await expect(page.locator(".group-header").first()).toContainText("Poisson");
  });

  test("a card not yet translated says so on screen", async ({ page }) => {
    // `ALIN-FR010` comes from Alliance Insight, a recent set the source has not
    // translated yet. Its name and text display in English.
    await signUp(page);
    await addBySetCode(page, "ALIN-FR010");
    await page.locator(".item-main").first().click();

    const sheet = page.locator("#inspect-panel");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Traduction pas encore disponible/)).toBeVisible();
  });

  test("the pending counter follows a removal", async ({ page }) => {
    // Removing the last card of an unidentified row left “1 pending” on screen
    // until a full reload.
    await signUp(page);
    await addBySetCode(page, "NOSUCHSET-FR999");
    await expect(page.locator(".meta-line .warn")).toContainText("en attente");

    await page.locator(".item").first()
      .getByRole("button", { name: "Retirer un exemplaire" }).click();

    await expect(page.locator(".meta-line .warn")).toHaveText("");
  });

  test("a note is saved from the sheet", async ({ page }) => {
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await useGalleryView(page);
    await page.locator(".tile").first().click();

    await page.getByLabel("Note").fill("Bought in a shop");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Note enregistrée.")).toBeVisible();

    await page.keyboard.press("Escape");
    await useGalleryView(page);
    await page.locator(".tile").first().click();
    await expect(page.getByLabel("Note")).toHaveValue("Bought in a shop");
  });
});

test("the account block does not overlap itself", async ({ page }, testInfo) => {
  // The username touched the sign-out button: the right-hand block's layout
  // lived in a `style` attribute in ATEM-old, not in its sheet — so it was not
  // taken along with it.
  test.skip(testInfo.project.name !== "desktop", "top bar: desktop profile");
  await signUp(page);

  const username = (await page.locator(".app-bar-right .muted").boundingBox())!;
  // The bar now also carries the language switch: aim at the sign-out button,
  // which is the one next to the username.
  const button = (await page.locator(".app-bar-right .btn").boundingBox())!;
  expect(username.x + username.width).toBeLessThanOrEqual(button.x);
});

test.describe("Scroll lock", () => {
  /**
   * A collection taller than the screen.
   *
   * We shorten the window rather than add twenty cards: what is tested here is
   * the lock, not the ability to load a long list, and every addition costs a
   * round trip.
   */
  async function scrollableCollection(page: import("@playwright/test").Page): Promise<void> {
    await signUp(page);
    for (const code of ["LTGY-FR008", "LOB-FR001", "SDK-001", "PSV-F088", "LOB-EN001"]) {
      await addBySetCode(page, code);
    }

    const width = page.viewportSize()!.width;
    await page.setViewportSize({ width, height: 420 });

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    );
    expect(scrollable, "the page must exceed the screen for the test to mean anything").toBe(true);
  }

  test("the card sheet freezes the page behind it", async ({ page }) => {
    // Two scrollbars lived side by side: the sheet's and the collection's. You
    // thought you were scrolling down the card and it was the page that moved —
    // and on closing, you were no longer where you had been.
    await scrollableCollection(page);

    await page.evaluate(() => window.scrollTo(0, 220));
    const before = await page.evaluate(() => window.scrollY);

    // Track a row on screen: its movement is what shows, not the value of
    // `scrollY` — which is zero during the lock, by construction, since the body
    // is fixed rather than scrolled.
    const row = page.locator(".item").first();
    const positionBefore = (await row.boundingBox())!.y;

    /**
     * `click()` would scroll the row into view before clicking, and reset the
     * page to zero right before the lock: the test would measure its own side
     * effect. `dispatchEvent` fires the event without touching the scroll.
     */
    await page.locator(".item-main").first().dispatchEvent("click");
    await expect(page.locator("#inspect-panel")).toBeVisible();

    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);

    const positionDuring = (await row.boundingBox())!.y;
    expect(
      Math.abs(positionDuring - positionBefore),
      "the collection behind must not move a pixel",
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(page.locator("#inspect-panel")).toHaveCount(0);
    expect(
      await page.evaluate(() => window.scrollY),
      "we come back exactly where we were",
    ).toBe(before);
  });

  test("the filter panel freezes it too", async ({ page }) => {
    await scrollableCollection(page);
    await page.evaluate(() => window.scrollTo(0, 180));
    const before = await page.evaluate(() => window.scrollY);
    const row = page.locator(".item").first();
    const positionBefore = (await row.boundingBox())!.y;

    await page.getByRole("button", { name: "Trier et filtrer" }).dispatchEvent("click");
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(150);
    expect(Math.abs((await row.boundingBox())!.y - positionBefore)).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "OK" }).dispatchEvent("click");
    expect(
      await page.evaluate(() => window.scrollY),
      "the position is given back on closing",
    ).toBe(before);
  });

  test("clicking filters does not upset the lock", async ({ page }) => {
    // `setFilterPanel(true)` is called again at every chip: counting twice would
    // never be caught up with, and the page would stay frozen after closing.
    await scrollableCollection(page);

    await page.getByRole("button", { name: "Trier et filtrer" }).click();
    await page.locator('[data-filter-kind="monster"]').click();
    await page.locator('[data-filter-kind=""]').click();
    await page.getByRole("button", { name: "OK" }).click();

    await page.evaluate(() => window.scrollTo(0, 200));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("changing screen always gives scrolling back", async ({ page }) => {
    await scrollableCollection(page);
    await page.locator(".item-main").first().dispatchEvent("click");
    await expect(page.locator("#inspect-panel")).toBeVisible();

    // Leave without closing: the router takes the sheet away with the root.
    await page.goto("/login");
    await page.goBack();
    await page.waitForURL("**/collection");

    await page.evaluate(() => window.scrollTo(0, 150));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});

test.describe("Sheet layout", () => {
  test("the note's label aligns with its field", async ({ page }) => {
    // Three elements on one line, three different alignments: the label
    // stretched over the full height and its text sat at the top.
    await signUp(page);
    await addBySetCode(page, "LTGY-FR008");
    await page.locator(".item-main").first().click();
    await expect(page.locator("#inspect-panel")).toBeVisible();

    /**
     * The three centres are read in one go.
     *
     * “Autres éditions” is inserted by a call that returns after the sheet has
     * rendered, and `.inspect-info-col` scrolls: three successive
     * `boundingBox()` calls could fall on either side of that insertion and
     * compare two different layouts. The gap measured that way says nothing
     * about alignment — only that the page moved between two measurements.
     */
    await expect(page.locator("#inspect-panel .editions")).toBeVisible();

    const { label, field, button } = await page.evaluate(() => {
      const centre = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return box.y + box.height / 2;
      };
      return {
        label: centre(".inspect-notes > label"),
        field: centre("#notes-input"),
        button: centre("#btn-save-notes"),
      };
    });

    expect(Math.abs(label - field), "label and field").toBeLessThanOrEqual(2);
    expect(Math.abs(button - field), "button and field").toBeLessThanOrEqual(2);
  });

  test("“Autres éditions” stands apart from the note", async ({ page }) => {
    // The two blocks touched: you could not see where one ended, although it is
    // the information you come for in front of a card being sorted.
    await signUp(page);
    await addBySetCode(page, "LOB-FR001");
    await page.locator(".item-main").first().click();

    const editions = page.locator("#inspect-panel .editions");
    await expect(editions).toBeVisible();

    const notes = (await page.locator(".inspect-notes").boundingBox())!;
    const block = (await editions.boundingBox())!;
    expect(
      block.y - (notes.y + notes.height),
      "clear space separates the note from the printings",
    ).toBeGreaterThanOrEqual(16);
  });
});
