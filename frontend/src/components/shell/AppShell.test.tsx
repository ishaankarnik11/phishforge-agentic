import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AppShell from "./AppShell";
import AuthorizationContextBar from "./AuthorizationContextBar";
import { AuthContext, type AuthContextValue } from "../../contexts/AuthContext";

function makeAuthValue(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    token: "fake-token",
    user: { id: 1, email: "sana@example.com", name: "Sana", role: "editor" },
    isAuthenticated: true,
    isAdmin: false,
    profileLoaded: true,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderShell(authValue: AuthContextValue) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext.Provider value={authValue}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>home content</div>} />
          </Route>
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

describe("AuthorizationContextBar", () => {
  it("is present and states the authorized-simulation context", () => {
    render(<AuthorizationContextBar />);
    const bar = screen.getByTestId("authorization-context-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveTextContent(/authorized simulation/i);
  });

  it("uses info tone, never danger or warning (it is context, not an alarm)", () => {
    render(<AuthorizationContextBar />);
    const bar = screen.getByTestId("authorization-context-bar");
    expect(bar.className).toContain("bg-info-subtle");
    expect(bar.className).not.toMatch(/danger|warning/);
  });
});

describe("AppShell", () => {
  it("renders the PhishForge wordmark, the auth context bar, and the routed content", () => {
    renderShell(makeAuthValue());
    expect(
      screen.getByRole("link", { name: /phishforge home/i })
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("authorization-context-bar")
    ).toBeInTheDocument();
    expect(screen.getByText("home content")).toBeInTheDocument();
  });

  it("shows the primary nav and hides admin-only items for non-admins", () => {
    renderShell(makeAuthValue({ isAdmin: false }));
    expect(
      screen.getByRole("link", { name: /simulations/i })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /asset library/i }).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.queryByRole("link", { name: /observability/i })
    ).not.toBeInTheDocument();
  });

  it("reveals admin-only nav items for admins", () => {
    renderShell(makeAuthValue({ isAdmin: true }));
    expect(
      screen.getByRole("link", { name: /observability/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /impersonation presets/i })
    ).toBeInTheDocument();
  });
});
