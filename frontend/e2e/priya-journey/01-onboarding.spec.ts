import { test, expect, type APIRequestContext } from "@playwright/test";
import { test as authedTest } from "../fixtures/emailer";

/**
 * STORY-7.9 Priya-journey Wave 1 — Onboarding (register + login + create
 * emailer landing).
 *
 * This is the only spec in the journey that drives the *real* register
 * and login screens — every other spec uses the API-based auth fixture
 * because it's faster and decoupled from form interactions. We need at
 * least one spec that proves the UI auth flow itself still works.
 *
 * Flow:
 *   1. Register a fresh user via the auth-register API (the LoginPage
 *      doesn't expose a register form; production users are seeded
 *      out-of-band, but the JWT issued by /register is identical to the
 *      one /login returns and the LoginPage accepts either).
 *   2. Drive the /login form with that user's credentials, assert
 *      navigation lands on `/`.
 *   3. From the home page, click "Create new emailer" and assert
 *      navigation lands on /brief.
 *
 * No API mocks — this hits the real backend.
 */

const TEST_PASSWORD = "e2e-password-pls-ignore";

function uniqueEmail(): string {
  // Match the auth.ts fixture's pattern so dev DB cleanup tooling can
  // recognise these as e2e users.
  return `e2e-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
}

async function registerUser(
  request: APIRequestContext,
  baseURL: string,
  email: string
): Promise<void> {
  const res = await request.post(`${baseURL}/api/v1/auth/register`, {
    data: { email, password: TEST_PASSWORD, name: "E2E Test User" },
  });
  expect(
    res.ok(),
    `register failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
}

test("onboarding: register a user, sign in via the LoginPage, land on the home page, and start a brief", async ({
  page,
  playwright,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL ?? "http://localhost:5173";
  const email = uniqueEmail();

  // Pre-create the user so the LoginPage form has something to log in
  // against. The LoginPage itself does not expose a registration UI.
  const apiRequest = await playwright.request.newContext();
  try {
    await registerUser(apiRequest, baseURL, email);
  } finally {
    await apiRequest.dispose();
  }

  // Drive the actual login form.
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /Acme Emailer/i })
  ).toBeVisible({ timeout: 10_000 });

  await page.getByLabel(/^Email$/i).fill(email);
  await page.getByLabel(/^Password$/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^Log in$/i }).click();

  // After successful login, the LoginPage redirects to "/" (HomePage).
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: /Acme Emailer Studio/i })
  ).toBeVisible({ timeout: 10_000 });

  // From the home page, kick off the brief flow. A freshly-registered
  // user has zero emailers, so the empty-state CTA "Create your first
  // emailer" is also a valid target — but the header button "Create new
  // emailer" is always present, so we use that for stability.
  await page
    .getByRole("button", { name: /^Create new emailer$/i })
    .click();
  await page.waitForURL((url) => url.pathname === "/brief", {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: /Create new emailer/i })
  ).toBeVisible({ timeout: 5_000 });
});

/**
 * STORY-1.4 AC-5 — browser-back navigation reloads the editor with the
 * emailer's prior content.
 *
 * Flow: open a seeded emailer in the editor, navigate to Home, click
 * back, assert the editor reloads with the same MJML it had before.
 *
 * We rely on the seeded-emailer fixture so the test is fast and
 * decoupled from the brief / generate flow.
 */
authedTest(
  "back navigation: editor → home → back reloads the editor with the same content",
  async ({ authedPage, seededEmailer }) => {
    const page = authedPage;

    // Land on the editor.
    await page.goto(`/emailers/${seededEmailer.id}`);
    await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
      timeout: 30_000,
    });
    const canvasFrame = page.frameLocator(".gjs-frame");
    await expect(canvasFrame.locator("text=E2E seed content")).toBeVisible({
      timeout: 15_000,
    });

    // Navigate back to home via the in-app link (this is the natural
    // user path — header back-link is added by STORY-7.6).
    await page.getByRole("link", { name: /back to emailers/i }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /Acme Emailer Studio/i })
    ).toBeVisible({ timeout: 5_000 });

    // Use the browser back button (not in-app routing) so we exercise
    // the AC literally — the editor must rehydrate from the URL.
    await page.goBack();
    await page.waitForURL((url) => url.pathname === `/emailers/${seededEmailer.id}`, {
      timeout: 10_000,
    });

    // Editor remounts and the seeded content reappears.
    await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
      timeout: 30_000,
    });
    await expect(canvasFrame.locator("text=E2E seed content")).toBeVisible({
      timeout: 15_000,
    });
  }
);
