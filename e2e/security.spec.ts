import { expect, test } from "@playwright/test";
import { addBySetCode, signUp } from "./helpers.js";

/**
 * What only a browser can check.
 *
 * A content security policy fails in one place: the page. It blocks silently as
 * far as the server is concerned — no request ever leaves, no log records it —
 * and the person sees a button that does nothing. So the policy served in
 * development is the one nginx serves in production (`vite.config.ts` reads
 * `deploy/security-headers.conf`), and these tests run under it.
 */

/** Everything the browser says it refused, and every address it called. */
function watch(page: import("@playwright/test").Page) {
  const refusals: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refusals.push(message.text());
  });
  page.on("pageerror", (error) => refusals.push(`page error: ${error.message}`));
  page.on("request", (request) => requests.push(request.url()));
  return { refusals, requests };
}

test("the policy is served, and refuses what it must", async ({ page }) => {
  const response = await page.goto("/login");
  const policy = response?.headers()["content-security-policy"] ?? "";

  expect(policy, "no policy served").not.toBe("");
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  // An inline script would undo the whole policy: it is exactly what it exists
  // against.
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");
});

test("card artwork is served by ATEM, and the browser never calls YGOPRODeck", async ({ page }) => {
  /**
   * YGOPRODeck's guide: “You must download and store these images yourself!”,
   * and continued hot-linking “will result in an IP blacklist”. Until
   * 2026-09-16 every viewer's browser fetched artworks straight from
   * `images.ygoprodeck.com`.
   */
  const { refusals, requests } = watch(page);

  await signUp(page);
  await addBySetCode(page, "LTGY-FR008");
  await page.locator(".item-main").first().click();
  await expect(page.locator("#inspect-panel")).toBeVisible();

  const artwork = page.locator("#inspect-panel img").first();
  await expect(artwork).toHaveJSProperty("complete", true);

  const source = await artwork.evaluate((img) => ({
    src: (img as HTMLImageElement).src,
    width: (img as HTMLImageElement).naturalWidth,
  }));
  expect(source.src, "the screen must point at our own address").toContain("/media/cards/");
  expect(source.width, "the image must really be there, not a broken one").toBeGreaterThan(0);

  expect(
    requests.filter((url) => url.includes("ygoprodeck.com")),
    "no request from the browser to YGOPRODeck",
  ).toEqual([]);
  expect(refusals, "nothing refused by the policy").toEqual([]);
});

test("the screens run under the policy, scanner included", async ({ page }) => {
  const { refusals } = watch(page);

  await signUp(page);
  await addBySetCode(page, "LOB-FR001");
  await page.getByRole("button", { name: "Trier et filtrer" }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await page.locator("a[href='/decks']").first().dispatchEvent("click");
  await page.getByRole("button", { name: "Construire un deck" }).click();
  await page.keyboard.press("Escape");
  await page.locator("a[href='/collection']").first().dispatchEvent("click");
  await page.getByRole("button", { name: "Scanner" }).click();
  await page.locator(".scan-modal").waitFor();

  expect(refusals).toEqual([]);
});

test("the OCR engine starts under the policy", async ({ page }) => {
  /**
   * The scan is what the policy could break most quietly: Tesseract compiles
   * WebAssembly (`'wasm-unsafe-eval'`) and starts its worker from a blob URL
   * (`worker-src blob:`). No test browser has a camera, so the engine is driven
   * directly, on a canvas — what matters here is that it runs at all, not what
   * it reads.
   */
  test.setTimeout(120_000);
  const { refusals } = watch(page);
  await signUp(page);

  const started = await page.evaluate(async () => {
    const engine = await import("/src/screens/collection/ocr/engine.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#000";
    context.font = "bold 64px monospace";
    context.fillText("LTGY-FR008", 30, 85);
    try {
      await engine.ocrSetCodeFromImage(canvas, () => {}, "full");
      return "ran";
    } catch (error) {
      return String(error);
    }
  });

  expect(started, "the OCR engine must run under the policy").toBe("ran");
  expect(refusals).toEqual([]);
});
