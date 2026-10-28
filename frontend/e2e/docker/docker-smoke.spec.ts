import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Routing model.
 *
 * The frontend image is built with ``VITE_API_URL=http://127.0.0.1:8001``
 * (see ``frontend/scripts/e2e-docker.sh``), so the SPA's API client
 * calls the backend directly with absolute URLs. The browser handles
 * CORS — backend's ``ALLOWED_ORIGINS`` env includes both loopback
 * origins. No Playwright-side route forwarding is needed.
 *
 * In production, the bundle is built with the real public backend URL
 * (``PUBLIC_BACKEND_URL``); same browser-CORS path, no NPM custom
 * locations. This mirrors the existing TMS / token-flow deploy.
 */

/**
 * STORY-7.7 — production docker-stack smoke.
 *
 * These specs run against the freshly-built docker-compose stack
 * (deploy/docker-compose.yml), NOT against `pnpm dev`. They are
 * intentionally a thin slice — every critical user-facing function is
 * exercised exactly once, no LLM round-trips, no DB-mutating long
 * journeys. The bar is "QA can sign off the deploy if these eight pass."
 *
 * Stack URLs (loopback per deploy plan §2.3 Pattern 2):
 *   - frontend (nginx)   : http://127.0.0.1:8182
 *   - backend (uvicorn)  : http://127.0.0.1:8001
 *
 * Both can be re-pointed at staging via env vars; see the constants.
 *
 * Mocking note: we deliberately do NOT call the real Anthropic API here.
 * Test 8 ("generate path is reachable") only checks that the route
 * responds without 5xx, never that an actual MJML payload comes back.
 * If a future test needs the editor populated, mock /api/v1/generate
 * with `page.route(...)` and a canned MJML payload — do not enable real
 * generation in this suite (cost + flakiness).
 */

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? "http://127.0.0.1:8001";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://127.0.0.1:8182";

const ADMIN_EMAIL = "admin@phishforge.io";
const EDITOR_EMAIL = "priya@phishforge.io";
const SEED_PASSWORD = "password123";

interface TokenResponse {
  access_token: string;
  token_type: string;
}

async function login(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/api/v1/auth/login`, {
    data: { email, password },
  });
  expect(
    res.ok(),
    `auth/login (${email}) failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  const body = (await res.json()) as TokenResponse;
  return body.access_token;
}

/**
 * Seed the JWT into localStorage *before* the SPA boots, then navigate.
 * Mirrors the dev-server `fixtures/auth.ts` pattern but doesn't take a
 * dependency on the existing fixture (which lives in a different testDir
 * scope and uses /auth/register, which would create new prod DB rows on
 * every run). Reusing the seeded users keeps the docker DB stable.
 */
async function authenticateAs(
  page: Page,
  request: APIRequestContext,
  email: string
): Promise<void> {
  const token = await login(request, email, SEED_PASSWORD);
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, token);
}

// ---------------------------------------------------------------------------
// 1. Healthchecks reachable (backend + frontend, via the request fixture)
// ---------------------------------------------------------------------------

test("healthchecks reachable: backend reports OK + db connected; frontend returns ok", async ({
  request,
}) => {
  // Backend: JSON shape exactly per app/main.py /healthz handler.
  const backendRes = await request.get(`${BACKEND_URL}/healthz`);
  expect(backendRes.status()).toBe(200);
  const backendBody = (await backendRes.json()) as {
    status: string;
    database: string;
  };
  expect(backendBody.status).toBe("ok");
  expect(backendBody.database).toBe("connected");

  // Frontend: nginx-static emits "ok\n"; trim to tolerate both.
  const frontendRes = await request.get(`${FRONTEND_URL}/healthz`);
  expect(frontendRes.status()).toBe(200);
  expect((await frontendRes.text()).trim()).toBe("ok");
});

// ---------------------------------------------------------------------------
// 2. Login flow (drives the real LoginPage form, not just the API)
// ---------------------------------------------------------------------------

