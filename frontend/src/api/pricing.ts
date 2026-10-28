/**
 * Frontend-side mirror of the backend pricing table.
 *
 * Source of truth: ``backend/app/services/observability_service.py:28-44``
 * (the ``PRICE_PER_1M`` dict). When that dict changes, update this file
 * in the same PR. Drift means the editor tooltip's "saved $X via cache"
 * line will be wrong — annoying but not catastrophic.
 *
 * Why duplicate instead of expose a /pricing endpoint?
 *   - One round-trip saved on every editor mount.
 *   - The backend already records the *resolved* dollar cost on each
 *     ``LlmCallLog`` row, so the *display* of total spend is always
 *     server-authoritative. The only thing this table influences is the
 *     incremental cache-savings hint — easy to reconcile by hand.
 *   - For the POC, a 12-line constant is cheaper than a new endpoint +
 *     query + cache invalidation.
 *
 * The unit is USD per 1,000,000 tokens (matching the backend).
 */

export interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const PRICE_PER_1M: Readonly<Record<string, ModelPricing>> = {
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cache_read: 0.3,
    cache_write: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.8,
    output: 4.0,
    cache_read: 0.08,
    cache_write: 1.0,
  },
};

const DEFAULT_PRICING: ModelPricing = PRICE_PER_1M["claude-sonnet-4-6"];

export function getPricing(model: string | null | undefined): ModelPricing {
  if (!model) return DEFAULT_PRICING;
  return PRICE_PER_1M[model] ?? DEFAULT_PRICING;
}

/**
 * Estimated USD savings from prompt caching for a given call.
 *
 * Formula: ``cache_read_tokens * (input_price - cache_read_price) / 1e6``.
 * The intuition: each cache-read token would have cost the full input
 * price *without* caching; with caching it costs the (much lower) cache
 * read price, so the delta is the savings.
 *
 * Returns 0 when there were no cache-read tokens (no caching kicked in
 * yet) or when the model is unknown (the default pricing falls back to
 * Sonnet — which has the largest delta — so the answer is at least
 * directionally right).
 */
export function computeCacheSavingsUsd(
  cacheReadTokens: number,
  model: string | null | undefined
): number {
  if (cacheReadTokens <= 0) return 0;
  const p = getPricing(model);
  const delta = p.input - p.cache_read;
  if (delta <= 0) return 0;
  return (cacheReadTokens * delta) / 1_000_000;
}
