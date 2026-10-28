import { test, expect } from "../fixtures/emailer";

/**
 * STORY-7.9 Priya-journey Wave 1 — Share preview link + Export HTML +
 * Status confirmation.
 *
 * Flow:
 *   1. Open the seeded emailer.
 *   2. Click "Share preview" → fill the dialog → create a link.
 *   3. Open the resulting share URL in a *fresh, unauthenticated* browser
 *      context (no JWT in localStorage) and verify the public preview
 *      renders the seeded HTML.
 *   4. Back on the editor, click "Export HTML", intercept the download,
 *      and assert the file looks like the compiled email.
 *   5. Refetch the emailer via the API and assert ``status === "exported"``.
 *
 * No real LLM calls in this spec — it's all server-compiled HTML and
 * download plumbing. Runs in fast-CI by default.
 */

test("share + export: link works in incognito, downloaded HTML matches saved version, status flips to exported", async ({
  authedPage,
  authedRequest,
  seededEmailer,
  browser,
}) => {
  const page = authedPage;

  await page.goto(`/emailers/${seededEmailer.id}`);
  await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });

  // STORY-7.6 AC-5: opening the user menu, then clicking outside it,
  // closes the menu. We exercise this here while the editor's top bar
  // (which mounts the UserMenu) is already loaded — keeps the journey
  // moving without a dedicated spec.
  await page.getByRole("button", { name: /Account menu/i }).click();
  await expect(page.getByRole("menu", { name: /Account menu/i })).toBeVisible({
    timeout: 5_000,
  });
  // Click on a non-menu element (the editor's emailer-name heading).
  await page.locator("h1, h2").first().click({ position: { x: 5, y: 5 } });
  await expect(
    page.getByRole("menu", { name: /Account menu/i })
  ).toBeHidden({ timeout: 5_000 });

  // ---------- Share preview link ----------
  await page.getByRole("button", { name: /Share preview/i }).click();
  // The dialog renders with role="dialog".
  const dialog = page.getByRole("dialog", { name: /Share preview/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  await dialog.getByRole("button", { name: /Create link/i }).click();
  const created = dialog.getByTestId("share-link-created");
  await expect(created).toBeVisible({ timeout: 15_000 });

  const shareUrl = await created
    .getByRole("textbox", { name: /Created preview URL/i })
    .inputValue();
  expect(shareUrl).toMatch(/\/share\/[A-Za-z0-9_-]+/);

  // ---------- Open share URL anonymously ----------
  // Spawn a fresh context so the owner's JWT in localStorage doesn't
  // leak in. Production reviewers open these links with no auth.
  const anonContext = await browser.newContext();
  try {
    const anonPage = await anonContext.newPage();
    await anonPage.goto(shareUrl);
    const iframe = anonPage.getByTestId("shared-preview-iframe");
    await expect(iframe).toBeVisible({ timeout: 15_000 });
    // The seed MJML's compiled output should contain the seed text. We
    // pull the iframe's HTML content directly to avoid race-y locator
    // timing on iframe document load.
    const compiled = await iframe.getAttribute("srcdoc");
    expect(compiled).not.toBeNull();
    expect(compiled).toContain("E2E seed content");
  } finally {
    await anonContext.close();
  }

  // Close the share dialog before exporting.
  await dialog.getByRole("button", { name: /^Done$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });

  // ---------- Export HTML ----------
  // STORY-5.4: Export forces a Save first. With seeded MJML on screen
  // and no canvas mutations, the resulting saved version's compiled HTML
  // still contains the seed text — that's all we need to assert here
  // (the "edit-then-export" round-trip is covered by spec 05).
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: /Export HTML/i }).click();
  const download = await downloadPromise;

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  // Read the downloaded bytes — Node fs is fine here; Playwright
  // returns a real file path on disk.
  const fs = await import("node:fs");
  const fileText = fs.readFileSync(downloadPath, "utf-8");
  expect(fileText).toContain("E2E seed content");
  // STORY-5.2 metadata block should be present on every export.
  expect(fileText).toContain("Exported:");

  // ---------- Confirm status === "exported" ----------
  const emailerRes = await authedRequest.get(
    `/api/v1/emailers/${seededEmailer.id}`
  );
  expect(emailerRes.ok()).toBe(true);
  const emailerBody = (await emailerRes.json()) as { status: string };
  expect(emailerBody.status).toBe("exported");
});
