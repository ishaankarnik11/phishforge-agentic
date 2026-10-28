import type { Editor } from "grapesjs";

/**
 * Force GrapesJS to commit any in-progress inline-RTE edits to the
 * component tree before the caller reads the model via `editor.getHtml()`.
 *
 * Why this exists
 * ---------------
 * GrapesJS' inline Rich Text Editor keeps the user's edits in a
 * `contentEditable` buffer inside the canvas iframe and only syncs them
 * to the component tree on blur/deselect. If the user clicks Save (or
 * Export) while their cursor is still inside an `<mj-text>`,
 * `editor.getHtml()` returns the *pre-edit* MJML — the saved version
 * ends up byte-identical to the previous one.
 *
 * The fix is to:
 *   1. Blur the active element inside the canvas iframe so the RTE
 *      commits its buffer.
 *   2. Clear GrapesJS' selection so the component tree is the source of
 *      truth on the next read.
 *
 * Originally introduced for the Save flow (UAT 2026-04-25 defect #8 —
 * see Sprint Board "Save lost in-progress RTE edits"). Reused by the
 * Export flow for STORY-5.4 so a click-Export-without-clicking-Save
 * round-trips the live canvas state instead of the stale prior save.
 *
 * Pure side-effect helper. Returns nothing. Tolerates older GrapesJS
 * builds where `editor.select(undefined)` is rejected.
 */
export function commitPendingEdits(editor: Editor): void {
  // 1. Blur the iframe's active element so the RTE syncs its buffer.
  const canvasDoc = editor.Canvas?.getDocument?.();
  const active = canvasDoc?.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }

  // 2. Clear GrapesJS selection. Older builds may reject `undefined`
  //    here; swallow that to stay backwards-compatible.
  try {
    editor.select(undefined);
  } catch {
    // Best-effort — the blur() above is the primary commit trigger.
  }
}
