/**
 * Currency formatter for per-emailer LLM cost (STORY-7.8 AC-4).
 *
 * USD with the ``$`` symbol and 4 decimal places. INR conversion is
 * explicitly out of scope for STORY-7.8 — track as tech debt.
 *
 * We use Intl.NumberFormat instead of ``n.toFixed(4)`` so locale
 * grouping (e.g. ``$1,234.5678``) renders correctly when a user
 * eventually rolls up enough cost. ``toFixed`` would emit ``$1234.5678``
 * which reads fine for small amounts but degrades at scale.
 */

const FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export function formatUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "$0.0000";
  }
  return FORMATTER.format(amount);
}
