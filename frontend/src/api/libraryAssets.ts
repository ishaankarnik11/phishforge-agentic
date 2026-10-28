/**
 * API client for the Asset Library (STORY-A1.1).
 *
 * Mirrors the patterns in ``emailers.ts`` — auth token from
 * localStorage, ``API_BASE`` for deploy-agnostic URLs, typed
 * response shapes matching the backend Pydantic schemas.
 */

import { API_BASE } from "./baseUrl";

// ---------------------------------------------------------------------------
// Types — mirror backend schemas in app.schemas.library_asset
// ---------------------------------------------------------------------------

export interface LibraryAssetVersionRead {
  id: string;
  version_number: number;
  thumbnail_url: string | null;
  storage_url: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  prompt_text: string | null;
  refinement_instruction: string | null;
  model_used: string | null;
  cost_usd: number | null;
  created_at: string;
}

export interface LibraryAssetRead {
  id: string;
  name: string;
  source: "generated" | "uploaded";
  tags: string[];
  created_by_name: string | null;
  primary_version: LibraryAssetVersionRead | null;
  created_at: string;
}

export interface LibraryAssetListResponse {
  items: LibraryAssetRead[];
  total: number;
}

export interface LibraryAssetDetailRead extends LibraryAssetRead {
  versions: LibraryAssetVersionRead[];
}

// ---------------------------------------------------------------------------
// Generate asset request/response types
// ---------------------------------------------------------------------------

export interface GenerateAssetStylePresets {
  visual_style: string | null;
  mood: string | null;
  texture: string | null;
  layout: string | null;
}

export interface GenerateAssetRequest {
  name: string;
  prompt: string;
  style_presets: GenerateAssetStylePresets;
  width: number;
  height: number;
  quality: "high" | "medium" | "low";
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Query parameter types
// ---------------------------------------------------------------------------

export interface FetchLibraryAssetsParams {
  search?: string;
  source?: "generated" | "uploaded";
  tag?: string;
  sort?: "newest" | "oldest" | "name";
  offset?: number;
  limit?: number;
}

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

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Fetch a paginated, filtered, sorted list of library assets.
 *
 * Maps to ``GET /api/v1/library-assets``.
 */
export async function fetchLibraryAssets(
  params: FetchLibraryAssetsParams = {}
): Promise<LibraryAssetListResponse> {
  const qs = new URLSearchParams();

  if (params.search) qs.set("search", params.search);
  if (params.source) qs.set("source", params.source);
  if (params.tag) qs.set("tag", params.tag);
  if (params.sort) qs.set("sort", params.sort);
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));

  const query = qs.toString();
  const url = query
    ? `${API_BASE}/api/v1/library-assets?${query}`
    : `${API_BASE}/api/v1/library-assets`;

  const response = await fetch(url, { headers: authHeaders() });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<LibraryAssetListResponse>;
}

/**
 * Fetch a single library asset with all versions.
 *
 * Maps to ``GET /api/v1/library-assets/{id}``.
 */
export async function fetchLibraryAsset(
  id: string
): Promise<LibraryAssetDetailRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}`,
    { headers: authHeaders() }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Upload an image file as a new library asset.
 *
 * Maps to ``POST /api/v1/library-assets/upload`` (multipart/form-data).
 * Returns the created asset detail on success (201).
 * Throws on validation (422 -- invalid MIME, too large, missing name) or auth (401).
 */
export async function uploadLibraryAsset(
  file: File,
  name: string,
  tags?: string[],
): Promise<LibraryAssetDetailRead> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  if (tags && tags.length > 0) {
    formData.append("tags", tags.join(","));
  }

  // Auth header only -- do NOT set Content-Type; the browser sets it
  // with the multipart boundary automatically.
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/api/v1/library-assets/upload`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Upload failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Soft-delete a library asset.
 *
 * Maps to ``DELETE /api/v1/library-assets/{id}``.
 * Returns nothing on success (204). Throws on 404 (not found) or auth (401).
 */
