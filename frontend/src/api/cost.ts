/**
 * Cost / observability API client (STORY-7.8).
 *
 * Three endpoints:
 *   - User-facing:    GET /api/v1/emailers/{id}/cost
 *   - Admin list:     GET /api/v1/admin/observability/emailers
 *   - Admin detail:   GET /api/v1/admin/observability/emailers/{id}
 *
 * Response shapes mirror the backend's ``EmailerCostSummary`` /
 * ``EmailerCostDetail`` / ``LlmCallLogRead`` Pydantic models in
 * ``backend/app/schemas/observability.py`` — keep these typed interfaces
 * in lock-step with that file. Drift is the maintenance trade-off; the
 * alternative (a generated client) is overkill for the POC.
 *
 * Pricing constants are duplicated in ./pricing.ts so the editor's
 * "saved $X via cache" tooltip can compute the savings client-side
 * without an extra round trip. The single source of truth lives at
 * ``backend/app/services/observability_service.py:28-44`` — when the
 * backend table changes, update ./pricing.ts in the same PR.
 */

import { API_BASE } from "./baseUrl";

export interface EmailerCostSummary {
  emailer_id: number;
  emailer_name: string;
  creator_email: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_write_tokens: number;
  estimated_cost_usd: number;
  first_call_at: string | null;
  last_call_at: string | null;
}

export interface EmailersCostList {
  emailers: EmailerCostSummary[];
}

export interface LlmCallLogRead {
  id: number;
  stage_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  success: boolean;
  error_message: string | null;
  called_at: string;
}

export interface EmailerCostDetail {
  summary: EmailerCostSummary;
  calls: LlmCallLogRead[];
  total: number;
  limit: number;
  offset: number;
}

export interface CostQueryOptions {
  limit?: number;
  offset?: number;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function buildQuery(opts?: CostQueryOptions): string {
  if (!opts) return "";
  const parts: string[] = [];
  if (typeof opts.limit === "number") parts.push(`limit=${opts.limit}`);
  if (typeof opts.offset === "number") parts.push(`offset=${opts.offset}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as T;
}

/**
 * User-facing per-emailer cost detail. Returns 404 when the emailer is
 * missing OR owned by a different user (the backend collapses both into
 * the same response so callers can't enumerate IDs they don't own).
 */
export async function getEmailerCost(
  emailerId: number,
  opts?: CostQueryOptions
): Promise<EmailerCostDetail> {
  return fetchJson<EmailerCostDetail>(
    `${API_BASE}/api/v1/emailers/${emailerId}/cost${buildQuery(opts)}`
  );
}

/**
 * Admin-only: list every emailer that has at least one LLM call,
 * sorted by estimated cost descending.
 */
export async function listAdminEmailerCosts(): Promise<EmailersCostList> {
  return fetchJson<EmailersCostList>(
    `${API_BASE}/api/v1/admin/observability/emailers`
  );
}

/**
 * Admin-only: per-emailer cost detail including paginated call log.
 */
export async function getAdminEmailerCost(
  emailerId: number,
  opts?: CostQueryOptions
): Promise<EmailerCostDetail> {
  return fetchJson<EmailerCostDetail>(
    `${API_BASE}/api/v1/admin/observability/emailers/${emailerId}${buildQuery(opts)}`
  );
}