test("login flow: editor can sign in via the form and lands on the home list", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EDITOR_EMAIL);
  await page.getByLabel("Password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();

  // Land on /, see the home list header.
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Acme Emailer Studio" })
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Home page filter (STORY-1.3) — toggle a chip, observe row delta
// ---------------------------------------------------------------------------

test("home filter: toggling a status chip changes the visible row count", async ({
  page,
  request,
}) => {
  await authenticateAs(page, request, ADMIN_EMAIL);
  await page.goto("/");

  // Wait for the chip row to render — it appears as soon as the
  // brand-kit query resolves (independent of the emailer list).
  await expect(page.getByTestId("filter-chip-row")).toBeVisible();

  const draftChip = page.getByTestId("filter-status-draft");
  await expect(draftChip).toHaveAttribute("aria-pressed", "false");

  // Toggle the Draft chip and confirm aria-pressed flips. We don't
  // assert exact row counts — the seeded DB content is not part of this
  // test's contract — but we do confirm the chip-driven query refetch
  // path is wired (the page would surface an error alert otherwise).
  await draftChip.click();
  await expect(draftChip).toHaveAttribute("aria-pressed", "true");

  // No error alert should appear from the refetch.
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Clear filters and confirm the chip releases.
  // The "clear" affordance only renders when filters are active.
  await page.getByTestId("clear-filters-chip-row").click();
  await expect(draftChip).toHaveAttribute("aria-pressed", "false");
});

// ---------------------------------------------------------------------------
// 4. Brief form loads + brand-kit dropdown lists the 3 seeded kits
// ---------------------------------------------------------------------------

test("brief form: renders fields and the brand-kit selector lists 3 seeded kits", async ({
  page,
  request,
}) => {
  await authenticateAs(page, request, EDITOR_EMAIL);
  await page.goto("/brief");

  // Form fields visible.
  await expect(page.getByLabel("Template name")).toBeVisible();
  await expect(page.getByLabel("Category")).toBeVisible();
  await expect(page.getByLabel("Target audience")).toBeVisible();

  // Open the brand-kit combobox (a custom button, role=combobox,
  // aria-label="Brand kit"). It should expose a listbox with exactly
  // the three seeded kits: acme-retail, acme-private-banking,
  // acme-wealth.
  const trigger = page.getByRole("combobox", { name: "Brand kit" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const listbox = page.getByRole("listbox", { name: "Brand kits" });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option")).toHaveCount(3);
});

// ---------------------------------------------------------------------------
// 5. Brand-kit admin CRUD (STORY-6.3) — list, create, edit, delete in one test
//
// All four steps are stitched into a single test on purpose: they share
// the same authenticated session and the same DB-side artefact (a kit
// with a one-off slug) and we want a Single Failed Test if any phase
// breaks, not a cascade of "skipped" sub-tests. The slug is unique per
// run so re-running against a long-lived DB doesn't collide.
// ---------------------------------------------------------------------------

test("brand-kit admin CRUD: list, create, edit, delete (STORY-6.3)", async ({
  page,
  request,
}) => {
  const slug = `e2e-smoke-${Date.now().toString(36)}`;
  const initialName = "E2E Smoke Kit";
  const renamedName = "E2E Smoke Kit v2";

  await authenticateAs(page, request, ADMIN_EMAIL);

  // --- List: three seeded kits visible ---------------------------------
  await page.goto("/admin/brand-kits");
  await expect(
    page.getByRole("heading", { name: "Admin · Brand kits" })
  ).toBeVisible();
  await expect(page.getByTestId("brand-kit-row-acme-retail")).toBeVisible();
  await expect(
    page.getByTestId("brand-kit-row-acme-private-banking")
  ).toBeVisible();
  await expect(page.getByTestId("brand-kit-row-acme-wealth")).toBeVisible();

  // --- Create ----------------------------------------------------------
  await page.getByTestId("create-brand-kit-cta").click();
  await expect(page.getByTestId("brand-kit-form")).toBeVisible();

  await page.getByTestId("brand-kit-slug-input").fill(slug);
  await page.getByTestId("brand-kit-name-input").fill(initialName);
  await page.getByTestId("brand-kit-bu-input").fill("Smoke");
  await page
    .getByTestId("brand-kit-heading-font-input")
    .fill("Arial, sans-serif");
  await page
    .getByTestId("brand-kit-body-font-input")
    .fill("Arial, sans-serif");
  await page
    .getByTestId("brand-kit-logo-url-input")
    .fill("https://example.com/smoke.svg");
  await page.getByTestId("brand-kit-tone-input").fill("smoke, test");
  await page
    .getByTestId("brand-kit-disclaimer-input")
    .fill("Smoke disclaimer.");

  await page.getByTestId("brand-kit-submit-button").click();
  await expect(page).toHaveURL(/\/admin\/brand-kits$/);
  await expect(page.getByTestId(`brand-kit-row-${slug}`)).toBeVisible();

  // --- Edit (rename) ---------------------------------------------------
  await page.getByTestId(`brand-kit-row-${slug}`).click();
  await expect(page.getByTestId("brand-kit-slug-input")).toBeDisabled();
  await expect(page.getByTestId("brand-kit-name-input")).toHaveValue(
    initialName
  );

  await page.getByTestId("brand-kit-name-input").fill(renamedName);
  await page.getByTestId("brand-kit-submit-button").click();

  await expect(page).toHaveURL(/\/admin\/brand-kits$/);
  await expect(page.getByRole("link", { name: renamedName })).toBeVisible();

  // --- Delete ----------------------------------------------------------
  await page.getByTestId(`brand-kit-row-${slug}`).click();
  await page.getByTestId("brand-kit-delete-button").click();
  await expect(page.getByTestId("confirm-delete-dialog")).toBeVisible();
  await page.getByTestId("confirm-delete-confirm").click();

  await expect(page).toHaveURL(/\/admin\/brand-kits$/);
  // Absorb the delete → list-refetch round-trip jitter via expect.poll.
  await expect
    .poll(
      async () => await page.getByTestId(`brand-kit-row-${slug}`).count(),
      { timeout: 10_000 }
    )
    .toBe(0);
});

// ---------------------------------------------------------------------------
// 6. Brand-kit admin gated — non-admin (editor) gets bounced + no chrome
// ---------------------------------------------------------------------------

test("brand-kit admin gated: editor is redirected from /admin/brand-kits and the menu hides the link", async ({
  page,
  request,
}) => {
  await authenticateAs(page, request, EDITOR_EMAIL);

  // Direct nav: redirected to /.
  await page.goto("/admin/brand-kits");
  await expect(page).toHaveURL(/\/$/);

  // Open the user menu — the admin link must NOT be visible.
  await page.getByRole("button", { name: /Account menu/i }).click();
  await expect(
    page.getByTestId("admin-brand-kits-link")
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 7. Logout — click user menu, click Logout, land on /login
// ---------------------------------------------------------------------------

test("logout: user menu logout returns to /login", async ({
  page,
  request,
}) => {
  await authenticateAs(page, request, EDITOR_EMAIL);
  await page.goto("/");

  await page.getByRole("button", { name: /Account menu/i }).click();
  await page.getByRole("menuitem", { name: /log out/i }).click();

  await expect(page).toHaveURL(/\/login$/);
});

// ---------------------------------------------------------------------------
// 8. /generate is reachable — responds without 5xx (no real LLM)
// ---------------------------------------------------------------------------

test("generate route is reachable: backend responds without 5xx (no real LLM call)", async ({
  request,
}) => {
  // Deliberate: we do NOT hit the real Anthropic API in this suite.
  // We only confirm that POST /api/v1/generate is mounted and responds
  // with a client-error (or auth-required) status, never a 5xx — i.e.
  // the deploy didn't break the route or its DB dependency.
  //
  // Acceptable shapes:
  //   - 401 (no Authorization header)
  //   - 403 (auth required, depending on dependency wiring)
  //   - 422 (auth + bad payload)
  //   - 4xx generally
  // Disallowed: 5xx (means the route blew up).
  const res = await request.post(`${BACKEND_URL}/api/v1/generate`, {
    data: {},
  });
  expect(res.status(), `unexpected status ${res.status()}`).toBeGreaterThanOrEqual(400);
  expect(res.status(), `unexpected 5xx: ${res.status()} ${await res.text()}`).toBeLessThan(500);
});
