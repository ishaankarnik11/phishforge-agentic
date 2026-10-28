import type { EditorConfig } from "grapesjs";
import type { PluginOptions } from "grapesjs-mjml";
import mjmlPlugin from "grapesjs-mjml";

/**
 * GrapesJS editor configuration for the MJML email editor.
 * Centralizes all editor options so the consuming component stays lean.
 *
 * ## Direct text editing (STORY-4.2)
 *
 * **AC-1 (Click-to-edit):** GrapesJS + grapesjs-mjml enables click-to-edit on
 * `<mj-text>` blocks by default. Double-clicking a text component opens the
 * built-in Rich Text Editor (RTE) inline, allowing users to edit text content
 * directly on the canvas. No additional configuration is needed.
 *
 * **AC-2 (Bold / Italic / Link):** The default GrapesJS RTE toolbar provides
 * bold, italic, underline, strikethrough, and link insertion controls out of
 * the box. These appear automatically when the inline editor is activated.
 *
 * **AC-3 (Undo/Redo):** The UndoManager is enabled below
 * (`undoManager: { trackSelection: false }`). Keyboard shortcuts Ctrl+Z /
 * Ctrl+Shift+Z work natively. UI buttons are wired in EmailerPage.tsx.
 */

export const editorConfig: EditorConfig = {
  height: "100%",
  storageManager: false,
  undoManager: { trackSelection: false },
  // Canvas styling
  canvas: {
    styles: [
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    ],
  },
  // Device manager is handled by the right-pane preview, so we keep defaults
  deviceManager: {
    devices: [
      { name: "Desktop", width: "" },
      { name: "Mobile", width: "375px", widthMedia: "480px" },
    ],
  },
};

export const mjmlPluginConfig: PluginOptions = {
  resetDevices: false,
  // Let the MJML plugin handle style manager reset
  resetStyleManager: true,
};

/**
 * Returns the plugins array for the @grapesjs/react Editor component.
 * The MJML plugin function itself is used (not a string ID).
 */
export function getEditorPlugins() {
  return [mjmlPlugin];
}

/**
 * Returns plugin options keyed by plugin reference.
 * The @grapesjs/react component accepts pluginsOpts in EditorConfig.
 */
export function getEditorPluginsOpts(): Record<string, PluginOptions> {
  // We use the function reference as key via the options config
  return {};
}
