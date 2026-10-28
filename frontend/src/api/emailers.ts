import { API_BASE } from "./baseUrl";

export type EmailerCategory =
  | "product_launch"
  | "offer"
  | "statement"
  | "campaign"
  | "announcement"
  | "other";

export type EmailerTone =
  | "professional"
  | "casual"
  | "festive"
  | "urgent"
  | "empathetic";

export type EmailerLength = "short" | "medium" | "long";

// STORY-AP2.1: pretext fields. Enum values are the pinned backend contract.
export type LureType =
  | "credential_harvest"
  | "malicious_attachment"
  | "link_click"
  | "oauth_consent";

export type UrgencyLevel = "low" | "medium" | "high";

// CR-001: pretext scenario — the believable story the lure tells. Reinvented
// from the retired marketing ``category``. Enum values are the pinned backend
// contract.
export type PretextScenario =
  | "password_expiry"
  | "invoice_payment"
  | "shared_document"
  | "account_security_alert"
  | "delivery_shipping"
  | "hr_payroll"
  | "it_support"
  | "other";

/**
 * Emailer status enum (STORY-1.3).
 *
 * Mirrors ``EmailerStatus`` on the backend. The list endpoint accepts
 * these as repeatable ``?status=...`` query params; values outside this
 * set yield 422.
 */
export type EmailerStatus = "draft" | "in_review" | "completed" | "exported";

export interface EmailerCreate {
  name: string;
  // CR-001: marketing-era fields retired. ``category``, ``content_summary``,
  // and ``tone`` are still accepted by the backend (nullable/optional) but the
  // form no longer sends them. ``target_audience`` and ``length`` are now
  // optional.
  category?: EmailerCategory | null;
  target_audience?: string | null;
  content_summary?: string | null;
  cta_text: string | null;
  cta_url: string | null;
  tone?: EmailerTone | null;
  length?: EmailerLength | null;

  // CR-001: pretext scenario — the believable story (D2). Required.
  pretext_scenario: PretextScenario;

  // STORY-AP2.2: impersonated identity — the brand/sender the phishing
  // simulation mimics. Required name/email/pretends-to-be; optional colour
  // and logo asset. Field names are the pinned backend contract.
  impersonation_sender_name: string;
  impersonation_sender_email: string;
  impersonation_pretends_to_be: string;
  impersonation_primary_color: string | null;
  impersonation_logo_asset_id: string | null;

  // STORY-AP2.1: pretext. Lure type + urgency are required; the intended
  // "tell" is optional free text captured for the training debrief. Field
  // names are the pinned backend contract.
  lure_type: LureType;
  urgency_level: UrgencyLevel;
  pretext_tell: string | null;
}

/**
 * Draft create body (STORY-2.6).
 *
 * Every brief field is optional so the user can start uploading assets
 * before filling out the full form. The server stores whatever subset
 * was provided. ``status`` MUST be the literal "draft" -- omit it for
 * the strict create path (use ``EmailerCreate`` for that).
 */
export interface EmailerDraftCreate {
  status: "draft";
  name?: string;
  category?: EmailerCategory;
  target_audience?: string;
  content_summary?: string;
  cta_text?: string | null;
  cta_url?: string | null;
  tone?: EmailerTone;
  length?: EmailerLength;

  // CR-001: pretext scenario may be partially filled on the draft.
  pretext_scenario?: PretextScenario;

  // STORY-AP2.2: impersonated identity may be partially filled when the
  // draft is created (e.g. the user adds a logo before finishing the form).
  impersonation_sender_name?: string;
  impersonation_sender_email?: string;
  impersonation_pretends_to_be?: string;
  impersonation_primary_color?: string | null;
  impersonation_logo_asset_id?: string | null;

  // STORY-AP2.1: pretext fields may be partially filled when the draft is
  // created (e.g. the user adds a logo before finishing the form).
  lure_type?: LureType;
  urgency_level?: UrgencyLevel;
  pretext_tell?: string | null;
}

/**
 * Partial update body for PATCH /emailers/{id} (STORY-2.6).
 *
 * Every field is optional. ``status`` may not transition back to
 * "draft" -- moving from draft to any non-draft requires every brief
 * field to be present (server enforces).
 */
export interface EmailerUpdate {
  name?: string;
  category?: EmailerCategory;
  target_audience?: string;
  content_summary?: string;
  cta_text?: string | null;
  cta_url?: string | null;
  tone?: EmailerTone;
  length?: EmailerLength;
  status?: "in_review" | "completed" | "exported";

  // CR-001: pretext scenario (see EmailerCreate). Optional here so a partial
  // PATCH can update it.
  pretext_scenario?: PretextScenario;

  // STORY-AP2.2: impersonated identity (see EmailerCreate). Optional here
  // so a partial PATCH can update any subset.
  impersonation_sender_name?: string;
  impersonation_sender_email?: string;
  impersonation_pretends_to_be?: string;
  impersonation_primary_color?: string | null;
  impersonation_logo_asset_id?: string | null;

