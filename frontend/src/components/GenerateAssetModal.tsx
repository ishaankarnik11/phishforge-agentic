/**
 * GenerateAssetModal — AI image generation form (STORY-A2.1).
 *
 * Centered overlay modal with:
 * - Asset name + prompt inputs
 * - Style preset selectors (4 axes, one chip per axis)
 * - Dimension presets or custom width/height
 * - Reference images placeholder drop zone
 * - Generate button with cost indicator
 * - Loading state with elapsed timer
 * - Error state with retry affordance
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateAsset, generateAssetWithRefs } from "../api/libraryAssets";
import type {
  GenerateAssetRequest,
  GenerateAssetStylePresets,
  LibraryAssetDetailRead,
} from "../api/libraryAssets";
import { Button, Input, Select, Textarea } from "./ds";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GenerateAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (asset: LibraryAssetDetailRead) => void;
}

// ---------------------------------------------------------------------------
// Style preset options
// ---------------------------------------------------------------------------

const VISUAL_STYLE_OPTIONS = [
  "Corporate Clean",
  "Premium Luxury",
  "Modern Gradient",
  "Photorealistic",
  "Illustrated",
  "Watercolor",
] as const;

const MOOD_OPTIONS = [
  "Trustworthy & Calm",
  "Dynamic & Energetic",
  "Warm & Personal",
  "Bold & Celebratory",
  "Urgent & Direct",
] as const;

const TEXTURE_OPTIONS = [
  "Matte Paper",
  "Glass & Light",
  "Solid & Flat",
  "Soft Depth",
  "Metallic",
] as const;

const LAYOUT_OPTIONS = [
  "Left Copy Space",
  "Center Focal",
  "Full Bleed",
  "Split Panel",
] as const;

// ---------------------------------------------------------------------------
// Dimension presets
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

const CUSTOM_RATIOS = [
  { label: "3:1", ratio: 3 },
  { label: "2:1", ratio: 2 },
  { label: "3:2", ratio: 1.5 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "1:1", ratio: 1 },
  { label: "3:4", ratio: 3 / 4 },
] as const;

/** Snap a number to the nearest multiple of 16, clamped between 320-1024. */
function snapTo16(value: number): number {
  const clamped = Math.max(320, Math.min(1024, value));
  return Math.round(clamped / 16) * 16;
}

// ---------------------------------------------------------------------------
// Reference image constraints
// ---------------------------------------------------------------------------

const MAX_REFERENCE_FILES = 16;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

// ---------------------------------------------------------------------------
// StylePresetRow sub-component
// ---------------------------------------------------------------------------

interface StylePresetRowProps {
  label: string;
  options: readonly string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  testIdPrefix: string;
}

