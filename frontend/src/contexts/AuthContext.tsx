import {
  createContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { login as apiLogin } from "../api/auth";
import { API_BASE } from "../api/baseUrl";

const TOKEN_KEY = "access_token";

/**
 * Public user representation served by ``GET /api/v1/auth/me``.
 *
 * STORY-7.8 extends the in-context ``user`` shape from a bare ``{email}``
 * (decoded from the JWT ``sub``) to the full server profile so the UI
 * can gate admin-only routes on ``role``. The ``email`` fallback path is
 * preserved — between login and the first ``/auth/me`` round-trip, the
 * user is treated as authenticated but ``role`` reads as ``null``, which
 * the admin guards interpret as "not admin yet, redirect".
 */
export interface AuthUser {
  id: number | null;
  email: string;
  name: string | null;
  role: "editor" | "admin" | null;
}

export interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  /** True until the first ``/auth/me`` resolution has settled (success
   *  or failure). Lets pages avoid flash-of-non-admin redirects. */
  profileLoaded: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  id: number;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

function decodeTokenEmail(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    // atob handles base64; JWT uses base64url so replace chars first
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const data: unknown = JSON.parse(json);
    if (
      typeof data === "object" &&
      data !== null &&
      "sub" in data &&
      typeof (data as Record<string, unknown>).sub === "string"
    ) {
      return (data as Record<string, unknown>).sub as string;
    }
    return null;
  } catch {
    return null;
  }
}

function normaliseRole(value: string): "editor" | "admin" | null {
  return value === "admin" || value === "editor" ? value : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );

  // Profile fetched from /auth/me. Falls back to a JWT-decoded email
  // until the round-trip settles so consumers (UserMenu, etc.) can keep
  // rendering something meaningful in the meantime.
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const isAuthenticated = token !== null;

  // STORY-7.8: fetch /auth/me whenever the token changes (login + initial
  // mount with a stored token). On 401/network failure we clear the token
  // — the LoginPage already does the same on its mount-time probe; this
  // keeps the two code paths consistent and prevents a stale token from
  // pretending the user is authenticated when the server has revoked it.
  useEffect(() => {
    if (!token) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }
    setProfileLoaded(false);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          // Stale / invalid token — drop it.
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setProfile(null);
          return;
        }
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        setProfile({
          id: data.id,
          email: data.email,
          name: data.name,
          role: normaliseRole(data.role),
        });
      } catch {
        // Network blip — leave the token in place but keep the role
        // null so admin gates fail closed. The next render that calls
        // /auth/me (e.g. logout-then-login) will retry.
        if (cancelled) return;
        const fallbackEmail = decodeTokenEmail(token) ?? "";
        setProfile({
          id: null,
          email: fallbackEmail,
          name: null,
          role: null,
        });
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Derived "user" exposed on the context. Until /auth/me resolves, fall
  // back to the JWT-decoded email so the logged-in chrome (UserMenu)
  // still renders something. ``role`` stays null in the fallback so
  // admin gates fail closed.
  const user = useMemo<AuthUser | null>(() => {
    if (profile) return profile;
    if (!token) return null;
    const email = decodeTokenEmail(token);
    if (!email) return null;
    return { id: null, email, name: null, role: null };
  }, [profile, token]);

  const isAdmin = user?.role === "admin";

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, response.access_token);
    setToken(response.access_token);
    // The /auth/me effect above re-runs on the new token and populates
    // the role; nothing to do here.
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setProfile(null);
    setProfileLoaded(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated,
      isAdmin,
      profileLoaded,
      login,
      logout,
    }),
    [token, user, isAuthenticated, isAdmin, profileLoaded, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth is exported separately to satisfy react-refresh/only-export-components
// (this file must only export the AuthProvider component)
export { AuthContext };
