// Asset upload panel (STORY-2.6).
//
// Renders on the Brief form between "Content summary" and the CTA fields.
// Owns its own queue + per-file progress state. The parent passes:
//   - emailerId: the draft emailer id (or null if not created yet)
//   - onEnsureEmailer: lazy creator that returns an id; called the first
//     time we have at least one accepted file
//   - onUploadingChange: notifies the parent so it can disable Create
//     while any upload is in flight (AC-7)
//
// We intentionally keep the component self-contained: it lists assets,
// handles upload progress, label edits, and deletions without leaking
// any of that state up the tree.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ALLOWED_MIME_TYPES,
  MAX_ASSETS_PER_EMAILER,
  MAX_FILE_SIZE_BYTES,
  deleteAsset,
  listAssets,
  updateAsset,
  uploadAsset,
  validateFiles,
  type AssetKind,
  type AssetRead,
  type ValidationError,
} from "../api/assets";
import type { LibraryAssetRead } from "../api/libraryAssets";
import AssetPickerModal from "./AssetPickerModal";
import { Button } from "./ds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingUpload {
  // Local-only id so React keys are stable across re-renders.
  tempId: string;
  file: File;
  // Object URL for thumbnail preview; revoked on completion or removal.
  previewUrl: string;
  progress: number;
  error: string | null;
}

interface AssetUploadPanelProps {
  /**
   * The id of the (possibly draft) emailer this panel uploads to. May be
   * ``null`` if the emailer has not been created yet -- when that's the
   * case the panel calls ``onEnsureEmailer`` the first time it has files
   * to upload, then drives subsequent uploads against the returned id.
   */
  emailerId: number | null;
  /**
   * Lazy emailer creator. Called once when the user drops the first file
   * before any emailer exists. Must return the new emailer id (the same
   * one that subsequent calls to onEmailerIdChange will reflect, but the
   * panel uses the returned value directly so it doesn't have to wait
   * for a re-render).
   */
  onEnsureEmailer: () => Promise<number>;
  /**
   * Notifies the parent whenever a new id is acquired so the parent's
   * form-state can persist it (e.g. for the eventual generate call).
   */
  onEmailerIdChange?: (id: number) => void;
  /**
   * Notifies the parent whenever the in-flight upload set changes from
   * empty to non-empty or vice versa. Used to disable the Create button
   * (AC-7).
   */
  onUploadingChange?: (uploading: boolean) => void;

  /** Read-only mode disables uploads, edits, and deletes. */
  readOnly?: boolean;

  /** Library assets attached via the asset picker modal. */
  libraryAssets?: LibraryAssetRead[];
  /** Called when the user adds or removes library assets. */
  onLibraryAssetsChange?: (assets: LibraryAssetRead[]) => void;

  // -------------------------------------------------------------------------
  // STORY-AP2.3: reuse this panel for "Sample emails to mimic". The defaults
  // below preserve the inherited in-email "Assets (optional)" behaviour, so
  // existing callers are unchanged. The samples instance overrides them.
  // -------------------------------------------------------------------------

