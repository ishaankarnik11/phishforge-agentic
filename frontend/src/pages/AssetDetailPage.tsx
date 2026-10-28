/**
 * AssetDetailPage -- detail view for a single library asset (STORY-A1.5).
 *
 * Two-panel layout:
 * - Left (~55%): full-size image preview (switches when a version is selected)
 * - Right (~45%): scrollable column of info cards (asset info, metadata,
 *   original prompt, version history, refine placeholder, actions)
 *
 * Inline editing for name and tags via PATCH, version switching, download,
 * and delete with confirmation dialog.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibraryAsset,
  updateLibraryAsset,
  deleteLibraryAsset,
  regenerateAsset,
  refineAsset,
  editPromptAndRegenerate,
  setPrimaryVersion,
} from "../api/libraryAssets";
import type {
  LibraryAssetDetailRead,
  LibraryAssetVersionRead,
} from "../api/libraryAssets";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import { Button, Card, Input, Textarea } from "../components/ds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string to "MMM D, YYYY" */
function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format file size in human-readable form */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Derive a display category from the asset's tags */
function deriveCategory(tags: string[]): string | null {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.includes("banner") || lower.includes("banners")) return "Banner";
  if (lower.includes("hero") || lower.includes("heroes")) return "Hero";
  if (lower.includes("icon") || lower.includes("icons")) return "Icon";
  if (lower.includes("background") || lower.includes("backgrounds"))
    return "Background";
  return tags[0] ?? null;
}

// ---------------------------------------------------------------------------
// Section header component
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-caption text-ink-faint">{children}</h3>
  );
}

// ---------------------------------------------------------------------------
// Card wrapper — the design-system Card with a data-testid passthrough. Flat at
// rest per DESIGN.md §5 (border + surface layer, no resting shadow).
// ---------------------------------------------------------------------------

