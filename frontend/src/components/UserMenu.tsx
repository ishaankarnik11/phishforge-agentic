import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * UserMenu — dropdown showing the logged-in user and a "Log out" action.
 *
 * STORY-7.6 AC:
 * - Shows the current user's name (falls back to email when name unavailable).
 * - Clicking the button opens a dropdown with a "Log out" menu item.
 * - "Log out" calls AuthContext.logout() (clears token + resets state) and
 *   navigates to /login.
 * - Accessible: aria-haspopup / aria-expanded on the trigger, role="menu" on
 *   the list, role="menuitem" on each action, Escape closes, click-outside
 *   closes, focus returns to trigger on close.
 */
export default function UserMenu() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const menuId = useId();

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The context currently only carries `email`, derived from the JWT `sub`.
  // Per story: "Display the user's name (or email if name unavailable)".
  // We render the email portion before the "@" as a friendly fallback name
  // and expose the full email as the accessible label for disambiguation.
  const email = user?.email ?? "";
  const displayName = email ? email.split("@")[0] : "Account";

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger for keyboard users.
    buttonRef.current?.focus();
  }, []);

  const handleLogout = useCallback(() => {
    logout();
    setOpen(false);
    navigate("/login");
  }, [logout, navigate]);

  // Close on Escape and on outside click while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        !menuRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  // When the menu opens, move focus to the first menu item.
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      "[role=menuitem]"
    );
    first?.focus();
  }, [open]);

  if (!user) {
    // Don't render when unauthenticated; callers should only mount this on
    // authenticated routes, but guard defensively.
    return null;
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${email}`}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-ds-sm border border-border-default bg-surface-raised px-3 py-1.5 text-label text-ink-body transition-colors duration-fast hover:bg-surface-sunken hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-chrome"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-ds-full bg-accent-subtle text-caption text-accent"
        >
          {displayName.charAt(0) || "?"}
        </span>
        <span className="max-w-[10rem] truncate">{displayName}</span>
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-ink-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised shadow-overlay focus:outline-none"
        >
          <div className="border-b border-border-subtle px-4 py-3">
            <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-body text-ink-strong">{email}</p>
          </div>
          {/* STORY-7.8 AC-3 / AC-5: admin-only entry point to the
              observability page. The route is gated on the page itself
              too, but hiding the link keeps non-admins from seeing
              admin chrome at all. */}
          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              data-testid="admin-observability-link"
              onClick={() => {
                setOpen(false);
                navigate("/admin/observability");
              }}
              className="flex w-full items-center gap-2 border-b border-border-subtle px-4 py-2 text-left text-label text-ink-body transition-colors hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-ink-muted"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm-1-9a1 1 0 112 0v3.586l1.707 1.707a1 1 0 01-1.414 1.414l-2-2A1 1 0 019 11V7z"
                  clipRule="evenodd"
                />
              </svg>
              Admin · Observability
            </button>
          )}
          {/* STORY-AP1.2: admin impersonation preset registry. */}
          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              data-testid="admin-impersonation-presets-link"
              onClick={() => {
                setOpen(false);
                navigate("/admin/impersonation-presets");
              }}
              className="flex w-full items-center gap-2 border-b border-border-subtle px-4 py-2 text-left text-label text-ink-body transition-colors hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-ink-muted"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M3.5 2.75A1.75 1.75 0 015.25 1h9.5A1.75 1.75 0 0116.5 2.75v14.5A1.75 1.75 0 0114.75 19h-9.5A1.75 1.75 0 013.5 17.25V2.75zM5.25 2.5a.25.25 0 00-.25.25v14.5c0 .138.112.25.25.25h9.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25h-9.5z"
                  clipRule="evenodd"
                />
                <path d="M7 6.75A.75.75 0 017.75 6h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 017 6.75zM7 10a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5A.75.75 0 017 10zm.75 2.5a.75.75 0 000 1.5h2.5a.75.75 0 000-1.5h-2.5z" />
              </svg>
              Manage impersonation presets
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-label text-ink-body transition-colors hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-ink-muted"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M3 4.75A2.75 2.75 0 015.75 2h4.5a2.75 2.75 0 012.75 2.75v1a.75.75 0 01-1.5 0v-1c0-.69-.56-1.25-1.25-1.25h-4.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h4.5c.69 0 1.25-.56 1.25-1.25v-1a.75.75 0 011.5 0v1A2.75 2.75 0 0110.25 18h-4.5A2.75 2.75 0 013 15.25V4.75z"
                clipRule="evenodd"
              />
              <path
                fillRule="evenodd"
                d="M16.22 7.47a.75.75 0 011.06 0l2.25 2.25a.75.75 0 010 1.06l-2.25 2.25a.75.75 0 11-1.06-1.06l.97-.97H9a.75.75 0 010-1.5h8.19l-.97-.97a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
