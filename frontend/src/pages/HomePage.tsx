import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { listEmailers } from "../api/emailers";
import type { EmailerStatus, EmailerSummary } from "../api/emailers";
import { getEmailerCost } from "../api/cost";
import type { EmailerCostDetail } from "../api/cost";
import { formatUsd } from "../api/formatCost";
import { useAuth } from "../hooks/useAuth";
import { Button, Card, StatusBadge } from "../components/ds";
import type { StatusTone } from "../components/ds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a human-friendly relative time string (e.g. "3 hours ago"). */
function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

// Per-status label + ds StatusBadge tone. The ds StatusBadge always renders a
// per-tone leading icon alongside the label, so status survives color-blind
// viewing (The Two-Signal Rule). draft → neutral, in_review → warning (caution,
// not yet approved), completed → success, exported → info.
const STATUS_CONFIG: Record<
  EmailerStatus,
  { label: string; tone: StatusTone }
> = {
  draft: { label: "Draft", tone: "neutral" },
  in_review: { label: "In Review", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  exported: { label: "Exported", tone: "info" },
};

// All four statuses, in the order they appear in the chip row. Kept as a
// const tuple so we get exhaustive typing if the EmailerStatus union ever
// grows.
const STATUS_ORDER: readonly EmailerStatus[] = [
  "draft",
  "in_review",
  "completed",
  "exported",
];

function EmailerStatusBadge({ status }: { status: string }) {
  const config =
    STATUS_CONFIG[status as EmailerStatus] ?? STATUS_CONFIG.draft;
  return <StatusBadge tone={config.tone}>{config.label}</StatusBadge>;
}

// ---------------------------------------------------------------------------
// Filter chip (STORY-1.3)
// ---------------------------------------------------------------------------

interface FilterChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
  testId?: string;
}

/**
 * A single filter chip — toggles between filled (selected) and outlined
 * (unselected). Uses ``aria-pressed`` so screen readers announce the
 * toggle state correctly. Visual styling intentionally mirrors the small
 * pill-shaped buttons elsewhere in the app (status badge, preset
 * chip) so the row looks at home above the list.
 */
function FilterChip({ label, selected, onToggle, testId }: FilterChipProps) {
  // Filter chip per DESIGN.md §5 Chips: surface-sunken / ink-muted at rest,
  // accent-subtle fill + accent text + accent-border when selected. aria-pressed
  // carries the toggle state for assistive tech (color is never the only cue).
  const base =
    "inline-flex items-center rounded-ds-xs px-2 py-0.5 text-label " +
    "transition-colors duration-fast ease-out focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 " +
    "focus-visible:ring-offset-surface-raised";
  const selectedCls =
    "border border-accent-border bg-accent-subtle text-accent";
  const unselectedCls =
    "border border-transparent bg-surface-sunken text-ink-muted hover:text-ink-body";
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      onClick={onToggle}
      className={`${base} ${selected ? selectedCls : unselectedCls}`}
    >
      {label}
    </button>
  );
}

interface FilterChipRowProps {
  statusFilter: EmailerStatus[];
  onToggleStatus: (status: EmailerStatus) => void;
  onClearFilters: () => void;
  filtersActive: boolean;
}

