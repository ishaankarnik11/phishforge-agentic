/**
 * Asset Picker Modal (STORY-A5.1 + STORY-A5.5).
 *
 * A modal that allows users to browse and select assets from the
 * Asset Library to attach to a brief form. Renders a searchable,
 * 3-column grid of asset cards with multi-select. Selected assets
 * are passed back to the parent via ``onSelect`` when the user
 * clicks "Add Selected".
 *
 * STORY-A5.5 adds a "Generate New" tab that embeds a compact
 * generation form (name + prompt + dimensions + generate). On
 * success, the generated asset is immediately passed to onSelect
 * and the modal closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibraryAssets,
  generateAsset,
  type GenerateAssetRequest,
  type GenerateAssetStylePresets,
  type LibraryAssetDetailRead,
  type LibraryAssetRead,
} from "../api/libraryAssets";
import { Button, Input, Select, Textarea } from "./ds";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AssetPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (assets: LibraryAssetRead[]) => void;
  /** IDs of assets already attached to the brief -- shown as disabled. */
  alreadyAttachedIds?: Set<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

type PickerTab = "browse" | "generate";

// ---------------------------------------------------------------------------
// Dimension presets (compact subset for inline generation)
// ---------------------------------------------------------------------------

interface DimensionPreset {
  label: string;
  width: number;
  height: number;
}

const DIMENSION_PRESETS: DimensionPreset[] = [
  { label: "1024 x 1024 (Square)", width: 1024, height: 1024 },
  { label: "1536 x 1024 (Landscape)", width: 1536, height: 1024 },
  { label: "1024 x 1536 (Portrait)", width: 1024, height: 1536 },
];

// Visual style presets (compact: single axis only)
const VISUAL_STYLE_OPTIONS = [
  "Corporate Clean",
  "Premium Luxury",
  "Modern Gradient",
  "Photorealistic",
  "Illustrated",
] as const;

// ---------------------------------------------------------------------------
// Helper: convert LibraryAssetDetailRead -> LibraryAssetRead
// ---------------------------------------------------------------------------

function detailToRead(detail: LibraryAssetDetailRead): LibraryAssetRead {
  return {
    id: detail.id,
    name: detail.name,
    source: detail.source,
    tags: detail.tags,
    created_by_name: detail.created_by_name,
    primary_version: detail.primary_version,
    created_at: detail.created_at,
  };
}

// ---------------------------------------------------------------------------
// Sub-component: InlineGenerateForm
// ---------------------------------------------------------------------------

interface InlineGenerateFormProps {
  onGenerated: (asset: LibraryAssetRead) => void;
}

