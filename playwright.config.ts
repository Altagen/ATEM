import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end tests.
 *
 * **Every test runs on both profiles.** Validating the desktop and then
 * discovering the phone at integration is exactly the mistake we do not make
 * again: an overflowing grid, a touch target too small or a modal running off
 * the screen are invisible at 1440 px wide, and cost far more to fix once the
 * screen is considered finished.
 *
 * The phone counts double here: scanning happens on a phone, a pile of cards in
 * the other hand.
 */
const baseURL = process.env.ATEM_E2E_URL ?? "https://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  // The tests share one instance: running them in parallel would make their
  // outcome depend on their execution order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL,
    // The dev server serves HTTPS with a self-signed certificate, without which
    // the scanner's camera is refused outside `localhost`.
    ignoreHTTPSErrors: true,
    // Traces and screenshots are only kept on failure: that is the only time
    // they help, and keeping them always drowns the diagnosis.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        // Scanning needs the camera. Under test it is granted up front: the
        // permission dialog is not what we test, and refusing it would block
        // the screen before we could look at it.
        permissions: ["camera"],
      },
    },
  ],
});
