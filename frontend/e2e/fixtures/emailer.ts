import { test as authTest, expect } from "./auth";
import type { APIRequestContext } from "@playwright/test";

/**
 * Emailer fixture (STORY-7.10).
 *
 * Builds on the `auth` fixture. Provides helpers to:
 *   - Create an emailer (draft) directly via the API.
 *   - Seed a version onto that emailer with caller-provided MJML.
 *
 * We seed via API rather than UI to keep tests fast and decoupled from
 * the brief-form / generate flow. Note: `POST /versions` runs the MJML
 * sanitizer, so v8-style malformed input gets auto-repaired before
 * persisting. Tests that need to exercise the rejection path should mock
 * the response with `page.route(...)` instead of trying to push invalid
 * MJML through the seed.
 */

export interface SeededEmailer {
  id: number;
  versionId: number;
  versionNumber: number;
}

const VALID_SEED_MJML = `<mjml>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-text>E2E seed content</mj-text>
        <mj-divider />
        <mj-text>Body paragraph for e2e testing.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

async function createEmailerDraft(
  request: APIRequestContext,
  name: string
): Promise<number> {
  const res = await request.post(`/api/v1/emailers`, {
    data: {
      status: "draft",
      name,
      brand_kit_id: "acme-retail",
    },
  });
  expect(
    res.ok(),
    `POST /emailers failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  const body = (await res.json()) as { id: number };
  return body.id;
}

async function seedVersion(
  request: APIRequestContext,
  emailerId: number,
  mjmlSource: string
): Promise<{ versionId: number; versionNumber: number }> {
  const res = await request.post(
    `/api/v1/emailers/${emailerId}/versions`,
    { data: { mjml_source: mjmlSource } }
  );
  expect(
    res.ok(),
    `POST /versions failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  const body = (await res.json()) as {
    id: number;
    version_number: number;
  };
  return { versionId: body.id, versionNumber: body.version_number };
}

export interface EmailerFixtures {
  seededEmailer: SeededEmailer;
}

export const test = authTest.extend<EmailerFixtures>({
  seededEmailer: async ({ authedRequest }, use) => {
    const emailerId = await createEmailerDraft(
      authedRequest,
      `E2E Emailer ${Date.now()}`
    );
    const { versionId, versionNumber } = await seedVersion(
      authedRequest,
      emailerId,
      VALID_SEED_MJML
    );
    await use({ id: emailerId, versionId, versionNumber });
  },
});

export { expect, VALID_SEED_MJML };

export const seedHelpers = { createEmailerDraft, seedVersion };
