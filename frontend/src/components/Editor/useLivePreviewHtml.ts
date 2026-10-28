import { useEffect, useRef, useState } from "react";
import type { Editor } from "grapesjs";

/**
 * Mode hint emitted alongside the resolved HTML.
 *
 *  - `live`            — derived from the in-memory GrapesJS model via the
 *                        `mjml-code-to-html` command. Updates while the user
 *                        is mutating the canvas (RTE, drag-drop, attribute
 *                        panel changes).
 *  - `server-compiled` — `savedCompiledHtml` from the server's last
 *                        MJML→HTML compile. Used immediately after a save,
 *                        AI-chat apply, or history restore.
 *  - `empty`           — neither input is available yet (initial mount).
 */
export type PreviewMode = "live" | "server-compiled" | "empty";

/**
 * Default debounce window for live recomputation. STORY-4.6 AC-2 requires
 * `≤300ms`. Exported for the test suite so it can advance fake timers
 * symbolically.
 */
export const LIVE_PREVIEW_DEBOUNCE_MS = 250;

/**
 * GrapesJS events that should trigger a live recompute. Per STORY-4.6 AC-2
 * spec, exactly these four events.
 */
export const LIVE_PREVIEW_EVENTS = [
  "component:update",
  "component:add",
  "component:remove",
  "component:styleUpdate",
] as const;

interface UseLivePreviewHtmlResult {
  /** HTML to feed into the preview iframe's `srcDoc`. May be `null` only
   *  when both saved HTML and editor are absent (initial mount). */
  html: string | null;
  /** Which source produced `html`. Useful for tests and for future
   *  diagnostics; the preview iframe itself is mode-agnostic. */
  mode: PreviewMode;
}

/**
 * Compile the editor's current MJML to HTML using `grapesjs-mjml`'s built-in
 * `mjml-code-to-html` command. Returns `null` if the command is missing or
 * throws — callers should fall back to the last successful render to avoid
 * flashing a blank iframe.
 *
 * The command returns the same shape as `mjml-browser`'s parser:
 *   `{ html: string, errors: Array<...>, ... }`
 *
 * STORY-7.12 AC-4: ``errors`` (a.k.a. mjml-browser warnings) are *never*
 * surfaced in the UI. With STORY-7.10's save-time validator in place, the
 * MJML the preview compiles is always valid by construction — anything
 * mjml-browser flags here is a transient artifact of an in-progress edit
 * (e.g. an attribute panel value that just blanked while the user types
 * a new one) and not actionable for the user. We log them to
 * ``console.warn`` so a developer triaging a desync can still see them
 * in the browser console; we do *not* render them.
 */
