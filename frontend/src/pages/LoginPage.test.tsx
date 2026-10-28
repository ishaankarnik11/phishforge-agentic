import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import LoginPage from "./LoginPage";
import * as authApi from "../api/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub, exp: 9999999999 }));
  return `${header}.${payload}.fake-signature`;
}

const FAKE_TOKEN = makeFakeJwt("test@example.com");

let storedItems: Record<string, string> = {};

function renderLoginPage(initialPath = "/login") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={<div data-testid="home-page">Home page</div>}
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  storedItems = {};
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storedItems[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storedItems[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete storedItems[key];
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginPage", () => {
  it("renders email and password fields and login button", () => {
    renderLoginPage();

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /log in/i })
    ).toBeInTheDocument();
  });

  // STORY-AP1.1 rebrand: the login screen carries the PhishForge identity and
  // the authorized-simulation context, not the legacy Acme marketing branding.
  it("renders PhishForge branding header", () => {
    renderLoginPage();

    expect(
      screen.getByRole("heading", { name: "PhishForge" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/authorized anti-phishing audits/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/authorized simulation/i)).toBeInTheDocument();
  });

  // STORY-7.5 AC-3: page tells users self-registration is disabled and
  // points them at their admin instead of a sign-up link.
  it("shows a 'contact your admin' hint instead of a registration CTA", () => {
    renderLoginPage();

    expect(
      screen.getByText(/contact your admin/i)
    ).toBeInTheDocument();
    // Sanity: there is no register / sign-up link on the login page.
    expect(
      screen.queryByRole("link", { name: /sign up|register/i })
    ).not.toBeInTheDocument();
  });

  it("shows error message on failed login", async () => {
    vi.spyOn(authApi, "login").mockRejectedValue(
      new Error("Invalid credentials")
    );

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), "bad@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrongpass");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/invalid credentials/i);
  });

  it("shows loading state during login", async () => {
    // Never-resolving promise to test loading state
    vi.spyOn(authApi, "login").mockReturnValue(
      new Promise(() => {
        // intentionally pending
      })
    );

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /logging in/i })
      ).toBeDisabled()
    );
  });

  it("redirects to / (home) on successful login", async () => {
    vi.spyOn(authApi, "login").mockResolvedValue({
      access_token: FAKE_TOKEN,
      token_type: "bearer",
    });

    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "password123");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() =>
      expect(screen.getByTestId("home-page")).toBeInTheDocument()
    );
  });

  it("redirects authenticated users from /login to / (home)", async () => {
    // STORY-7.6 regression: after hotfix, /login -> / (Home), not /brief.
    // Async because the login-loop hotfix (commit 2265357) added an
    // /auth/me probe-on-mount that gates the redirect on token validity.
    storedItems["access_token"] = FAKE_TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true } as Response)
    );

    renderLoginPage();

    await waitFor(() =>
      expect(screen.getByTestId("home-page")).toBeInTheDocument()
    );
  });
});
