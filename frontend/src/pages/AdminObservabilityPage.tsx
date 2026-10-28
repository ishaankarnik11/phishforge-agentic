import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getAdminEmailerCost,
  listAdminEmailerCosts,
} from "../api/cost";
import type {
  EmailerCostDetail,
  EmailerCostSummary,
  EmailersCostList,
  LlmCallLogRead,
} from "../api/cost";
import { formatUsd } from "../api/formatCost";
import { useAuth } from "../hooks/useAuth";
import { Button, Card, StatusBadge } from "../components/ds";

const PAGE_SIZE = 50;

/**
 * Admin observability page (STORY-7.8 AC-3 / AC-5).
 *
 * Lists every emailer that has logged at least one LLM call, sorted by
 * cost desc on the server. Clicking a row reveals a paginated call log
 * for that emailer. The whole page is gated on ``user.role === "admin"``;
 * non-admin callers get redirected back to ``/`` (we wait for the
 * profile to settle to avoid a flash redirect during the /auth/me
 * round-trip on first mount).
 */
export default function AdminObservabilityPage() {
  const { isAdmin, profileLoaded } = useAuth();
  const [selectedEmailerId, setSelectedEmailerId] = useState<number | null>(
    null
  );
  const [offset, setOffset] = useState(0);

  const listQuery = useQuery<EmailersCostList>({
    queryKey: ["adminEmailerCosts"],
    queryFn: listAdminEmailerCosts,
    enabled: isAdmin === true,
    retry: false,
  });

  const detailQuery = useQuery<EmailerCostDetail>({
    queryKey: ["adminEmailerCost", selectedEmailerId, offset],
    queryFn: () =>
      getAdminEmailerCost(selectedEmailerId as number, {
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: isAdmin === true && selectedEmailerId !== null,
    retry: false,
  });

  // STORY-7.8 AC-5: keep the redirect in a layout effect so the
  // first render doesn't briefly leak admin-only chrome to non-admins.
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

  const summaries: EmailerCostSummary[] = listQuery.data?.emailers ?? [];

  return (
    // STORY-AP7.1: global user menu moved to the app shell (TopBar). This
    // page keeps its page-level back link and title.
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
            Admin · LLM Observability
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-lg py-lg">
        <p className="mb-md text-body text-ink-muted">
          Per-emailer LLM spend across all users. Click a row to see the
          full call log.
        </p>

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
            Failed to load admin cost summary:{" "}
            {listQuery.error instanceof Error
              ? listQuery.error.message
              : "Unknown error"}
          </div>
        )}

        {listQuery.isSuccess && summaries.length === 0 && (
          <Card className="text-center text-body text-ink-muted">
            No LLM calls have been recorded yet.
          </Card>
        )}

        {listQuery.isSuccess && summaries.length > 0 && (
          <div className="overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised">
            <table className="min-w-full divide-y divide-border-subtle text-body">
              <thead className="bg-surface-sunken">
                <tr>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    Emailer
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    Creator
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-right text-label text-ink-muted"
                  >
                    Calls
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-right text-label text-ink-muted"
                  >
                    Total cost
                  </th>
                  <th
                    scope="col"
                    className="px-md py-sm text-left text-label text-ink-muted"
                  >
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody
                data-testid="admin-emailer-cost-rows"
                className="divide-y divide-border-subtle"
              >
                {summaries.map((s) => {
                  const isSelected = s.emailer_id === selectedEmailerId;
                  return (
                    <tr
                      key={s.emailer_id}
                      data-testid={`admin-row-${s.emailer_id}`}
                      onClick={() => {
                        setSelectedEmailerId(
                          isSelected ? null : s.emailer_id
                        );
                        setOffset(0);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-accent-subtle"
                          : "hover:bg-surface-sunken"
                      }`}
                    >
                      <td className="px-md py-sm font-medium text-ink-strong">
                        {s.emailer_name}
                      </td>
                      <td className="px-md py-sm font-mono text-mono text-ink-body">
                        {s.creator_email}
                      </td>
                      <td className="px-md py-sm text-right tabular-nums text-ink-body">
                        {s.total_calls}
                      </td>
                      <td className="px-md py-sm text-right tabular-nums font-medium text-ink-strong">
                        {formatUsd(s.estimated_cost_usd)}
                      </td>
                      <td className="px-md py-sm text-ink-muted">
                        {s.last_call_at
                          ? new Date(s.last_call_at).toLocaleString()
                          : "Never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Drill-down */}
        {selectedEmailerId !== null && (
          <section
            aria-label="Call log detail"
            data-testid="admin-call-log"
            className="mt-lg"
          >
            <CallLogDetail
              emailerId={selectedEmailerId}
              detail={detailQuery.data ?? null}
              isLoading={detailQuery.isLoading}
              isError={detailQuery.isError}
              error={detailQuery.error}
              offset={offset}
              onPrev={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              onNext={() => setOffset((o) => o + PAGE_SIZE)}
            />
          </section>
        )}
      </main>
    </div>
  );
}

interface CallLogDetailProps {
  emailerId: number;
  detail: EmailerCostDetail | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
}

function CallLogDetail({
  emailerId,
  detail,
  isLoading,
  isError,
  error,
  offset,
  onPrev,
  onNext,
}: CallLogDetailProps) {
  const calls: LlmCallLogRead[] = detail?.calls ?? [];
  const total = detail?.total ?? 0;
  const limit = detail?.limit ?? PAGE_SIZE;
  const showingFrom = calls.length === 0 ? 0 : offset + 1;
  const showingTo = offset + calls.length;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised">
      <div className="flex items-center justify-between border-b border-border-subtle px-md py-sm">
        <h2 className="text-title text-ink-strong">
          Call log · emailer #{emailerId}
        </h2>
        <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
          {total === 0
            ? "0 calls"
            : `Showing ${showingFrom} to ${showingTo} of ${total}`}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div
            role="status"
            className="h-6 w-6 animate-spin rounded-full border-4 border-accent border-t-transparent"
          />
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="m-md rounded-ds-sm border border-danger bg-danger-subtle px-sm py-2 text-body text-danger"
        >
          Failed to load call log:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {!isLoading && !isError && calls.length === 0 && (
        <p className="px-md py-6 text-center text-body text-ink-muted">
          No calls recorded for this emailer yet.
        </p>
      )}

      {calls.length > 0 && (
        <table className="min-w-full divide-y divide-border-subtle text-caption font-normal normal-case tracking-normal">
          <thead className="bg-surface-sunken">
            <tr>
              <th className="px-sm py-sm text-left text-label text-ink-muted">
                When
              </th>
              <th className="px-sm py-sm text-left text-label text-ink-muted">
                Stage
              </th>
              <th className="px-sm py-sm text-left text-label text-ink-muted">
                Model
              </th>
              <th className="px-sm py-sm text-right text-label text-ink-muted">
                Input
              </th>
              <th className="px-sm py-sm text-right text-label text-ink-muted">
                Output
              </th>
              <th className="px-sm py-sm text-right text-label text-ink-muted">
                Cache R / W
              </th>
              <th className="px-sm py-sm text-right text-label text-ink-muted">
                Cost
              </th>
              <th className="px-sm py-sm text-right text-label text-ink-muted">
                Latency
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {calls.map((c) => (
              <tr key={c.id} className={c.success ? "" : "bg-danger-subtle"}>
                <td className="px-sm py-2 text-ink-body">
                  {new Date(c.called_at).toLocaleString()}
                </td>
                <td className="px-sm py-2 text-ink-body">
                  {c.success ? (
                    c.stage_name
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {c.stage_name}
                      <StatusBadge tone="danger">Failed</StatusBadge>
                    </span>
                  )}
                </td>
                <td className="px-sm py-2 font-mono text-mono text-ink-body">
                  {c.model}
                </td>
                <td className="px-sm py-2 text-right tabular-nums text-ink-body">
                  {c.input_tokens.toLocaleString()}
                </td>
                <td className="px-sm py-2 text-right tabular-nums text-ink-body">
                  {c.output_tokens.toLocaleString()}
                </td>
                <td className="px-sm py-2 text-right tabular-nums text-ink-body">
                  {c.cache_read_tokens.toLocaleString()}
                  {" / "}
                  {c.cache_write_tokens.toLocaleString()}
                </td>
                <td className="px-sm py-2 text-right tabular-nums font-medium text-ink-strong">
                  {formatUsd(c.estimated_cost_usd)}
                </td>
                <td className="px-sm py-2 text-right tabular-nums text-ink-body">
                  {c.latency_ms} ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination controls */}
      <div className="flex items-center justify-between border-t border-border-subtle px-md py-sm text-caption font-normal normal-case tracking-normal text-ink-muted">
        <span>Page offset {offset}</span>
        <div className="flex gap-xs">
          <Button
            type="button"
            size="sm"
            data-testid="admin-call-log-prev"
            onClick={onPrev}
            disabled={!canPrev}
          >
            Prev
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="admin-call-log-next"
            onClick={onNext}
            disabled={!canNext}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
