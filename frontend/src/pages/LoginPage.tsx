import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { API_BASE } from "../api/baseUrl";
import { useAuth } from "../hooks/useAuth";
import { Button, Field, Input } from "../components/ds";

export default function LoginPage() {
  const { isAuthenticated, token, logout, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenChecked, setTokenChecked] = useState(!isAuthenticated);

  useEffect(() => {
    if (!token) {
      setTokenChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (!res.ok) logout();
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setTokenChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, logout]);

  if (!tokenChecked) return null;
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // Navigation handled by the isAuthenticated redirect above on re-render
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-4 text-ink-body">
      <div className="w-full max-w-sm">
        {/* Header / branding (STORY-AP1.1 rebrand) */}
        <div className="mb-8 text-center">
          <h1 className="text-display text-ink-strong">PhishForge</h1>
          <p className="mt-2 text-body text-ink-muted">
            Phishing-simulation studio for authorized anti-phishing audits.
          </p>
        </div>

        {/* Authorization context: the boundary is visible by design, even at
            sign in (PRODUCT.md principle 3). info-toned, never an alarm. */}
        <div className="mb-6 flex items-center gap-2 rounded-ds-sm border border-border-subtle bg-info-subtle px-3 py-2 text-info">
          <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 1.75 13 3.5v3.75c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5V3.5L8 1.75Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path
              d="M5.75 8 7.25 9.5 10.25 6.25"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-caption">Authorized simulation</span>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-1.5 rounded-ds-sm border border-danger bg-danger-subtle px-4 py-3 text-body text-danger"
          >
            {error}
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>

          <Field label="Password">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            )}
          </Field>

          <Button type="submit" variant="primary" loading={loading} className="w-full">
            {loading ? "Logging in..." : "Log in"}
          </Button>
        </form>

        {/* STORY-7.5 AC-3: there is no self-registration; users are
            provisioned out-of-band by an administrator. Surface that
            explicitly so first-time visitors don't hunt for a sign-up
            link. */}
        <p className="mt-6 text-center text-caption font-normal normal-case tracking-normal text-ink-muted">
          Don't have an account? Please contact your admin.
        </p>
      </div>
    </div>
  );
}
