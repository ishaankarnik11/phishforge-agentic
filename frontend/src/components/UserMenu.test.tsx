import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import UserMenu from "./UserMenu";
import { AuthContext, type AuthContextValue } from "../contexts/AuthContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuthValue(
  overrides: Partial<AuthContextValue> = {}
): AuthContextValue {
  return {
    token: "fake-token",
    user: {
      id: 1,
      email: "priya@phishforge.io",
      name: "Priya",
      role: "editor",
    },
    isAuthenticated: true,
    isAdmin: false,
    profileLoaded: true,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderMenu(authValue: AuthContextValue) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext.Provider value={authValue}>
        <Routes>
          <Route
            path="/"
            element={
              <div>
                <UserMenu />
              </div>
            }
          />
          <Route
            path="/login"
            element={<div data-testid="login-page">Login</div>}
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Keep each test isolated.
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UserMenu", () => {
  it("renders the logged-in user's name (derived from email)", () => {
    renderMenu(makeAuthValue());

    const trigger = screen.getByRole("button", {
      name: /account menu for priya@phishforge.io/i,
    });
    expect(trigger).toBeInTheDocument();
    // Display name = local-part of email
    expect(trigger).toHaveTextContent("priya");
  });

  it("opens the dropdown menu when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderMenu(makeAuthValue());

    const trigger = screen.getByRole("button", {
      name: /account menu for priya@phishforge.io/i,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /log out/i })
    ).toBeInTheDocument();
    // Full email is rendered inside the menu for disambiguation.
    expect(screen.getByText("priya@phishforge.io")).toBeInTheDocument();
  });

  it("calls logout and navigates to /login when Log out is clicked", async () => {
    const logout = vi.fn();
    const user = userEvent.setup();
    renderMenu(makeAuthValue({ logout }));

    await user.click(
      screen.getByRole("button", { name: /account menu for priya@phishforge.io/i })
    );
    await user.click(screen.getByRole("menuitem", { name: /log out/i }));

    expect(logout).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("login-page")).toBeInTheDocument()
    );
  });

  it("closes the menu when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderMenu(makeAuthValue());

    const trigger = screen.getByRole("button", {
      name: /account menu for priya@phishforge.io/i,
    });
    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders nothing when there is no authenticated user", () => {
    renderMenu(
      makeAuthValue({ user: null, token: null, isAuthenticated: false })
    );
    // The trigger button is absent and no menu controls are rendered.
    expect(
      screen.queryByRole("button", { name: /account menu/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // STORY-7.8 AC-3 / AC-5: admin nav entry visibility.
  // -------------------------------------------------------------------------
  it("does NOT render the admin observability link for editors", async () => {
    const user = userEvent.setup();
    renderMenu(makeAuthValue({ isAdmin: false }));

    await user.click(
      screen.getByRole("button", {
        name: /account menu for priya@phishforge.io/i,
      })
    );

    expect(
      screen.queryByTestId("admin-observability-link")
    ).not.toBeInTheDocument();
  });

  it("renders the admin observability link for admins", async () => {
    const user = userEvent.setup();
    renderMenu(
      makeAuthValue({
        isAdmin: true,
        user: {
          id: 1,
          email: "admin@phishforge.io",
          name: "Admin",
          role: "admin",
        },
      })
    );

    await user.click(
      screen.getByRole("button", {
        name: /account menu for admin@phishforge.io/i,
      })
    );

    const link = screen.getByTestId("admin-observability-link");
    expect(link).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // STORY-6.3: brand kits admin nav entry visibility.
  // -------------------------------------------------------------------------
  it("does NOT render the admin brand kits link for editors", async () => {
    const user = userEvent.setup();
    renderMenu(makeAuthValue({ isAdmin: false }));

    await user.click(
      screen.getByRole("button", {
        name: /account menu for priya@phishforge.io/i,
      })
    );

    expect(
      screen.queryByTestId("admin-impersonation-presets-link")
    ).not.toBeInTheDocument();
  });

  it("renders the manage impersonation presets link for admins", async () => {
    const user = userEvent.setup();
    renderMenu(
      makeAuthValue({
        isAdmin: true,
        user: {
          id: 1,
          email: "admin@phishforge.io",
          name: "Admin",
          role: "admin",
        },
      })
    );

    await user.click(
      screen.getByRole("button", {
        name: /account menu for admin@phishforge.io/i,
      })
    );

    const link = screen.getByTestId("admin-impersonation-presets-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(/Manage impersonation presets/i);
  });
});