function FilterChipRow({
  statusFilter,
  onToggleStatus,
  onClearFilters,
  filtersActive,
}: FilterChipRowProps) {
  return (
    <Card
      compact
      data-testid="filter-chip-row"
      className="mb-md"
      role="group"
      aria-label="Filter simulations"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-ink-muted">Status</span>
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_CONFIG[s].label}
            selected={statusFilter.includes(s)}
            onToggle={() => onToggleStatus(s)}
            testId={`filter-status-${s}`}
          />
        ))}
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            data-testid="clear-filters-chip-row"
            onClick={onClearFilters}
            className="ml-auto text-accent"
          >
            Clear filters
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      {/* Simple illustration placeholder */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-ds-full bg-accent-subtle">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 text-accent"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
          />
        </svg>
      </div>
      <h2 className="text-title text-ink-strong">
        You haven't created any simulations yet
      </h2>
      <p className="mt-1 text-body text-ink-muted">
        Get started by creating your first email template.
      </p>
      <Link
        to="/brief"
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-ds-sm bg-accent px-4 text-label text-on-accent transition-colors duration-fast ease-out hover:bg-accent-hover active:bg-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
      >
        Create your first simulation
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort key + direction
// ---------------------------------------------------------------------------

type SortKey = "updated_at" | "cost";
type SortDirection = "asc" | "desc";

// ---------------------------------------------------------------------------
// Emailer row
// ---------------------------------------------------------------------------

interface EmailerRowProps {
  emailer: EmailerSummary;
  costUsd: number | null;
  costLoading: boolean;
}

function EmailerRow({ emailer, costUsd, costLoading }: EmailerRowProps) {
  return (
    <Link
      to={`/emailers/${emailer.id}`}
      className="block rounded-ds-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
    >
      <Card
        compact
        interactive
        className="flex items-center gap-4 hover:border-border-default"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-label text-ink-strong">{emailer.name}</p>
          <p className="mt-0.5 text-caption font-normal normal-case tracking-normal text-ink-muted">
            Updated {relativeTime(emailer.updated_at)}
          </p>
        </div>

        <span
          data-testid={`emailer-cost-${emailer.id}`}
          className="w-24 shrink-0 text-right text-caption font-normal normal-case tracking-normal tabular-nums text-ink-body"
          aria-label="Estimated cost"
        >
          {costLoading ? (
            <span className="text-ink-faint">…</span>
          ) : (
            formatUsd(costUsd ?? 0)
          )}
        </span>

        <EmailerStatusBadge status={emailer.status} />
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // STORY-1.3: filter state. Each facet is a string array — empty means
  // "no restriction" (matches backend semantics). React Query refetches
  // whenever either array changes thanks to the array in the queryKey.
  const [statusFilter, setStatusFilter] = useState<EmailerStatus[]>([]);

  const filtersActive = statusFilter.length > 0;

  function toggleStatus(status: EmailerStatus) {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  }

  function clearFilters() {
    setStatusFilter([]);
  }

  // STORY-1.3: include the status filter in the query key so React Query
  // caches per-combination and triggers a refetch on every toggle. Passed
  // down to `listEmailers` which serializes to the repeated query params
  // the backend expects.
  const emailersQuery = useQuery({
    queryKey: ["emailers", { statusFilter }],
    queryFn: () => listEmailers({ statusFilter }),
  });

  // Stabilise the array reference so useMemo / useQueries below have a
  // consistent dependency — without this, every render minted a new
  // ``[]`` for the empty case and the per-row queries thrashed.
  const emailers = useMemo<EmailerSummary[]>(
    () => emailersQuery.data ?? [],
    [emailersQuery.data]
  );

  // STORY-7.8 AC-2: per-row cost via the user-facing endpoint. We
  // deliberately DO NOT branch on admin role here — the user-facing
  // endpoint already returns the right shape for any caller's own
  // emailers, and admins can still use the dedicated Admin Observability
  // page when they want to see other users' costs. Using one code path
  // keeps the UI predictable.
  //
  // For larger lists this fans out to N requests; the home list is
  // already paginated server-side so N is bounded, and React Query's
  // dedup means re-renders don't trigger duplicate fetches.
  const costQueries = useQueries({
    queries: emailers.map((e) => ({
      queryKey: ["emailerCost", e.id],
      queryFn: () => getEmailerCost(e.id),
      enabled: isAuthenticated,
      retry: false,
      staleTime: 30_000,
    })),
  });

  const costById = useMemo<
    Record<number, { usd: number | null; loading: boolean }>
  >(() => {
    const map: Record<number, { usd: number | null; loading: boolean }> = {};
    emailers.forEach((e, i) => {
      const q = costQueries[i];
      const data = q?.data as EmailerCostDetail | undefined;
      map[e.id] = {
        usd: data?.summary.estimated_cost_usd ?? null,
        loading: q?.isLoading ?? false,
      };
    });
    return map;
  }, [emailers, costQueries]);

  const sortedEmailers = useMemo(() => {
    const list = [...emailers];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "updated_at") {
        cmp =
          new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      } else {
        const aCost = costById[a.id]?.usd ?? 0;
        const bCost = costById[b.id]?.usd ?? 0;
        cmp = aCost - bCost;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return list;
  }, [emailers, costById, sortKey, sortDirection]);

  function toggleCostSort() {
    if (sortKey !== "cost") {
      setSortKey("cost");
      setSortDirection("desc"); // most-expensive first by default
    } else {
      setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
    }
  }

  function toggleUpdatedSort() {
    if (sortKey !== "updated_at") {
      setSortKey("updated_at");
      setSortDirection("desc");
    } else {
      setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
    }
  }

  return (
    <div className="min-h-full bg-surface-base">
      {/* STORY-AP7.1: global wordmark / nav / user menu live in the app shell
          (TopBar + SideNav). This page keeps its page-level header (title +
          primary "Create new emailer" action) and its body, now on AP0.2
          tokens + ds components. */}
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-headline text-ink-strong">Simulations</h1>
          <Button
            variant="primary"
            onClick={() => navigate("/brief")}
            leadingIcon={
              <svg
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
            }
          >
            Create new simulation
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* STORY-1.3: filter chip row sits above every other surface so
            filters stay visible during loading / error / empty states. */}
        <FilterChipRow
          statusFilter={statusFilter}
          onToggleStatus={toggleStatus}
          onClearFilters={clearFilters}
          filtersActive={filtersActive}
        />

        {/* Loading state */}
        {emailersQuery.isLoading && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div
                role="status"
                className="mx-auto h-8 w-8 animate-spin rounded-ds-full border-4 border-accent border-t-transparent"
              />
              <p className="mt-3 text-body text-ink-muted">
                Loading simulations...
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {emailersQuery.isError && (
          <div
            role="alert"
            className="rounded-ds-md border border-danger bg-danger-subtle px-4 py-3 text-body text-danger"
          >
            <strong className="font-medium">Error:</strong>{" "}
            {emailersQuery.error instanceof Error
              ? emailersQuery.error.message
              : "Failed to load simulations"}
          </div>
        )}

        {/* Empty state — split between "user has none at all" (the
            classic onboarding CTA) and "filters yielded zero" (offer
            Clear filters). The latter is STORY-1.3's empty-with-filter
            branch. */}
        {emailersQuery.isSuccess &&
          sortedEmailers.length === 0 &&
          !filtersActive && <EmptyState />}

        {emailersQuery.isSuccess &&
          sortedEmailers.length === 0 &&
          filtersActive && (
            <div
              data-testid="filtered-empty-state"
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <p className="text-body text-ink-body">
                No simulations match the selected filters.
              </p>
              <Button
                variant="primary"
                data-testid="clear-filters"
                onClick={clearFilters}
                className="mt-3"
              >
                Clear filters
              </Button>
            </div>
          )}

        {/* Emailer list */}
        {emailersQuery.isSuccess && sortedEmailers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-label text-ink-muted">
                {sortedEmailers.length}{" "}
                {sortedEmailers.length === 1 ? "simulation" : "simulations"}
              </h2>
              {/* STORY-7.8 AC-2: column header acts as the sort control.
                  Two columns are sortable; we mirror "current sort" via
                  aria-sort so screen readers can read it. The active sort
                  reads as an accent-subtle fill (not a colored stripe). */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleUpdatedSort}
                  aria-sort={
                    sortKey === "updated_at"
                      ? sortDirection === "desc"
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                  className={`rounded-ds-sm px-2 py-1 text-label transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    sortKey === "updated_at"
                      ? "bg-accent-subtle text-accent"
                      : "text-ink-muted hover:bg-surface-sunken"
                  }`}
                >
                  Updated
                  {sortKey === "updated_at"
                    ? sortDirection === "desc"
                      ? " ↓"
                      : " ↑"
                    : ""}
                </button>
                <button
                  type="button"
                  data-testid="sort-by-cost"
                  onClick={toggleCostSort}
                  aria-sort={
                    sortKey === "cost"
                      ? sortDirection === "desc"
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                  className={`rounded-ds-sm px-2 py-1 text-label transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    sortKey === "cost"
                      ? "bg-accent-subtle text-accent"
                      : "text-ink-muted hover:bg-surface-sunken"
                  }`}
                >
                  Cost
                  {sortKey === "cost"
                    ? sortDirection === "desc"
                      ? " ↓"
                      : " ↑"
                    : ""}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {sortedEmailers.map((emailer) => {
                const cost = costById[emailer.id] ?? {
                  usd: null,
                  loading: false,
                };
                return (
                  <EmailerRow
                    key={emailer.id}
                    emailer={emailer}
                    costUsd={cost.usd}
                    costLoading={cost.loading}
                  />
                );
              })}
            </div>
            {/* NOTE: Pagination / virtual scroll deferred per AC-4 */}
          </div>
        )}
      </main>
    </div>
  );
}
