import { useCallback } from "react";
import GjsEditor from "@grapesjs/react";
import grapesjs, { Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import { editorConfig, mjmlPluginConfig, getEditorPlugins } from "./config";

interface GrapesjsEditorProps {
  /** MJML source to load into the editor */
  mjmlSource: string;
  /** Called when the editor instance is created */
  onEditorInit?: (editor: Editor) => void;
}

export default function GrapesjsEditor({
  mjmlSource,
  onEditorInit,
}: GrapesjsEditorProps) {
  const handleEditor = useCallback(
    (editor: Editor) => {
      // Load MJML content into the editor
      editor.setComponents(mjmlSource);
      // STORY-7.12 AC-6.3: Playwright e2e specs need a stable handle on
      // the editor instance to drive canvas edits and verify state. We
      // park the Editor on ``window.gjsEditor`` for that purpose. This
      // is a test seam — production code never reads it. The cost is one
      // extra global; the benefit is e2e tests that don't have to
      // synthesise real keyboard events through grapesjs's RTE chain.
      // justified: extending Window with a debug global, not a typed API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).gjsEditor = editor;
      onEditorInit?.(editor);
    },
    [mjmlSource, onEditorInit]
  );

  return (
    <div className="h-full [&_.gjs-one-bg]:!bg-gray-800 [&_.gjs-two-color]:!text-gray-200">
      <GjsEditor
        grapesjs={grapesjs}
        plugins={getEditorPlugins()}
        options={{
          ...editorConfig,
          pluginsOpts: {
            // justified: grapesjs-mjml plugin uses function reference as key at runtime
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [getEditorPlugins()[0] as any]: mjmlPluginConfig,
          },
        }}
        onEditor={handleEditor}
      />
    </div>
  );
}
