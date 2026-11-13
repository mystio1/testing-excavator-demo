import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Playwright does not read .env the way Next does, and the fixtures connect to
// the same database the app uses.
loadEnv({ path: ".env", quiet: true });

/**
 * Browser tests for the assistant, and only for the assistant.
 *
 * Everything else in this repository is tested with vitest against the real
 * services and a real database, which is faster and more precise. What vitest
 * cannot reach is the part of the assistant that only exists in a browser:
 *
 *  - the navigation spine. Every workflow begins "go to /excavators, wait for
 *    the machines to load, click the right card, wait for the detail page".
 *    In a unit test `navigate` is a no-op function, so that whole sequence —
 *    the backbone of all eighteen capabilities — was never run.
 *  - `readControl` uses `innerText`, which respects CSS visibility. jsdom has
 *    no layout and falls back to `textContent`, so the text the assistant
 *    quotes back to the owner is genuinely different there.
 *  - dialogs mounting in portals, and the waits that exist because of it.
 *  - a phone-sized screen, which is where this is actually used.
 *
 * The MODEL is stubbed. A live model would make these non-deterministic, cost
 * money per run and hit the account's per-minute limit (which it did, twice,
 * during development). Which capability the model picks is covered by
 * tests/agent/*; these prove the app does what a plan says.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // One worker: these share a database and a seeded tenant, and the Supabase
  // session pooler is capped at 15 connections (see src/lib/db.ts).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      // The owner uses this on a phone in a yard. Testing it at desktop width
      // would miss the layout it is actually used at.
      name: "phone",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // `next dev` rather than a production build: these tests are about the
    // app's own behaviour, and a dev server starts in seconds instead of
    // minutes. Set E2E_BASE_URL to point at an already-running server instead.
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
