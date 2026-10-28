import { useState, useRef, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { getEmailerCost } from "../api/cost";
import type { EmailerCostDetail } from "../api/cost";
import { formatUsd } from "../api/formatCost";
import { computeCacheSavingsUsd } from "../api/pricing";

interface CostBadgeProps {
  emailerId: number;
}

/**
 * Header badge showing running USD cost for an emailer (STORY-7.8 AC-1).
 *
 * Hover (or focus) reveals a small popover with the breakdown — input,
 * output, cache-read, cache-write tokens, the model used on the most
 * recent call, and AC-7's "saved $X via cache" line.
 *
 * Implementation notes:
 *   - Driven by ``["emailerCost", emailerId]`` React Query key. The
 *     parent ``EmailerPage`` invalidates that key in ``onSuccess`` of
 *     the generate / refine / save mutations so the badge stays fresh.
 *   - Pricing for the cache-savings calculation lives in
 *     ``api/pricing.ts`` and mirrors the backend's table; see that file
 *     for the drift trade-off.
 */
export default function CostBadge({ emailerId }: CostBadgeProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const costQuery = useQuery<EmailerCostDetail>({
    queryKey: ["emailerCost", emailerId],
    queryFn: () => getEmailerCost(emailerId),
    enabled: !Number.isNaN(emailerId),
    // The badge is purely a display aid — a momentary stale cost is
    // fine. Don't retry on transient errors; the parent's mutations
    // re-invalidate this key on every successful generate/refine/save.
    retry: false,
    // Treat the data as fresh for one second so a burst of mutations
    // settling almost simultaneously doesn't trigger a refetch storm.
    staleTime: 1_000,
  });

  const summary = costQuery.data?.summary;
  const lastCall = costQuery.data?.calls?.[0] ?? null;
  const totalCostUsd = summary?.estimated_cost_usd ?? 0;

  const cacheSavings = summary
    ? computeCacheSavingsUsd(
        summary.total_cache_read_tokens,
        lastCall?.model ?? null
      )
    : 0;

  // Hover popover — a small grace period on close so the user can move
  // the cursor between the badge and the panel without it disappearing.
  function show() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function scheduleHide() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
    }
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, 100);
  }

  return (
    <div
      className="relative"
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      <button
        type="button"
        aria-describedby={tooltipId}
        data-testid="cost-badge"
        className="inline-flex cursor-help items-center gap-1.5 rounded-ds-full bg-success-subtle px-3 py-1 text-caption normal-case tracking-normal text-success ring-1 ring-success/20 transition-colors hover:bg-success-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-success/50"
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          className="h-3.5 w-3.5"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-13a1 1 0 011 1v.092a4 4 0 011.755.927.75.75 0 11-1.06 1.06A2.5 2.5 0 1010 13a4 4 0 010-8z"
            clipRule="evenodd"
          />
        </svg>
        <span className="hidden sm:inline">Cost so far:</span>
        <span data-testid="cost-badge-value">
          {costQuery.isLoading ? "…" : formatUsd(totalCostUsd)}
        </span>
      </button>

      {open && (
        <div
          id={tooltipId}
          role="tooltip"
          data-testid="cost-badge-tooltip"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-ds-md border border-border-subtle bg-surface-raised p-sm text-caption font-normal normal-case tracking-normal text-ink-body shadow-overlay"
        >
          {costQuery.isError && (
            <p className="text-danger">
              Couldn&apos;t load cost details.
            </p>
          )}

          {!costQuery.isError && summary && (
            <>
              <p className="mb-2 text-label text-ink-strong">
                Cost breakdown
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                <dt className="text-ink-muted">Total spend</dt>
                <dd
                  className="text-right font-medium text-ink-strong"
                  data-testid="cost-tooltip-total"
                >
                  {formatUsd(totalCostUsd)}
                </dd>

                <dt className="text-ink-muted">Calls</dt>
                <dd className="text-right text-ink-strong">
                  {summary.total_calls}
                </dd>

                <dt className="text-ink-muted">Input tokens</dt>
                <dd className="text-right text-ink-strong">
                  {summary.total_input_tokens.toLocaleString()}
                </dd>

                <dt className="text-ink-muted">Output tokens</dt>
                <dd className="text-right text-ink-strong">
                  {summary.total_output_tokens.toLocaleString()}
                </dd>

                <dt className="text-ink-muted">Cache-read tokens</dt>
                <dd className="text-right text-ink-strong">
                  {summary.total_cache_read_tokens.toLocaleString()}
                </dd>

                <dt className="text-ink-muted">Cache-write tokens</dt>
                <dd className="text-right text-ink-strong">
                  {summary.total_cache_write_tokens.toLocaleString()}
                </dd>

                <dt className="text-ink-muted">Last model</dt>
                <dd
                  className="truncate text-right text-ink-strong"
                  data-testid="cost-tooltip-model"
                  title={lastCall?.model ?? undefined}
                >
                  {lastCall?.model ?? "None"}
                </dd>
              </dl>

              {/* AC-7: cache savings */}
              {cacheSavings > 0 && (
                <p
                  data-testid="cost-tooltip-cache-savings"
                  className="mt-2 rounded-ds-sm bg-success-subtle px-2 py-1 text-success"
                >
                  Saved {formatUsd(cacheSavings)} via cache
                </p>
              )}
              {summary.total_calls === 0 && (
                <p className="mt-2 italic text-ink-muted">
                  No LLM calls yet.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
