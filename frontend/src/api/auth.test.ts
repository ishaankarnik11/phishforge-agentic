import { describe, it, expect, vi, afterEach } from "vitest";
import { login } from "./auth";

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Unauthorized",
    text: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("login", () => {
  it("sends POST with email and password and returns token", async () => {
    const fetchMock = mockFetchOk({
      access_token: "jwt-token-123",
      token_type: "bearer",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await login("user@example.com", "secret");

    expect(result).toEqual({
      access_token: "jwt-token-123",
      token_type: "bearer",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "secret" }),
    });
  });

  it("throws the FastAPI detail message on a non-ok JSON response", async () => {
    // BUG-1: the body is a FastAPI envelope; the thrown message is the
    // ``detail`` field (clean copy), not the raw JSON blob.
    vi.stubGlobal(
      "fetch",
      mockFetchError(401, '{"detail":"Invalid email or password"}')
    );

    await expect(login("bad@example.com", "wrong")).rejects.toThrow(
      "Invalid email or password"
    );
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    // BUG-1: a non-JSON body must NOT be surfaced verbatim — fall back to
    // the generic status message instead.
    vi.stubGlobal("fetch", mockFetchError(500, "<html>oops</html>"));

    await expect(login("bad@example.com", "wrong")).rejects.toThrow(
      "Login failed: 500 Unauthorized"
    );
  });

  it("falls back to status text when body is empty", async () => {
    vi.stubGlobal("fetch", mockFetchError(401, ""));

    await expect(login("bad@example.com", "wrong")).rejects.toThrow(
      "Login failed: 401 Unauthorized"
    );
  });
});
