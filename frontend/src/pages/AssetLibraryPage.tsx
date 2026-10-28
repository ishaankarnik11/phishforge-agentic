/**
 * AssetLibraryPage — grid view for browsing library assets (STORY-A1.1).
 *
 * Matches the FRD section 2 specs and reference screenshots exactly:
 * - Header with "Asset Library" title + count badge + back link
 * - Filter bar: search (debounced 300ms), type chips, category chips
 * - 4-column responsive grid (3 at 1100px, 2 at 800px)
 * - Card hover: translateY(-2px), stronger shadow, blue border
 * - Empty state with CTAs
 * - Skeleton loading cards
 * - Offset/limit pagination via "Load more" button
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibraryAssets,
  deleteLibraryAsset,
  fetchTags,
  bulkTagAssets,
} from "../api/libraryAssets";
import type {
  LibraryAssetRead,
  LibraryAssetDetailRead,
  FetchLibraryAssetsParams,
} from "../api/libraryAssets";
import GenerateAssetModal from "../components/GenerateAssetModal";
import UploadAssetModal from "../components/UploadAssetModal";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import BulkTagBar from "../components/BulkTagBar";
import { Button, Input, StatusBadge } from "../components/ds";

// ---------------------------------------------------------------------------
// Constants — design tokens from prototype CSS :root
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 24;

// ---------------------------------------------------------------------------
// Type / category filter definitions
// ---------------------------------------------------------------------------

type SourceFilter = "all" | "generated" | "uploaded";

const SOURCE_CHIPS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "generated", label: "AI Generated" },
  { value: "uploaded", label: "Uploaded" },
];

/** Maximum number of tag chips to display in the filter bar */
const MAX_TAG_CHIPS = 10;

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

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

/**
 * Placeholder thumbnail for assets without an image. STORY-AP7.1 (chunk 3):
 * the previous multicolor gradient set is replaced by a single restrained
 * surface-sunken fill with a neutral image-off glyph, per the Tinted Neutral
 * Rule and the "no gradient heroes" guidance (DESIGN.md §6).
 */
function ThumbnailPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-sunken">
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-ink-faint"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
        />
      </svg>
    </div>
  );
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
// Filter chip component
// ---------------------------------------------------------------------------

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  testId?: string;
}

