import { API_BASE } from "./baseUrl";

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

/**
 * Pull a human-readable message out of an error response, preferring the
 * FastAPI ``detail`` field over the raw JSON body. Mirrors the helper in
 * ``impersonationPresets.ts`` so failed calls surface clean copy (e.g.
 * "Invalid email or password") rather than a raw ``{"detail":...}`` blob.
 */
async function readErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = await response.text();
    if (!body) return fallback;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object") {
        // justified: walking an unknown FastAPI envelope before narrowing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = (parsed as any).detail;
        if (typeof detail === "string") return detail;
      }
    } catch {
      // not JSON — fall through to the generic fallback
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `Login failed: ${response.status} ${response.statusText}`
    );
    throw new Error(message);
  }

  return response.json() as Promise<LoginResponse>;
}
