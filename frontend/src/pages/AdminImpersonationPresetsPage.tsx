import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listPresets } from "../api/impersonationPresets";
import type { ImpersonationPresetSummary } from "../api/impersonationPresets";
import Toast from "../components/Toast";
import type { ToastVariant } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";

interface NavigationToastState {
  title: string;
  variant: ToastVariant;
  description?: string;
}

interface LocationStateWithToast {
  toast?: NavigationToastState;
}

/**
 * Admin impersonation preset list page (STORY-AP1.2).
 *
 * Replaces the former admin brand-kit list. Non-admin callers are
 * redirected to ``/``; we wait for ``profileLoaded`` before deciding so
 * the first render doesn't leak admin chrome during the ``/auth/me``
 * round-trip.
 *
 * Layout: a card-style table of presets with logo thumbnail, name, sender
 * email, and a color swatch. Each row links to the edit form; a CTA in the
 * header opens the create form. Styled with the AP0.2 design tokens.
 */
export default function AdminImpersonationPresetsPage() {
  const { isAdmin, profileLoaded } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<NavigationToastState | null>(null);

  // Pick up any toast forwarded via the navigation state from the form
  // page (created/saved/deleted confirmation). Clear the state after
  // reading so reloads don't re-show the toast.
  useEffect(() => {
    const state = location.state as LocationStateWithToast | null;
    if (state?.toast) {
      setToast(state.toast);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const listQuery = useQuery<ImpersonationPresetSummary[]>({
    queryKey: ["admin", "impersonation-presets"],
    queryFn: listPresets,
    enabled: isAdmin === true,
    retry: false,
  });

  if (!profileLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
        <div role="status" className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <p className="mt-2 text-body text-ink-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const presets: ImpersonationPresetSummary[] = listQuery.data ?? [];

  return (
    // STORY-AP7.1: global user menu moved to the app shell (TopBar).
    <div className="min-h-full bg-surface-sunken">
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="mx-auto flex max-w-6xl items-center gap-sm px-lg py-md">
          <Link
            to="/"
            aria-label="Back to home"
            className="rounded-ds-sm p-1.5 text-ink-body transition-colors hover:bg-surface-sunken"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <h1 className="text-title text-ink-strong">
            Manage impersonation presets
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-lg py-lg">
        <div className="mb-md flex items-center justify-between">
          <p className="text-body text-ink-muted">
            Reusable impersonated identities (name, sender email, color, and
            logo) that the brief form can load into a simulation.
          </p>
          {/* A link styled as the primary Button (DESIGN.md §5). It owns
              navigation, so it stays an anchor rather than a nested button. */}
          <Link
            to="/admin/impersonation-presets/new"
            data-testid="create-preset-cta"
            className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-ds-sm border border-transparent bg-accent px-3.5 text-label text-on-accent transition-colors duration-fast ease-out hover:bg-accent-hover active:bg-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
            Create new preset
          </Link>
        </div>

        {listQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div
              role="status"
              className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"
            />
          </div>
        )}

        {listQuery.isError && (
          <div
            role="alert"
            className="rounded-ds-md border border-danger bg-danger-subtle px-md py-sm text-body text-danger"
          >
            Failed to load presets:{" "}
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Unknown error"}
          </div>
        )}

        {listQuery.isSuccess && presets.length === 0 && (
          <div className="rounded-ds-md border border-border-default bg-surface-raised px-md py-lg text-center text-body text-ink-muted">
            No impersonation presets configured yet.
          </div>
        )}

        {listQuery.isSuccess && presets.length > 0 && (
          <div className="overflow-hidden rounded-ds-md border border-border-default bg-surface-raised shadow-raise">
            <table className="min-w-full divide-y divide-border-default text-body">
              <thead className="bg-surface-sunken">
                <tr>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    Color
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    ID
                  </th>
                </tr>
              </thead>
              <tbody
                data-testid="preset-rows"
                className="divide-y divide-border-default"
              >
                {presets.map((preset) => (
                  <PresetRow key={preset.id} preset={preset} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {toast && (
        <Toast
          data-testid="admin-presets-toast"
          title={toast.title}
          description={toast.description ?? null}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

interface PresetRowProps {
  preset: ImpersonationPresetSummary;
}

function PresetRow({ preset }: PresetRowProps) {
  const navigate = useNavigate();
  const editPath = `/admin/impersonation-presets/${preset.id}/edit`;
  return (
    <tr
      data-testid={`preset-row-${preset.id}`}
      onClick={() => navigate(editPath)}
      className="cursor-pointer transition-colors hover:bg-surface-sunken"
    >
      <td className="px-md py-sm">
        <span
          aria-hidden="true"
          className="inline-block h-6 w-6 rounded-ds-sm border border-border-default"
          style={{ backgroundColor: preset.primary_color ?? "transparent" }}
        />
      </td>
      <td className="px-md py-sm text-ink-strong">
        <Link
          to={editPath}
          onClick={(e) => e.stopPropagation()}
          className="hover:text-accent hover:underline"
        >
          {preset.name}
        </Link>
      </td>
      <td className="px-md py-sm font-mono text-caption text-ink-muted">
        {preset.id}
      </td>
    </tr>
  );
}