export async function deleteLibraryAsset(id: string): Promise<void> {
  const token = localStorage.getItem("access_token");
  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Delete failed: ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Tag management functions (STORY-A1.3)
// ---------------------------------------------------------------------------

/**
 * Fetch all distinct tags across library assets, sorted alphabetically.
 *
 * Maps to ``GET /api/v1/library-assets/tags``.
 */
export async function fetchTags(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/api/v1/library-assets/tags`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<string[]>;
}

/**
 * Update a library asset's name and/or tags.
 *
 * Maps to ``PATCH /api/v1/library-assets/{id}``.
 */
export interface UpdateLibraryAssetBody {
  name?: string;
  tags?: string[];
}

export async function updateLibraryAsset(
  id: string,
  body: UpdateLibraryAssetBody
): Promise<LibraryAssetDetailRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
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

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Bulk add or remove tags from multiple assets.
 *
 * Maps to ``POST /api/v1/library-assets/bulk-tag``.
 */
export interface BulkTagRequest {
  asset_ids: string[];
  action: "add" | "remove";
  tags: string[];
}

export interface BulkTagResponse {
  updated: number;
}

export async function bulkTagAssets(
  request: BulkTagRequest
): Promise<BulkTagResponse> {
  const response = await fetch(`${API_BASE}/api/v1/library-assets/bulk-tag`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      text || `Request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<BulkTagResponse>;
}

// ---------------------------------------------------------------------------
// Asset generation
// ---------------------------------------------------------------------------

/**
 * Regenerate an asset using the same prompt but a new random seed.
 *
 * Maps to ``POST /api/v1/library-assets/{id}/regenerate``.
 * Returns the updated asset detail with the new version on success (201).
 * Throws on validation (422 -- no prompt on source version) or
 * service unavailable (503).
 */
export async function regenerateAsset(
  id: string,
  fromVersionId?: string,
): Promise<LibraryAssetDetailRead> {
  const body: { from_version_id?: string } = {};
  if (fromVersionId) {
    body.from_version_id = fromVersionId;
  }

  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}/regenerate`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Regeneration failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Refine an existing generated asset with a new instruction.
 *
 * Maps to ``POST /api/v1/library-assets/{id}/refine``.
 * Sends the instruction (and optionally a source version) to produce
 * a new version of the asset using OpenAI's image edit endpoint.
 * Returns the updated asset detail with the new version on success (201).
 * Throws on validation (422 -- instruction too short, max versions, no prompt)
 * or service unavailable (503).
 */
export async function refineAsset(
  id: string,
  instruction: string,
  fromVersionId?: string,
): Promise<LibraryAssetDetailRead> {
  const body: { instruction: string; from_version_id?: string } = {
    instruction,
  };
  if (fromVersionId) {
    body.from_version_id = fromVersionId;
  }

  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}/refine`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Refinement failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Edit the original prompt and regenerate the asset.
 *
 * Maps to ``POST /api/v1/library-assets/{id}/edit-prompt``.
 * Returns the updated asset detail with a new version on success (201).
 * Throws on validation (422 -- prompt too short/long, no source version)
 * or service unavailable (503).
 */
export async function editPromptAndRegenerate(
  id: string,
  prompt: string,
  fromVersionId?: string,
): Promise<LibraryAssetDetailRead> {
  const body: { prompt: string; from_version_id?: string } = { prompt };
  if (fromVersionId) {
    body.from_version_id = fromVersionId;
  }

  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}/edit-prompt`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Edit prompt failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Set the primary version of a library asset.
 *
 * Maps to ``PATCH /api/v1/library-assets/{id}/primary-version``.
 * Returns the updated asset detail on success.
 * Throws on validation (422 -- version not found) or auth (401).
 */
export async function setPrimaryVersion(
  assetId: string,
  versionId: string,
): Promise<LibraryAssetDetailRead> {
  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(assetId)}/primary-version`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ version_id: versionId }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Set primary version failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Apply a mask-based inpainting edit to a library asset.
 *
 * Maps to ``POST /api/v1/library-assets/{id}/mask-edit`` (multipart/form-data).
 * Sends the mask PNG + instruction to produce a new version of the asset.
 * Returns the updated asset detail with the new version on success (201).
 * Throws on validation (422 -- instruction too short, no primary version)
 * or service unavailable (503).
 */
