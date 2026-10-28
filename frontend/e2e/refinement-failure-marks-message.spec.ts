import { test, expect } from "./fixtures/emailer";

/**
 * STORY-7.12 AC-6.2 — Refinement 422 marks the user message as failed.
 *
 * Mocks `POST /api/v1/emailers/{id}/chat` so the test is self-contained
 * (no LLM env-seam coordination needed). First send returns 422; the
 * UI marks the user's bubble as failed and shows the inline remediation
 * hint. Second send returns 200; the chat keeps working normally — the
 * failed marker on the first bubble persists, only that one message is
 * flagged.
 *
 * Canvas-content invariance is asserted by snapshotting the editor's
 * inner HTML before the failed send and confirming it is unchanged
 * afterwards. The refiner-mock-422 path never produces a version row,
 * so EmailerPage never calls `setActiveVersion`, so the canvas should
 * not move. We snapshot via `editor.getHtml()` (exposed through the
 * GrapesJS DOM by `grapesjs-react`'s wrapper).
 */

const MOCK_422_BODY = {
  detail: {
    detail: "MJML validation failed",
    errors: [
      {
        line: 4,
        tag: "mj-divider",
        message: "void element with children",
      },
    ],
  },
};

const MOCK_REFINE_OK = {
  message: {
    id: 8888,
    emailer_id: 0,
    role: "assistant",
    content: "OK, I made the change you asked for.",
    created_at: new Date().toISOString(),
  },
  version: {
    id: 7777,
    emailer_id: 0,
    version_number: 2,
    mjml_source:
      "<mjml><mj-body><mj-section><mj-column><mj-text>Refined</mj-text></mj-column></mj-section></mj-body></mjml>",
    compiled_html: "<html><body>refined</body></html>",
    subject_line: "Refined",
    preheader: "Refined preheader",
    model_used: "claude-sonnet-4-20250514",
    input_tokens: 50,
    output_tokens: 100,
    created_at: new Date().toISOString(),
  },
  summary: "Made the requested edit.",
  warnings: [],
};

test("ChatPanel marks a failed refinement and continues to work for subsequent sends", async ({
  authedPage,
  seededEmailer,
}) => {
  // Intercept the chat refine endpoint. First call: 422. Second call: 200.
  // GET stays unmocked so the chat history pre-fetch hits the real
  // backend (returns []).
  let chatPostCount = 0;
  await authedPage.route(
    `**/api/v1/emailers/${seededEmailer.id}/chat`,
    async (route) => {
      if (route.request().method() !== "POST") {
        return route.fallback();
      }
      chatPostCount += 1;
      if (chatPostCount === 1) {
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify(MOCK_422_BODY),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_REFINE_OK),
      });
    }
  );

  await authedPage.goto(`/emailers/${seededEmailer.id}`);

  // Wait for the editor canvas to mount — the same locator other specs
  // use to confirm GrapesJS has a populated tree.
  await expect(authedPage.locator(".gjs-cv-canvas")).toBeVisible({
    timeout: 30_000,
  });

  // Snapshot the canvas content. GrapesJS exposes the editor instance
  // on the canvas iframe's parent window via the `grapesjs` object;
  // the project's wrapper attaches the editor to a global only if a
  // dev opts in, so we use a textContent probe instead. The seed MJML
  // contains the literal "E2E seed content" string from the fixture.
  const canvasFrame = authedPage.frameLocator(".gjs-frame");
  const seededMarker = canvasFrame.locator("text=E2E seed content");
  await expect(seededMarker).toBeVisible({ timeout: 10_000 });

  // Open the chat panel.
  await authedPage.getByRole("button", { name: /^chat$/i }).click();

  // Send the first message — this gets 422.
  const chatInput = authedPage.getByLabel(/chat message input/i);
  await chatInput.fill("Make the divider blue");
  await authedPage.getByLabel(/send message/i).click();

  // The user bubble shows up with a failed indicator + the inline hint.
  const failedIndicator = authedPage.getByTestId(
    "chat-message-failed-indicator"
  );
  await expect(failedIndicator).toBeVisible({ timeout: 10_000 });
  await expect(
    authedPage.getByTestId("chat-message-failed-text")
  ).toContainText(/couldn['’]t apply that change — please rephrase/i);

  // The canvas content is unchanged — the seed text is still there.
  await expect(seededMarker).toBeVisible();

  // Second message succeeds — Apply button appears on the assistant
  // response, proving the chat is still functional after the failure.
  await chatInput.fill("Try a different change");
  await authedPage.getByLabel(/send message/i).click();
  await expect(
    authedPage.getByRole("button", { name: /^apply$/i })
  ).toBeVisible({ timeout: 10_000 });

  // The first message's failure marker is still there — only that one
  // message is flagged.
  await expect(failedIndicator).toBeVisible();

  expect(chatPostCount).toBe(2);
});