  /**
   * What the uploaded assets are for. Sent to the backend as the multipart
   * ``kind`` field on every upload. Defaults to "content" (in-email images).
   */
  kind?: AssetKind;
  /** Heading shown above the panel. Defaults to "Assets (optional)". */
  title?: string;
  /** Helper copy under the heading. Defaults to the in-email asset blurb. */
  description?: string;
  /**
   * When false (the samples use case), the "Pick from Library" affordance and
   * the on-device box's "Pick from Library" partner are hidden — samples are
   * always fresh uploads, never library picks. Defaults to true.
   */
  showLibraryPicker?: boolean;
  /**
   * Accessible label for the hidden file input. Must be unique per panel so
   * multiple instances on one page don't collide. Defaults to "Upload assets".
   */
  fileInputLabel?: string;
  /** data-testid for the hidden file input. Defaults to "asset-file-input". */
  fileInputTestId?: string;
  /**
   * Visible label + aria-label on the on-device upload box. Defaults to
   * "Upload from device". Overridden for samples so the two on-page panels
   * don't present identical text.
   */
  uploadBoxLabel?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// We cap parallel uploads at 4 (per technical notes §2). Larger drops queue.
const MAX_CONCURRENT_UPLOADS = 4;

const ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function makeTempId(): string {
  // crypto.randomUUID is available in evergreen browsers + jsdom.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// AssetTile (one rendered asset, uploading or persisted)
// ---------------------------------------------------------------------------

interface AssetTileProps {
  asset: AssetRead;
  onLabelChange: (assetId: string, label: string) => Promise<void>;
  onDelete: (asset: AssetRead) => void;
  readOnly?: boolean;
}

function AssetTile({ asset, onLabelChange, onDelete, readOnly }: AssetTileProps) {
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(asset.label);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the draft in sync if the asset prop's label changes (e.g. after refetch).
  useEffect(() => {
    if (!editing) {
      setDraftLabel(asset.label);
    }
  }, [asset.label, editing]);

  const commit = useCallback(async () => {
    const trimmed = draftLabel.trim();
    if (trimmed === "") {
      setError("Label cannot be empty.");
      return;
    }
    setError(null);
    if (trimmed === asset.label) {
      setEditing(false);
      return;
    }
    try {
      await onLabelChange(asset.id, trimmed);
      setEditing(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [asset.id, asset.label, draftLabel, onLabelChange]);

  const cancel = useCallback(() => {
    setDraftLabel(asset.label);
    setEditing(false);
    setError(null);
  }, [asset.label]);

  return (
    <li
      role="listitem"
      data-testid={`asset-tile-${asset.id}`}
      aria-label={asset.label}
      className="group relative flex flex-col rounded-ds-md border border-border-subtle bg-surface-raised p-2"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-ds-sm bg-surface-sunken">
        <img
          src={asset.url}
          alt={asset.label}
          className="h-full w-full object-contain"
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() => onDelete(asset)}
            aria-label={`Remove ${asset.label}`}
            className="absolute right-1 top-1 rounded-ds-full bg-surface-raised/90 p-1 text-ink-muted opacity-0 shadow-raise transition-opacity hover:bg-danger-subtle hover:text-danger focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-danger group-hover:opacity-100"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="mt-1.5 min-h-[1.5rem]">
        {editing ? (
          <input
            type="text"
            value={draftLabel}
            autoFocus
            aria-label={`Edit label for ${asset.filename}`}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            className="w-full rounded-ds-sm border border-accent bg-surface-raised px-1.5 py-0.5 text-label normal-case tracking-normal text-ink-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          />
        ) : (
          <button
            type="button"
            onClick={() => !readOnly && setEditing(true)}
            disabled={readOnly}
            className="block w-full truncate text-left text-label normal-case tracking-normal text-ink-body hover:text-accent disabled:cursor-default disabled:hover:text-ink-body"
            title={asset.label}
          >
            {asset.label}
            {savedFlash && (
              <span className="ml-1 text-[10px] font-semibold text-success">
                Saved
              </span>
            )}
          </button>
        )}
        {error && (
          <p role="alert" className="mt-0.5 text-[10px] text-danger">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// PendingTile (in-flight or failed upload)
// ---------------------------------------------------------------------------

interface PendingTileProps {
  pending: PendingUpload;
  onRetry: (tempId: string) => void;
  onRemove: (tempId: string) => void;
}

function PendingTile({ pending, onRetry, onRemove }: PendingTileProps) {
  const failed = pending.error !== null;
  return (
    <li
      role="listitem"
      data-testid={`asset-pending-${pending.tempId}`}
      className={`relative flex flex-col rounded-ds-md border bg-surface-raised p-2 ${
        failed ? "border-danger" : "border-border-subtle"
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-ds-sm bg-surface-sunken">
        <img
          src={pending.previewUrl}
          alt={pending.file.name}
          className="h-full w-full object-contain opacity-70"
        />
        {!failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-strong/30 text-label normal-case tracking-normal font-semibold text-on-accent">
            {pending.progress}%
          </div>
        )}
      </div>
      <div className="mt-1.5 min-h-[1.5rem]">
        <p
          className="truncate text-label normal-case tracking-normal text-ink-body"
          title={pending.file.name}
        >
          {pending.file.name}
        </p>
        {failed ? (
          <div className="mt-0.5 space-y-0.5">
            <p role="alert" className="text-[10px] text-danger">
              {pending.error}
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onRetry(pending.tempId)}
                className="rounded-ds-sm bg-accent px-1.5 py-0.5 text-[10px] font-medium text-on-accent hover:bg-accent-hover"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => onRemove(pending.tempId)}
                className="rounded-ds-sm border border-border-default bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-body hover:bg-surface-sunken"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-ink-faint">Uploading...</p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function AssetUploadPanel({
  emailerId,
  onEnsureEmailer,
  onEmailerIdChange,
  onUploadingChange,
  readOnly = false,
  libraryAssets,
  onLibraryAssetsChange,
  kind = "content",
  title,
  description,
  showLibraryPicker = true,
  fileInputLabel = "Upload assets",
  fileInputTestId = "asset-file-input",
  uploadBoxLabel = "Upload from device",
}: AssetUploadPanelProps) {
  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------

  const [assets, setAssets] = useState<AssetRead[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [rejections, setRejections] = useState<ValidationError[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AssetRead | null>(null);
  // Non-blocking toast that auto-dismisses (after a delete that may have
  // affected a generated version).
  const [toast, setToast] = useState<string | null>(null);

  // STORY-A5.1: picker modal state
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // We need a ref for the in-flight count because the upload loop runs
  // outside React state updates (parallel async tasks). The ref is the
  // source of truth; we mirror it into state for the disabled flag.
  const inFlightRef = useRef(0);
  const [inFlight, setInFlight] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // The id the panel actually uses for uploads. May lead the parent's
  // emailerId by one render after the lazy create resolves.
  const liveEmailerIdRef = useRef<number | null>(emailerId);
  useEffect(() => {
    liveEmailerIdRef.current = emailerId;
  }, [emailerId]);

  // ------------------------------------------------------------
  // Initial fetch when an emailerId becomes available
  // ------------------------------------------------------------

  useEffect(() => {
    if (emailerId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listAssets(emailerId);
        // STORY-AP2.3: keep each panel scoped to its own kind so the in-email
        // assets panel and the samples panel don't show each other's uploads.
        const scoped = list.filter((a) => a.kind === kind);
        if (!cancelled) setAssets(scoped);
      } catch {
        // Non-fatal: the panel is still usable; uploads will fail
        // visibly if the id is bogus.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [emailerId, kind]);

  // ------------------------------------------------------------
  // Notify parent when in-flight transitions
  // ------------------------------------------------------------

  useEffect(() => {
    onUploadingChange?.(inFlight > 0);
  }, [inFlight, onUploadingChange]);

  // ------------------------------------------------------------
  // Cleanup object URLs on unmount
  // ------------------------------------------------------------

  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------
  // Upload pipeline
  // ------------------------------------------------------------

  const updatePending = useCallback(
    (tempId: string, patch: Partial<PendingUpload>) => {
      setPending((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, ...patch } : p))
      );
    },
    []
  );

  const removePending = useCallback((tempId: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.tempId === tempId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.tempId !== tempId);
    });
  }, []);

  const startSingleUpload = useCallback(
    async (tempId: string, file: File, label: string, targetEmailerId: number) => {
      inFlightRef.current += 1;
      setInFlight(inFlightRef.current);
      try {
        const created = await uploadAsset(targetEmailerId, file, {
          label,
          kind,
          onProgress: (pct) => updatePending(tempId, { progress: pct }),
        });
        // Move from pending to assets.
        setAssets((prev) => [...prev, created]);
        removePending(tempId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed";
        updatePending(tempId, { error: message, progress: 0 });
      } finally {
        inFlightRef.current -= 1;
        setInFlight(inFlightRef.current);
      }
    },
    [kind, removePending, updatePending]
  );

  /**
   * Dispatch up to MAX_CONCURRENT_UPLOADS uploads from a fresh batch of
   * pending items. The simplest "queue" we can get away with: each
   * callback is fire-and-forget and resolves independently. If the total
   * batch is larger than the cap, the excess starts as soon as one of
   * the in-flight calls completes via the runner's recursive nudge.
   */
  const dispatchUploads = useCallback(
    (batch: PendingUpload[], targetEmailerId: number) => {
      const queue = [...batch];

      const drainOne = async () => {
        const next = queue.shift();
        if (!next) return;
        const label = stripExtension(next.file.name);
        await startSingleUpload(next.tempId, next.file, label, targetEmailerId);
        // After a slot frees, immediately start another from the queue.
        await drainOne();
      };

      const concurrency = Math.min(MAX_CONCURRENT_UPLOADS, queue.length);
      for (let i = 0; i < concurrency; i += 1) {
        void drainOne();
      }
    },
    [startSingleUpload]
  );

  /**
   * Public entry point: validates the dropped/selected files, ensures an
   * emailer exists (creating a draft if needed), and kicks off uploads.
   */
  const handleFiles = useCallback(
    async (filesIn: FileList | File[]) => {
      if (readOnly) return;
      const files = Array.from(filesIn);
      if (files.length === 0) return;

      // Reset previous rejections so the user sees only the latest batch's.
      const existingCount = assets.length + pending.filter((p) => !p.error).length;
      const [accepted, rejected] = validateFiles(files, existingCount);
      setRejections(rejected);

      if (accepted.length === 0) return;

      // Ensure an emailer exists before we start uploads.
      let targetId = liveEmailerIdRef.current;
      if (targetId === null) {
        try {
          targetId = await onEnsureEmailer();
          liveEmailerIdRef.current = targetId;
          onEmailerIdChange?.(targetId);
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Could not save the brief before uploading.";
          setRejections((prev) => [
            ...prev,
            ...accepted.map((f) => ({ filename: f.name, reason: message })),
          ]);
          return;
        }
      }

      const batch: PendingUpload[] = accepted.map((file) => ({
        tempId: makeTempId(),
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        error: null,
      }));

      setPending((prev) => [...prev, ...batch]);
      dispatchUploads(batch, targetId);
    },
    [
      assets.length,
      dispatchUploads,
      onEmailerIdChange,
      onEnsureEmailer,
      pending,
      readOnly,
    ]
  );

  const handleRetry = useCallback(
    (tempId: string) => {
      const target = pending.find((p) => p.tempId === tempId);
      const liveId = liveEmailerIdRef.current;
      if (!target || liveId === null) return;
      updatePending(tempId, { error: null, progress: 0 });
      const label = stripExtension(target.file.name);
      void startSingleUpload(tempId, target.file, label, liveId);
    },
    [pending, startSingleUpload, updatePending]
  );

  // ------------------------------------------------------------
  // Drop-zone events
  // ------------------------------------------------------------

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    },
    [readOnly]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles, readOnly]
  );

  const openPicker = useCallback(() => {
    if (readOnly) return;
    fileInputRef.current?.click();
  }, [readOnly]);

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) void handleFiles(files);
      // Reset so picking the same file twice still triggers change.
      e.target.value = "";
    },
    [handleFiles]
  );

  // ------------------------------------------------------------
  // Label edit + delete
  // ------------------------------------------------------------

  const handleLabelChange = useCallback(
    async (assetId: string, label: string) => {
      const liveId = liveEmailerIdRef.current;
      if (liveId === null) return;
      const updated = await updateAsset(liveId, assetId, label);
      setAssets((prev) =>
        prev.map((a) => (a.id === assetId ? updated : a))
      );
    },
    []
  );

  const handleConfirmDelete = useCallback(async () => {
    const liveId = liveEmailerIdRef.current;
    if (!confirmDelete || liveId === null) return;
    try {
      await deleteAsset(liveId, confirmDelete.id);
      setAssets((prev) => prev.filter((a) => a.id !== confirmDelete.id));
      setToast(
        "Removed. Re-generate or edit the email to refresh references."
      );
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(
        err instanceof Error ? err.message : "Could not delete asset."
      );
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setConfirmDelete(null);
    }
  }, [confirmDelete]);

  // ------------------------------------------------------------
  // Derived state
  // ------------------------------------------------------------

  const totalCount = assets.length + pending.filter((p) => !p.error).length;
  const isFull = totalCount >= MAX_ASSETS_PER_EMAILER;
  const hasContent = assets.length > 0 || pending.length > 0;
  const hasLibraryAssets = (libraryAssets?.length ?? 0) > 0;

  // STORY-A5.1: set of library asset IDs already attached
  const alreadyAttachedIds = useMemo(() => {
    if (!libraryAssets || libraryAssets.length === 0) return new Set<string>();
    return new Set(libraryAssets.map((a) => a.id));
  }, [libraryAssets]);

  const handlePickerSelect = useCallback(
    (selected: LibraryAssetRead[]) => {
      if (!onLibraryAssetsChange) return;
      const existing = libraryAssets ?? [];
      const existingIds = new Set(existing.map((a) => a.id));
      const newOnes = selected.filter((a) => !existingIds.has(a.id));
      onLibraryAssetsChange([...existing, ...newOnes]);
    },
    [libraryAssets, onLibraryAssetsChange]
  );

  const handleRemoveLibraryAsset = useCallback(
    (id: string) => {
      if (!onLibraryAssetsChange || !libraryAssets) return;
      onLibraryAssetsChange(libraryAssets.filter((a) => a.id !== id));
    },
    [libraryAssets, onLibraryAssetsChange]
  );

  const announce = useMemo(() => {
    if (inFlight === 0 && pending.length === 0) {
      if (assets.length === 0) return "No assets uploaded.";
      return `${assets.length} asset${assets.length === 1 ? "" : "s"} uploaded.`;
    }
    return `Uploading ${pending.filter((p) => !p.error).length} file${
      pending.filter((p) => !p.error).length === 1 ? "" : "s"
    }.`;
  }, [assets.length, inFlight, pending]);

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------

  return (
    <div className="space-y-4 rounded-ds-md border border-border-subtle bg-surface-raised p-lg">
      <div>
        {title ? (
          <h2 className="text-caption text-ink-muted">{title}</h2>
        ) : (
          <h2 className="text-caption text-ink-muted">
            Assets{" "}
            <span className="font-normal lowercase tracking-normal text-ink-faint">
              (optional)
            </span>
          </h2>
        )}
        <p className="mt-1 text-caption font-normal normal-case tracking-normal text-ink-muted">
          {description ?? (
            <>
              Upload logos, hero images, or product photos. Up to{" "}
              {MAX_ASSETS_PER_EMAILER} files,{" "}
              {Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)} MB each. PNG, JPG,
              GIF, SVG.
            </>
          )}
        </p>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        onChange={onPickerChange}
        className="sr-only"
        aria-label={fileInputLabel}
        data-testid={fileInputTestId}
      />

      {/* Live region for screen readers (AC-9). We deliberately use
          aria-live without role="status" so the queryByRole("status")
          spinner-detection assertions in other tests don't pick this up. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="asset-live-region"
      >
        {announce}
      </div>

      {/* Action boxes: Upload from device + Pick from Library (STORY-A5.1).
          STORY-AP2.3: the samples instance hides the library picker, so the
          upload box spans the full width on its own. */}
      {!isFull && (
        <div className={showLibraryPicker ? "grid grid-cols-2 gap-3" : ""}>
          {/* Left: Upload from device */}
          <div
            role="button"
            tabIndex={0}
            aria-label={uploadBoxLabel}
            onClick={openPicker}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPicker();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-ds-md border-2 border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              isDragging
                ? "border-accent bg-accent-subtle"
                : "border-border-default bg-surface-sunken hover:border-accent hover:bg-accent-subtle"
            } ${readOnly ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {/* Folder icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 text-ink-faint"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <p className="text-body font-medium text-ink-body">
              {uploadBoxLabel}
            </p>
            <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
              {totalCount}/{MAX_ASSETS_PER_EMAILER} uploaded
            </p>
          </div>

          {/* Right: Pick from Library */}
          {showLibraryPicker && (
          <button
            type="button"
            onClick={() => !readOnly && setIsPickerOpen(true)}
            disabled={readOnly}
            data-testid="pick-from-library-btn"
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-ds-md border-2 border-dashed border-border-default bg-surface-sunken px-4 py-6 text-center transition-colors hover:border-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              readOnly ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            {/* Palette icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-7 w-7 text-ink-faint"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-body font-medium text-ink-body">
              Pick from Library
            </p>
            <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
              Browse existing assets
            </p>
          </button>
          )}
        </div>
      )}

      {/* Library asset chips (STORY-A5.1) */}
      {showLibraryPicker && hasLibraryAssets && (
        <div className="flex flex-wrap gap-2" data-testid="library-asset-chips">
          {libraryAssets!.map((la) => (
            <span
              key={la.id}
              className="inline-flex items-center gap-1.5 rounded-ds-xs border border-accent-border bg-accent-subtle px-2.5 py-1 text-label normal-case tracking-normal text-accent"
              data-testid={`library-chip-${la.id}`}
            >
              {la.name}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemoveLibraryAsset(la.id)}
                  aria-label={`Remove ${la.name}`}
                  className="ml-0.5 rounded-ds-xs p-0.5 text-accent/70 hover:bg-accent/10 hover:text-accent focus-visible:outline-1 focus-visible:outline-accent"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Rejected files (client-side validation failures) */}
      {rejections.length > 0 && (
        <ul
          role="alert"
          className="space-y-0.5 rounded-ds-sm bg-danger-subtle p-2 text-caption font-normal normal-case tracking-normal text-danger"
        >
          {rejections.map((r, idx) => (
            <li key={`${r.filename}-${idx}`}>
              <span className="font-medium">{r.filename}</span> &middot; {r.reason}
            </li>
          ))}
        </ul>
      )}

      {/* Thumbnail grid */}
      {hasContent && (
        <ul
          role="list"
          aria-label="Uploaded assets"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
        >
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              onLabelChange={handleLabelChange}
              onDelete={(a) => setConfirmDelete(a)}
              readOnly={readOnly}
            />
          ))}
          {pending.map((p) => (
            <PendingTile
              key={p.tempId}
              pending={p}
              onRetry={handleRetry}
              onRemove={removePending}
            />
          ))}
        </ul>
      )}

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/40 p-md"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDelete(null);
          }}
        >
          <div className="w-full max-w-sm overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised shadow-dialog">
            <div className="border-b border-border-subtle px-lg py-md">
              <h3
                id="confirm-delete-title"
                className="text-title text-ink-strong"
              >
                Remove asset?
              </h3>
            </div>
            <div className="px-lg py-md text-body text-ink-body">
              Remove{" "}
              <span className="font-medium text-ink-strong">
                {confirmDelete.label}
              </span>{" "}
              from this emailer?
            </div>
            <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-sunken px-lg py-sm">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => void handleConfirmDelete()}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-md right-md z-50 max-w-sm rounded-ds-md border border-border-subtle bg-surface-raised px-4 py-3 text-body text-ink-strong shadow-overlay"
        >
          {toast}
        </div>
      )}

      {/* STORY-A5.1: Asset Picker Modal */}
      {showLibraryPicker && (
        <AssetPickerModal
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onSelect={handlePickerSelect}
          alreadyAttachedIds={alreadyAttachedIds}
        />
      )}
    </div>
  );
}