function InlineGenerateForm({ onGenerated }: InlineGenerateFormProps) {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [visualStyle, setVisualStyle] = useState<string | null>(null);
  const [dimensionIndex, setDimensionIndex] = useState(1); // Default Hero

  // Validation
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Elapsed timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mutation
  const mutation = useMutation({
    mutationFn: generateAsset,
    onSuccess: (asset: LibraryAssetDetailRead) => {
      queryClient.invalidateQueries({ queryKey: ["libraryAssets"] });
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      onGenerated(detailToRead(asset));
    },
  });

  // Elapsed timer effect
  useEffect(() => {
    if (mutation.isPending) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [mutation.isPending]);

  const validate = (): boolean => {
    let valid = true;
    if (!name.trim()) {
      setNameError("Asset name is required");
      valid = false;
    } else {
      setNameError(null);
    }
    if (prompt.trim().length < 10) {
      setPromptError("Prompt must be at least 10 characters");
      valid = false;
    } else if (prompt.length > 2000) {
      setPromptError("Prompt must be at most 2000 characters");
      valid = false;
    } else {
      setPromptError(null);
    }
    return valid;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (mutation.isPending) return;
    if (!validate()) return;

    const preset = DIMENSION_PRESETS[dimensionIndex];
    const stylePresets: GenerateAssetStylePresets = {
      visual_style: visualStyle,
      mood: null,
      texture: null,
      layout: null,
    };
    const request: GenerateAssetRequest = {
      name: name.trim(),
      prompt: prompt.trim(),
      style_presets: stylePresets,
      width: preset.width,
      height: preset.height,
      quality: "high",
    };

    mutation.mutate(request);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3"
      data-testid="inline-generate-form"
    >
      {/* Asset Name */}
      <div>
        <label
          htmlFor="inline-gen-name"
          className="mb-1 block text-label text-ink-body"
        >
          Asset Name
        </label>
        <Input
          id="inline-gen-name"
          data-testid="inline-gen-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          disabled={mutation.isPending}
          invalid={Boolean(nameError)}
          aria-describedby={nameError ? "inline-gen-name-error" : undefined}
          placeholder="e.g., Login Portal Banner"
        />
        {nameError && (
          <p
            id="inline-gen-name-error"
            data-testid="inline-gen-name-error"
            role="alert"
            className="mt-2xs text-caption font-normal normal-case tracking-normal text-danger"
          >
            {nameError}
          </p>
        )}
      </div>

      {/* Prompt */}
      <div>
        <label
          htmlFor="inline-gen-prompt"
          className="mb-1 block text-label text-ink-body"
        >
          Prompt
        </label>
        <Textarea
          id="inline-gen-prompt"
          data-testid="inline-gen-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (promptError) setPromptError(null);
          }}
          disabled={mutation.isPending}
          invalid={Boolean(promptError)}
          aria-describedby={promptError ? "inline-gen-prompt-error" : undefined}
          placeholder="A professional login portal banner for a corporate IT brand..."
        />
        {promptError && (
          <p
            id="inline-gen-prompt-error"
            data-testid="inline-gen-prompt-error"
            role="alert"
            className="mt-2xs text-caption font-normal normal-case tracking-normal text-danger"
          >
            {promptError}
          </p>
        )}
        <p className="mt-0.5 text-caption font-normal normal-case tracking-normal text-ink-faint">
          {prompt.length}/2000 characters
        </p>
      </div>

      {/* Visual Style presets (compact: single row) */}
      <div>
        <p className="mb-1.5 text-caption text-ink-muted">Visual Style</p>
        <div className="flex flex-wrap gap-1.5">
          {VISUAL_STYLE_OPTIONS.map((style) => {
            const isActive = visualStyle === style;
            return (
              <button
                key={style}
                type="button"
                disabled={mutation.isPending}
                data-testid={`inline-gen-style-${style.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                onClick={() => setVisualStyle(isActive ? null : style)}
                className={
                  "rounded-ds-full border px-2.5 py-1 text-label transition-colors duration-fast disabled:opacity-60 " +
                  (isActive
                    ? "border-accent-border bg-accent-subtle text-accent"
                    : "border-border-default bg-surface-raised text-ink-muted hover:border-accent-border hover:text-accent")
                }
              >
                {style}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dimensions */}
      <div>
        <label
          htmlFor="inline-gen-dimensions"
          className="mb-1 block text-label text-ink-body"
        >
          Dimensions
        </label>
        <Select
          id="inline-gen-dimensions"
          data-testid="inline-gen-dimensions"
          value={dimensionIndex}
          onChange={(e) => setDimensionIndex(Number(e.target.value))}
          disabled={mutation.isPending}
        >
          {DIMENSION_PRESETS.map((preset, i) => (
            <option key={i} value={i}>
              {preset.label}
            </option>
          ))}
        </Select>
      </div>

      {/* Error message */}
      {mutation.isError && (
        <div
          data-testid="inline-gen-error"
          className="rounded-ds-md border border-danger/30 bg-danger-subtle px-3 py-2 text-body text-danger"
        >
          <strong className="font-medium">Error:</strong>{" "}
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Generation failed. Please try again."}
        </div>
      )}

      {/* Loading state */}
      {mutation.isPending && (
        <div
          data-testid="inline-gen-loading"
          className="flex items-center gap-3 rounded-ds-md border border-info/30 bg-info-subtle px-3 py-2"
        >
          <div className="h-4 w-4 animate-spin rounded-ds-full border-2 border-info border-t-transparent" />
          <div>
            <p className="text-body font-medium text-info">
              Generating image...
            </p>
            <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
              Elapsed: {elapsedSeconds}s
            </p>
          </div>
        </div>
      )}

      {/* Generate & Add button */}
      <Button
        type="submit"
        variant="primary"
        data-testid="inline-gen-submit"
        loading={mutation.isPending}
        className="w-full"
      >
        {mutation.isPending ? "Generating..." : "Generate & Add"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssetPickerModal({
  isOpen,
  onClose,
  onSelect,
  alreadyAttachedIds,
}: AssetPickerModalProps) {
  const [activeTab, setActiveTab] = useState<PickerTab>("browse");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMap, setSelectedMap] = useState<Map<string, LibraryAssetRead>>(
    new Map()
  );
  const backdropRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------------
  // Debounced search
  // ------------------------------------------------------------------

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // ------------------------------------------------------------------
  // Fetch assets via TanStack Query
  // ------------------------------------------------------------------

  const { data, isLoading, isError } = useQuery({
    queryKey: ["libraryAssets", "picker", debouncedSearch],
    queryFn: () =>
      fetchLibraryAssets({ search: debouncedSearch || undefined, limit: 24 }),
    enabled: isOpen,
    staleTime: 30_000,
  });

  const assets = data?.items ?? [];

  // ------------------------------------------------------------------
  // Reset state when modal opens
  // ------------------------------------------------------------------

  useEffect(() => {
    if (isOpen) {
      setActiveTab("browse");
      setSearchInput("");
      setDebouncedSearch("");
      setSelectedMap(new Map());
      // Auto-focus the search input when the modal opens.
      window.setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ------------------------------------------------------------------
  // Keyboard: Escape to close
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ------------------------------------------------------------------
  // Selection logic
  // ------------------------------------------------------------------

  const attachedIds = useMemo(
    () => alreadyAttachedIds ?? new Set<string>(),
    [alreadyAttachedIds]
  );

  const toggleSelect = useCallback(
    (asset: LibraryAssetRead) => {
      if (attachedIds.has(asset.id)) return;
      setSelectedMap((prev) => {
        const next = new Map(prev);
        if (next.has(asset.id)) {
          next.delete(asset.id);
        } else {
          next.set(asset.id, asset);
        }
        return next;
      });
    },
    [attachedIds]
  );

  const handleAddSelected = useCallback(() => {
    onSelect(Array.from(selectedMap.values()));
    onClose();
  }, [onSelect, onClose, selectedMap]);

  // ------------------------------------------------------------------
  // Inline generate: on success, immediately select and close
  // ------------------------------------------------------------------

  const handleGenerated = useCallback(
    (asset: LibraryAssetRead) => {
      onSelect([asset]);
      onClose();
    },
    [onSelect, onClose]
  );

  // ------------------------------------------------------------------
  // Backdrop click
  // ------------------------------------------------------------------

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === backdropRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // ------------------------------------------------------------------
  // Thumbnail helper
  // ------------------------------------------------------------------

  function getThumbnail(asset: LibraryAssetRead): string | null {
    const v = asset.primary_version;
    if (!v) return null;
    return v.thumbnail_url ?? v.storage_url ?? null;
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (!isOpen) return null;

  const selectedCount = selectedMap.size;

  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      aria-label="Pick from Library"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-strong/40 p-md"
      data-testid="asset-picker-modal"
    >
      <div className="flex max-h-[80vh] w-full max-w-[700px] flex-col overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised shadow-dialog">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-lg py-md">
          <h2 className="text-title text-ink-strong">Pick from Library</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-ds-sm p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
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
        </div>

        {/* Tab toggle */}
        <div className="border-b border-border-subtle px-lg py-sm">
          <div
            className="flex gap-1 rounded-ds-md bg-surface-sunken p-1"
            role="tablist"
            aria-label="Asset picker tabs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "browse"}
              data-testid="tab-browse"
              onClick={() => setActiveTab("browse")}
              className={
                "flex-1 rounded-ds-sm px-3 py-1.5 text-label transition-colors " +
                (activeTab === "browse"
                  ? "bg-surface-raised text-accent shadow-raise"
                  : "text-ink-muted hover:text-ink-strong")
              }
            >
              Browse Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "generate"}
              data-testid="tab-generate"
              onClick={() => setActiveTab("generate")}
              className={
                "flex-1 rounded-ds-sm px-3 py-1.5 text-label transition-colors " +
                (activeTab === "generate"
                  ? "bg-surface-raised text-accent shadow-raise"
                  : "text-ink-muted hover:text-ink-strong")
              }
            >
              Generate New
            </button>
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "browse" && (
          <>
            {/* Search */}
            <div className="border-b border-border-subtle px-lg py-sm">
              <div className="relative">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                    clipRule="evenodd"
                  />
                </svg>
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search library assets..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                  data-testid="asset-picker-search"
                />
              </div>
            </div>

            {/* Grid body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-lg py-md">
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <svg
                    className="h-6 w-6 animate-spin text-ink-faint"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span className="ml-2 text-body text-ink-muted">
                    Loading assets...
                  </span>
                </div>
              )}

              {isError && (
                <div className="py-12 text-center text-body text-danger">
                  Failed to load library assets. Please try again.
                </div>
              )}

              {!isLoading && !isError && assets.length === 0 && (
                <div className="py-12 text-center text-body text-ink-muted">
                  {debouncedSearch
                    ? `No assets matching "${debouncedSearch}".`
                    : "No assets in the library yet."}
                </div>
              )}

              {!isLoading && !isError && assets.length > 0 && (
                <div
                  className="grid grid-cols-3 gap-3"
                  role="grid"
                  aria-label="Library assets"
                >
                  {assets.map((asset) => {
                    const isAttached = attachedIds.has(asset.id);
                    const isSelected = selectedMap.has(asset.id);
                    const thumb = getThumbnail(asset);

                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => toggleSelect(asset)}
                        disabled={isAttached}
                        aria-pressed={isSelected}
                        data-testid={`asset-picker-card-${asset.id}`}
                        className={`relative flex flex-col overflow-hidden rounded-ds-md border text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                          isAttached
                            ? "cursor-not-allowed border-border-subtle opacity-50"
                            : isSelected
                            ? "border-accent-border bg-accent-subtle"
                            : "border-border-subtle hover:border-border-strong hover:shadow-raise"
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="relative aspect-square w-full overflow-hidden bg-surface-sunken">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={asset.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-surface-sunken">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-8 w-8 text-ink-faint"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </div>
                          )}

                          {/* Selection checkmark circle */}
                          {isSelected && (
                            <div
                              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-ds-full bg-accent shadow-raise"
                              data-testid={`asset-picker-check-${asset.id}`}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-4 w-4 text-on-accent"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </div>
                          )}

                          {/* Already added badge */}
                          {isAttached && (
                            <div className="absolute inset-x-0 bottom-0 bg-ink-strong/70 px-2 py-1 text-center text-[10px] font-medium text-on-accent">
                              Already added
                            </div>
                          )}
                        </div>

                        {/* Name + creator */}
                        <div className="px-2 py-1.5">
                          <p
                            className="truncate text-label normal-case tracking-normal text-ink-strong"
                            title={asset.name}
                          >
                            {asset.name}
                          </p>
                          {asset.created_by_name && (
                            <p className="truncate text-[10px] text-ink-faint">
                              by {asset.created_by_name}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border-subtle bg-surface-sunken px-lg py-sm">
              <span
                className="text-body text-ink-muted"
                data-testid="asset-picker-count"
              >
                {selectedCount} selected
              </span>
              <Button
                variant="primary"
                onClick={handleAddSelected}
                disabled={selectedCount === 0}
                data-testid="asset-picker-add-btn"
              >
                Add Selected
              </Button>
            </div>
          </>
        )}

        {activeTab === "generate" && (
          <div className="flex-1 overflow-y-auto px-lg py-md">
            <InlineGenerateForm onGenerated={handleGenerated} />
          </div>
        )}
      </div>
    </div>
  );
}
