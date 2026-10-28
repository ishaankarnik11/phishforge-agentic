import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the **docker-stack** smoke (STORY-7.7).
 *
 * Unlike `playwright.config.ts` (which assumes the dev servers — vite +
 * uvicorn — are running locally), this config targets the loopback ports
 * published by `deploy/docker-compose.yml`:
 *
 *   - frontend nginx :  http://127.0.0.1:8182
 *   - backend uvicorn:  http://127.0.0.1:8001
 *
 * The orchestrator brings the stack up first (`docker compose up --build
 * -d`) and then runs:
 *
 *     pnpm exec playwright test --config playwright.docker.config.ts
 *
 * Override the URLs via E2E_FRONTEND_URL / E2E_BACKEND_URL when pointing
 * at staging or a non-default host.
 *
 * Why a separate config (rather than a project inside the existing one):
 *   - We want a hard separation of testDir so the 21 dev-server specs
 *     don't accidentally run against the docker stack.
 *   - We want webServer:undefined (Playwright must NOT spin up dev
 *     servers; the docker stack is the system under test).
 *   - We want a different default baseURL.
 *
 * Browsers: Chromium-only. This is a smoke; the full cross-browser
 * matrix lives in the dev-server suite.
 */
const FRONTEND_URL =
  process.env.E2E_FRONTEND_URL ?? "http://127.0.0.1:8182";

export default defineConfig({
  testDir: "./e2e/docker",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The docker stack is deterministic — one retry in CI just to absorb
  // first-cold-start jitter (e.g. nginx warm-up); zero locally so flake
  // is loud.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? "github"
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // No webServer block. The docker stack must already be up — see
  // deploy/DEPLOYMENT.md and frontend/scripts/e2e-docker.sh.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