function StylePresetRow({
  label,
  options,
  selected,
  onSelect,
  testIdPrefix,
}: StylePresetRowProps) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-caption text-ink-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isActive = selected === option;
          return (
            <button
              key={option}
              type="button"
              data-testid={`${testIdPrefix}-${option.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              onClick={() => onSelect(isActive ? null : option)}
              className={
                "rounded-ds-full border px-3 py-1.5 text-label transition-colors duration-fast " +
                (isActive
                  ? "border-accent-border bg-accent-subtle text-accent"
                  : "border-border-default bg-surface-raised text-ink-muted hover:border-accent-border hover:text-accent")
              }
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GenerateAssetModal({
  isOpen,
  onClose,
  onSuccess,
}: GenerateAssetModalProps) {
  const queryClient = useQueryClient();

  // -- Form state ------------------------------------------------------------
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [stylePresets, setStylePresets] = useState<GenerateAssetStylePresets>({
    visual_style: null,
    mood: null,
    texture: null,
    layout: null,
  });
  const [dimensionPresetIndex, setDimensionPresetIndex] = useState(0); // 0,1,2 = presets; 3 = custom
  const [customWidth, setCustomWidth] = useState(608);
  const [customRatioIndex, setCustomRatioIndex] = useState(0);

  // -- Reference images state -------------------------------------------------
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [refError, setRefError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Validation state ------------------------------------------------------
  const [nameError, setNameError] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);

  // -- Loading timer ---------------------------------------------------------
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -- Mutation ---------------------------------------------------------------
  const mutation = useMutation({
    mutationFn: (vars: { request: GenerateAssetRequest; files: File[] }) =>
      vars.files.length > 0
        ? generateAssetWithRefs(vars.request, vars.files)
        : generateAsset(vars.request),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      onSuccess(asset);
      resetForm();
    },
  });

  // -- Computed dimensions ---------------------------------------------------
  const isCustom = dimensionPresetIndex === 3;
  const currentWidth = isCustom
    ? snapTo16(customWidth)
    : DIMENSION_PRESETS[dimensionPresetIndex].width;
  const currentHeight = isCustom
    ? snapTo16(Math.round(customWidth / CUSTOM_RATIOS[customRatioIndex].ratio))
    : DIMENSION_PRESETS[dimensionPresetIndex].height;

  // -- Effects ---------------------------------------------------------------

  // Elapsed timer during generation
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !mutation.isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, mutation.isPending]);

  // -- Helpers ---------------------------------------------------------------

  const resetForm = useCallback(() => {
    setName("");
    setPrompt("");
    setStylePresets({ visual_style: null, mood: null, texture: null, layout: null });
    setDimensionPresetIndex(0);
    setCustomWidth(608);
    setCustomRatioIndex(0);
    setNameError(null);
    setPromptError(null);
    setReferenceFiles([]);
    setRefError(null);
    setIsDraggingOver(false);
    setElapsedSeconds(0);
    mutation.reset();
  }, [mutation]);

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

    const request: GenerateAssetRequest = {
      name: name.trim(),
      prompt: prompt.trim(),
      style_presets: stylePresets,
      width: currentWidth,
      height: currentHeight,
      quality: "high",
    };

    mutation.mutate({ request, files: referenceFiles });
  };

  // -- Reference image helpers ------------------------------------------------

  /** Validate and add files, returning any error string or null. */
  const addReferenceFiles = useCallback(
    (incoming: FileList | File[]) => {
      setRefError(null);
      const files = Array.from(incoming);

      // Check MIME types
      const invalidType = files.find(
        (f) => !(ACCEPTED_MIME_TYPES as readonly string[]).includes(f.type),
      );
      if (invalidType) {
        setRefError(`"${invalidType.name}" is not a supported image type (PNG, JPEG, WebP).`);
        return;
      }

      // Check file size
      const tooLarge = files.find((f) => f.size > MAX_FILE_SIZE_BYTES);
      if (tooLarge) {
        setRefError(`"${tooLarge.name}" exceeds the 20 MB size limit.`);
        return;
      }

      // Check total count
      const totalAfterAdd = referenceFiles.length + files.length;
      if (totalAfterAdd > MAX_REFERENCE_FILES) {
        setRefError(
          `You can add up to ${MAX_REFERENCE_FILES} reference images. Adding ${files.length} would exceed the limit.`,
        );
        return;
      }

      setReferenceFiles((prev) => [...prev, ...files]);
    },
    [referenceFiles.length],
  );

  const removeReferenceFile = useCallback((index: number) => {
    setReferenceFiles((prev) => prev.filter((_, i) => i !== index));
    setRefError(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!mutation.isPending) setIsDraggingOver(true);
    },
    [mutation.isPending],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
      if (mutation.isPending) return;
      if (e.dataTransfer.files.length > 0) {
        addReferenceFiles(e.dataTransfer.files);
      }
    },
    [mutation.isPending, addReferenceFiles],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addReferenceFiles(e.target.files);
      }
      // Reset the input so the same file can be selected again
      e.target.value = "";
    },
    [addReferenceFiles],
  );

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !mutation.isPending) {
      onClose();
    }
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      onClose();
    }
  };

  // -- Render ----------------------------------------------------------------

  if (!isOpen) return null;

  return (
    <div
      data-testid="generate-modal-backdrop"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-strong/40 p-md"
      onClick={handleBackdropClick}
    >
      <div
        data-testid="generate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-modal-title"
        className="relative max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-ds-md border border-border-subtle bg-surface-raised shadow-dialog"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-ds-md border-b border-border-subtle bg-surface-raised px-lg py-md">
          <h2
            id="generate-modal-title"
            className="text-title text-ink-strong"
          >
            Generate New Asset
          </h2>
          <button
            type="button"
            data-testid="modal-close-btn"
            onClick={handleClose}
            disabled={mutation.isPending}
            className="flex h-8 w-8 items-center justify-center rounded-ds-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong disabled:opacity-50"
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-lg py-md">
          {/* Asset Name */}
          <div className="mb-4">
            <label
              htmlFor="asset-name"
              className="mb-1.5 block text-label text-ink-body"
            >
              Asset Name
            </label>
            <Input
              id="asset-name"
              data-testid="asset-name-input"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
              disabled={mutation.isPending}
              invalid={Boolean(nameError)}
              aria-describedby={nameError ? "name-error" : undefined}
              placeholder="e.g., Payroll Portal Login Banner"
            />
            {nameError && (
              <p
                id="name-error"
                data-testid="name-error"
                role="alert"
                className="mt-2xs text-caption font-normal normal-case tracking-normal text-danger"
              >
                {nameError}
              </p>
            )}
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <label
              htmlFor="asset-prompt"
              className="mb-1.5 block text-label text-ink-body"
            >
              Prompt
            </label>
            <Textarea
              id="asset-prompt"
              data-testid="asset-prompt-input"
              rows={3}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (promptError) setPromptError(null);
              }}
              disabled={mutation.isPending}
              invalid={Boolean(promptError)}
              aria-describedby={promptError ? "prompt-error" : undefined}
              placeholder="A professional login portal banner for a corporate IT services brand, clean geometric layout in restrained indigo"
            />
            {promptError && (
              <p
                id="prompt-error"
                data-testid="prompt-error"
                role="alert"
                className="mt-2xs text-caption font-normal normal-case tracking-normal text-danger"
              >
                {promptError}
              </p>
            )}
            <p className="mt-1 text-caption font-normal normal-case tracking-normal text-ink-faint">
              {prompt.length}/2000 characters
            </p>
          </div>

          {/* Style Presets */}
          <div className="mb-5">
            <h3 className="mb-1 text-label text-ink-strong">Style Presets</h3>
            <p className="mb-3 text-caption font-normal normal-case tracking-normal text-ink-faint">
              (pick up to 4, one per row)
            </p>

            <StylePresetRow
              label="Visual Style"
              options={VISUAL_STYLE_OPTIONS}
              selected={stylePresets.visual_style}
              onSelect={(v) =>
                setStylePresets((s) => ({ ...s, visual_style: v }))
              }
              testIdPrefix="style-visual"
            />
            <StylePresetRow
              label="Mood / Energy"
              options={MOOD_OPTIONS}
              selected={stylePresets.mood}
              onSelect={(v) => setStylePresets((s) => ({ ...s, mood: v }))}
              testIdPrefix="style-mood"
            />
            <StylePresetRow
              label="Texture / Finish"
              options={TEXTURE_OPTIONS}
              selected={stylePresets.texture}
              onSelect={(v) => setStylePresets((s) => ({ ...s, texture: v }))}
              testIdPrefix="style-texture"
            />
            <StylePresetRow
              label="Layout / Space"
              options={LAYOUT_OPTIONS}
              selected={stylePresets.layout}
              onSelect={(v) => setStylePresets((s) => ({ ...s, layout: v }))}
              testIdPrefix="style-layout"
            />
          </div>

          {/* Dimensions */}
          <div className="mb-5">
            <label
              htmlFor="dimension-select"
              className="mb-1.5 block text-label text-ink-body"
            >
              Dimensions
            </label>
            <Select
              id="dimension-select"
              data-testid="dimension-select"
              value={dimensionPresetIndex}
              onChange={(e) => setDimensionPresetIndex(Number(e.target.value))}
              disabled={mutation.isPending}
            >
              {DIMENSION_PRESETS.map((preset, i) => (
                <option key={i} value={i}>
                  {preset.label}
                </option>
              ))}
              <option value={3}>Custom</option>
            </Select>

            {isCustom && (
              <div className="mt-3 flex items-end gap-3">
                <div className="flex-1">
                  <label
                    htmlFor="custom-ratio"
                    className="mb-1 block text-label text-ink-muted"
                  >
                    Ratio
                  </label>
                  <Select
                    id="custom-ratio"
                    data-testid="custom-ratio-select"
                    value={customRatioIndex}
                    onChange={(e) =>
                      setCustomRatioIndex(Number(e.target.value))
                    }
                    disabled={mutation.isPending}
                  >
                    {CUSTOM_RATIOS.map((r, i) => (
                      <option key={i} value={i}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="custom-width"
                    className="mb-1 block text-label text-ink-muted"
                  >
                    Width (px)
                  </label>
                  <Input
                    id="custom-width"
                    data-testid="custom-width-input"
                    type="number"
                    min={320}
                    max={1024}
                    step={16}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                    onBlur={() => setCustomWidth(snapTo16(customWidth))}
                    disabled={mutation.isPending}
                  />
                </div>
                <div className="flex-1">
                  <p className="mb-1 text-label text-ink-muted">Height (px)</p>
                  <p
                    data-testid="custom-height-display"
                    className="flex h-9 items-center rounded-ds-sm border border-border-default bg-surface-sunken px-3 text-body text-ink-muted"
                  >
                    {currentHeight}
                  </p>
                </div>
              </div>
            )}

            <p className="mt-1.5 text-caption font-normal normal-case tracking-normal text-ink-faint">
              Output: {currentWidth} x {currentHeight} px
            </p>
          </div>

          {/* Reference images drop zone */}
          <div className="mb-5">
            <label className="mb-1.5 block text-label text-ink-body">
              Reference Images{" "}
              <span className="font-normal normal-case tracking-normal text-ink-muted">
                (optional, up to {MAX_REFERENCE_FILES})
              </span>
            </label>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              data-testid="reference-file-input"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileInputChange}
              disabled={mutation.isPending}
            />

            {/* Drop zone */}
            <div
              data-testid="reference-drop-zone"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!mutation.isPending) fileInputRef.current?.click();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !mutation.isPending) {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={
                "flex flex-col items-center justify-center rounded-ds-md border-2 border-dashed px-4 py-6 text-center transition-colors " +
                (mutation.isPending
                  ? "cursor-not-allowed border-border-default bg-surface-sunken opacity-60 "
                  : isDraggingOver
                    ? "cursor-copy border-accent bg-accent-subtle "
                    : "cursor-pointer border-border-default bg-surface-sunken hover:border-accent hover:bg-accent-subtle ")
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mb-2 h-8 w-8 text-ink-faint"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                />
              </svg>
              <p className="text-body text-ink-body">
                Drop reference images here or{" "}
                <span className="font-medium text-accent">browse</span>
              </p>
              <p className="mt-1 text-caption font-normal normal-case tracking-normal text-ink-faint">
                PNG, JPG, WebP &middot; max 20 MB each
              </p>
            </div>

            {/* Thumbnails grid */}
            {referenceFiles.length > 0 && (
              <div className="mt-3">
                <p
                  data-testid="reference-file-count"
                  className="mb-2 text-caption font-normal normal-case tracking-normal text-ink-muted"
                >
                  {referenceFiles.length} of {MAX_REFERENCE_FILES} reference
                  images
                </p>
                <div className="flex flex-wrap gap-2">
                  {referenceFiles.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      data-testid={`reference-thumbnail-${index}`}
                      className="group relative h-20 w-20 overflow-hidden rounded-ds-md border border-border-subtle"
                    >
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="h-full w-full object-cover"
                        onLoad={(e) => {
                          // Revoke the object URL after the image loads to free memory
                          URL.revokeObjectURL(
                            (e.target as HTMLImageElement).src,
                          );
                        }}
                      />
                      {!mutation.isPending && (
                        <button
                          type="button"
                          data-testid={`reference-remove-${index}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeReferenceFile(index);
                          }}
                          className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-ds-full bg-ink-strong/60 text-on-accent opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label={`Remove ${file.name}`}
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
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error message */}
            {refError && (
              <p
                data-testid="reference-error"
                className="mt-1.5 text-caption font-normal normal-case tracking-normal text-danger"
              >
                {refError}
              </p>
            )}
          </div>

          {/* Error message */}
          {mutation.isError && (
            <div
              data-testid="generate-error"
              className="mb-4 rounded-ds-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body text-danger"
            >
              <strong className="font-medium">Error:</strong>{" "}
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Generation failed. Please try again."}
              <div className="mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="retry-button"
                  onClick={() => handleSubmit()}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}

          {/* Loading state */}
          {mutation.isPending && (
            <div
              data-testid="generate-loading"
              className="mb-4 flex items-center gap-3 rounded-ds-md border border-info/30 bg-info-subtle px-4 py-3"
            >
              <div className="h-5 w-5 animate-spin rounded-ds-full border-2 border-info border-t-transparent" />
              <div>
                <p className="text-body font-medium text-info">
                  Generating your image with GPT Image...
                </p>
                <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
                  Elapsed: {elapsedSeconds}s
                </p>
              </div>
            </div>
          )}

          {/* Submit button + cost */}
          <div className="flex flex-col items-center">
            <Button
              type="submit"
              variant="primary"
              data-testid="generate-submit-btn"
              loading={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? "Generating..." : "Generate Image"}
            </Button>
            <p className="mt-2 text-caption font-normal normal-case tracking-normal text-ink-faint">
              ~$0.04-0.08 per generation
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
