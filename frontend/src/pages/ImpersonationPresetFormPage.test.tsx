import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ImpersonationPresetFormPage from "./ImpersonationPresetFormPage";
import * as presetsApi from "../api/impersonationPresets";
import type { ImpersonationPresetDetail } from "../api/impersonationPresets";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
    },
  });
}

function makeAuth(role: "admin" | "editor" | null): AuthContextValue {
  return {
    token: "fake-token",
    user: {
      id: 1,
      email: role === "admin" ? "admin@phishforge.io" : "priya@phishforge.io",
      name: role === "admin" ? "Admin" : "Priya",
      role,
    },
    isAuthenticated: true,
    isAdmin: role === "admin",
    profileLoaded: true,
    login: vi.fn(),
    logout: vi.fn(),
  };
}

function renderPage(path: string, auth: AuthContextValue) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route
              path="/admin/impersonation-presets/new"
              element={<ImpersonationPresetFormPage />}
            />
            <Route
              path="/admin/impersonation-presets/:id/edit"
              element={<ImpersonationPresetFormPage />}
            />
            <Route
              path="/admin/impersonation-presets"
              element={<div data-testid="list-page">List page</div>}
            />
            <Route
              path="/"
              element={<div data-testid="home-page">Home page</div>}
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const MOCK_DETAIL: ImpersonationPresetDetail = {
  id: "microsoft-365",
  name: "Microsoft 365",
  sender_email: "it-support@contoso.com",
  primary_color: "#0067B8",
  pretends_to_be: "A password-expiry notice",
  logo_url: "https://example.com/logo.png",
};

describe("ImpersonationPresetFormPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects non-admins to /", async () => {
    renderPage("/admin/impersonation-presets/new", makeAuth("editor"));
    await waitFor(() =>
      expect(screen.getByTestId("home-page")).toBeInTheDocument()
    );
  });

  it("creates a preset from the new form", async () => {
    const createSpy = vi.spyOn(presetsApi, "createPreset").mockResolvedValue({
      ...MOCK_DETAIL,
      id: "microsoft-365-new",
      logo_url: null,
    });

    const user = userEvent.setup();
    renderPage("/admin/impersonation-presets/new", makeAuth("admin"));

    await user.type(screen.getByTestId("preset-name-input"), "Microsoft 365");
    await user.type(
      screen.getByTestId("preset-sender-email-input"),
      "it-support@contoso.com"
    );
    await user.type(
      screen.getByTestId("preset-pretends-to-be-input"),
      "A password-expiry notice"
    );

    await user.click(screen.getByTestId("preset-submit-button"));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith({
        name: "Microsoft 365",
        sender_email: "it-support@contoso.com",
        primary_color: null,
        pretends_to_be: "A password-expiry notice",
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId("list-page")).toBeInTheDocument()
    );
  });

  it("blocks submit with a malformed sender email", async () => {
    const createSpy = vi.spyOn(presetsApi, "createPreset");

    const user = userEvent.setup();
    renderPage("/admin/impersonation-presets/new", makeAuth("admin"));

    await user.type(screen.getByTestId("preset-name-input"), "X");
    await user.type(
      screen.getByTestId("preset-sender-email-input"),
      "not-an-email"
    );
    await user.type(screen.getByTestId("preset-pretends-to-be-input"), "Pretext");

    await user.click(screen.getByTestId("preset-submit-button"));

    expect(
      await screen.findByText(/enter a valid email address/i)
    ).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("loads an existing preset and patches the diff on save", async () => {
    vi.spyOn(presetsApi, "getPresetDetail").mockResolvedValue(MOCK_DETAIL);
    const updateSpy = vi
      .spyOn(presetsApi, "updatePreset")
      .mockResolvedValue({ ...MOCK_DETAIL, name: "Renamed" });

    const user = userEvent.setup();
    renderPage("/admin/impersonation-presets/microsoft-365/edit", makeAuth("admin"));

    await waitFor(() =>
      expect(screen.getByTestId("preset-name-input")).toHaveValue(
        "Microsoft 365"
      )
    );
    // Logo preview from the loaded preset.
    expect(screen.getByTestId("preset-logo-preview")).toBeInTheDocument();

    const nameInput = screen.getByTestId("preset-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");

    await user.click(screen.getByTestId("preset-submit-button"));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith("microsoft-365", { name: "Renamed" })
    );
  });

  it("uploads a logo on the edit page", async () => {
    vi.spyOn(presetsApi, "getPresetDetail").mockResolvedValue({
      ...MOCK_DETAIL,
      logo_url: null,
    });
    const uploadSpy = vi
      .spyOn(presetsApi, "uploadPresetLogo")
      .mockResolvedValue({
        ...MOCK_DETAIL,
        logo_url: "https://example.com/new-logo.png",
      });

    const user = userEvent.setup();
    renderPage("/admin/impersonation-presets/microsoft-365/edit", makeAuth("admin"));

    await waitFor(() =>
      expect(screen.getByTestId("preset-name-input")).toHaveValue(
        "Microsoft 365"
      )
    );

    const logoInput = screen.getByLabelText(
      /upload preset logo/i
    ) as HTMLInputElement;
    await user.upload(
      logoInput,
      new File([new Uint8Array(8)], "logo.png", { type: "image/png" })
    );

    await waitFor(() =>
      expect(uploadSpy).toHaveBeenCalledWith("microsoft-365", expect.any(File))
    );
    await waitFor(() =>
      expect(screen.getByTestId("preset-logo-preview")).toBeInTheDocument()
    );
  });

  it("deletes a preset after confirmation", async () => {
    vi.spyOn(presetsApi, "getPresetDetail").mockResolvedValue(MOCK_DETAIL);
    const removeSpy = vi
      .spyOn(presetsApi, "removePreset")
      .mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage("/admin/impersonation-presets/microsoft-365/edit", makeAuth("admin"));

    await waitFor(() =>
      expect(screen.getByTestId("preset-name-input")).toHaveValue(
        "Microsoft 365"
      )
    );

    await user.click(screen.getByTestId("preset-delete-button"));
    await user.click(screen.getByTestId("confirm-delete-confirm"));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("microsoft-365"));
    await waitFor(() =>
      expect(screen.getByTestId("list-page")).toBeInTheDocument()
    );
  });
});
