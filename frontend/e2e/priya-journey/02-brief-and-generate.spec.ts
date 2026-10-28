import { test, expect } from "../fixtures/emailer";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * STORY-7.9 Priya-journey Wave 1 — Brief + asset upload + generate.
 *
 * Drives the real /brief form end-to-end:
 *   1. Fill every required field.
 *   2. Upload an asset (a tiny PNG checked in at
 *      ``frontend/e2e/fixtures/test-asset.png``). This implicitly creates
 *      a draft emailer via the asset-upload-first path (STORY-2.6) so
 *      the subsequent submit goes through the PATCH branch.
 *   3. Click Generate, wait for the navigation to ``/emailers/{id}``
 *      (which only happens after the LLM round-trip succeeds), and
 *      assert the editor mounts with content.
 *
 * **Real LLM call** — typically 20–60s. If the run sets ``SKIP_REAL_LLM``
 * on the runner, the spec is skipped with a clear reason. CI sets it for
 * fast-loop runs; demo / nightly runs leave it unset.
 *
 * Auth comes from the ``authedPage`` fixture so we bypass the LoginPage
 * for this spec (covered separately by 01-onboarding).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_ASSET = path.join(__dirname, "..", "fixtures", "test-asset.png");

const skipRealLlm = process.env.SKIP_REAL_LLM === "1";

test.skip(
  skipRealLlm,
  "Set SKIP_REAL_LLM=1 to skip real-LLM specs in fast CI runs."
);

test.describe("brief + generate", () => {
  // The generate step is a real Claude call; bump the per-test timeout so
  // we don't false-fail under cold-cache conditions.
  test.setTimeout(180_000);

  test("fills brief, uploads an asset, generates, and lands on the editor with content", async ({
    authedPage,
    authedRequest,
  }) => {
    const page = authedPage;

    await page.goto("/brief");
    await expect(
      page.getByRole("heading", { name: /Create new emailer/i })
    ).toBeVisible({ timeout: 10_000 });

    // ----- Fill the brief -----
    await page.getByLabel(/Template name/i).fill("E2E Priya Brief");

    // BrandKitSelector is a custom combobox with role="combobox" and a
    // role="listbox" popover. Select the first option that appears.
    await page.getByRole("combobox", { name: /Brand kit/i }).click();
    await page.getByRole("option").first().click();

    await page.getByLabel(/Category/i).selectOption("product_launch");
    await page
      .getByLabel(/Target audience/i)
      .fill("Acme savings account holders aged 25–45");
    await page
      .getByLabel(/Email content summary/i)
      .fill(
        "Announce our new credit card with 5% cashback for the first three months. Friendly, conversational tone."
      );
    await page.getByLabel(/^Tone$/i).selectOption("professional");
    await page.getByLabel(/^Length$/i).selectOption("short");
    await page.getByLabel(/Primary CTA text/i).fill("Apply now");
    await page
      .getByLabel(/Primary CTA URL/i)
      .fill("https://acmebank.example/personal/pay/cards/credit-cards");

    // ----- Upload a test asset -----
    // The hidden file input is data-testid'd in AssetUploadPanel.
    await page
      .getByTestId("asset-file-input")
      .setInputFiles(TEST_ASSET);

    // Wait for the asset tile to appear with the inferred label
    // (filename without extension).
    await expect(page.getByText("test-asset")).toBeVisible({
      timeout: 30_000,
    });

    // ----- Submit + wait for navigation to the editor -----
    // The button label is "Generate" before the click and "Generating…"
    // while the request is in-flight. We click the matching button and
    // then wait for the URL change.
    await page.getByRole("button", { name: /^Generate$/ }).click();

    // The redirect happens when the generate API succeeds; allow a
    // generous timeout for the cold-path LLM call.
    await page.waitForURL(/\/emailers\/\d+$/, { timeout: 150_000 });

    // The GrapesJS canvas should mount with content.
    await expect(page.locator(".gjs-cv-canvas")).toBeVisible({
      timeout: 30_000,
    });
    // And the cost badge exists on the editor toolbar (already covered
    // in detail by the cost-badge spec — we're just sanity-checking the
    // editor mounted).
    await expect(page.getByTestId("cost-badge-value")).toBeVisible({
      timeout: 15_000,
    });

    // STORY-2.6 AC-7: the uploaded asset's URL must surface in the
    // generated MJML — proving the LLM actually integrated the asset
    // rather than just acknowledging the upload list. We pull the
    // emailer id from the URL, fetch the latest version's MJML via the
    // API, and assert the asset filename appears inside an <mj-image>
    // tag.
    const matchEmailerId = page.url().match(/\/emailers\/(\d+)/);
    expect(matchEmailerId, "Should be on /emailers/{id}").not.toBeNull();
    const emailerId = matchEmailerId![1];

    const versionRes = await authedRequest.get(
      `/api/v1/emailers/${emailerId}/versions/latest`
    );
    expect(
      versionRes.ok(),
      `GET /versions/latest failed: ${versionRes.status()}`
    ).toBe(true);
    const versionBody = (await versionRes.json()) as {
      mjml_source: string;
    };
    // The asset's storage path includes the emailer id and filename;
    // we don't know the exact storage path prefix, but the original
    // filename (test-asset.png) is preserved by the storage service
    // and substituted into <mj-image src="...">. Asserting against
    // the filename is the strongest signal the LLM actually wired the
    // upload into the rendered email.
    expect(
      versionBody.mjml_source,
      "Generated MJML should reference the uploaded asset via <mj-image>"
    ).toMatch(/<mj-image[^>]*src="[^"]*test-asset[^"]*"/);
  });
});