function DetailCard({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} compact>
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div data-testid="detail-skeleton" className="flex gap-6 p-6">
      {/* Left panel skeleton */}
      <div className="flex-[55] min-w-0">
        <div className="aspect-[4/3] w-full animate-pulse rounded-ds-md bg-surface-sunken" />
      </div>
      {/* Right panel skeleton */}
      <div className="flex flex-[45] min-w-0 flex-col gap-4">
        <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-md">
          <div className="mb-3 h-4 w-24 animate-pulse rounded-ds-sm bg-surface-sunken" />
          <div className="mb-2 h-6 w-3/4 animate-pulse rounded-ds-sm bg-surface-sunken" />
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded-ds-sm bg-surface-sunken" />
            <div className="h-6 w-20 animate-pulse rounded-ds-sm bg-surface-sunken" />
          </div>
        </div>
        <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-md">
          <div className="mb-3 h-4 w-20 animate-pulse rounded-ds-sm bg-surface-sunken" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-4 w-full animate-pulse rounded-ds-sm bg-surface-sunken" />
            <div className="h-4 w-full animate-pulse rounded-ds-sm bg-surface-sunken" />
            <div className="h-4 w-full animate-pulse rounded-ds-sm bg-surface-sunken" />
            <div className="h-4 w-full animate-pulse rounded-ds-sm bg-surface-sunken" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // -- Data fetching ---------------------------------------------------------
  const assetQuery = useQuery({
    queryKey: ["library-asset", id],
    queryFn: () => fetchLibraryAsset(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const asset = assetQuery.data;

  // -- Version switching state -----------------------------------------------
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );

  // Resolve which version to display
  const displayedVersion: LibraryAssetVersionRead | null =
    asset
      ? (selectedVersionId
          ? asset.versions.find((v) => v.id === selectedVersionId)
          : asset.primary_version) ?? asset.primary_version
      : null;

  // -- Inline name editing ---------------------------------------------------
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Sync draft when asset loads or changes
  useEffect(() => {
    if (asset && !isEditingName) {
      setDraftName(asset.name);
    }
  }, [asset, isEditingName]);

  // Focus when editing starts
  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  const updateMutation = useMutation({
    mutationFn: ({ assetId, body }: { assetId: string; body: { name?: string; tags?: string[] } }) =>
      updateLibraryAsset(assetId, body),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
    },
  });

  const saveName = useCallback(() => {
    const trimmed = draftName.trim();
    if (!trimmed || !asset || trimmed === asset.name) {
      setIsEditingName(false);
      if (asset) setDraftName(asset.name);
      return;
    }
    updateMutation.mutate(
      { assetId: asset.id, body: { name: trimmed } },
      {
        onSuccess: () => setIsEditingName(false),
      }
    );
  }, [draftName, asset, updateMutation]);

  // -- Tag editing -----------------------------------------------------------
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAddingTag) {
      tagInputRef.current?.focus();
    }
  }, [isAddingTag]);

  const removeTag = useCallback(
    (tagToRemove: string) => {
      if (!asset) return;
      const updatedTags = asset.tags.filter((t) => t !== tagToRemove);
      updateMutation.mutate({
        assetId: asset.id,
        body: { tags: updatedTags },
      });
    },
    [asset, updateMutation]
  );

  const addTag = useCallback(() => {
    const trimmed = newTagInput.trim().toLowerCase();
    if (!trimmed || !asset) {
      setIsAddingTag(false);
      setNewTagInput("");
      return;
    }
    if (asset.tags.includes(trimmed)) {
      setIsAddingTag(false);
      setNewTagInput("");
      return;
    }
    const updatedTags = [...asset.tags, trimmed];
    updateMutation.mutate(
      { assetId: asset.id, body: { tags: updatedTags } },
      {
        onSuccess: () => {
          setIsAddingTag(false);
          setNewTagInput("");
        },
      }
    );
  }, [newTagInput, asset, updateMutation]);

  // -- Delete ----------------------------------------------------------------
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (assetId: string) => deleteLibraryAsset(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      navigate("/assets");
    },
  });

  const handleDeleteConfirm = useCallback(() => {
    if (asset) {
      deleteMutation.mutate(asset.id);
    }
  }, [asset, deleteMutation]);

  const handleDeleteCancel = useCallback(() => {
    if (!deleteMutation.isPending) {
      setShowDeleteDialog(false);
      deleteMutation.reset();
    }
  }, [deleteMutation]);

  // -- Regenerate ------------------------------------------------------------
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const regenerateMutation = useMutation({
    mutationFn: ({ assetId, fromVersionId }: { assetId: string; fromVersionId?: string }) =>
      regenerateAsset(assetId, fromVersionId),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setSelectedVersionId(null);
      setRegenerateError(null);
    },
    onError: (error: Error) => {
      setRegenerateError(error.message);
    },
  });

  const handleRegenerate = useCallback(
    (fromVersionId?: string) => {
      if (!asset || regenerateMutation.isPending) return;
      setRegenerateError(null);
      regenerateMutation.mutate({ assetId: asset.id, fromVersionId });
    },
    [asset, regenerateMutation],
  );

  // -- Refine ----------------------------------------------------------------
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineFromVersionId, setRefineFromVersionId] = useState<
    string | undefined
  >(undefined);
  const [refineError, setRefineError] = useState<string | null>(null);

  const refineMutation = useMutation({
    mutationFn: ({
      assetId,
      instruction,
      fromVersionId,
    }: {
      assetId: string;
      instruction: string;
      fromVersionId?: string;
    }) => refineAsset(assetId, instruction, fromVersionId),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setSelectedVersionId(null);
      setRefineInstruction("");
      setRefineFromVersionId(undefined);
      setRefineError(null);
    },
    onError: (error: Error) => {
      setRefineError(error.message);
    },
  });

  const handleRefine = useCallback(() => {
    if (!asset || refineMutation.isPending || refineInstruction.trim().length < 5) return;
    setRefineError(null);
    refineMutation.mutate({
      assetId: asset.id,
      instruction: refineInstruction.trim(),
      fromVersionId: refineFromVersionId,
    });
  }, [asset, refineInstruction, refineFromVersionId, refineMutation]);

  // -- Edit Prompt & Regenerate (STORY-A3.3) ---------------------------------
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [editPromptError, setEditPromptError] = useState<string | null>(null);

  const editPromptMutation = useMutation({
    mutationFn: ({
      assetId,
      prompt,
      fromVersionId,
    }: {
      assetId: string;
      prompt: string;
      fromVersionId?: string;
    }) => editPromptAndRegenerate(assetId, prompt, fromVersionId),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setSelectedVersionId(null);
      setIsEditingPrompt(false);
      setEditedPrompt("");
      setEditPromptError(null);
    },
    onError: (error: Error) => {
      setEditPromptError(error.message);
    },
  });

  const handleEditPromptSubmit = useCallback(() => {
    if (!asset || editPromptMutation.isPending || editedPrompt.trim().length < 10) return;
    setEditPromptError(null);
    editPromptMutation.mutate({
      assetId: asset.id,
      prompt: editedPrompt.trim(),
      fromVersionId: displayedVersion?.id,
    });
  }, [asset, editedPrompt, displayedVersion, editPromptMutation]);

  const handleEditPromptCancel = useCallback(() => {
    setIsEditingPrompt(false);
    setEditedPrompt("");
    setEditPromptError(null);
  }, []);

  const handleEditPromptOpen = useCallback(() => {
    setIsEditingPrompt(true);
    setEditedPrompt(displayedVersion?.prompt_text ?? "");
    setEditPromptError(null);
  }, [displayedVersion]);

  // -- Set Primary Version (STORY-A3.2) --------------------------------------
  const [setPrimaryError, setSetPrimaryError] = useState<string | null>(null);

  const setPrimaryMutation = useMutation({
    mutationFn: ({
      assetId,
      versionId,
    }: {
      assetId: string;
      versionId: string;
    }) => setPrimaryVersion(assetId, versionId),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setSelectedVersionId(null);
      setSetPrimaryError(null);
    },
    onError: (error: Error) => {
      setSetPrimaryError(error.message);
    },
  });

  const handleSetPrimary = useCallback(
    (versionId: string) => {
      if (!asset) return;
      setSetPrimaryError(null);
      setPrimaryMutation.mutate({ assetId: asset.id, versionId });
    },
    [asset, setPrimaryMutation],
  );

  const handleRefineFromVersion = useCallback(
    (versionId: string) => {
      setRefineFromVersionId(versionId);
      // Scroll the refine card into view if it exists
      const refineCard = document.querySelector(
        '[data-testid="refine-card"]',
      );
      if (refineCard) {
        refineCard.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
    },
    [],
  );

  // -- Download --------------------------------------------------------------
  const handleDownload = useCallback(() => {
    if (!displayedVersion?.storage_url) return;
    const a = document.createElement("a");
    a.href = displayedVersion.storage_url;
    a.download = asset?.name ?? "download";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [displayedVersion, asset]);

  // -- Render ----------------------------------------------------------------
  return (
    // STORY-AP7.1: global wordmark / nav / user menu moved to the app shell
    // (TopBar + SideNav). This page renders directly into the shell's main
    // area; a "Back to Asset Library" link remains below. Full restyle is a
    // later AP7 chunk.
    <div className="min-h-full bg-surface-base">
      {/* Main content */}
      <main className="mx-auto max-w-[1280px] px-6 pb-12 pt-lg">
        {/* Back link */}
        <Link
          to="/assets"
          data-testid="back-link"
          className="mb-6 inline-flex items-center gap-1 text-label text-accent hover:underline"
        >
          &larr; Back to Asset Library
        </Link>

        {/* Loading state */}
        {assetQuery.isLoading && <DetailSkeleton />}

        {/* Error state */}
        {assetQuery.isError && (
          <div
            role="alert"
            data-testid="error-state"
            className="rounded-ds-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body text-danger"
          >
            <strong className="font-medium">Error:</strong>{" "}
            {assetQuery.error instanceof Error
              ? assetQuery.error.message
              : "Failed to load asset"}
          </div>
        )}

        {/* Two-panel layout */}
        {asset && (
          <div
            data-testid="asset-detail"
            className="flex gap-6"
            style={{ minHeight: "calc(100vh - 140px)" }}
          >
            {/* Left panel — image preview */}
            <div className="flex-[55] min-w-0">
              <div
                data-testid="image-preview"
                className="sticky top-[84px] flex items-center justify-center rounded-ds-md border border-border-subtle bg-surface-raised p-4"
                style={{ minHeight: "400px" }}
              >
                {displayedVersion?.storage_url ? (
                  <img
                    src={displayedVersion.storage_url}
                    alt={asset.name}
                    data-testid="preview-image"
                    className="max-h-[70vh] max-w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-ink-faint">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-16 w-16"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                      />
                    </svg>
                    <span className="text-body">No preview available</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel — info cards */}
            <div className="flex flex-[45] min-w-0 flex-col gap-4 overflow-y-auto">
              {/* 1. ASSET INFO card */}
              <DetailCard testId="asset-info-card">
                <SectionHeader>Asset Info</SectionHeader>

                {/* Editable name */}
                {isEditingName ? (
                  <Input
                    ref={nameInputRef}
                    type="text"
                    data-testid="name-input"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveName();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setIsEditingName(false);
                        setDraftName(asset.name);
                      }
                    }}
                    className="mb-3 h-auto py-2 text-headline text-ink-strong"
                  />
                ) : (
                  <button
                    type="button"
                    data-testid="asset-name"
                    onClick={() => setIsEditingName(true)}
                    className="mb-3 w-full cursor-pointer text-left text-headline text-ink-strong transition-colors hover:text-accent"
                    title="Click to edit name"
                  >
                    {asset.name}
                  </button>
                )}

                {/* Tag chips */}
                <div className="flex flex-wrap items-center gap-2">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      data-testid={`tag-chip-${tag}`}
                      className="inline-flex items-center gap-1 rounded-ds-xs border border-accent-border bg-accent-subtle px-2.5 py-1 text-label normal-case tracking-normal text-accent"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                        data-testid={`remove-tag-${tag}`}
                        className="ml-0.5 rounded-ds-xs p-0.5 text-accent/70 hover:bg-accent/10 hover:text-accent"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3 w-3"
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
                    </span>
                  ))}
                  {isAddingTag ? (
                    <Input
                      ref={tagInputRef}
                      type="text"
                      data-testid="add-tag-input"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      onBlur={addTag}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTag();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setIsAddingTag(false);
                          setNewTagInput("");
                        }
                      }}
                      placeholder="tag name"
                      className="h-auto w-28 py-1 text-label normal-case tracking-normal"
                    />
                  ) : (
                    <button
                      type="button"
                      data-testid="add-tag-btn"
                      onClick={() => setIsAddingTag(true)}
                      className="inline-flex items-center gap-1 rounded-ds-xs border border-dashed border-border-strong px-2.5 py-1 text-label normal-case tracking-normal text-ink-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      + Add tag
                    </button>
                  )}
                </div>
              </DetailCard>

              {/* 2. METADATA card */}
              <DetailCard testId="metadata-card">
                <SectionHeader>Metadata</SectionHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
                      Category
                    </p>
                    <p className="text-body font-medium text-ink-strong">
                      {deriveCategory(asset.tags) ?? "Uncategorized"}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
                      Dimensions
                    </p>
                    <p
                      data-testid="dimensions"
                      className="font-mono text-mono text-ink-strong"
                    >
                      {displayedVersion?.width && displayedVersion?.height
                        ? `${displayedVersion.width} x ${displayedVersion.height}`
                        : "Unknown"}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
                      Created
                    </p>
                    <p className="text-body font-medium text-ink-strong">
                      {formatDate(asset.created_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
                      File size
                    </p>
                    <p
                      data-testid="file-size"
                      className="font-mono text-mono text-ink-strong"
                    >
                      {displayedVersion?.file_size_bytes
                        ? formatFileSize(displayedVersion.file_size_bytes)
                        : "Unknown"}
                    </p>
                  </div>
                </div>
              </DetailCard>

              {/* 3. ORIGINAL PROMPT card (only for generated assets) */}
              {asset.source === "generated" && displayedVersion?.prompt_text && (
                <DetailCard testId="prompt-card">
                  <SectionHeader>Original Prompt</SectionHeader>

                  {isEditingPrompt ? (
                    <div data-testid="edit-prompt-form">
                      <Textarea
                        data-testid="edit-prompt-textarea"
                        rows={4}
                        value={editedPrompt}
                        onChange={(e) => setEditedPrompt(e.target.value)}
                        disabled={editPromptMutation.isPending}
                      />

                      <div className="mt-3 flex items-center gap-3">
                        <Button
                          variant="primary"
                          data-testid="edit-prompt-submit-btn"
                          onClick={handleEditPromptSubmit}
                          disabled={
                            editPromptMutation.isPending ||
                            editedPrompt.trim().length < 10
                          }
                          leadingIcon={
                            editPromptMutation.isPending ? (
                              <span
                                data-testid="edit-prompt-spinner"
                                className="h-4 w-4 animate-spin rounded-ds-full border-2 border-current border-t-transparent"
                              />
                            ) : undefined
                          }
                        >
                          {editPromptMutation.isPending
                            ? "Generating..."
                            : "Generate with new prompt"}
                        </Button>

                        <Button
                          variant="ghost"
                          data-testid="edit-prompt-cancel-btn"
                          onClick={handleEditPromptCancel}
                          disabled={editPromptMutation.isPending}
                        >
                          Cancel
                        </Button>
                      </div>

                      {editPromptError && (
                        <p
                          data-testid="edit-prompt-error"
                          className="mt-2 rounded-ds-md border border-danger/30 bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
                        >
                          {editPromptError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <blockquote className="rounded-ds-md border border-border-subtle bg-surface-sunken px-4 py-3 text-body italic text-ink-muted">
                        {displayedVersion.prompt_text}
                      </blockquote>

                      <button
                        type="button"
                        data-testid="edit-regenerate-btn"
                        onClick={handleEditPromptOpen}
                        disabled={
                          regenerateMutation.isPending ||
                          refineMutation.isPending ||
                          editPromptMutation.isPending
                        }
                        className="mt-3 text-label normal-case tracking-normal text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit &amp; Regenerate
                      </button>
                    </>
                  )}
                </DetailCard>
              )}

              {/* 4. VERSION HISTORY card */}
              {asset.versions.length > 0 && (
                <DetailCard testId="version-history-card">
                  <SectionHeader>Version History</SectionHeader>
                  <div className="flex flex-col gap-2">
                    {[...asset.versions]
                      .sort(
                        (a, b) => b.version_number - a.version_number
                      )
                      .map((version) => {
                        const isCurrent =
                          version.id === asset.primary_version?.id;
                        const isSelected =
                          selectedVersionId === null
                            ? isCurrent
                            : version.id === selectedVersionId;

                        return (
                          <div
                            key={version.id}
                            data-testid={`version-row-${version.id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              setSelectedVersionId(
                                isCurrent ? null : version.id
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedVersionId(
                                  isCurrent ? null : version.id
                                );
                              }
                            }}
                            className={
                              "cursor-pointer rounded-ds-md px-3 py-2 transition-colors " +
                              (isSelected
                                ? "border border-accent-border bg-accent-subtle"
                                : "border border-transparent hover:bg-surface-sunken")
                            }
                          >
                            <div
                              className="flex w-full items-center gap-3 text-left"
                            >
                              {/* Thumbnail */}
                              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-ds-sm bg-surface-sunken">
                                {version.thumbnail_url ? (
                                  <img
                                    src={version.thumbnail_url}
                                    alt={`Version ${version.version_number}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : version.storage_url ? (
                                  <img
                                    src={version.storage_url}
                                    alt={`Version ${version.version_number}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-caption font-normal normal-case tracking-normal text-ink-faint">
                                    v{version.version_number}
                                  </div>
                                )}
                              </div>

                              {/* Version info */}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-body font-semibold text-ink-strong">
                                    v{version.version_number}
                                  </span>
                                  {isCurrent && (
                                    <span
                                      data-testid={`current-label-${version.id}`}
                                      className="rounded-ds-xs bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent"
                                    >
                                      (current)
                                    </span>
                                  )}
                                </div>
                                <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
                                  {formatDate(version.created_at)}
                                </p>
                                {version.refinement_instruction && (
                                  <p className="mt-0.5 truncate text-caption font-normal normal-case tracking-normal text-ink-muted">
                                    {version.refinement_instruction}
                                  </p>
                                )}
                              </div>
                            </div>
                            {/* Version action links */}
                            {(asset.source === "generated" || !isCurrent) && (
                              <div className="mt-1 ml-[60px] flex gap-3">
                                {asset.source === "generated" && (
                                  <>
                                    <button
                                      type="button"
                                      data-testid={`regenerate-version-${version.id}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRegenerate(version.id);
                                      }}
                                      disabled={regenerateMutation.isPending || refineMutation.isPending || setPrimaryMutation.isPending}
                                      className="text-caption font-normal normal-case tracking-normal text-ink-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Regenerate from this
                                    </button>
                                    <button
                                      type="button"
                                      data-testid={`refine-version-${version.id}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRefineFromVersion(version.id);
                                      }}
                                      disabled={regenerateMutation.isPending || refineMutation.isPending || setPrimaryMutation.isPending}
                                      className="text-caption font-normal normal-case tracking-normal text-ink-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      Refine from this
                                    </button>
                                  </>
                                )}
                                {!isCurrent && (
                                  <button
                                    type="button"
                                    data-testid={`set-primary-${version.id}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSetPrimary(version.id);
                                    }}
                                    disabled={setPrimaryMutation.isPending || regenerateMutation.isPending || refineMutation.isPending}
                                    className="inline-flex items-center gap-1 text-caption font-normal normal-case tracking-normal text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {setPrimaryMutation.isPending &&
                                     setPrimaryMutation.variables?.versionId === version.id ? (
                                      <>
                                        <span
                                          data-testid={`set-primary-spinner-${version.id}`}
                                          className="h-3 w-3 animate-spin rounded-ds-full border-2 border-current border-t-transparent"
                                        />
                                        Setting...
                                      </>
                                    ) : (
                                      "Set as primary"
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  {setPrimaryError && (
                    <p
                      data-testid="set-primary-error"
                      className="mt-2 rounded-ds-md border border-danger/30 bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
                    >
                      {setPrimaryError}
                    </p>
                  )}
                </DetailCard>
              )}

              {/* 5. REFINE card (STORY-A3.1) — only for generated assets */}
              {asset.source === "generated" && (
                <DetailCard testId="refine-card">
                  <SectionHeader>Refine</SectionHeader>

                  {/* Show which version we're refining from, if explicitly chosen */}
                  {refineFromVersionId && (
                    <div
                      data-testid="refine-from-badge"
                      className="mb-2 inline-flex items-center gap-1.5 rounded-ds-xs border border-accent-border bg-accent-subtle px-2.5 py-1 text-label normal-case tracking-normal text-accent"
                    >
                      <span>
                        Refining from v
                        {asset.versions.find(
                          (v) => v.id === refineFromVersionId,
                        )?.version_number ?? "?"}
                      </span>
                      <button
                        type="button"
                        data-testid="clear-refine-from"
                        onClick={() => setRefineFromVersionId(undefined)}
                        className="ml-0.5 rounded-ds-xs p-0.5 text-accent/70 hover:bg-accent/10 hover:text-accent"
                        aria-label="Clear version selection"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-3 w-3"
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
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Textarea
                      data-testid="refine-input"
                      rows={2}
                      placeholder="Describe refinement..."
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      disabled={refineMutation.isPending}
                      className="flex-1"
                    />
                    <Button
                      variant="primary"
                      data-testid="refine-btn"
                      onClick={handleRefine}
                      disabled={
                        refineMutation.isPending ||
                        refineInstruction.trim().length < 5
                      }
                      className="self-end"
                      leadingIcon={
                        refineMutation.isPending ? (
                          <span
                            data-testid="refine-spinner"
                            className="h-4 w-4 animate-spin rounded-ds-full border-2 border-current border-t-transparent"
                          />
                        ) : undefined
                      }
                    >
                      {refineMutation.isPending ? "Refining..." : "Refine"}
                    </Button>
                  </div>

                  {refineError && (
                    <p
                      data-testid="refine-error"
                      className="mt-2 rounded-ds-md border border-danger/30 bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
                    >
                      {refineError}
                    </p>
                  )}
                </DetailCard>
              )}

              {/* 6. ACTIONS card */}
              <DetailCard testId="actions-card">
                <SectionHeader>Actions</SectionHeader>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="primary"
                    data-testid="use-in-emailer-btn"
                    onClick={() => navigate("/brief")}
                    disabled={regenerateMutation.isPending || refineMutation.isPending}
                    className="w-full"
                  >
                    Use in Emailer
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="download-btn"
                    onClick={handleDownload}
                    disabled={!displayedVersion?.storage_url || regenerateMutation.isPending || refineMutation.isPending}
                    className="w-full"
                  >
                    Download
                  </Button>
                  {displayedVersion?.storage_url && (
                    <Button
                      variant="secondary"
                      data-testid="mask-edit-btn"
                      onClick={() => navigate(`/assets/${asset.id}/edit`)}
                      disabled={regenerateMutation.isPending || refineMutation.isPending}
                      className="w-full"
                      leadingIcon={
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          />
                        </svg>
                      }
                    >
                      Edit with Mask
                    </Button>
                  )}
                  {asset.source === "generated" && (
                    <Button
                      variant="secondary"
                      data-testid="regenerate-btn"
                      onClick={() => handleRegenerate(displayedVersion?.id)}
                      disabled={regenerateMutation.isPending || refineMutation.isPending}
                      className="w-full"
                      leadingIcon={
                        regenerateMutation.isPending ? (
                          <span
                            data-testid="regenerate-spinner"
                            className="h-4 w-4 animate-spin rounded-ds-full border-2 border-current border-t-transparent"
                          />
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        )
                      }
                    >
                      {regenerateMutation.isPending
                        ? "Regenerating..."
                        : "Regenerate"}
                    </Button>
                  )}
                  {regenerateError && (
                    <p
                      data-testid="regenerate-error"
                      className="rounded-ds-md border border-danger/30 bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
                    >
                      {regenerateError}
                    </p>
                  )}
                  <Button
                    variant="secondary"
                    data-testid="delete-btn"
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={regenerateMutation.isPending || refineMutation.isPending}
                    className="w-full border-danger/40 text-danger hover:bg-danger-subtle hover:border-danger/40"
                  >
                    Delete
                  </Button>
                </div>
              </DetailCard>
            </div>
          </div>
        )}
      </main>

      {/* Delete confirmation dialog */}
      <ConfirmDeleteDialog
        isOpen={showDeleteDialog}
        assetName={asset?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
