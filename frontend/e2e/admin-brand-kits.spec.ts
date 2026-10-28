import { test, expect, type Page } from "@playwright/test";

/**
 * STORY-6.3 — Admin brand kit UI end-to-end.
 *
 * Strategy:
 *   - Authenticate against the seeded admin account (admin@phishforge.io /
 *     password123 from STORY-8.2's startup seeder). Token goes into
 *     localStorage before the app boots, mirroring fixtures/auth.ts.
 *   - Stub the admin brand-kit list / detail / create / patch / delete
 *     endpoints with `page.route`. We don't want this spec to mutate the
 *     dev DB — the contract under test is "the UI sends the right
 *     request and renders the right response", which is fully decided
 *     client-side.
 *   - Walk a small in-memory corpus through the UI: list → create →
 *     edit → delete, plus a 409-on-delete branch for an in-use kit.
 *
 * This spec stays fully offline (no LLM, no DB writes) so it's safe to
 * run alongside the existing 16 specs without polluting the dev
 * environment.
 */

interface MockKit {
  id: string;
  name: string;
  business_unit: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_family_heading: string;
  font_family_body: string;
  logo_url: string;
  tone_descriptors: string[];
  disclaimer_text: string;
  created_at: string;
  updated_at: string;
}

const SEED_KITS: MockKit[] = [
  {
    id: "acme-retail",
    name: "Acme Retail",
    business_unit: "Retail",
    primary_color: "#004C8F",
    secondary_color: "#FFFFFF",
    accent_color: "#0066ff",
    font_family_heading: "Arial, sans-serif",
    font_family_body: "Arial, sans-serif",
    logo_url: "https://example.com/retail.svg",
    tone_descriptors: ["trustworthy", "professional"],
    disclaimer_text: "Retail disclaimer.",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-04-25T08:00:00Z",
  },
  {
    id: "acme-cards",
    name: "Acme Cards",
    business_unit: "Cards",
    primary_color: "#9B1B30",
    secondary_color: "#FFFFFF",
    accent_color: "#cc2244",
    font_family_heading: "Arial, sans-serif",
    font_family_body: "Arial, sans-serif",
    logo_url: "https://example.com/cards.svg",
    tone_descriptors: ["bold"],
    disclaimer_text: "Cards disclaimer.",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-04-24T08:00:00Z",
  },
];

interface AdminAuthPayload {
  access_token: string;
}

