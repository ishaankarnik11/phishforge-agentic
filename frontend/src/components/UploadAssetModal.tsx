/**
 * UploadAssetModal -- upload images to the asset library (STORY-A1.2).
 *
 * Modal overlay with:
 * - Drag-and-drop zone (or file picker)
 * - File preview + metadata when a file is selected
 * - Asset name (required, pre-filled from filename)
 * - Tags (optional, comma-separated)
 * - Client-side validation (MIME type, file size 50 MB)
 * - TanStack Query mutation for the upload call
 * - Loading, error, and success states
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadLibraryAsset } from "../api/libraryAssets";
import type { LibraryAssetDetailRead } from "../api/libraryAssets";
import { Button, Field, Input } from "./ds";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

const ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",");

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UploadAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (asset: LibraryAssetDetailRead) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAllowedMime(type: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UploadAssetModal({
  isOpen,
  onClose,
  onSuccess,
}: UploadAssetModalProps) {
  const queryClient = useQueryClient();

  // -- Form state ----------------------------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");

  // -- Validation state ----------------------------------------------------
  const [nameError, setNameError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // -- Drag state ----------------------------------------------------------
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // -- Refs ----------------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Mutation -------------------------------------------------------------
  const mutation = useMutation({
    mutationFn: ({
      uploadFile,
      uploadName,
      uploadTags,
    }: {
      uploadFile: File;
      uploadName: string;
      uploadTags?: string[];
    }) => uploadLibraryAsset(uploadFile, uploadName, uploadTags),
    onSuccess: (asset) => {
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      onSuccess(asset);
      resetForm();
    },
  });

  // -- Effects -------------------------------------------------------------

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

  // Revoke object URL on cleanup
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // -- Helpers -------------------------------------------------------------

  const resetForm = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(null);
    setName("");
    setTags("");
    setNameError(null);
    setFileError(null);
    setIsDragOver(false);
    dragCounterRef.current = 0;
    mutation.reset();
  }, [previewUrl, mutation]);

  const validateFile = useCallback((f: File): string | null => {
    if (!isAllowedMime(f.type)) {
      return `Invalid file type "${f.type || "unknown"}". Accepted: PNG, JPEG, WebP, GIF, SVG.`;
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      return `File is too large (${formatFileSize(f.size)}). Maximum size is 50 MB.`;
    }
    return null;
  }, []);

  const selectFile = useCallback(
    (f: File) => {
      const error = validateFile(f);
      if (error) {
        setFileError(error);
        return;
      }
      setFileError(null);
      mutation.reset();

      // Revoke previous preview
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));

      // Pre-fill asset name from filename (without extension)
      if (!name.trim()) {
        setName(stripExtension(f.name));
      }
    },
    [validateFile, previewUrl, name, mutation],
  );

  const validate = (): boolean => {
    let valid = true;

    if (!file) {
      setFileError("Please select a file to upload.");
      valid = false;
    }

    if (!name.trim()) {
      setNameError("Asset name is required.");
      valid = false;
    } else {
      setNameError(null);
    }

    return valid;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!validate() || !file) return;

    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    mutation.mutate({
      uploadFile: file,
      uploadName: name.trim(),
      uploadTags: parsedTags.length > 0 ? parsedTags : undefined,
    });
  };

  // -- Drag-and-drop handlers -----------------------------------------------

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles.length > 0) {
        selectFile(droppedFiles[0]);
      }
    },
    [selectFile],
  );

  // -- File picker handler --------------------------------------------------

  const openPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        selectFile(files[0]);
      }
      // Reset so re-selecting the same file still triggers change
      e.target.value = "";
    },
    [selectFile],
  );

  // -- Event handlers -------------------------------------------------------

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

  const removeFile = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setPreviewUrl(null);
    setFileError(null);
  }, [previewUrl]);

  // -- Render --------------------------------------------------------------

  if (!isOpen) return null;

  return (
    <div
      data-testid="upload-modal-backdrop"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-strong/40 p-md"
      onClick={handleBackdropClick}
    >
      <div
        data-testid="upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-modal-title"
        className="relative max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-ds-md border border-border-subtle bg-surface-raised shadow-dialog"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-ds-md border-b border-border-subtle bg-surface-raised px-lg py-md">
          <h2
            id="upload-modal-title"
            className="text-title text-ink-strong"
          >
            Upload Asset
          </h2>
          <button
            type="button"
            data-testid="upload-modal-close-btn"
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
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={onPickerChange}
            className="sr-only"
            aria-label="Upload image file"
            data-testid="upload-file-input"
          />

          {/* Drag-and-drop zone / file preview */}
          {!file ? (
            <div
              data-testid="upload-drop-zone"
              role="button"
              tabIndex={0}
              onClick={openPicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPicker();
                }
              }}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={
                "mb-4 flex cursor-pointer flex-col items-center justify-center rounded-ds-md border-2 border-dashed px-4 py-10 text-center transition-colors " +
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
                (isDragOver
                  ? "border-accent bg-accent-subtle"
                  : "border-border-default bg-surface-sunken hover:border-accent hover:bg-accent-subtle")
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mb-3 h-10 w-10 text-ink-faint"
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
                Drag & drop an image here, or{" "}
                <span className="font-medium text-accent">
                  click to browse
                </span>
              </p>
              <p className="mt-2 text-caption font-normal normal-case tracking-normal text-ink-muted">
                PNG, JPEG, WebP, GIF, SVG. Max 50 MB.
              </p>
            </div>
          ) : (
            <div
              data-testid="upload-file-preview"
              className="mb-4 flex items-center gap-4 rounded-ds-md border border-border-subtle bg-surface-sunken p-3"
            >
              {/* Thumbnail */}
              {previewUrl && (
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-ds-md bg-surface-raised">
                  <img
                    src={previewUrl}
                    alt="Preview"
                    data-testid="upload-thumbnail"
                    className="h-full w-full object-contain"
                  />
                </div>
              )}
              {/* File info */}
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-body font-medium text-ink-strong"
                  data-testid="upload-filename"
                >
                  {file.name}
                </p>
                <p
                  className="text-caption font-normal normal-case tracking-normal text-ink-muted"
                  data-testid="upload-filesize"
                >
                  {formatFileSize(file.size)}
                </p>
              </div>
              {/* Remove button */}
              <button
                type="button"
                data-testid="upload-remove-file"
                onClick={removeFile}
                disabled={mutation.isPending}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-ds-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-danger disabled:opacity-50"
                aria-label="Remove file"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* File error */}
          {fileError && (
            <p
              data-testid="file-error"
              className="mb-4 text-caption font-normal normal-case tracking-normal text-danger"
            >
              {fileError}
            </p>
          )}

          {/* Asset Name */}
          <div className="mb-4">
            <Field label="Asset Name">
              {({ id, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={nameError ? "upload-name-error" : undefined}
                  invalid={invalid || Boolean(nameError)}
                  data-testid="upload-name-input"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  disabled={mutation.isPending}
                  placeholder="e.g., Q3 Payroll Update Banner"
                />
              )}
            </Field>
            {nameError && (
              <p
                id="upload-name-error"
                data-testid="upload-name-error"
                role="alert"
                className="mt-2xs flex items-center gap-1 text-caption font-normal normal-case tracking-normal text-danger"
              >
                {nameError}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="mb-5">
            <Field
              label="Tags"
              required={false}
              help="Separate tags with commas"
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  data-testid="upload-tags-input"
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  disabled={mutation.isPending}
                  placeholder="e.g., banner, payroll, internal"
                />
              )}
            </Field>
          </div>

          {/* Error message (API errors) */}
          {mutation.isError && (
            <div
              data-testid="upload-error"
              className="mb-4 rounded-ds-md border border-danger/30 bg-danger-subtle px-4 py-3 text-body text-danger"
            >
              <strong className="font-medium">Error:</strong>{" "}
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Upload failed. Please try again."}
            </div>
          )}

          {/* Loading state */}
          {mutation.isPending && (
            <div
              data-testid="upload-loading"
              className="mb-4 flex items-center gap-3 rounded-ds-md border border-info/30 bg-info-subtle px-4 py-3"
            >
              <div className="h-5 w-5 animate-spin rounded-ds-full border-2 border-info border-t-transparent" />
              <p className="text-body font-medium text-info">Uploading...</p>
            </div>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            variant="primary"
            data-testid="upload-submit-btn"
            loading={mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? "Uploading..." : "Upload Asset"}
          </Button>
        </form>
      </div>
    </div>
  );
}
