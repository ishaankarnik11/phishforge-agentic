import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Auth fixture for the Acme Emailer e2e suite (STORY-7.10).
 *
 * Strategy:
 *   1. Hit POST /api/v1/auth/register with a unique email to mint a fresh
 *      user + JWT for each test run. We pick this over driving the login
 *      form because it's the simplest path: one HTTP call, no flaky form
 *      interaction, and tests are isolated from each other (each gets a
 *      fresh emailer namespace under their own user).
 *   2. Seed the access token into localStorage via `addInitScript` BEFORE
 *      the app boots. The app's `useAuth` hook reads the token from
 *      localStorage on mount and treats it as authenticated.
 *
 * Teardown is best-effort — we don't try to delete the user. The dev DB
 * accumulates e2e users; that's fine for now (cleanup script can come
 * later if it ever matters).
 */

export interface AuthFixtures {
  authToken: string;
  authedUserEmail: string;
  authedPage: Page;
  authedRequest: APIRequestContext;
}

const TEST_PASSWORD = "e2e-password-pls-ignore";

function randomSuffix(): string {
  // Cheap unique suffix — good enough for disambiguating concurrent test
  // runs against a shared dev DB. No need for a real nanoid dep.
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

interface TokenResponse {
  access_token: string;
  token_type: string;
}

async function registerFreshUser(
  request: APIRequestContext,
  baseURL: string
): Promise<{ token: string; email: string }> {
  const email = `e2e-${randomSuffix()}@example.com`;
  const res = await request.post(`${baseURL}/api/v1/auth/register`, {
    data: {
      email,
      password: TEST_PASSWORD,
      name: "E2E Test User",
    },
  });
  expect(
    res.ok(),
    `auth/register failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  const body = (await res.json()) as TokenResponse;
  return { token: body.access_token, email };
}

export const test = base.extend<AuthFixtures>({
  authToken: async ({ playwright }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const request = await playwright.request.newContext();
    try {
      const { token } = await registerFreshUser(request, baseURL);
      await use(token);
    } finally {
      await request.dispose();
    }
  },

  authedUserEmail: async ({ playwright }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const request = await playwright.request.newContext();
    try {
      const { email } = await registerFreshUser(request, baseURL);
      await use(email);
    } finally {
      await request.dispose();
    }
  },

  authedPage: async ({ page, authToken }, use) => {
    // Seed the JWT into localStorage *before* any app code runs.
    await page.addInitScript((token: string) => {
      window.localStorage.setItem("access_token", token);
    }, authToken);
    await use(page);
  },

  authedRequest: async ({ playwright, authToken }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    try {
      await use(request);
    } finally {
      await request.dispose();
    }
  },
});

export { expect };
