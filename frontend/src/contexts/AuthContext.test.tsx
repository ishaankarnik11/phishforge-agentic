import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "../hooks/useAuth";
import * as authApi from "../api/auth";

// ---------------------------------------------------------------------------
// Helper component that renders auth state and exposes actions
// ---------------------------------------------------------------------------

function AuthConsumer() {
  const { token, user, isAuthenticated, login, logout } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);

  async function handleLogin() {
    try {
      await login("test@example.com", "password123");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div>
      <span data-testid="token">{token ?? "null"}</span>
      <span data-testid="user">{user ? user.email : "null"}</span>
      <span data-testid="authenticated">
        {isAuthenticated ? "yes" : "no"}
      </span>
      {loginError && <span data-testid="login-error">{loginError}</span>}
      <button onClick={handleLogin}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A fake JWT token with sub = "test@example.com"
// header.payload.signature — only payload matters for our decode
// ---------------------------------------------------------------------------

function makeFakeJwt(sub: string): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ sub, exp: 9999999999 }));
  return `${header}.${payload}.fake-signature`;
}

const FAKE_TOKEN = makeFakeJwt("test@example.com");

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let storedItems: Record<string, string> = {};

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

describe("AuthProvider", () => {
  it("starts unauthenticated when no token in localStorage", () => {
    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("token")).toHaveTextContent("null");
    expect(screen.getByTestId("user")).toHaveTextContent("null");
    expect(screen.getByTestId("authenticated")).toHaveTextContent("no");
  });

  it("restores token from localStorage on mount", () => {
    storedItems["access_token"] = FAKE_TOKEN;

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("token")).toHaveTextContent(FAKE_TOKEN);
    expect(screen.getByTestId("user")).toHaveTextContent("test@example.com");
    expect(screen.getByTestId("authenticated")).toHaveTextContent("yes");
  });

  it("login() calls API, stores token, and updates state", async () => {
    vi.spyOn(authApi, "login").mockResolvedValue({
      access_token: FAKE_TOKEN,
      token_type: "bearer",
    });

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("authenticated")).toHaveTextContent("no");

    await user.click(screen.getByText("Login"));

    expect(authApi.login).toHaveBeenCalledWith(
      "test@example.com",
      "password123"
    );
    expect(screen.getByTestId("authenticated")).toHaveTextContent("yes");
    expect(screen.getByTestId("token")).toHaveTextContent(FAKE_TOKEN);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "access_token",
      FAKE_TOKEN
    );
  });

  it("logout() clears token from state and localStorage", async () => {
    storedItems["access_token"] = FAKE_TOKEN;

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("authenticated")).toHaveTextContent("yes");

    await user.click(screen.getByText("Logout"));

    expect(screen.getByTestId("authenticated")).toHaveTextContent("no");
    expect(screen.getByTestId("token")).toHaveTextContent("null");
    expect(localStorage.removeItem).toHaveBeenCalledWith("access_token");
  });

  // STORY-7.5 AC-7: the /auth/me effect acts as a 401 interceptor for
  // tokens that have been revoked or expired server-side. When it gets a
  // 401, the token must be cleared from both state and localStorage so
  // subsequent renders bounce the user back to /login.
  it("clears the stored token and resets state when /auth/me returns 401", async () => {
    storedItems["access_token"] = FAKE_TOKEN;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Token expired" }),
      } as unknown as Response)
    );

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    // Initially the AuthProvider seeds from localStorage and shows
    // authenticated. The /auth/me effect fires after mount; once it
    // settles with 401 the token is cleared.
    await waitFor(() =>
      expect(screen.getByTestId("authenticated")).toHaveTextContent("no")
    );
    expect(screen.getByTestId("token")).toHaveTextContent("null");
    expect(localStorage.removeItem).toHaveBeenCalledWith("access_token");
  });

  it("login() propagates API errors", async () => {
    vi.spyOn(authApi, "login").mockRejectedValue(
      new Error("Invalid credentials")
    );

    const user = userEvent.setup();

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await user.click(screen.getByText("Login"));

    // The AuthConsumer component catches the error and displays it
    expect(await screen.findByTestId("login-error")).toHaveTextContent(
      "Invalid credentials"
    );

    // Should remain unauthenticated
    expect(screen.getByTestId("authenticated")).toHaveTextContent("no");
  });
});

describe("useAuth outside provider", () => {
  it("throws when used outside AuthProvider", () => {
    // Suppress console.error for the expected React error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<AuthConsumer />)).toThrow(
      "useAuth must be used within an AuthProvider"
    );

    spy.mockRestore();
  });
});
