import { useState } from "react";
import type { Editor } from "grapesjs";
import { useLivePreviewHtml } from "./useLivePreviewHtml";

type Viewport = "desktop" | "mobile";

interface PreviewPaneProps {
  /**
   * The server-compiled HTML for the active version. Used as the source of
   * truth immediately after a save, AI-chat apply, or history restore (per
   * STORY-4.6 AC-3 — the server-compiled output is what eventually ships).
   *
   * Pass a fresh string reference (e.g. via React state) when you want the
   * preview to snap to the saved HTML; the bridging hook detects reference
   * change to trigger the live → server-compiled swap.
   */
  compiledHtml: string | null;
  /**
   * Live GrapesJS editor instance. When provided, the preview iframe is
   * driven from the editor's in-memory model between saves
   * (debounced ≤300ms after `component:update`, `component:add`,
   * `component:remove`, `component:styleUpdate`). Pass `null` to keep the
   * iframe purely server-compiled.
   *
   * See `useLivePreviewHtml.ts` JSDoc for the full live↔server-compiled
   * contract and the no-flash transition guarantee (AC-4).
   */
  editor?: Editor | null;
}

const VIEWPORT_WIDTHS: Record<Viewport, string> = {
  desktop: "100%",
  mobile: "375px",
};

/**
 * Right-pane email preview.
 *
 * ## Source contract (STORY-4.6)
 *
 *  - When an `editor` is wired in, the iframe content is derived from the
 *    live GrapesJS model via `mjml-code-to-html`, debounced ≤300ms.
 *    See {@link useLivePreviewHtml} for details.
 *  - When `compiledHtml` changes by reference (save / AI apply / history
 *    restore), the iframe snaps to that value because the server-compiled
 *    HTML is what eventually ships.
 *  - During the live → server-compiled swap there is no flash of stale or
 *    blank content: the previous HTML stays painted until the next source
 *    is ready.
 *
 * ## Viewport toggle (STORY-4.6 AC-6)
 *
 * Mobile / desktop toggle is purely a visual width clamp on the iframe —
 * unaffected by the source-mode plumbing above.
 */
export default function PreviewPane({
  compiledHtml,
  editor = null,
}: PreviewPaneProps) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const { html } = useLivePreviewHtml(editor, compiledHtml);

  return (
    // The preview canvas reads as "the artifact": a surface-sunken gutter sets
    // the email apart from the themed chrome (DESIGN.md §2, §5).
    <div className="flex h-full flex-col bg-surface-sunken">
      {/* Viewport toggle bar (themed chrome). Ghost-style toggles whose active
          state is conveyed by accent-subtle fill, never a side stripe. */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-chrome px-md py-2">
        <span className="text-label text-ink-muted">Preview</span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            className={`rounded-ds-sm px-3 py-1 text-label transition-colors ${
              viewport === "desktop"
                ? "bg-accent-subtle text-accent"
                : "text-ink-body hover:bg-surface-sunken"
            }`}
            aria-pressed={viewport === "desktop"}
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            className={`rounded-ds-sm px-3 py-1 text-label transition-colors ${
              viewport === "mobile"
                ? "bg-accent-subtle text-accent"
                : "text-ink-body hover:bg-surface-sunken"
            }`}
            aria-pressed={viewport === "mobile"}
          >
            Mobile
          </button>
        </div>
      </div>

      {/* Preview iframe container. The iframe stays light regardless of theme:
          it mimics a real inbox. We frame it with a border-default edge so it
          reads as a discrete artifact on the sunken gutter. */}
      <div className="flex flex-1 justify-center overflow-auto p-md">
        {html ? (
          <iframe
            title="Email preview"
            srcDoc={html}
            sandbox="allow-same-origin"
            className="border border-border-default bg-white shadow-raise"
            style={{
              width: VIEWPORT_WIDTHS[viewport],
              maxWidth: "100%",
              height: "100%",
              minHeight: "500px",
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-body text-ink-faint">
              No preview available. Generate content first.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
