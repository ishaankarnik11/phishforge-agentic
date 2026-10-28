import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminImpersonationPresetsPage from "./AdminImpersonationPresetsPage";
import * as presetsApi from "../api/impersonationPresets";
import type { ImpersonationPresetSummary } from "../api/impersonationPresets";
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

function renderPage(auth: AuthContextValue) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/impersonation-presets"]}>
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route
              path="/admin/impersonation-presets"
              element={<AdminImpersonationPresetsPage />}
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

const MOCK_PRESETS: ImpersonationPresetSummary[] = [
  { id: "microsoft-365", name: "Microsoft 365", primary_color: "#0067B8" },
  { id: "okta", name: "Okta", primary_color: null },
];

describe("AdminImpersonationPresetsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects non-admins to /", async () => {
    renderPage(makeAuth("editor"));
    await waitFor(() =>
      expect(screen.getByTestId("home-page")).toBeInTheDocument()
    );
  });

  it("renders the preset list for admins", async () => {
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue(MOCK_PRESETS);

    renderPage(makeAuth("admin"));

    expect(
      await screen.findByRole("heading", {
        name: /manage impersonation presets/i,
      })
    ).toBeInTheDocument();

    expect(await screen.findByTestId("preset-row-microsoft-365")).toHaveTextContent(
      "Microsoft 365"
    );
    expect(screen.getByTestId("preset-row-okta")).toHaveTextContent("Okta");
    expect(screen.getByTestId("create-preset-cta")).toBeInTheDocument();
  });

  it("shows an empty state when there are no presets", async () => {
    vi.spyOn(presetsApi, "listPresets").mockResolvedValue([]);

    renderPage(makeAuth("admin"));

    expect(
      await screen.findByText(/no impersonation presets configured/i)
    ).toBeInTheDocument();
  });

  it("shows an error state when the list fails", async () => {
    vi.spyOn(presetsApi, "listPresets").mockRejectedValue(
      new Error("boom")
    );

    renderPage(makeAuth("admin"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/boom/i);
  });
});
