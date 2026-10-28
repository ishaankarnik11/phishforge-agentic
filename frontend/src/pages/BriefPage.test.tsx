import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BriefPage from "./BriefPage";
import * as emailersApi from "../api/emailers";
import * as presetsApi from "../api/impersonationPresets";
import * as assetsApi from "../api/assets";
import type {
  ImpersonationPresetSummary,
  ImpersonationPresetDetail,
} from "../api/impersonationPresets";
import { AuthProvider } from "../contexts/AuthContext";
import type { AssetRead } from "../api/assets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function renderBriefPage(initialPath = "/brief") {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <Routes>
            <Route path="/brief" element={<BriefPage />} />
            <Route
              path="/emailers/:id"
              element={<div data-testid="emailer-page">Emailer page</div>}
            />
            <Route
              path="/"
              element={<div data-testid="home-page">Home page</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const MOCK_PRESETS: ImpersonationPresetSummary[] = [
  {
    id: "microsoft-365",
    name: "Microsoft 365",
    primary_color: "#0067B8",
  },
];

const MOCK_PRESET_DETAIL: ImpersonationPresetDetail = {
  id: "microsoft-365",
  name: "Microsoft 365",
  sender_email: "it-support@contoso.com",
  primary_color: "#0067B8",
  pretends_to_be: "A Microsoft 365 password-expiry notice",
  logo_url: null,
};

const VALID_FORM_DATA = {
  name: "Q4 Savings Campaign",
  target_audience: "Existing Acme savings account holders",
};

// STORY-AP2.2: the three required impersonated-identity fields. Shared so
// existing submit-path tests can satisfy the new validation.
const VALID_IMPERSONATION = {
  sender_name: "MS 365",
  sender_email: "it@contoso.com",
  pretends_to_be: "Password-expiry notice",
};

/** Fill the three required impersonation fields with valid data. */
async function fillImpersonation(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText(/brand \/ sender name/i),
    VALID_IMPERSONATION.sender_name
  );
  await user.type(
    screen.getByLabelText(/sender email/i),
    VALID_IMPERSONATION.sender_email
  );
  await user.type(
    screen.getByLabelText(/what this email pretends to be/i),
    VALID_IMPERSONATION.pretends_to_be
  );
}

/**
 * Fill the required pretext fields (STORY-AP2.1 + CR-001 scenario). CR-001
 * adds the required Pretext scenario select at the top of the section.
 */
async function fillPretext(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    screen.getByTestId("pretext-scenario-select"),
    "password_expiry"
  );
  await user.selectOptions(
    screen.getByTestId("lure-type-select"),
    "credential_harvest"
  );
  await user.selectOptions(screen.getByTestId("urgency-select"), "high");
}

