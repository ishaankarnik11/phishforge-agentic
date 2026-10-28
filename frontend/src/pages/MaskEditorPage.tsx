/**
 * MaskEditorPage -- canvas-based mask editor for inpainting (STORY-A4.1).
 *
 * Full page at /assets/:id/edit. Two-column layout:
 * - Left (~70%): HTML5 canvas with image + mask overlay, brush/eraser tools
 * - Right (~30%): instruction textarea, Apply Edit button, result panel
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchLibraryAsset,
  maskEditAsset,
} from "../api/libraryAssets";
import type { LibraryAssetDetailRead } from "../api/libraryAssets";
import UserMenu from "../components/UserMenu";
import { Button, Card } from "../components/ds";
import Wordmark from "../components/shell/Wordmark";
import AuthorizationContextBar from "../components/shell/AuthorizationContextBar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tool = "brush" | "eraser";

// ---------------------------------------------------------------------------
// Mask-to-PNG conversion
// ---------------------------------------------------------------------------

/**
 * Convert the mask canvas into a PNG blob suitable for the OpenAI inpainting
 * mask format: transparent pixels = edit zone, opaque = preserve.
 */
function getMaskBlob(maskCanvas: HTMLCanvasElement): Promise<Blob> {
  const ctx = maskCanvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const data = imageData.data;

  const output = new ImageData(maskCanvas.width, maskCanvas.height);
  for (let i = 0; i < data.length; i += 4) {
    const painted = data[i + 3] > 0; // any alpha = painted
    output.data[i] = 0;     // R
    output.data[i + 1] = 0; // G
    output.data[i + 2] = 0; // B
    output.data[i + 3] = painted ? 0 : 255; // transparent if painted (edit zone)
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = maskCanvas.width;
  outputCanvas.height = maskCanvas.height;
  outputCanvas.getContext("2d")!.putImageData(output, 0, 0);

  return new Promise<Blob>((resolve) =>
    outputCanvas.toBlob((blob) => resolve(blob!), "image/png"),
  );
}

/**
 * Check whether any pixel on the mask canvas has been painted.
 */
function hasMaskContent(maskCanvas: HTMLCanvasElement): boolean {
  const ctx = maskCanvas.getContext("2d");
  if (!ctx) return false;
  const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MaskEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // -- Data fetching --------------------------------------------------------
  const assetQuery = useQuery({
    queryKey: ["library-asset", id],
    queryFn: () => fetchLibraryAsset(id!),
    enabled: !!id,
    staleTime: 30_000,
  });

  const asset = assetQuery.data;
  const primaryVersion = asset?.primary_version;

  // -- Canvas refs ----------------------------------------------------------
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);

  // -- Tool state -----------------------------------------------------------
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(30);
  const [instruction, setInstruction] = useState("");
  const [maskPainted, setMaskPainted] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);

  // -- Image dimensions stored after load -----------------------------------
  const [canvasDims, setCanvasDims] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // -- Result state ---------------------------------------------------------
  const [resultAsset, setResultAsset] = useState<LibraryAssetDetailRead | null>(
    null,
  );
  // Capture the original image URL before the edit so "Before" always
  // shows the pre-edit version even after queryClient cache is updated.
  const [beforeImageUrl, setBeforeImageUrl] = useState<string | null>(null);

  // -- Mouse position for custom cursor ------------------------------------
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  // -- Load image onto canvas when asset data arrives -----------------------
  useEffect(() => {
    if (!primaryVersion?.storage_url) return;

    const img = new Image();
    // Try with CORS first; fall back without if it fails (same-origin
    // images served from the backend don't need CORS headers).
    img.crossOrigin = "anonymous";
    const srcUrl = primaryVersion.storage_url!;
    img.onerror = () => {
      // Retry without crossOrigin — handles same-origin and mixed setups
      const retry = new Image();
      retry.onload = () => loadImageToCanvas(retry);
      retry.src = srcUrl;
    };
    img.onload = () => loadImageToCanvas(img);
    img.src = srcUrl;

    function loadImageToCanvas(loadedImg: HTMLImageElement) {
      const imageCanvas = imageCanvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      if (!imageCanvas || !maskCanvas) return;

      // Canvas dimensions MUST match original image size exactly —
      // OpenAI requires mask size == image size. CSS handles display scaling.
      const natW = loadedImg.naturalWidth;
      const natH = loadedImg.naturalHeight;

      imageCanvas.width = natW;
      imageCanvas.height = natH;
      maskCanvas.width = natW;
      maskCanvas.height = natH;

      // Display size: fit to container via CSS
      const containerWidth =
        canvasContainerRef.current?.clientWidth ?? natW;
      const displayW = Math.min(natW, containerWidth);
      const displayH = Math.round(displayW * (natH / natW));
      setCanvasDims({ width: displayW, height: displayH });

      const ctx = imageCanvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, natW, natH);
        ctx.drawImage(loadedImg, 0, 0, natW, natH);
      }
    }
  }, [primaryVersion?.storage_url]);

  // -- Drawing handlers -----------------------------------------------------
  const getCanvasPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      // Display coordinates (for CSS cursor positioning)
      const displayX = e.clientX - rect.left;
      const displayY = e.clientY - rect.top;
      // Canvas coordinates (for drawing — scaled to actual canvas size)
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: displayX * scaleX,
        y: displayY * scaleY,
        displayX,
        displayY,
      };
    },
    [],
  );

  const draw = useCallback(
    (x: number, y: number) => {
      const canvas = maskCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!ctx || !canvas) return;

      // Scale brush size from display to canvas coordinates
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      const scaledBrush = (brushSize / 2) * scale;

      ctx.save();
      if (tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(239, 68, 68, 0.4)";
      }
      ctx.beginPath();
      ctx.arc(x, y, scaledBrush, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    [tool, brushSize],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = getCanvasPoint(e);
      if (!pt) return;
      setIsDrawing(true);
      draw(pt.x, pt.y);
      if (tool === "brush") setMaskPainted(true);
    },
    [getCanvasPoint, draw, tool],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pt = getCanvasPoint(e);
      if (pt) setCursorPos({ x: pt.displayX, y: pt.displayY });
      if (!isDrawing || !pt) return;
      draw(pt.x, pt.y);
      if (tool === "brush") setMaskPainted(true);
    },
    [isDrawing, getCanvasPoint, draw, tool],
  );

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
    // Re-check mask content after eraser usage
    if (tool === "eraser" && maskCanvasRef.current) {
      setMaskPainted(hasMaskContent(maskCanvasRef.current));
    }
  }, [tool]);

  const handleMouseLeave = useCallback(() => {
    setIsDrawing(false);
    setCursorPos(null);
  }, []);

  // -- Clear mask -----------------------------------------------------------
  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setMaskPainted(false);
  }, []);

  // -- Mutation: mask edit --------------------------------------------------
  const maskEditMutation = useMutation({
    mutationFn: async ({
      assetId,
      maskBlob,
      inst,
      fromVersionId,
    }: {
      assetId: string;
      maskBlob: Blob;
      inst: string;
      fromVersionId?: string;
    }) => maskEditAsset(assetId, maskBlob, inst, fromVersionId),
    onSuccess: (updated: LibraryAssetDetailRead) => {
      queryClient.setQueryData(["library-asset", id], updated);
      queryClient.invalidateQueries({ queryKey: ["library-assets"] });
      setResultAsset(updated);
    },
  });

  const handleApplyEdit = useCallback(async () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas || !asset || maskEditMutation.isPending) return;
    // Capture the before image before mutation updates the cache
    setBeforeImageUrl(primaryVersion?.storage_url ?? null);
    const maskBlob = await getMaskBlob(maskCanvas);
    maskEditMutation.mutate({
      assetId: asset.id,
      maskBlob,
      inst: instruction.trim(),
      fromVersionId: primaryVersion?.id,
    });
  }, [asset, instruction, primaryVersion, maskEditMutation]);

  // -- Result actions -------------------------------------------------------
  const handleKeep = useCallback(() => {
    navigate(`/assets/${id}`);
  }, [navigate, id]);

  const handleTryAgain = useCallback(() => {
    setResultAsset(null);
    setBeforeImageUrl(null);
    setInstruction("");
    clearMask();
  }, [clearMask]);

  // -- Disable apply conditions --------------------------------------------
  const applyDisabled =
    !maskPainted ||
    instruction.trim().length < 5 ||
    maskEditMutation.isPending;

  // -- Render ---------------------------------------------------------------
  return (
    <div className="min-h-screen bg-surface-base">
      {/* Slim themed header (this full-screen editor lives outside the
          standard AppShell, so it carries its own chrome). */}
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-border-subtle bg-surface-chrome px-lg">
        <div className="flex items-center gap-6">
          <Wordmark />
          <nav className="flex gap-1">
            <Link
              to="/"
              className="rounded-ds-sm px-3 py-2 text-label text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink-strong"
            >
              Emailers
            </Link>
            <Link
              to="/assets"
              className="rounded-ds-sm bg-accent-subtle px-3 py-2 text-label text-ink-strong"
            >
              Asset Library
            </Link>
          </nav>
        </div>
        <UserMenu />
      </header>

      {/* Authorization Context Bar pinned below the fixed header: this is an
          authenticated screen outside the AppShell, so the boundary stays
          visible (DESIGN.md §5). */}
      <div className="fixed inset-x-0 top-14 z-40">
        <AuthorizationContextBar />
      </div>

      {/* Main content. Offset for the fixed header (56px) plus the
          authorization bar (~30px). */}
      <main className="mx-auto max-w-[1440px] px-lg pb-2xl pt-[6.25rem]">
        {/* Back link */}
        <Link
          to={`/assets/${id}`}
          data-testid="back-link"
          className="mb-lg inline-flex items-center gap-1 text-label text-accent transition-colors hover:text-accent-hover"
        >
          &larr; Back to Asset Detail
        </Link>

        {/* Loading state */}
        {assetQuery.isLoading && (
          <div
            data-testid="editor-skeleton"
            className="flex gap-6"
          >
            <div className="flex-[70] min-w-0">
              <div className="aspect-[4/3] w-full animate-pulse rounded-ds-lg bg-surface-sunken" />
            </div>
            <div className="flex flex-[30] min-w-0 flex-col gap-4">
              <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-5">
                <div className="mb-3 h-4 w-24 animate-pulse rounded-ds-sm bg-surface-sunken" />
                <div className="h-24 w-full animate-pulse rounded-ds-sm bg-surface-sunken" />
              </div>
            </div>
          </div>
        )}

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

        {/* Two-column editor layout */}
        {asset && !resultAsset && (
          <div data-testid="mask-editor" className="flex gap-6">
            {/* Left: Canvas area */}
            <div className="flex-[70] min-w-0">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-headline text-ink-strong">
                  {asset.name}
                </h2>
              </div>

              {/* Toolbar */}
              <div
                data-testid="toolbar"
                className="mb-3 flex flex-wrap items-center gap-4 rounded-ds-md border border-border-subtle bg-surface-raised px-4 py-2"
              >
                {/* Brush/Eraser toggle. Active state uses accent-subtle fill,
                    never a side stripe (DESIGN.md §6). */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    data-testid="brush-tool-btn"
                    onClick={() => setTool("brush")}
                    className={
                      "rounded-ds-sm px-3 py-1.5 text-label transition-colors " +
                      (tool === "brush"
                        ? "bg-accent-subtle text-accent"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink-strong")
                    }
                  >
                    Brush
                  </button>
                  <button
                    type="button"
                    data-testid="eraser-tool-btn"
                    onClick={() => setTool("eraser")}
                    className={
                      "rounded-ds-sm px-3 py-1.5 text-label transition-colors " +
                      (tool === "eraser"
                        ? "bg-accent-subtle text-accent"
                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink-strong")
                    }
                  >
                    Eraser
                  </button>
                </div>

                {/* Brush size slider */}
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="brush-size"
                    className="text-label text-ink-muted"
                  >
                    Size
                  </label>
                  <input
                    id="brush-size"
                    data-testid="brush-size-slider"
                    type="range"
                    min={10}
                    max={100}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="h-1.5 w-24 cursor-pointer appearance-none rounded-ds-full bg-surface-sunken accent-accent"
                  />
                  <span
                    data-testid="brush-size-value"
                    className="w-8 text-caption font-normal normal-case tracking-normal text-ink-muted"
                  >
                    {brushSize}px
                  </span>
                </div>

                {/* Clear mask */}
                <button
                  type="button"
                  data-testid="clear-mask-btn"
                  onClick={clearMask}
                  className="rounded-ds-sm border border-border-default px-3 py-1.5 text-label text-ink-muted transition-colors hover:bg-danger-subtle hover:text-danger"
                >
                  Clear mask
                </button>
              </div>

              {/* Canvas stack. The image/mask work area is the artifact: it
                  stays light, framed on a border-default edge. Drawing
                  behavior is unchanged. */}
              <div
                ref={canvasContainerRef}
                data-testid="canvas-container"
                className="relative inline-block rounded-ds-md border border-border-default bg-white"
                style={{
                  cursor: "none",
                  width: canvasDims ? `${canvasDims.width}px` : "100%",
                }}
              >
                <canvas
                  ref={imageCanvasRef}
                  data-testid="image-canvas"
                  className="block rounded-lg"
                  style={{
                    width: canvasDims ? `${canvasDims.width}px` : "100%",
                    height: canvasDims ? `${canvasDims.height}px` : "auto",
                  }}
                />
                <canvas
                  ref={maskCanvasRef}
                  data-testid="mask-canvas"
                  className="absolute inset-0 rounded-lg"
                  style={{
                    width: canvasDims ? `${canvasDims.width}px` : "100%",
                    height: canvasDims ? `${canvasDims.height}px` : "auto",
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                />

                {/* Custom brush cursor */}
                {cursorPos && (
                  <div
                    data-testid="brush-cursor"
                    className="pointer-events-none absolute rounded-full border-2 border-white"
                    style={{
                      width: `${brushSize}px`,
                      height: `${brushSize}px`,
                      left: `${cursorPos.x - brushSize / 2}px`,
                      top: `${cursorPos.y - brushSize / 2}px`,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Right: Sidebar */}
            <div className="flex flex-[30] min-w-0 flex-col gap-4">
              {/* Instruction card */}
              <Card>
                <h3 className="mb-3 text-caption text-ink-muted">
                  Edit Instruction
                </h3>
                <textarea
                  data-testid="instruction-textarea"
                  rows={4}
                  placeholder="What should appear in the painted area?"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  disabled={maskEditMutation.isPending}
                  className="w-full resize-none rounded-ds-sm border border-border-default bg-surface-raised px-3 py-2.5 text-body text-ink-body placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/35 disabled:bg-surface-sunken disabled:text-ink-faint"
                />

                {/* We keep the custom spinner (with its data-testid) and drive
                    the disabled state manually rather than using Button's
                    `loading` prop, because the loading-state spec asserts on
                    the `apply-edit-spinner` testid specifically. */}
                <Button
                  variant="primary"
                  data-testid="apply-edit-btn"
                  onClick={handleApplyEdit}
                  disabled={applyDisabled}
                  className="mt-3 w-full"
                  leadingIcon={
                    maskEditMutation.isPending ? (
                      <svg
                        data-testid="apply-edit-spinner"
                        className="h-4 w-4 animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
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
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    ) : undefined
                  }
                >
                  {maskEditMutation.isPending ? "Applying..." : "Apply Edit"}
                </Button>

                {maskEditMutation.isError && (
                  <p
                    data-testid="mask-edit-error"
                    className="mt-2 rounded-ds-sm border border-danger/30 bg-danger-subtle px-3 py-2 text-caption font-normal normal-case tracking-normal text-danger"
                  >
                    {maskEditMutation.error instanceof Error
                      ? maskEditMutation.error.message
                      : "Mask edit failed"}
                  </p>
                )}
              </Card>

              {/* Tips */}
              <Card>
                <h3 className="mb-3 text-caption text-ink-muted">
                  Tips
                </h3>
                <ul className="space-y-2 text-caption font-normal normal-case tracking-normal text-ink-muted">
                  <li>Paint over the area you want to change</li>
                  <li>Use the eraser to fix mistakes</li>
                  <li>Describe what should replace the painted area</li>
                  <li>Larger brush sizes cover more area faster</li>
                </ul>
              </Card>
            </div>
          </div>
        )}

        {/* Result: Before/After comparison. The image artifacts stay light
            on a framed card. */}
        {asset && resultAsset && (
          <div data-testid="result-panel" className="max-w-4xl mx-auto">
            <h2 className="mb-6 text-headline text-ink-strong">
              Edit Result
            </h2>
            <div className="grid grid-cols-2 gap-6">
              {/* Before */}
              <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-4">
                <p className="mb-2 text-label text-ink-muted">
                  Before
                </p>
                {beforeImageUrl && (
                  <img
                    data-testid="before-image"
                    src={beforeImageUrl}
                    alt="Before edit"
                    className="w-full rounded-ds-sm object-contain"
                  />
                )}
              </div>
              {/* After */}
              <div className="rounded-ds-md border border-border-subtle bg-surface-raised p-4">
                <p className="mb-2 text-label text-ink-muted">
                  After
                </p>
                {resultAsset.primary_version?.storage_url && (
                  <img
                    data-testid="after-image"
                    src={resultAsset.primary_version.storage_url}
                    alt="After edit"
                    className="w-full rounded-ds-sm object-contain"
                  />
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-6 flex items-center justify-center gap-4">
              <Button
                variant="primary"
                size="lg"
                data-testid="keep-version-btn"
                onClick={handleKeep}
              >
                Keep this version
              </Button>
              <Button
                variant="secondary"
                size="lg"
                data-testid="try-again-btn"
                onClick={handleTryAgain}
              >
                Try again
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
