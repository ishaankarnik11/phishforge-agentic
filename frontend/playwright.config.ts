import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Acme Emailer e2e suite.
 *
 * STORY-7.10 AC-8 bootstraps the harness. Devs run the backend
 * (`uv run uvicorn app.main:app --reload`) and frontend (`pnpm dev`)
 * manually for now. CI integration arrives in a follow-up story
 * (STORY-7.9).
 *
 * Override the target URL with E2E_BASE_URL when running against a
 * non-default host (e.g. CI-deployed preview).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