// STORY-7.12: BriefPage submit now also calls POST /emailers/{id}/generate
// before navigating. Tests that previously only stubbed createEmailer must
// also stub generateEmailer or they'll hit a real fetch and fail.
const MOCK_GENERATE_RESPONSE = {
  version_id: 99,
  version_number: 1,
  subject_line: "Generated subject",
  preheader: "Preheader",
  mjml_source: "<mjml><mj-body><mj-section /></mj-body></mjml>",
  compiled_html: "<html></html>",
  model_used: "claude-sonnet-4-20250514",
  input_tokens: 100,
  output_tokens: 200,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  latency_ms: 1234,
  warning: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// These tests drive the full brief form through userEvent.type, which is
// inherently slow; under full-suite parallel load the heavier submit-path
// cases can edge past the 5s default. Give the suite more headroom.
describe("BriefPage", { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: impersonation presets load successfully for the dropdown.
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue(MOCK_PRESETS);
    // Default: empty asset list (the AssetUploadPanel calls this whenever
    // a draft emailer id appears).
    vi.spyOn(assetsApi, "listAssets").mockResolvedValue([]);
    // jsdom doesn't implement createObjectURL.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    });
  });

  // -------------------------------------------------------------------------
  // STORY-7.6: Back-to-emailers regression test
  // -------------------------------------------------------------------------
  it("exposes a 'Back to emailers' link pointing at /", async () => {
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    const backLink = screen.getByRole("link", { name: /back to simulations/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/");
  });

  // -------------------------------------------------------------------------
  // 1. All required fields render
  // -------------------------------------------------------------------------
  it("renders the core form fields", async () => {
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    expect(screen.getByLabelText(/template name/i)).toBeInTheDocument();
    // STORY-AP1.2: the brand-kit selector is gone; an optional preset
    // dropdown lives in the impersonation section instead.
    expect(
      screen.getByTestId("impersonation-preset-select")
    ).toBeInTheDocument();
    // CR-001: pretext scenario replaces the retired marketing Category.
    expect(screen.getByTestId("pretext-scenario-select")).toBeInTheDocument();
    // CR-001: "Target audience" relabeled to "Target recipients".
    expect(screen.getByLabelText(/target recipients/i)).toBeInTheDocument();
    // CR-001: CTA relabeled — link text + tracked URL. The field label is
    // "Call to action (optional)", so match the leading text.
    expect(screen.getByLabelText(/call to action/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tracked url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/length/i)).toBeInTheDocument();

    // CR-001: the retired marketing fields are gone.
    expect(screen.queryByLabelText(/category/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/email content summary/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^tone$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/language/i)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Validation: empty name shows error on blur
  // -------------------------------------------------------------------------
  it("shows a validation error on the name field when blurred while empty", async () => {
    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    const nameInput = screen.getByLabelText(/template name/i);
    await user.click(nameInput);
    await user.tab(); // trigger blur

    expect(
      await screen.findByText(/template name is required/i)
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 3. Submitting with empty name (form-level) shows validation error
  // -------------------------------------------------------------------------
  it("shows validation errors and does not call createEmailer when name is missing on submit", async () => {
    const createSpy = vi
      .spyOn(emailersApi, "createEmailer")
      .mockResolvedValue({ id: 123, name: "test", status: "draft" });

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Leave name empty, click submit
    await user.click(screen.getByRole("button", { name: /generate/i }));

    expect(
      await screen.findByText(/template name is required/i)
    ).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Successful submit calls createEmailer and navigates to /emailers/{id}
  // -------------------------------------------------------------------------
  it("calls createEmailer with valid data and navigates to /emailers/{id}", async () => {
    const createSpy = vi
      .spyOn(emailersApi, "createEmailer")
      .mockResolvedValue({
        id: 42,
        name: VALID_FORM_DATA.name,
        status: "draft",
      });
    // STORY-7.12 AC-1: navigation now happens after generate succeeds.
    vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
      MOCK_GENERATE_RESPONSE
    );

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Fill in required fields
    await user.type(screen.getByLabelText(/template name/i), VALID_FORM_DATA.name);

    // CR-001: Target recipients (optional, relabeled).
    await user.type(
      screen.getByLabelText(/target recipients/i),
      VALID_FORM_DATA.target_audience
    );

    // Length (optional).
    await user.selectOptions(screen.getByLabelText(/length/i), "short");

    // STORY-AP2.2: impersonated identity is now required.
    await fillImpersonation(user);
    // STORY-AP2.1 + CR-001: pretext (scenario + lure + urgency) is required.
    await fillPretext(user);

    // Submit
    await user.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());

    // CR-001: payload carries pretext_scenario; target_audience/length sent
    // when present; category/content_summary/tone are NOT sent.
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: VALID_FORM_DATA.name,
        pretext_scenario: "password_expiry",
        target_audience: VALID_FORM_DATA.target_audience,
        length: "short",
        impersonation_sender_name: VALID_IMPERSONATION.sender_name,
        impersonation_sender_email: VALID_IMPERSONATION.sender_email,
        impersonation_pretends_to_be: VALID_IMPERSONATION.pretends_to_be,
        impersonation_primary_color: null,
        impersonation_logo_asset_id: null,
        lure_type: "credential_harvest",
        urgency_level: "high",
        pretext_tell: null,
      })
    );
    const submitted = createSpy.mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(submitted.category).toBeUndefined();
    expect(submitted.tone).toBeUndefined();
    // content_summary is only present when library assets are attached.
    expect(submitted.content_summary).toBeNull();

    // Should navigate to the emailer page
    await waitFor(() =>
      expect(screen.getByTestId("emailer-page")).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // 5. API error shows error banner
  // -------------------------------------------------------------------------
  it("shows an error banner when the API call fails", async () => {
    vi.spyOn(emailersApi, "createEmailer").mockRejectedValue(
      new Error("Internal server error")
    );

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Fill all required fields
    await user.type(screen.getByLabelText(/template name/i), VALID_FORM_DATA.name);


    await user.type(
      screen.getByLabelText(/target recipients/i),
      VALID_FORM_DATA.target_audience
    );
    await user.selectOptions(screen.getByLabelText(/length/i), "short");
    await fillImpersonation(user);
    await fillPretext(user);

    await user.click(screen.getByRole("button", { name: /generate/i }));

    const banner = await screen.findByText(/internal server error/i);
    expect(banner).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // STORY-2.6: Asset upload integration
  // -------------------------------------------------------------------------
  it("renders the in-email asset upload panel", async () => {
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // STORY-A5.1: the panel now has two action boxes instead of a single drop-zone.
    expect(screen.getByText(/Upload from device/i)).toBeInTheDocument();
    expect(screen.getByText(/Pick from Library/i)).toBeInTheDocument();
  });

  it("disables the Generate button while an asset upload is in flight", async () => {
    // Never resolves so we can inspect mid-flight state
    let resolveUpload: (asset: AssetRead) => void = () => {};
    vi.spyOn(assetsApi, "uploadAsset").mockReturnValue(
      new Promise<AssetRead>((res) => {
        resolveUpload = res;
      })
    );
    // Ensure-draft path: lazily creates a draft emailer
    vi.spyOn(emailersApi, "createEmailer").mockResolvedValue({
      id: 99,
      name: "draft",
      status: "draft",
    });

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    const fileInput = screen.getByLabelText(/Upload assets/i, {
      selector: "input",
    }) as HTMLInputElement;

    const file = new File([new Uint8Array(1024)], "hero.png", {
      type: "image/png",
    });
    await user.upload(fileInput, file);

    // The Generate button should now be disabled while the upload is in flight.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled()
    );

    // After the upload resolves, the button should be enabled again.
    resolveUpload({
      id: "a-1",
      emailer_id: 99,
      filename: "hero.png",
      label: "hero",
      mime_type: "image/png",
      size_bytes: 1024,
      url: "http://localhost:8000/assets/99/hero.png",
      uploaded_at: "2026-04-25T00:00:00Z",
      kind: "content",
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /generate/i })).not.toBeDisabled()
    );
  });

  it("uses PATCH instead of POST when a draft emailer was created via asset upload", async () => {
    vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue({
      id: "a-1",
      emailer_id: 42,
      filename: "hero.png",
      label: "hero",
      mime_type: "image/png",
      size_bytes: 1024,
      url: "http://localhost:8000/assets/42/hero.png",
      uploaded_at: "2026-04-25T00:00:00Z",
      kind: "content",
    });
    const createSpy = vi
      .spyOn(emailersApi, "createEmailer")
      .mockResolvedValue({
        id: 42,
        name: "wip",
        status: "draft",
      });
    const updateSpy = vi
      .spyOn(emailersApi, "updateEmailer")
      .mockResolvedValue({
        id: 42,
        name: "Q4 Savings Campaign",
        status: "in_review",
      });
    // STORY-7.12: post-PATCH generate also fires before navigation.
    vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
      MOCK_GENERATE_RESPONSE
    );

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Fill required fields
    await user.type(
      screen.getByLabelText(/template name/i),
      VALID_FORM_DATA.name
    );
    await user.type(
      screen.getByLabelText(/target recipients/i),
      VALID_FORM_DATA.target_audience
    );
    await user.selectOptions(screen.getByLabelText(/length/i), "short");
    await fillImpersonation(user);
    await fillPretext(user);

    // Trigger an asset upload to create the draft
    const fileInput = screen.getByLabelText(/Upload assets/i, {
      selector: "input",
    }) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File([new Uint8Array(1024)], "hero.png", { type: "image/png" })
    );

    // Wait for the upload to finish
    await waitFor(() => expect(createSpy).toHaveBeenCalled());

    // Now click Generate -- expect a PATCH, not another POST
    await user.click(screen.getByRole("button", { name: /generate/i }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        name: VALID_FORM_DATA.name,
      })
    ));

    // POST should have been called exactly once (the draft create) -- not
    // again on submit.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 6. Submit button is disabled while submitting
  // -------------------------------------------------------------------------
  it("disables the submit button while the API call is in flight", async () => {
    // Never resolves so we can inspect mid-flight state
    vi.spyOn(emailersApi, "createEmailer").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    // Fill all required fields
    await user.type(screen.getByLabelText(/template name/i), VALID_FORM_DATA.name);


    await user.type(
      screen.getByLabelText(/target recipients/i),
      VALID_FORM_DATA.target_audience
    );
    await user.selectOptions(screen.getByLabelText(/length/i), "medium");
    await fillImpersonation(user);
    await fillPretext(user);

    await user.click(screen.getByRole("button", { name: /generate/i }));

    // Button should now be disabled and show spinner text
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /generating/i })
      ).toBeDisabled()
    );
  });

  // -------------------------------------------------------------------------
  // STORY-7.12 AC-1 / AC-5: generation 422 surface + Retry
  // -------------------------------------------------------------------------

  /** Helper to fill out the brief form with valid data so we can submit. */
  async function fillValidBrief(user: ReturnType<typeof userEvent.setup>) {
    await user.type(
      screen.getByLabelText(/template name/i),
      VALID_FORM_DATA.name
    );
    await user.type(
      screen.getByLabelText(/target recipients/i),
      VALID_FORM_DATA.target_audience
    );
    await user.selectOptions(screen.getByLabelText(/length/i), "short");
    await fillImpersonation(user);
    await fillPretext(user);
  }

  it("renders the AC-1 retry surface when generate returns a MJMLValidationError", async () => {
    vi.spyOn(emailersApi, "createEmailer").mockResolvedValue({
      id: 77,
      name: VALID_FORM_DATA.name,
      status: "draft",
    });
    vi.spyOn(emailersApi, "generateEmailer").mockRejectedValue(
      new emailersApi.MJMLValidationError("MJML validation failed", [
        { line: 5, tag: "mj-divider", message: "void element with children" },
      ])
    );

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    await fillValidBrief(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    // The dedicated error block appears with the spec'd copy and a Retry
    // button (not the generic apiError banner).
    const block = await screen.findByTestId("generation-error");
    expect(block).toHaveTextContent(
      /generation produced invalid output\. please retry\./i
    );
    const retryBtn = within(block).getByRole("button", { name: /^retry$/i });
    expect(retryBtn).toBeInTheDocument();

    // We never navigated to the editor.
    expect(screen.queryByTestId("emailer-page")).not.toBeInTheDocument();

    // Form fields are not cleared (AC-1 explicit requirement).
    expect(screen.getByLabelText(/template name/i)).toHaveValue(
      VALID_FORM_DATA.name
    );
    expect(screen.getByLabelText(/target recipients/i)).toHaveValue(
      VALID_FORM_DATA.target_audience
    );

    // Focus moved to the Retry button so a keyboard user can recover
    // without hunting for it (AC-1).
    expect(retryBtn).toHaveFocus();
  });

  it("re-issues generate with the same emailer id when Retry is clicked, then navigates", async () => {
    const createSpy = vi
      .spyOn(emailersApi, "createEmailer")
      .mockResolvedValue({
        id: 77,
        name: VALID_FORM_DATA.name,
        status: "draft",
      });
    // First call fails, second call (Retry) succeeds.
    const generateSpy = vi
      .spyOn(emailersApi, "generateEmailer")
      .mockRejectedValueOnce(
        new emailersApi.MJMLValidationError("MJML validation failed", [])
      )
      .mockResolvedValueOnce(MOCK_GENERATE_RESPONSE);

    const user = userEvent.setup();
    renderBriefPage();

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument()
    );

    await fillValidBrief(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    const retryBtn = await screen.findByRole("button", { name: /^retry$/i });
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy).toHaveBeenLastCalledWith(77);
    // create should have happened only once across the whole flow — Retry
    // hits generate directly, not the create path.
    expect(createSpy).toHaveBeenCalledTimes(1);

    await user.click(retryBtn);

    await waitFor(() =>
      expect(generateSpy).toHaveBeenCalledTimes(2)
    );
    // Both generate calls used the same emailer id.
    expect(generateSpy.mock.calls.map((c) => c[0])).toEqual([77, 77]);
    // create was NOT called a second time on Retry.
    expect(createSpy).toHaveBeenCalledTimes(1);

    // After the successful retry we navigate to /emailers/77.
    await waitFor(() =>
      expect(screen.getByTestId("emailer-page")).toBeInTheDocument()
    );
  });

  // -------------------------------------------------------------------------
  // STORY-AP2.2: Impersonated identity section
  // -------------------------------------------------------------------------
  describe("impersonated identity (STORY-AP2.2)", () => {
    /** Fill every required field EXCEPT impersonation, so submit hinges on it. */
    async function fillBriefWithoutImpersonation(
      user: ReturnType<typeof userEvent.setup>
    ) {
      await user.type(
        screen.getByLabelText(/template name/i),
        VALID_FORM_DATA.name
      );
      await user.type(
        screen.getByLabelText(/target recipients/i),
        VALID_FORM_DATA.target_audience
      );
      await user.selectOptions(screen.getByLabelText(/length/i), "short");
      // STORY-AP2.1 + CR-001: pretext (scenario + lure + urgency) is also
      // required for a clean submit. Harmless for the validation-only tests
      // (impersonation still blocks submit).
      await fillPretext(user);
    }

    it("renders the section and its fields", async () => {
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      expect(
        screen.getByRole("heading", { name: /impersonated identity/i })
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/brand \/ sender name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/sender email/i)).toBeInTheDocument();
      expect(
        screen.getByLabelText(/what this email pretends to be/i)
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("impersonation-color-picker")
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText(/upload impersonation logo/i)
      ).toBeInTheDocument();
    });

    it("blocks submit and shows errors when the three required fields are empty", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 1,
          name: "x",
          status: "draft",
        });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutImpersonation(user);
      await user.click(screen.getByRole("button", { name: /generate/i }));

      expect(
        await screen.findByText(/brand \/ sender name is required/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/sender email is required/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/describe what this email pretends to be/i)
      ).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("shows a specific email-format error for a malformed sender email", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 1,
          name: "x",
          status: "draft",
        });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutImpersonation(user);
      await user.type(
        screen.getByLabelText(/brand \/ sender name/i),
        VALID_IMPERSONATION.sender_name
      );
      await user.type(
        screen.getByLabelText(/sender email/i),
        "not-an-email"
      );
      await user.type(
        screen.getByLabelText(/what this email pretends to be/i),
        VALID_IMPERSONATION.pretends_to_be
      );

      await user.click(screen.getByRole("button", { name: /generate/i }));

      expect(
        await screen.findByText(/enter a valid email address/i)
      ).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("submits with color and logo omitted (both optional) when only required fields are filled", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 5,
          name: VALID_FORM_DATA.name,
          status: "draft",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutImpersonation(user);
      await fillImpersonation(user);
      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          impersonation_sender_name: VALID_IMPERSONATION.sender_name,
          impersonation_sender_email: VALID_IMPERSONATION.sender_email,
          impersonation_pretends_to_be: VALID_IMPERSONATION.pretends_to_be,
          impersonation_primary_color: null,
          impersonation_logo_asset_id: null,
        })
      );
    });

    it("carries a typed hex primary color into the payload", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 6,
          name: VALID_FORM_DATA.name,
          status: "draft",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutImpersonation(user);
      await fillImpersonation(user);
      await user.type(
        screen.getByTestId("impersonation-color-hex"),
        "#0067B8"
      );
      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          impersonation_primary_color: "#0067B8",
        })
      );
    });

    it("uploads a logo (ensuring a draft emailer) and sends its asset id", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 88,
          name: "draft",
          status: "draft",
        });
      const updateSpy = vi
        .spyOn(emailersApi, "updateEmailer")
        .mockResolvedValue({
          id: 88,
          name: VALID_FORM_DATA.name,
          status: "in_review",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );
      const uploadSpy = vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue({
        id: "logo-asset-1",
        emailer_id: 88,
        filename: "logo.png",
        label: "impersonation-logo",
        mime_type: "image/png",
        size_bytes: 1024,
        url: "http://localhost:8000/assets/88/logo.png",
        uploaded_at: "2026-06-12T00:00:00Z",
        kind: "content",
      });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutImpersonation(user);
      await fillImpersonation(user);

      // Upload the logo via the section's hidden file input.
      const logoInput = screen.getByLabelText(
        /upload impersonation logo/i
      ) as HTMLInputElement;
      await user.upload(
        logoInput,
        new File([new Uint8Array(1024)], "logo.png", { type: "image/png" })
      );

      // Draft ensured + logo uploaded; preview appears.
      await waitFor(() => expect(uploadSpy).toHaveBeenCalledOnce());
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(uploadSpy).toHaveBeenCalledWith(
        88,
        expect.any(File),
        expect.objectContaining({ label: "impersonation-logo" })
      );
      expect(
        await screen.findByTestId("impersonation-logo-preview")
      ).toBeInTheDocument();

      // Submit: a draft exists, so we PATCH it with the logo asset id.
      await user.click(screen.getByRole("button", { name: /generate/i }));
      await waitFor(() =>
        expect(updateSpy).toHaveBeenCalledWith(
          88,
          expect.objectContaining({
            impersonation_logo_asset_id: "logo-asset-1",
          })
        )
      );
    });

    it("removes an uploaded logo and clears its asset id", async () => {
      vi.spyOn(emailersApi, "createEmailer").mockResolvedValue({
        id: 88,
        name: "draft",
        status: "draft",
      });
      vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue({
        id: "logo-asset-1",
        emailer_id: 88,
        filename: "logo.png",
        label: "impersonation-logo",
        mime_type: "image/png",
        size_bytes: 1024,
        url: "http://localhost:8000/assets/88/logo.png",
        uploaded_at: "2026-06-12T00:00:00Z",
        kind: "content",
      });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      const logoInput = screen.getByLabelText(
        /upload impersonation logo/i
      ) as HTMLInputElement;
      await user.upload(
        logoInput,
        new File([new Uint8Array(1024)], "logo.png", { type: "image/png" })
      );

      const preview = await screen.findByTestId("impersonation-logo-preview");
      expect(preview).toBeInTheDocument();

      await user.click(screen.getByTestId("impersonation-logo-remove"));

      expect(
        screen.queryByTestId("impersonation-logo-preview")
      ).not.toBeInTheDocument();
      // The upload affordance is back.
      expect(
        screen.getByLabelText(/upload impersonation logo/i)
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // STORY-AP2.1: Pretext section
  // -------------------------------------------------------------------------
  describe("pretext (STORY-AP2.1)", () => {
    /** Fill every required field EXCEPT pretext, so submit hinges on it. */
    async function fillBriefWithoutPretext(
      user: ReturnType<typeof userEvent.setup>
    ) {
      await user.type(
        screen.getByLabelText(/template name/i),
        VALID_FORM_DATA.name
      );
      await user.type(
        screen.getByLabelText(/target recipients/i),
        VALID_FORM_DATA.target_audience
      );
      await user.selectOptions(screen.getByLabelText(/length/i), "short");
      await fillImpersonation(user);
    }

    it("renders the section and its fields", async () => {
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      expect(
        screen.getByRole("heading", { name: /^pretext$/i })
      ).toBeInTheDocument();
      expect(screen.getByTestId("lure-type-select")).toBeInTheDocument();
      expect(screen.getByTestId("urgency-select")).toBeInTheDocument();
      expect(
        screen.getByLabelText(/the intended "tell"/i)
      ).toBeInTheDocument();
    });

    it("blocks submit and shows errors when lure type and urgency are missing", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({ id: 1, name: "x", status: "draft" });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutPretext(user);
      await user.click(screen.getByRole("button", { name: /generate/i }));

      expect(
        await screen.findByText(/lure type is required/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/urgency level is required/i)
      ).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    // CR-001: pretext scenario is a new required field.
    it("blocks submit and shows an error when the pretext scenario is missing", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({ id: 1, name: "x", status: "draft" });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      // Fill everything except the scenario: name, recipients, identity,
      // lure, and urgency — so submit hinges on the scenario alone.
      await user.type(
        screen.getByLabelText(/template name/i),
        VALID_FORM_DATA.name
      );
      await fillImpersonation(user);
      await user.selectOptions(
        screen.getByTestId("lure-type-select"),
        "credential_harvest"
      );
      await user.selectOptions(screen.getByTestId("urgency-select"), "high");

      await user.click(screen.getByRole("button", { name: /generate/i }));

      expect(
        await screen.findByText(/pretext scenario is required/i)
      ).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    // CR-001: confirm the submit payload carries pretext_scenario and omits
    // the retired marketing fields.
    it("submits pretext_scenario and omits category/content_summary/tone", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 11,
          name: VALID_FORM_DATA.name,
          status: "draft",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await user.type(
        screen.getByLabelText(/template name/i),
        VALID_FORM_DATA.name
      );
      await fillImpersonation(user);
      await fillPretext(user);
      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());
      const body = createSpy.mock.calls[0][0] as unknown as Record<
        string,
        unknown
      >;
      expect(body.pretext_scenario).toBe("password_expiry");
      expect(body.category).toBeUndefined();
      expect(body.tone).toBeUndefined();
      // content_summary is null unless library assets were attached.
      expect(body.content_summary).toBeNull();
    });

    it("submits with the three pretext fields in the payload (tell included)", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 9,
          name: VALID_FORM_DATA.name,
          status: "draft",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutPretext(user);
      // CR-001: scenario is required before the pretext section validates.
      await user.selectOptions(
        screen.getByTestId("pretext-scenario-select"),
        "invoice_payment"
      );
      await user.selectOptions(
        screen.getByTestId("lure-type-select"),
        "oauth_consent"
      );
      await user.selectOptions(screen.getByTestId("urgency-select"), "medium");
      await user.type(
        screen.getByLabelText(/the intended "tell"/i),
        "Lookalike domain"
      );

      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pretext_scenario: "invoice_payment",
          lure_type: "oauth_consent",
          urgency_level: "medium",
          pretext_tell: "Lookalike domain",
        })
      );
    });

    it("sends pretext_tell as null when the optional tell is left blank", async () => {
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({
          id: 10,
          name: VALID_FORM_DATA.name,
          status: "draft",
        });
      vi.spyOn(emailersApi, "generateEmailer").mockResolvedValue(
        MOCK_GENERATE_RESPONSE
      );

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillBriefWithoutPretext(user);
      await fillPretext(user);
      await user.click(screen.getByRole("button", { name: /generate/i }));

      await waitFor(() => expect(createSpy).toHaveBeenCalledOnce());
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          lure_type: "credential_harvest",
          urgency_level: "high",
          pretext_tell: null,
        })
      );
    });

    it("reflects the impersonation sender read-only as 'Appears from' (de-dup)", async () => {
      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      // Before the identity fields are filled, a hint points at the section.
      const reflection = screen.getByTestId("appears-from");
      expect(reflection).toHaveTextContent(
        /fill in the impersonated identity section/i
      );

      // Fill the identity sender fields — the reflection updates with no
      // separate sender input in the pretext section.
      await user.type(
        screen.getByLabelText(/brand \/ sender name/i),
        "Microsoft 365"
      );
      await user.type(
        screen.getByLabelText(/sender email/i),
        "no-reply@microsoftsupport.com"
      );

      expect(screen.getByTestId("appears-from")).toHaveTextContent(
        /appears from:\s*microsoft 365/i
      );
      expect(screen.getByTestId("appears-from")).toHaveTextContent(
        /no-reply@microsoftsupport\.com/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // STORY-AP1.2: impersonation preset load + save
  // -------------------------------------------------------------------------
  describe("impersonation presets (STORY-AP1.2)", () => {
    it("loads a preset and prefills the identity fields (editable, no lock)", async () => {
      const detailSpy = vi
        .spyOn(presetsApi, "getPresetDetail")
        .mockResolvedValue(MOCK_PRESET_DETAIL);

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await user.selectOptions(
        screen.getByTestId("impersonation-preset-select"),
        "microsoft-365"
      );

      await waitFor(() =>
        expect(detailSpy).toHaveBeenCalledWith("microsoft-365")
      );

      // Fields are prefilled from the preset.
      await waitFor(() =>
        expect(screen.getByLabelText(/brand \/ sender name/i)).toHaveValue(
          "Microsoft 365"
        )
      );
      expect(screen.getByLabelText(/sender email/i)).toHaveValue(
        "it-support@contoso.com"
      );
      expect(
        screen.getByLabelText(/what this email pretends to be/i)
      ).toHaveValue("A Microsoft 365 password-expiry notice");
      expect(screen.getByTestId("impersonation-color-hex")).toHaveValue(
        "#0067B8"
      );

      // Fields remain editable (no lock / disabled).
      const nameInput = screen.getByLabelText(/brand \/ sender name/i);
      expect(nameInput).not.toBeDisabled();
      await user.clear(nameInput);
      await user.type(nameInput, "Edited");
      expect(nameInput).toHaveValue("Edited");
    });

    it("copies the preset logo onto a draft emailer when the preset has one", async () => {
      vi.spyOn(presetsApi, "getPresetDetail").mockResolvedValue({
        ...MOCK_PRESET_DETAIL,
        logo_url: "https://example.com/preset-logo.png",
      });
      const createSpy = vi
        .spyOn(emailersApi, "createEmailer")
        .mockResolvedValue({ id: 55, name: "draft", status: "draft" });
      const copySpy = vi
        .spyOn(presetsApi, "copyLogoToEmailer")
        .mockResolvedValue({
          id: "preset-logo-asset",
          emailer_id: 55,
          filename: "preset-logo.png",
          label: "impersonation-logo",
          mime_type: "image/png",
          size_bytes: 2048,
          url: "http://localhost:8000/assets/55/preset-logo.png",
          uploaded_at: "2026-06-12T00:00:00Z",
          kind: "content",
        });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await user.selectOptions(
        screen.getByTestId("impersonation-preset-select"),
        "microsoft-365"
      );

      // Draft ensured, logo copied, preview shown.
      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(copySpy).toHaveBeenCalledWith(55, "microsoft-365")
      );
      expect(
        await screen.findByTestId("impersonation-logo-preview")
      ).toBeInTheDocument();
    });

    it("saves the current identity as a preset and shows a success message", async () => {
      const createPresetSpy = vi
        .spyOn(presetsApi, "createPreset")
        .mockResolvedValue({
          id: "ms-365-12",
          name: VALID_IMPERSONATION.sender_name,
          sender_email: VALID_IMPERSONATION.sender_email,
          primary_color: null,
          pretends_to_be: VALID_IMPERSONATION.pretends_to_be,
          logo_url: null,
        });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await fillImpersonation(user);
      await user.click(screen.getByTestId("save-as-preset"));

      await waitFor(() =>
        expect(createPresetSpy).toHaveBeenCalledWith({
          name: VALID_IMPERSONATION.sender_name,
          sender_email: VALID_IMPERSONATION.sender_email,
          primary_color: null,
          pretends_to_be: VALID_IMPERSONATION.pretends_to_be,
        })
      );

      expect(await screen.findByTestId("preset-message")).toHaveTextContent(
        /saved/i
      );
    });

    it("blocks save-as-preset when the core identity fields are empty", async () => {
      const createPresetSpy = vi.spyOn(presetsApi, "createPreset");

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      await user.click(screen.getByTestId("save-as-preset"));

      expect(await screen.findByTestId("preset-message")).toHaveTextContent(
        /fill in the brand name/i
      );
      expect(createPresetSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // STORY-AP2.3: "Sample emails to mimic" upload section
  // -------------------------------------------------------------------------
  describe("sample emails to mimic (STORY-AP2.3)", () => {
    it("renders the section title and the exact helper copy", async () => {
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      const section = screen.getByTestId("samples-section");
      expect(
        within(section).getByText(/sample emails to mimic/i)
      ).toBeInTheDocument();
      // Exact helper line from the AC.
      expect(
        within(section).getByText(
          "Upload the genuine email you're simulating. Used as a style reference only."
        )
      ).toBeInTheDocument();
    });

    it("uploads a sample with kind: 'sample' via the samples file input", async () => {
      const uploadSpy = vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue({
        id: "sample-1",
        emailer_id: 99,
        filename: "genuine.png",
        label: "genuine",
        mime_type: "image/png",
        size_bytes: 1024,
        url: "http://localhost:8000/assets/99/genuine.png",
        uploaded_at: "2026-06-13T00:00:00Z",
        kind: "sample",
      });
      // The samples panel lazily creates a draft emailer on first upload.
      vi.spyOn(emailersApi, "createEmailer").mockResolvedValue({
        id: 99,
        name: "draft",
        status: "draft",
      });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      const sampleInput = screen.getByTestId(
        "sample-file-input"
      ) as HTMLInputElement;
      await user.upload(
        sampleInput,
        new File([new Uint8Array(1024)], "genuine.png", { type: "image/png" })
      );

      await waitFor(() => expect(uploadSpy).toHaveBeenCalledOnce());
      expect(uploadSpy).toHaveBeenCalledWith(
        99,
        expect.any(File),
        expect.objectContaining({ kind: "sample" })
      );
    });

    it("keeps the samples panel independent from the in-email assets panel", async () => {
      // Two distinct file inputs exist: the in-email assets panel and the
      // samples panel. Uploading to one must use its own kind.
      const uploadSpy = vi.spyOn(assetsApi, "uploadAsset").mockResolvedValue({
        id: "content-1",
        emailer_id: 99,
        filename: "hero.png",
        label: "hero",
        mime_type: "image/png",
        size_bytes: 1024,
        url: "http://localhost:8000/assets/99/hero.png",
        uploaded_at: "2026-06-13T00:00:00Z",
        kind: "content",
      });
      vi.spyOn(emailersApi, "createEmailer").mockResolvedValue({
        id: 99,
        name: "draft",
        status: "draft",
      });

      const user = userEvent.setup();
      renderBriefPage();
      await waitFor(() =>
        expect(screen.queryByRole("status")).not.toBeInTheDocument()
      );

      // The in-email panel input and the samples panel input are separate.
      const contentInput = screen.getByLabelText(/upload assets/i, {
        selector: "input",
      }) as HTMLInputElement;
      const sampleInput = screen.getByTestId(
        "sample-file-input"
      ) as HTMLInputElement;
      expect(contentInput).not.toBe(sampleInput);

      // Uploading via the in-email panel uses kind "content" (no sample).
      await user.upload(
        contentInput,
        new File([new Uint8Array(1024)], "hero.png", { type: "image/png" })
      );

      await waitFor(() => expect(uploadSpy).toHaveBeenCalledOnce());
      expect(uploadSpy).toHaveBeenCalledWith(
        99,
        expect.any(File),
        expect.objectContaining({ kind: "content" })
      );

      // The samples panel does not offer a "Pick from Library" affordance —
      // it is scoped to fresh sample uploads only.
      const section = screen.getByTestId("samples-section");
      expect(
        within(section).queryByText(/pick from library/i)
      ).not.toBeInTheDocument();
    });
  });
});