export async function maskEditAsset(
  id: string,
  mask: Blob,
  instruction: string,
  fromVersionId?: string,
): Promise<LibraryAssetDetailRead> {
  const formData = new FormData();
  formData.append("mask", mask, "mask.png");
  formData.append("instruction", instruction);
  if (fromVersionId) {
    formData.append("from_version_id", fromVersionId);
  }

  // Auth header only -- do NOT set Content-Type; the browser sets it
  // with the multipart boundary automatically.
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/${encodeURIComponent(id)}/mask-edit`,
    {
      method: "POST",
      headers,
      body: formData,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Mask edit failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Generate a new image asset via AI, optionally with reference images.
 *
 * Maps to ``POST /api/v1/library-assets/generate-with-refs`` (multipart/form-data).
 * When reference images are provided they are sent as ``reference_images``
 * form-data fields.  The endpoint accepts up to 16 files (PNG, JPEG, WebP).
 * Returns the created asset detail on success (201).
 * Throws on validation (422), rate limit (429), service unavailable (503),
 * or timeout (504).
 */
export async function generateAssetWithRefs(
  request: GenerateAssetRequest,
  referenceImages: File[],
): Promise<LibraryAssetDetailRead> {
  const formData = new FormData();
  formData.append("name", request.name);
  formData.append("prompt", request.prompt);
  formData.append("width", String(request.width));
  formData.append("height", String(request.height));
  formData.append("quality", request.quality || "high");
  if (request.tags && request.tags.length > 0) {
    formData.append("tags", request.tags.join(","));
  }
  if (request.style_presets?.visual_style) {
    formData.append("style_visual", request.style_presets.visual_style);
  }
  if (request.style_presets?.mood) {
    formData.append("style_mood", request.style_presets.mood);
  }
  if (request.style_presets?.texture) {
    formData.append("style_texture", request.style_presets.texture);
  }
  if (request.style_presets?.layout) {
    formData.append("style_layout", request.style_presets.layout);
  }
  for (const file of referenceImages) {
    formData.append("reference_images", file);
  }

  // Auth header only -- do NOT set Content-Type; the browser sets it
  // with the multipart boundary automatically.
  const token = localStorage.getItem("access_token");
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const t0 = performance.now();
  console.log("[GENERATE-WITH-REFS] fetch started at", new Date().toISOString());
  const response = await fetch(
    `${API_BASE}/api/v1/library-assets/generate-with-refs`,
    {
      method: "POST",
      headers,
      body: formData,
    },
  );
  console.log(
    "[GENERATE-WITH-REFS] fetch completed in",
    Math.round(performance.now() - t0),
    "ms, status:",
    response.status,
  );

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Request failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}

/**
 * Generate a new image asset via AI.
 *
 * Maps to ``POST /api/v1/library-assets/generate``.
 * Returns the created asset detail on success (201).
 * Throws on validation (422), rate limit (429), service unavailable (503),
 * or timeout (504).
 */
export async function generateAsset(
  request: GenerateAssetRequest
): Promise<LibraryAssetDetailRead> {
  const t0 = performance.now();
  console.log("[GENERATE] fetch started at", new Date().toISOString());
  const response = await fetch(`${API_BASE}/api/v1/library-assets/generate`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(request),
  });
  console.log("[GENERATE] fetch completed in", Math.round(performance.now() - t0), "ms, status:", response.status);

  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { detail?: string };
      message = parsed.detail ?? text;
    } catch {
      message =
        text || `Request failed: ${response.status} ${response.statusText}`;
    }
    throw new Error(message);
  }

  return response.json() as Promise<LibraryAssetDetailRead>;
}
