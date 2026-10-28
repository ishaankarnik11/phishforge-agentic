// API client for asset endpoints (STORY-2.2 backend, STORY-2.6 frontend).
//
// All endpoints require Bearer auth and live under
// /api/v1/emailers/{emailer_id}/assets.
//
// We use XMLHttpRequest for the upload path so we can surface progress
// percentages to the UI; the other helpers stick with fetch().

import { API_BASE } from "./baseUrl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminates what an asset is for (STORY-AP2.3):
 *   - "content": in-email image (logo, hero, product photo). The default.
 *   - "sample":  a screenshot of the genuine email being simulated, uploaded
 *                as a style reference only (never embedded in the output).
 */
export type AssetKind = "content" | "sample";

export interface AssetRead {
  id: string;
  emailer_id: number;
  filename: string;
  label: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  uploaded_at: string;
  // STORY-AP2.3: backend gained a ``kind`` discriminator. Defaults to
  // "content" server-side, so it is always present on reads.
  kind: AssetKind;
}

// ---------------------------------------------------------------------------
// Constants — must match backend (app/schemas/asset.py).
// ---------------------------------------------------------------------------

export const MAX_ASSETS_PER_EMAILER = 10;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ---------------------------------------------------------------------------
// Helpers
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

function bearer(): string | null {
  const token = localStorage.getItem("access_token");
  return token ? `Bearer ${token}` : null;
}

// ---------------------------------------------------------------------------
// uploadAsset (XHR for progress)
// ---------------------------------------------------------------------------

export interface UploadAssetOptions {
  /** 0-100 progress callback. Called repeatedly as bytes are sent. */
  onProgress?: (percent: number) => void;
  /** Optional human-readable label. Backend defaults to filename. */
  label?: string;
  /**
   * STORY-AP2.3: what the asset is for. "content" (default) is an in-email
   * image; "sample" is a style-reference screenshot of the real email being
   * simulated. Sent as a multipart ``kind`` field.
   */
  kind?: AssetKind;
  /** Optional AbortSignal to cancel the upload. */
  signal?: AbortSignal;
}

/**
 * Upload a single image to an emailer's asset bucket.
 *
 * Returns the persisted ``AssetRead`` on success. Throws an Error with
 * the server's response body (or a status-code message) on failure.
 */
export function uploadAsset(
  emailerId: number,
  file: File,
  options: UploadAssetOptions = {}
): Promise<AssetRead> {
  return new Promise<AssetRead>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${API_BASE}/api/v1/emailers/${emailerId}/assets`;

    const formData = new FormData();
    formData.append("file", file);
    if (options.label !== undefined && options.label !== "") {
      formData.append("label", options.label);
    }
    // STORY-AP2.3: only send ``kind`` when it diverges from the backend
    // default ("content") to keep the existing content-upload calls byte-
    // identical and avoid surprising the backend before its field lands.
    if (options.kind !== undefined && options.kind !== "content") {
      formData.append("kind", options.kind);
    }

    xhr.open("POST", url);

    const auth = bearer();
    if (auth) {
      xhr.setRequestHeader("Authorization", auth);
    }
    // Note: deliberately do NOT set Content-Type; the browser will set
    // multipart/form-data with the correct boundary.

    if (options.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && options.onProgress) {
          const pct = Math.round((event.loaded / event.total) * 100);
          options.onProgress(pct);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as AssetRead;
          resolve(data);
        } catch {
          reject(new Error("Invalid JSON response from server"));
        }
      } else {
        const text = xhr.responseText || "";
        // FastAPI returns {"detail": "..."} for 4xx; surface that string.
        let detail = text;
        try {
          const parsed = JSON.parse(text) as { detail?: unknown };
          if (parsed && typeof parsed.detail === "string") {
            detail = parsed.detail;
          }
        } catch {
          // not JSON, use raw text
        }
        reject(
          new Error(
            detail || `Upload failed: ${xhr.status} ${xhr.statusText}`
          )
        );
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload"));
    };

    xhr.onabort = () => {
      reject(new DOMException("Upload aborted", "AbortError"));
    };

    if (options.signal) {
      const signal = options.signal;
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

// ---------------------------------------------------------------------------
// listAssets / updateAsset / deleteAsset (fetch-based)
// ---------------------------------------------------------------------------

export async function listAssets(emailerId: number): Promise<AssetRead[]> {
  const response = await fetch(`${API_BASE}/api/v1/emailers/${emailerId}/assets`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<AssetRead[]>;
}

export async function updateAsset(
  emailerId: number,
  assetId: string,
  label: string
): Promise<AssetRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/assets/${assetId}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ label }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<AssetRead>;
}

export async function deleteAsset(
  emailerId: number,
  assetId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/api/v1/emailers/${emailerId}/assets/${assetId}`,
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
// Validation helpers
// ---------------------------------------------------------------------------

export interface ValidationError {
  filename: string;
  reason: string;
}

/**
 * Run client-side validation for a batch of files.
 *
 * Returns a tuple ``[accepted, rejected]`` so the caller can upload the
 * accepted batch while reporting rejected files inline. ``existingCount``
 * is the number of assets already attached to this emailer; the function
 * uses it to enforce the per-emailer cap.
 */
export function validateFiles(
  files: File[],
  existingCount: number
): [File[], ValidationError[]] {
  const accepted: File[] = [];
  const rejected: ValidationError[] = [];

  let runningCount = existingCount;

  for (const file of files) {
    const filename = file.name;

    if (runningCount >= MAX_ASSETS_PER_EMAILER) {
      rejected.push({
        filename,
        reason: `over the ${MAX_ASSETS_PER_EMAILER}-asset limit`,
      });
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push({
        filename,
        reason: "exceeds 5 MB",
      });
      continue;
    }

    const mime = file.type;
    if (!ALLOWED_MIME_TYPES.includes(mime as AllowedMimeType)) {
      rejected.push({
        filename,
        reason: `unsupported format (${mime || "unknown"})`,
      });
      continue;
    }

    accepted.push(file);
    runningCount += 1;
  }

  return [accepted, rejected];
}