function FilterChip({ label, active, onClick, testId }: FilterChipProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={
        "inline-flex items-center rounded-ds-xs border px-3 py-1.5 text-label transition-colors duration-fast " +
        (active
          ? "border-accent-border bg-accent-subtle text-accent"
          : "border-border-default bg-surface-raised text-ink-muted hover:border-accent-border hover:text-accent")
      }
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeleton card (loading placeholder)
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      data-testid="skeleton-card"
      className="overflow-hidden rounded-ds-md border border-border-subtle bg-surface-raised"
    >
      <div className="h-40 animate-pulse bg-surface-sunken" />
      <div className="px-4 pb-4 pt-3">
        <div className="mb-2 h-4 w-3/4 animate-pulse rounded-ds-sm bg-surface-sunken" />
        <div className="mb-1.5 flex gap-2">
          <div className="h-5 w-20 animate-pulse rounded-ds-sm bg-surface-sunken" />
          <div className="h-5 w-8 animate-pulse rounded-ds-sm bg-surface-sunken" />
        </div>
        <div className="h-3 w-1/2 animate-pulse rounded-ds-sm bg-surface-sunken" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset card
// ---------------------------------------------------------------------------

interface AssetCardProps {
  asset: LibraryAssetRead;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}

function AssetCard({ asset, onClick, onDelete, selectMode, isSelected, onToggleSelect }: AssetCardProps) {
  const thumbnailUrl = asset.primary_version?.thumbnail_url;
  const versionNumber = asset.primary_version?.version_number ?? 1;
  const category = deriveCategory(asset.tags);

  return (
    <button
      type="button"
      data-testid={`asset-card-${asset.id}`}
      onClick={onClick}
      className={
        "group w-full cursor-pointer overflow-hidden rounded-ds-md border border-border-subtle " +
        "bg-surface-raised text-left transition-shadow duration-fast ease-out " +
        "hover:border-border-strong hover:shadow-raise " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
      }
    >
      {/* Thumbnail */}
      <div className="relative h-40 w-full overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={asset.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <ThumbnailPlaceholder />
        )}

        {/* Selection checkbox — visible in select mode */}
        {selectMode && (
          <div
            data-testid={`select-checkbox-${asset.id}`}
            role="checkbox"
            tabIndex={0}
            aria-checked={isSelected}
            aria-label={`Select ${asset.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect?.(e as unknown as React.MouseEvent);
              }
            }}
            className={
              "absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-ds-xs " +
              "border-2 transition-colors duration-fast " +
              (isSelected
                ? "border-accent bg-accent"
                : "border-surface-raised/80 bg-surface-raised/80 hover:border-accent")
            }
          >
            {isSelected && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-on-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        )}

        {/* Delete button — visible on card hover */}
        <div
          data-testid={`delete-btn-${asset.id}`}
          role="button"
          tabIndex={0}
          aria-label={`Delete ${asset.name}`}
          onClick={onDelete}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onDelete(e as unknown as React.MouseEvent);
            }
          }}
          className={
            "absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-ds-sm " +
            "bg-surface-raised/90 text-ink-muted opacity-0 shadow-raise " +
            "transition-colors duration-fast hover:bg-danger-subtle hover:text-danger " +
            "focus:opacity-100 group-hover:opacity-100"
          }
        >
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
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
            />
          </svg>
        </div>
      </div>

      {/* Card body */}
      <div className="px-4 pb-4 pt-3">
        {/* Name (truncated) */}
        <p className="mb-2 truncate text-body font-semibold text-ink-strong">
          {asset.name}
        </p>

        {/* Badges */}
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {asset.source === "generated" ? (
            <StatusBadge tone="info">AI Generated</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Uploaded</StatusBadge>
          )}
          <span className="inline-flex items-center rounded-ds-xs bg-surface-sunken px-2 py-0.5 text-label normal-case tracking-normal text-ink-muted">
            v{versionNumber}
          </span>
        </div>

        {/* Date + category */}
        <p className="text-caption font-normal normal-case tracking-normal text-ink-faint">
          {formatDate(asset.created_at)}
          {category && <> &middot; {category}</>}
        </p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  hasFilters,
  onClearFilters,
  onGenerate,
  onUpload,
}: {
  hasFilters: boolean;
  onClearFilters: () => void;
  onGenerate: () => void;
  onUpload: () => void;
}) {
  if (hasFilters) {
    return (
      <div
        data-testid="filtered-empty-state"
        className="flex flex-col items-center justify-center py-24 text-center"
      >
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-ds-full bg-surface-sunken">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-ink-faint"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 0z"
            />
          </svg>
        </div>
        <p className="text-body font-medium text-ink-strong">
          No assets match your search.
        </p>
        <p className="mt-1 text-body text-ink-muted">
          Try different keywords or generate a new asset.
        </p>
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            data-testid="clear-filters"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
          <Button
            variant="primary"
            data-testid="filtered-generate-btn"
            onClick={onGenerate}
          >
            + Generate new
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-ds-full bg-accent-subtle">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 text-accent"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
          />
        </svg>
      </div>
      <h2 className="text-title text-ink-strong">No assets yet</h2>
      <p className="mt-1 text-body text-ink-muted">
        Generate your first AI image or upload an asset to get started.
      </p>
      <div className="mt-6 flex gap-3">
        <Button
          variant="primary"
          data-testid="empty-state-generate-btn"
          onClick={onGenerate}
        >
          + Generate your first image
        </Button>
        <Button
          variant="secondary"
          data-testid="empty-state-upload-btn"
          onClick={onUpload}
        >
          Upload existing assets
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AssetLibraryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // -- Generate modal state --------------------------------------------------
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

  const handleGenerateSuccess = useCallback(
    (asset: LibraryAssetDetailRead) => {
      setIsGenerateModalOpen(false);
      // Navigate to asset detail if route exists, otherwise stay on library
      navigate(`/assets/${asset.id}`);
    },
    [navigate]
  );

  // -- Upload modal state ---------------------------------------------------
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const handleUploadSuccess = useCallback(
    (asset: LibraryAssetDetailRead) => {
      setIsUploadModalOpen(false);
      navigate(`/assets/${asset.id}`);
    },
    [navigate]
  );

  // -- Filter state ----------------------------------------------------------
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  // -- Multi-select state (STORY-A1.3) -------------------------------------
  const [selectMode, setSelectMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set()
  );

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) {
        // Exiting select mode — clear selection
        setSelectedAssetIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleAssetSelection = useCallback((id: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedAssetIds(new Set());
  }, []);

  // Track all loaded items across pages for "load more" pagination
  const [allItems, setAllItems] = useState<LibraryAssetRead[]>([]);
  const totalRef = useRef(0);

  // Reset offset, accumulated items, and total when filters change
  useEffect(() => {
    setOffset(0);
    setAllItems([]);
    totalRef.current = 0;
  }, [debouncedSearch, sourceFilter, tagFilter]);

  const hasFilters =
    debouncedSearch !== "" ||
    sourceFilter !== "all" ||
    tagFilter !== "all";

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSourceFilter("all");
    setTagFilter("all");
    setOffset(0);
    setAllItems([]);
  }, []);

  // -- Build query params ----------------------------------------------------
  const queryParams: FetchLibraryAssetsParams = useMemo(() => {
    const p: FetchLibraryAssetsParams = {
      offset,
      limit: PAGE_LIMIT,
      sort: "newest",
    };
    if (debouncedSearch) p.search = debouncedSearch;
    if (sourceFilter !== "all") p.source = sourceFilter;
    if (tagFilter !== "all") p.tag = tagFilter;
    return p;
  }, [debouncedSearch, sourceFilter, tagFilter, offset]);

  // -- React Query -----------------------------------------------------------
  const assetsQuery = useQuery({
    queryKey: ["library-assets", queryParams],
    queryFn: () => fetchLibraryAssets(queryParams),
    staleTime: 30_000,
  });

  // -- Dynamic tags query (STORY-A1.3) --------------------------------------
  const tagsQuery = useQuery({
    queryKey: ["library-asset-tags"],
    queryFn: fetchTags,
    staleTime: 60_000,
  });

  const tagChips = useMemo(() => {
    const tags = tagsQuery.data ?? [];
    return tags.slice(0, MAX_TAG_CHIPS);
  }, [tagsQuery.data]);

  // -- Bulk tag mutation (STORY-A1.3) ---------------------------------------
  const bulkTagMutation = useMutation({
    mutationFn: bulkTagAssets,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      queryClient.invalidateQueries({ queryKey: ["library-asset-tags"] });
      setSelectedAssetIds(new Set());
    },
  });

  const handleBulkAddTag = useCallback(
    (tag: string) => {
      if (selectedAssetIds.size === 0) return;
      bulkTagMutation.mutate({
        asset_ids: [...selectedAssetIds],
        action: "add",
        tags: [tag],
      });
    },
    [selectedAssetIds, bulkTagMutation]
  );

  const handleBulkRemoveTag = useCallback(
    (tag: string) => {
      if (selectedAssetIds.size === 0) return;
      bulkTagMutation.mutate({
        asset_ids: [...selectedAssetIds],
        action: "remove",
        tags: [tag],
      });
    },
    [selectedAssetIds, bulkTagMutation]
  );

  // When data arrives, accumulate for "load more" or replace if offset is 0
  useEffect(() => {
    const data = assetsQuery.data;
    if (data) {
      totalRef.current = data.total;
      if (offset === 0) {
        setAllItems(data.items);
      } else {
        setAllItems((prev) => [...prev, ...data.items]);
      }
    }
  }, [assetsQuery.data, offset]);

  const total = totalRef.current;
  const hasMore = allItems.length < total;
  const isLoadingMore = offset > 0 && assetsQuery.isLoading;
  const isInitialLoading = offset === 0 && assetsQuery.isLoading;

  const loadMore = useCallback(() => {
    setOffset((prev) => prev + PAGE_LIMIT);
  }, []);

  // -- Delete state + mutation ------------------------------------------------
  const [assetToDelete, setAssetToDelete] = useState<LibraryAssetRead | null>(
    null,
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLibraryAsset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setAssetToDelete(null);
    },
  });

  const handleDeleteClick = useCallback(
    (asset: LibraryAssetRead, e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card onClick (navigate)
      setAssetToDelete(asset);
    },
    [],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (assetToDelete) {
      deleteMutation.mutate(assetToDelete.id);
    }
  }, [assetToDelete, deleteMutation]);

  const handleDeleteCancel = useCallback(() => {
    if (!deleteMutation.isPending) {
      setAssetToDelete(null);
      deleteMutation.reset();
    }
  }, [deleteMutation]);

  // -- Render ----------------------------------------------------------------
  return (
    // STORY-AP7.1: global wordmark / primary nav / user menu moved to the app
    // shell (TopBar + SideNav). This page keeps its own Upload / Generate page
    // actions in a non-fixed page header. Full restyle of this page (and
    // removal of the remaining hardcoded hex colors) is a later AP7 chunk.
    <div className="min-h-full bg-surface-base">
      <header className="flex h-[60px] items-center justify-end gap-3 border-b border-border-subtle bg-surface-chrome px-6">
        <Button
          variant="secondary"
          data-testid="header-upload-btn"
          onClick={() => setIsUploadModalOpen(true)}
        >
          Upload
        </Button>
        <Button
          variant="primary"
          data-testid="header-generate-btn"
          onClick={() => setIsGenerateModalOpen(true)}
        >
          + Generate new
        </Button>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-[1280px] px-6 pb-12 pt-lg">
        {/* Back link */}
        <Link
          to="/"
          data-testid="back-link"
          className="mb-4 inline-flex items-center gap-1 text-label text-accent hover:underline"
        >
          &larr; Back to emailers
        </Link>

        {/* Page header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-display text-ink-strong">Asset Library</h1>
            {!isInitialLoading && (
              <span
                data-testid="count-badge"
                className="rounded-ds-full bg-accent-subtle px-2.5 py-0.5 text-label normal-case tracking-normal text-accent"
              >
                {total} {total === 1 ? "asset" : "assets"}
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div
          data-testid="filter-bar"
          className="mb-6 flex flex-wrap items-center gap-3"
        >
          {/* Search input */}
          <div className="relative min-w-[200px] max-w-[320px] flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-ink-faint"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <Input
              type="text"
              data-testid="search-input"
              placeholder="Search assets..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Type (source) filter chips */}
          <div className="flex gap-1" role="group" aria-label="Type filter">
            {SOURCE_CHIPS.map((chip) => (
              <FilterChip
                key={chip.value}
                label={chip.label}
                active={sourceFilter === chip.value}
                onClick={() => setSourceFilter(chip.value)}
                testId={`filter-source-${chip.value}`}
              />
            ))}
          </div>

          {/* Dynamic tag filter chips (STORY-A1.3) */}
          {tagChips.length > 0 && (
            <div
              className="flex gap-1"
              role="group"
              aria-label="Tag filter"
            >
              <FilterChip
                label="All"
                active={tagFilter === "all"}
                onClick={() => setTagFilter("all")}
                testId="filter-tag-all"
              />
              {tagChips.map((tag) => (
                <FilterChip
                  key={tag}
                  label={tag}
                  active={tagFilter === tag}
                  onClick={() => setTagFilter(tag)}
                  testId={`filter-tag-${tag}`}
                />
              ))}
            </div>
          )}

          {/* Select mode toggle (STORY-A1.3) */}
          <Button
            variant={selectMode ? "primary" : "secondary"}
            data-testid="select-mode-toggle"
            onClick={toggleSelectMode}
            className="ml-auto"
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
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          >
            {selectMode ? "Cancel" : "Select"}
          </Button>
        </div>

        {/* Loading state — skeleton grid */}
        {isInitialLoading && (
          <div
            data-testid="loading-grid"
            className="grid gap-5"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
            }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Error state */}
        {assetsQuery.isError && (
          <div
            role="alert"
            className="rounded-ds-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body text-danger"
          >
            <strong className="font-medium">Error:</strong>{" "}
            {assetsQuery.error instanceof Error
              ? assetsQuery.error.message
              : "Failed to load assets"}
          </div>
        )}

        {/* Empty state */}
        {!isInitialLoading &&
          !assetsQuery.isError &&
          allItems.length === 0 &&
          !assetsQuery.isLoading && (
            <EmptyState
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
              onGenerate={() => setIsGenerateModalOpen(true)}
              onUpload={() => setIsUploadModalOpen(true)}
            />
          )}

        {/* Asset grid */}
        {allItems.length > 0 && (
          <>
            <div
              data-testid="asset-grid"
              className="grid gap-5"
              style={{
                gridTemplateColumns: "repeat(4, 1fr)",
              }}
            >
              <style>{`
                @media (max-width: 1100px) {
                  [data-testid="asset-grid"],
                  [data-testid="loading-grid"] {
                    grid-template-columns: repeat(3, 1fr) !important;
                  }
                }
                @media (max-width: 800px) {
                  [data-testid="asset-grid"],
                  [data-testid="loading-grid"] {
                    grid-template-columns: repeat(2, 1fr) !important;
                  }
                }
              `}</style>
              {allItems.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onClick={() => {
                    if (selectMode) {
                      toggleAssetSelection(asset.id);
                    } else {
                      navigate(`/assets/${asset.id}`);
                    }
                  }}
                  onDelete={(e) => handleDeleteClick(asset, e)}
                  selectMode={selectMode}
                  isSelected={selectedAssetIds.has(asset.id)}
                  onToggleSelect={() => toggleAssetSelection(asset.id)}
                />
              ))}
            </div>

            {/* Load more pagination */}
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <Button
                  variant="secondary"
                  data-testid="load-more"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  leadingIcon={
                    isLoadingMore ? (
                      <span className="h-4 w-4 animate-spin rounded-ds-full border-2 border-current border-t-transparent" />
                    ) : undefined
                  }
                >
                  {isLoadingMore
                    ? "Loading..."
                    : `Load more (${allItems.length} of ${total})`}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Generate asset modal */}
      <GenerateAssetModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        onSuccess={handleGenerateSuccess}
      />

      {/* Upload asset modal */}
      <UploadAssetModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* Delete confirmation dialog */}
      <ConfirmDeleteDialog
        isOpen={assetToDelete !== null}
        assetName={assetToDelete?.name ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDeleting={deleteMutation.isPending}
      />

      {/* Bulk tag bar — shown when assets are selected (STORY-A1.3) */}
      {selectMode && selectedAssetIds.size > 0 && (
        <BulkTagBar
          selectedCount={selectedAssetIds.size}
          onAddTag={handleBulkAddTag}
          onRemoveTag={handleBulkRemoveTag}
          onDeselectAll={deselectAll}
          isLoading={bulkTagMutation.isPending}
          existingTags={tagsQuery.data ?? []}
        />
      )}
    </div>
  );
}
