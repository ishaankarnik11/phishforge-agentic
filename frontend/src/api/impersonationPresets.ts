/**
 * Impersonation preset API client (STORY-AP1.2).
 *
 * Replaces the former brand-kit client. An "impersonation preset" is a
 * reusable identity (brand/sender + colour + logo) that the phishing
 * simulation lure imitates. Two surfaces:
 *   * Read-only list + detail consumed by the brief form's "Load
 *     impersonation preset" dropdown.
 *   * Admin CRUD + logo upload backing the "Manage impersonation presets"
 *     pages.
 *
 * There is also a copy-into-template endpoint that materialises a preset's
 * logo as an emailer asset so the brief can reference it via
 * ``impersonation_logo_asset_id``.
 */

import { API_BASE } from "./baseUrl";
import type { AssetRead } from "./assets";

// ---------------------------------------------------------------------------
// Types — mirror the backend contract exactly.
// ---------------------------------------------------------------------------

/** Lightweight shape returned by the list endpoint (dropdown). */
export interface ImpersonationPresetSummary {
  // Preset PKs are string slugs (e.g. "microsoft-365"), not numbers.
  id: string;
  name: string;
  primary_color: string | null;
}

/** Full preset payload returned by the detail + mutation endpoints. */
export interface ImpersonationPresetDetail {
  // Preset PKs are string slugs (e.g. "microsoft-365"), not numbers.
  id: string;
  name: string;
  sender_email: string;
  primary_color: string | null;
  pretends_to_be: string;
  logo_url: string | null;
}

/** POST body for create. */
export interface ImpersonationPresetCreate {
  name: string;
  sender_email: string;
  primary_color: string | null;
  pretends_to_be: string;
}

/** PATCH body — every field optional. */
export type ImpersonationPresetUpdate = Partial<ImpersonationPresetCreate>;

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

/** Thrown when the backend returns 404 (preset no longer exists). */
export class ImpersonationPresetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImpersonationPresetNotFoundError";
    // Restore prototype chain — required when extending built-ins under
    // the ES5 transpile target Vitest uses.
    Object.setPrototypeOf(this, ImpersonationPresetNotFoundError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = `${API_BASE}/api/v1/impersonation-presets`;

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

function bearerHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    if (!body) return `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object") {
        // justified: walking an unknown FastAPI envelope before narrowing
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = (parsed as any).detail;
        if (typeof detail === "string") return detail;
      }
    } catch {
      // not JSON — fall through and use the raw body
    }
    return body;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function throwPresetError(response: Response): Promise<never> {
  const message = await readErrorMessage(response);
  if (response.status === 404) {
    throw new ImpersonationPresetNotFoundError(message);
  }
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

export async function listPresets(): Promise<ImpersonationPresetSummary[]> {
  const response = await fetch(BASE, { headers: authHeaders() });
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<ImpersonationPresetSummary[]>;
}

export async function getPresetDetail(
  id: string
): Promise<ImpersonationPresetDetail> {
  const response = await fetch(`${BASE}/${id}`, { headers: authHeaders() });
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<ImpersonationPresetDetail>;
}

// ---------------------------------------------------------------------------
// Admin mutation endpoints
// ---------------------------------------------------------------------------

export async function createPreset(
  body: ImpersonationPresetCreate
): Promise<ImpersonationPresetDetail> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<ImpersonationPresetDetail>;
}

export async function updatePreset(
  id: string,
  body: ImpersonationPresetUpdate
): Promise<ImpersonationPresetDetail> {
  const response = await fetch(`${BASE}/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<ImpersonationPresetDetail>;
}

export async function removePreset(id: string): Promise<void> {
  const response = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    await throwPresetError(response);
  }
  // 204 — no body to parse.
}

/**
 * Upload (or replace) a preset's logo. Multipart ``file`` field; the
 * browser sets the multipart boundary so we must NOT set Content-Type.
 */
export async function uploadPresetLogo(
  id: string,
  file: File
): Promise<ImpersonationPresetDetail> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${BASE}/${id}/logo`, {
    method: "POST",
    headers: bearerHeaders(),
    body: formData,
  });
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<ImpersonationPresetDetail>;
}

// ---------------------------------------------------------------------------
// Copy-into-template
// ---------------------------------------------------------------------------

/**
 * Materialise a preset's logo as an asset on the given emailer. The
 * returned ``AssetRead.id`` is what the brief stores as
 * ``impersonation_logo_asset_id``; ``AssetRead.url`` drives the preview.
 */
export async function copyLogoToEmailer(
  emailerId: number,
  presetId: string
): Promise<AssetRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/impersonation-logo/from-preset`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ preset_id: presetId }),
    }
  );
  if (!response.ok) {
    await throwPresetError(response);
  }
  return response.json() as Promise<AssetRead>;
}