async function adminToken(baseURL: string): Promise<string> {
  // STORY-8.2 seeds admin@phishforge.io / password123 on app startup. We
  // log in via the public auth API rather than minting a token directly so
  // this spec also acts as a smoke test of the seed pathway.
  const res = await fetch(`${baseURL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@phishforge.io",
      password: "password123",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `admin login failed: ${res.status} ${await res.text()}`
    );
  }
  const body = (await res.json()) as AdminAuthPayload;
  return body.access_token;
}

interface MountState {
  kits: MockKit[];
  /** When set, deleting this slug returns 409 with usage_count = N. */
  inUseSlug?: string;
  inUseCount?: number;
}

function mountAdminApiStubs(page: Page, state: MountState): void {
  // GET /api/v1/admin/brand-kits  → list
  // GET /api/v1/admin/brand-kits/{slug}  → detail or 404
  // POST /api/v1/admin/brand-kits  → 201 with body, push into corpus
  // PATCH /api/v1/admin/brand-kits/{slug}  → 200 with merged body
  // DELETE /api/v1/admin/brand-kits/{slug}  → 204 OR 409 inUse
  page.route("**/api/v1/admin/brand-kits**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    // /api/v1/admin/brand-kits exact?
    const isCollection = /\/admin\/brand-kits\/?$/.test(path);
    const detailMatch = path.match(/\/admin\/brand-kits\/([^/]+)$/);

    if (isCollection && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.kits),
      });
    }

    if (isCollection && method === "POST") {
      const data = req.postDataJSON() as MockKit;
      const exists = state.kits.find((k) => k.id === data.id);
      if (exists) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            detail: `Brand kit '${data.id}' already exists`,
          }),
        });
      }
      const newKit: MockKit = {
        ...data,
        created_at: "2026-04-25T12:00:00Z",
        updated_at: "2026-04-25T12:00:00Z",
      };
      state.kits.push(newKit);
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(newKit),
      });
    }

    if (detailMatch && method === "GET") {
      const slug = detailMatch[1];
      const kit = state.kits.find((k) => k.id === slug);
      if (!kit) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            detail: `Brand kit '${slug}' not found`,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kit),
      });
    }

    if (detailMatch && method === "PATCH") {
      const slug = detailMatch[1];
      const kit = state.kits.find((k) => k.id === slug);
      if (!kit) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            detail: `Brand kit '${slug}' not found`,
          }),
        });
      }
      const patch = req.postDataJSON() as Partial<MockKit>;
      Object.assign(kit, patch, { updated_at: "2026-04-25T13:00:00Z" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(kit),
      });
    }

    if (detailMatch && method === "DELETE") {
      const slug = detailMatch[1];
      if (state.inUseSlug && slug === state.inUseSlug) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "Brand kit in use",
            usage_count: state.inUseCount ?? 1,
          }),
        });
      }
      const idx = state.kits.findIndex((k) => k.id === slug);
      if (idx === -1) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            detail: `Brand kit '${slug}' not found`,
          }),
        });
      }
      state.kits.splice(idx, 1);
      return route.fulfill({ status: 204, body: "" });
    }

    return route.fallback();
  });

  // Block the public brand kit list / per-emailer cost from leaking
  // through during the home-page redirect flash. Not strictly necessary
  // since we navigate directly to /admin/brand-kits, but keeps the
  // network log clean.
  page.route("**/api/v1/brand-kits", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        SEED_KITS.map((k) => ({
          id: k.id,
          name: k.name,
          business_unit: k.business_unit,
          primary_color: k.primary_color,
          secondary_color: k.secondary_color,
        }))
      ),
    });
  });
}

test("admin can create a new brand kit", async ({ page, baseURL }) => {
  const token = await adminToken(baseURL ?? "http://localhost:5173");
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, token);

  const state: MountState = { kits: structuredClone(SEED_KITS) };
  mountAdminApiStubs(page, state);

  await page.goto("/admin/brand-kits");

  // Both seeded kits visible.
  await expect(page.getByTestId("brand-kit-row-acme-retail")).toBeVisible();
  await expect(page.getByTestId("brand-kit-row-acme-cards")).toBeVisible();

  // Create new.
  await page.getByTestId("create-brand-kit-cta").click();
  await expect(page.getByTestId("brand-kit-form")).toBeVisible();

  await page.getByTestId("brand-kit-slug-input").fill("acme-test");
  await page.getByTestId("brand-kit-name-input").fill("Acme Test");
  await page.getByTestId("brand-kit-bu-input").fill("Test");
  await page.getByTestId("brand-kit-primary-hex-input").fill("#112233");
  await page.getByTestId("brand-kit-secondary-hex-input").fill("#445566");
  await page.getByTestId("brand-kit-accent-hex-input").fill("#778899");
  await page
    .getByTestId("brand-kit-logo-url-input")
    .fill("https://example.com/test.svg");
  await page.getByTestId("brand-kit-tone-input").fill("playful, modern");
  await page
    .getByTestId("brand-kit-disclaimer-input")
    .fill("Test disclaimer.");

  await page.getByTestId("brand-kit-submit-button").click();

  // Lands back on the list, success toast visible, new row present.
  await expect(page.getByTestId("brand-kit-row-acme-test")).toBeVisible();
  await expect(page.getByTestId("admin-brand-kits-toast")).toContainText(
    /Acme Test.*created/i
  );
});

test("admin can edit an existing brand kit", async ({ page, baseURL }) => {
  const token = await adminToken(baseURL ?? "http://localhost:5173");
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, token);

  const state: MountState = { kits: structuredClone(SEED_KITS) };
  mountAdminApiStubs(page, state);

  await page.goto("/admin/brand-kits");
  await page.getByTestId("brand-kit-row-acme-retail").click();

  // Slug is disabled, name is pre-filled.
  await expect(page.getByTestId("brand-kit-slug-input")).toBeDisabled();
  await expect(page.getByTestId("brand-kit-name-input")).toHaveValue(
    "Acme Retail"
  );

  // Edit name and save.
  await page.getByTestId("brand-kit-name-input").fill("Acme Retail v2");
  await page.getByTestId("brand-kit-submit-button").click();

  // Back on the list, the row reflects the new name.
  await expect(page.getByTestId("admin-brand-kits-toast")).toContainText(
    /saved/i
  );
  await expect(
    page.getByRole("link", { name: "Acme Retail v2" })
  ).toBeVisible();
});

test("admin can delete a brand kit after confirmation", async ({
  page,
  baseURL,
}) => {
  const token = await adminToken(baseURL ?? "http://localhost:5173");
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, token);

  const state: MountState = { kits: structuredClone(SEED_KITS) };
  mountAdminApiStubs(page, state);

  await page.goto("/admin/brand-kits");
  await page.getByTestId("brand-kit-row-acme-cards").click();

  await page.getByTestId("brand-kit-delete-button").click();
  await expect(page.getByTestId("confirm-delete-dialog")).toBeVisible();

  await page.getByTestId("confirm-delete-confirm").click();

  // Back on the list, the row is gone.
  await expect(page.getByTestId("admin-brand-kits-toast")).toContainText(
    /deleted/i
  );
  await expect(page.getByTestId("brand-kit-row-acme-cards")).toBeHidden();
});

test("delete on an in-use brand kit shows the 409 message and stays on the form", async ({
  page,
  baseURL,
}) => {
  const token = await adminToken(baseURL ?? "http://localhost:5173");
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, token);

  const state: MountState = {
    kits: structuredClone(SEED_KITS),
    inUseSlug: "acme-retail",
    inUseCount: 4,
  };
  mountAdminApiStubs(page, state);

  await page.goto("/admin/brand-kits");
  await page.getByTestId("brand-kit-row-acme-retail").click();

  await page.getByTestId("brand-kit-delete-button").click();
  await page.getByTestId("confirm-delete-confirm").click();

  // Toast surfaces the in-use count, and we're still on the edit form.
  await expect(page.getByTestId("brand-kit-form-toast")).toContainText(
    /Cannot delete — 4 emailers reference this brand kit/i
  );
  await expect(page.getByTestId("brand-kit-form")).toBeVisible();
});

test("non-admin users are redirected away from /admin/brand-kits", async ({
  page,
  baseURL,
}) => {
  // Register a fresh editor (the public /auth/register endpoint defaults
  // role=editor) and use that token. The admin gate should kick in.
  const email = `e2e-editor-${Date.now()}@example.com`;
  const res = await fetch(
    `${baseURL ?? "http://localhost:5173"}/api/v1/auth/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "e2e-password-pls-ignore",
        name: "E2E Editor",
      }),
    }
  );
  expect(res.ok, `register failed: ${res.status}`).toBe(true);
  const body = (await res.json()) as { access_token: string };
  await page.addInitScript((t: string) => {
    window.localStorage.setItem("access_token", t);
  }, body.access_token);

  await page.goto("/admin/brand-kits");

  // Redirected to / (the home page).
  await expect(page).toHaveURL(/\/$/);
});
