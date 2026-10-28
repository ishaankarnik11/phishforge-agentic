// API client for preview-link endpoints (STORY-4.5).
//
// Two surfaces:
//   - Owner-facing (Bearer auth, uses the same pattern as emailers.ts)
//   - Public reviewer-facing (NO auth -- we MUST NOT attach the owner's
//     JWT when a reviewer opens the shared URL, otherwise an incognito
//     tab with a stale token in localStorage could leak it to an
//     untrusted browser tab).

import { API_BASE } from "./baseUrl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewLinkRead {
  token: string;
  url: string;
  emailer_id: number;
  version_id: number | null;
  expires_at: string;
  created_at: string;
}

export interface PreviewLinkCreateBody {
  expires_in_days?: number;
  version_id?: number | null;
}

/**
 * The impersonated identity echoed back on the public preview payload
 * (STORY-AP1.2). All fields nullable — a preview may have been generated
 * before the identity was fully filled.
 */
export interface PublicPreviewIdentity {
  name: string | null;
  primary_color: string | null;
  logo_url: string | null;
}

export interface PublicPreviewPayload {
  emailer_name: string;
  identity: PublicPreviewIdentity | null;
  version_id: number;
  version_number: number;
  subject_line: string | null;
  preheader: string | null;
  compiled_html: string | null;
  expires_at: string;
}

export interface SuggestionCreateBody {
  text: string;
  reviewer_name?: string;
}

export interface SuggestionRead {
  id: number;
  emailer_id: number;
  version_id: number | null;
  role: string;
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Owner-side helpers (Bearer auth)
// ---------------------------------------------------------------------------

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

export async function createPreviewLink(
  emailerId: number,
  body: PreviewLinkCreateBody = {}
): Promise<PreviewLinkRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/preview-links`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<PreviewLinkRead>;
}

export async function listPreviewLinks(
  emailerId: number
): Promise<PreviewLinkRead[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/preview-links`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<PreviewLinkRead[]>;
}

export async function revokePreviewLink(
  emailerId: number,
  token: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/preview-links/${encodeURIComponent(token)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public helpers (NO auth!)
// ---------------------------------------------------------------------------

// A sentinel thrown when the public endpoint returns 404 so the UI can
// show "invalid or expired" without inspecting HTTP status codes.
export class PreviewNotFoundError extends Error {
  constructor(message = "Preview link not found") {
    super(message);
    this.name = "PreviewNotFoundError";
  }
}

export async function getPublicPreview(
  token: string
): Promise<PublicPreviewPayload> {
  // Intentionally no Authorization header. We use a fresh fetch here
  // instead of reusing authHeaders() so stale localStorage tokens never
  // bleed into public calls.
  const response = await fetch(
    `${API_BASE}/api/v1/public/preview/${encodeURIComponent(token)}`,
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  if (response.status === 404) {
    throw new PreviewNotFoundError();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<PublicPreviewPayload>;
}

export async function submitPublicSuggestion(
  token: string,
  body: SuggestionCreateBody
): Promise<SuggestionRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/public/preview/${encodeURIComponent(token)}/suggest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (response.status === 404) {
    throw new PreviewNotFoundError();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<SuggestionRead>;
}