function compileLiveHtml(editor: Editor): string | null {
  try {
    // justified: grapesjs typings declare runCommand as returning `any`; the
    // mjml plugin's command returns whatever mjml-browser returns.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = editor.runCommand("mjml-code-to-html");
    if (result && typeof result === "object" && typeof result.html === "string") {
      // Diagnostic-only logging of warnings. AC-4: never rendered to the
      // user — see this function's JSDoc for the rationale.
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        console.warn(
          "[useLivePreviewHtml] mjml-browser flagged warnings on a live " +
            "compile; ignoring (the save-time validator is the source of " +
            "truth):",
          result.errors
        );
      }
      return result.html as string;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Bridge GrapesJS canvas state to the right-pane preview iframe.
 *
 * ## Contract
 *
 * Two source modes feed the preview, with a deterministic swap rule:
 *
 *  1. **Live mode** — between saves. The hook listens for the four
 *     `component:*` events listed in {@link LIVE_PREVIEW_EVENTS}, debounces
 *     by {@link LIVE_PREVIEW_DEBOUNCE_MS} (≤300ms per AC-2), and recompiles
 *     via the `mjml-code-to-html` command exposed by `grapesjs-mjml`.
 *  2. **Server-compiled mode** — when `savedCompiledHtml` changes by
 *     reference (new save success, AI-chat apply, or history restore), the
 *     hook snaps to that value because the *server-compiled* HTML is what
 *     eventually ships. AC-3.
 *
 * ## No-flash transition (AC-4)
 *
 * The hook keeps the previously emitted HTML in state and only overwrites
 * it when the next source has produced a non-null value:
 *
 *  - On `savedCompiledHtml` change → swap immediately (it is already a
 *    fully-compiled string; no async hop).
 *  - On a `component:*` event → run debounce; on debounce fire, recompile;
 *    only call `setHtml` if the recompile succeeded. A failed recompile
 *    leaves the previous HTML painted.
 *
 * ## Why the live HTML is "close-enough"
 *
 * `mjml-code-to-html` runs in the browser via `mjml-browser`, which is the
 * same parser used by the backend on save in production paths. There can
 * be small divergences (font embedding, tracking-pixel insertion done by
 * server-side post-processors, etc.) — those become visible only on save,
 * at which point AC-3 swaps to the server-compiled HTML anyway.
 *
 * ## Warnings policy (STORY-7.12 AC-4)
 *
 * `mjml-browser` may emit `errors[]` (warnings) alongside the compiled
 * HTML on every call. **These warnings are NEVER rendered in the UI.**
 * With STORY-7.10's save-time validator in place, the MJML that ever
 * reaches a saved version is valid by construction; anything the
 * in-browser parser flags during a live compile is a transient artifact
 * of an in-progress edit (an attribute mid-type, a dragged block not yet
 * dropped, etc.) and not actionable by the user. The compile helper logs
 * them to `console.warn` for developer triage and then drops them.
 */
export function useLivePreviewHtml(
  editor: Editor | null,
  savedCompiledHtml: string | null
): UseLivePreviewHtmlResult {
  // The HTML actually painted into the iframe. Held in state so AC-4
  // (no-flash) is enforced: we only setHtml when we have a new value.
  const [html, setHtml] = useState<string | null>(savedCompiledHtml);
  const [mode, setMode] = useState<PreviewMode>(
    savedCompiledHtml ? "server-compiled" : "empty"
  );

  // Track the most recent saved HTML reference. When it changes by ===,
  // we treat it as a server-compiled snap (save / AI-apply / restore).
  const lastSavedRef = useRef<string | null>(savedCompiledHtml);

  // Debounce timer for live recompute. Held in a ref so a rapid burst of
  // GrapesJS events coalesces into a single recompute.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Effect 1: react to savedCompiledHtml changes (save / AI / restore).
  // Snap synchronously — we already have the bytes; no async compile.
  useEffect(() => {
    if (savedCompiledHtml !== lastSavedRef.current) {
      lastSavedRef.current = savedCompiledHtml;
      if (savedCompiledHtml !== null) {
        // Cancel any pending live recompute so it can't overwrite the
        // server-compiled snap a few ms later.
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        setHtml(savedCompiledHtml);
        setMode("server-compiled");
      }
    }
  }, [savedCompiledHtml]);

  // Effect 2: subscribe to GrapesJS mutation events and recompute live HTML.
  useEffect(() => {
    if (!editor) return;

    const recompute = () => {
      debounceTimerRef.current = null;
      const next = compileLiveHtml(editor);
      // AC-4: only overwrite when the recompile succeeded. If it fails
      // (plugin missing, MJML temporarily invalid), keep the previously
      // painted HTML so the user does not see a blank iframe.
      if (next !== null) {
        setHtml(next);
        setMode("live");
      }
    };

    const onMutation = () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(recompute, LIVE_PREVIEW_DEBOUNCE_MS);
    };

    for (const eventName of LIVE_PREVIEW_EVENTS) {
      editor.on(eventName, onMutation);
    }

    return () => {
      for (const eventName of LIVE_PREVIEW_EVENTS) {
        editor.off(eventName, onMutation);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [editor]);

  return { html, mode };
}