  // STORY-AP2.1: pretext fields (see EmailerCreate). Optional here so a
  // partial PATCH can update any subset.
  lure_type?: LureType;
  urgency_level?: UrgencyLevel;
  pretext_tell?: string | null;
}

export interface EmailerRead {
  id: number;
  name: string;
  status: string;

  // STORY-AP2.2: impersonated identity, echoed back on read. The logo is
  // returned as a resolved URL (impersonation_logo_url) so the form can
  // render the saved logo on reload without a second fetch; the underlying
  // asset id is also returned for round-tripping into PATCH bodies.
  impersonation_sender_name?: string | null;
  impersonation_sender_email?: string | null;
  impersonation_pretends_to_be?: string | null;
  impersonation_primary_color?: string | null;
  impersonation_logo_asset_id?: string | null;
  impersonation_logo_url?: string | null;

  // STORY-AP2.1: pretext fields, echoed back on read for round-tripping
  // into PATCH bodies on reload.
  lure_type?: LureType | null;
  urgency_level?: UrgencyLevel | null;
  pretext_tell?: string | null;

  // CR-001: pretext scenario, echoed back on read.
  pretext_scenario?: PretextScenario | null;
}

export interface EmailerSummary {
  id: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface EmailerVersionRead {
  id: number;
  emailer_id: number;
  version_number: number;
  mjml_source: string;
  compiled_html: string | null;
  subject_line: string | null;
  preheader: string | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export interface GenerateResponse {
  version_id: number;
  version_number: number;
  subject_line: string;
  preheader: string;
  mjml_source: string;
  compiled_html: string | null;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  // STORY-7.8: cache token counts so the editor's cost badge can render
  // an accurate breakdown without a follow-up GET /cost. Backend always
  // emits these (zero-filled when prompt caching didn't kick in).
  cache_read_tokens: number;
  cache_write_tokens: number;
  latency_ms: number;
  warning: string | null;
}

export async function createEmailer(
  data: EmailerCreate | EmailerDraftCreate
): Promise<EmailerRead> {
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/api/v1/emailers`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerRead>;
}

export async function updateEmailer(
  id: number,
  data: EmailerUpdate
): Promise<EmailerRead> {
  const response = await fetch(`${API_BASE}/api/v1/emailers/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerRead>;
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

/**
 * Filter facets for ``GET /api/v1/emailers`` (STORY-1.3).
 *
 * Both arrays are independently optional. Within each facet the values
 * are OR-ed together; across facets they are AND-ed. An empty array is
 * treated identically to ``undefined`` (no restriction) — keeps the
 * caller's life simple when toggling chips off.
 */
export interface ListEmailersFilters {
  statusFilter?: EmailerStatus[];
}

export async function listEmailers(
  filters: ListEmailersFilters = {}
): Promise<EmailerSummary[]> {
  const { statusFilter } = filters;

  // Build the query string with `append` so the same key can repeat,
  // matching the backend's `Annotated[list[...] | None, Query(alias=...)]`
  // signature. URLSearchParams handles encoding for us.
  const params = new URLSearchParams();
  statusFilter?.forEach((s) => params.append("status", s));
  const qs = params.toString();
  const url = qs
    ? `${API_BASE}/api/v1/emailers?${qs}`
    : `${API_BASE}/api/v1/emailers`;

  const response = await fetch(url, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerSummary[]>;
}

export async function getEmailer(id: number): Promise<EmailerRead> {
  const response = await fetch(`${API_BASE}/api/v1/emailers/${id}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerRead>;
}

export async function getLatestVersion(
  emailerId: number
): Promise<EmailerVersionRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/versions/latest`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerVersionRead>;
}

export interface EmailerVersionSummary {
  id: number;
  version_number: number;
  subject_line: string | null;
  created_at: string;
}

export async function listVersions(
  emailerId: number
): Promise<EmailerVersionSummary[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/versions`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerVersionSummary[]>;
}

export async function getVersion(
  emailerId: number,
  versionNumber: number
): Promise<EmailerVersionRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/versions/${versionNumber}`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<EmailerVersionRead>;
}

/**
 * STORY-7.10 / STORY-7.12: backend MJML validation errors.
 *
 * The save endpoint (and the generate / chat endpoints, which run the same
 * sanitizer on LLM output) returns HTTP 422 on validation failure with the
 * shape:
 *
 *     { detail: { detail: "MJML validation failed", errors: [{line, tag, message}, ...] } }
 *
 * (FastAPI wraps ``HTTPException(detail=dict)`` under another ``detail``
 * key — that's why the message is double-nested.)
 *
 * STORY-7.10 originally collapsed this back to a plain `Error(message)`.
 * STORY-7.12's UI surfaces want to optionally render the structured errors
 * (line/tag info), so we now throw a typed ``MJMLValidationError`` that
 * carries the array.
 */
export interface MJMLValidationFieldError {
  line: number;
  tag: string;
  message: string;
}

export class MJMLValidationError extends Error {
  readonly errors: readonly MJMLValidationFieldError[];

  constructor(message: string, errors: readonly MJMLValidationFieldError[]) {
    super(message);
    this.name = "MJMLValidationError";
    this.errors = errors;
    // Restore prototype chain — required when extending built-ins under
    // the ES5 transpile target Vitest uses.
    Object.setPrototypeOf(this, MJMLValidationError.prototype);
  }
}

interface ParsedMJMLValidation {
  message: string;
  errors: MJMLValidationFieldError[];
}

/**
 * Try to extract a structured MJML validation envelope from a response
 * body. Returns ``null`` if the body doesn't match the documented shape
 * (caller should fall back to a plain Error).
 */
function parseMJMLValidationBody(body: string): ParsedMJMLValidation | null {
  if (!body) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("detail" in parsed)) {
    return null;
  }
  // justified: walking an unknown JSON envelope before narrowing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outerDetail = (parsed as any).detail;

  // Nested shape: { detail: { detail: "...", errors: [...] } }
  if (
    outerDetail &&
    typeof outerDetail === "object" &&
    typeof outerDetail.detail === "string"
  ) {
    const rawErrors = Array.isArray(outerDetail.errors)
      ? outerDetail.errors
      : [];
    const errors: MJMLValidationFieldError[] = [];
    for (const e of rawErrors) {
      if (
        e &&
        typeof e === "object" &&
        typeof e.line === "number" &&
        typeof e.tag === "string" &&
        typeof e.message === "string"
      ) {
        errors.push({ line: e.line, tag: e.tag, message: e.message });
      }
    }
    return { message: outerDetail.detail, errors };
  }
  // Plain shape: { detail: "..." } (FastAPI's default for HTTPException(str))
  if (typeof outerDetail === "string") {
    return { message: outerDetail, errors: [] };
  }
  return null;
}

/**
 * Throw the right error for a non-ok response. On HTTP 422 with the
 * documented MJML envelope, throws ``MJMLValidationError``; otherwise a
 * plain ``Error`` with the body or status text.
 */
async function throwApiError(response: Response): Promise<never> {
  const body = await response.text();
  if (response.status === 422) {
    const parsed = parseMJMLValidationBody(body);
    if (parsed) {
      throw new MJMLValidationError(parsed.message, parsed.errors);
    }
  }
  throw new Error(
    body || `Request failed: ${response.status} ${response.statusText}`
  );
}

export async function saveVersion(
  emailerId: number,
  mjmlSource: string
): Promise<EmailerVersionRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/versions`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ mjml_source: mjmlSource }),
    }
  );

  if (!response.ok) {
    await throwApiError(response);
  }

  return response.json() as Promise<EmailerVersionRead>;
}

// ---------------------------------------------------------------------------
// Chat / Refine types (STORY-4.3)
// ---------------------------------------------------------------------------

export interface ChatMessageRead {
  id: number;
  emailer_id: number;
  // "suggestion" is written by the public reviewer flow (STORY-4.5).
  role: "user" | "assistant" | "suggestion";
  content: string;
  created_at: string;
}

export interface RefineResponse {
  message: ChatMessageRead;
  version: EmailerVersionRead;
  summary: string;
  warnings: string[];
}

export async function listChatMessages(
  emailerId: number
): Promise<ChatMessageRead[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/chat`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<ChatMessageRead[]>;
}

export async function sendChatMessage(
  emailerId: number,
  content: string
): Promise<RefineResponse> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/chat`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    }
  );

  if (!response.ok) {
    // STORY-7.12: refiner 422 (LLM contract retry exhausted) is surfaced
    // as MJMLValidationError so ChatPanel can mark the user message as
    // failed without having to grep error.message for the magic string.
    await throwApiError(response);
  }

  return response.json() as Promise<RefineResponse>;
}

// ---------------------------------------------------------------------------
// Export HTML (STORY-5.1)
// ---------------------------------------------------------------------------

export function getExportUrl(emailerId: number): string {
  return `${API_BASE}/api/v1/emailers/${emailerId}/export`;
}

export async function exportHtml(emailerId: number): Promise<void> {
  const url = getExportUrl(emailerId);
  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Export failed: ${response.status} ${response.statusText}`
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] ?? "export.html";

  // Create a temporary download link and trigger it
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

export async function generateEmailer(
  emailerId: number
): Promise<GenerateResponse> {
  const response = await fetch(`${API_BASE}/api/v1/emailers/${emailerId}/generate`, {
    method: "POST",
    headers: authHeaders(),
  });

  if (!response.ok) {
    // STORY-7.12: generator 422 (LLM contract retry exhausted) becomes a
    // typed MJMLValidationError so BriefPage can render the dedicated
    // "Generation produced invalid output" surface with a Retry button.
    await throwApiError(response);
  }

  return response.json() as Promise<GenerateResponse>;
}
