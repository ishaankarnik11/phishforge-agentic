import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Editor, Component } from "grapesjs";
import {
  getEmailer,
  getLatestVersion,
  generateEmailer,
  MJMLValidationError,
  saveVersion,
  exportHtml,
} from "../api/emailers";
import type { EmailerVersionRead, GenerateResponse } from "../api/emailers";
import {
  GrapesjsEditor,
  PreviewPane,
  VersionHistory,
  ChatPanel,
  ShareLinkDialog,
  commitPendingEdits,
  LIVE_PREVIEW_EVENTS,
} from "../components/Editor";
import AssetPickerModal from "../components/AssetPickerModal";
import type { LibraryAssetRead } from "../api/libraryAssets";

/**
 * STORY-8.1: how often the auto-save timer fires while an emailer is
 * actively being edited and the tab is visible. Exported so the RTL
 * tests can advance fake timers symbolically rather than hard-coding
 * the milliseconds in the spec.
 */
export const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
import UserMenu from "../components/UserMenu";
import AssetStrip from "../components/AssetStrip";
import Toast from "../components/Toast";
import CostBadge from "../components/CostBadge";
import { Button, StatusBadge } from "../components/ds";
import Wordmark from "../components/shell/Wordmark";
import AuthorizationContextBar from "../components/shell/AuthorizationContextBar";

export default function EmailerPage() {
  const { id } = useParams<{ id: string }>();
  const emailerId = Number(id);
  const queryClient = useQueryClient();

  // Track the MJML source loaded into the editor.
  // We do not update this on every GrapesJS keystroke -- for MVP the preview
  // shows the compiled HTML from the most recent saved/generated version.
  const [activeVersion, setActiveVersion] =
    useState<EmailerVersionRead | null>(null);

  // Side panel state: version history or chat (mutually exclusive)
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  // STORY-AP7.1: draggable divider between the edit pane and the preview
  // canvas. This is a pure layout concern (no editor/preview behavior is
  // touched): we store the edit pane's share of the editor+preview area as a
  // fraction and let the user drag the `border-strong` handle to adjust it.
  // The right side panel (history/chat) keeps its own fixed width outside
  // this split.
  const [editPaneFraction, setEditPaneFraction] = useState(0.55);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingDividerRef = useRef(false);

  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      isDraggingDividerRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handleDividerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingDividerRef.current) return;
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      const next = (e.clientX - rect.left) / rect.width;
      // Clamp so neither pane collapses entirely.
      setEditPaneFraction(Math.min(0.8, Math.max(0.2, next)));
    },
    [],
  );

  const handleDividerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isDraggingDividerRef.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [],
  );
  // When previewing a past version, we show its HTML in the preview pane
  // but do NOT change the editor content.
  const [previewVersion, setPreviewVersion] =
    useState<EmailerVersionRead | null>(null);

  // ------------------------------------------------------------------
  // GrapesJS editor instance + undo/redo state (STORY-4.2 AC-3)
  // ------------------------------------------------------------------

  const editorRef = useRef<Editor | null>(null);
  // Editor instance held in state too, so the live-preview hook in
  // <PreviewPane> can subscribe to GrapesJS events as soon as the editor
  // mounts. STORY-4.6.
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // STORY-8.1: "dirty" flag for the auto-save timer. Set whenever the user
  // mutates the canvas (the same four GrapesJS events that drive the live
  // preview hook), cleared after a successful save. The flag is the
  // canonical signal for "active editing happened in this interval" — we
  // use a ref because the auto-save effect reads it on tick without
  // wanting to re-bind on every flip.
  const dirtyRef = useRef(false);

  // ------------------------------------------------------------------
  // STORY-A5.2: Asset picker integration for GrapesJS image components
  // ------------------------------------------------------------------

  const [isEditorPickerOpen, setIsEditorPickerOpen] = useState(false);
  const [pickerTargetComponent, setPickerTargetComponent] =
    useState<Component | null>(null);

  /** Refs to hold the setter functions so the GrapesJS callbacks (registered
   *  once in handleEditorReady) can always access the latest React state
   *  setters without stale closures. */
  const setIsEditorPickerOpenRef = useRef(setIsEditorPickerOpen);
  setIsEditorPickerOpenRef.current = setIsEditorPickerOpen;
  const setPickerTargetComponentRef = useRef(setPickerTargetComponent);
  setPickerTargetComponentRef.current = setPickerTargetComponent;

  const handleEditorPickerSelect = useCallback(
    (assets: LibraryAssetRead[]) => {
      if (pickerTargetComponent && assets.length > 0) {
        const asset = assets[0];
        const url =
          asset.primary_version?.storage_url ??
          asset.primary_version?.thumbnail_url;
        if (url) {
          pickerTargetComponent.addAttributes({ src: url });
          dirtyRef.current = true;
        }
      }
      setIsEditorPickerOpen(false);
      setPickerTargetComponent(null);
    },
    [pickerTargetComponent],
  );

  const handleEditorPickerClose = useCallback(() => {
    setIsEditorPickerOpen(false);
    setPickerTargetComponent(null);
  }, []);

  const handleEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    setEditorInstance(editor);

    const um = editor.UndoManager;
    const updateUndoRedoState = () => {
      setCanUndo(um.hasUndo());
      setCanRedo(um.hasRedo());
    };

    // GrapesJS fires "change" events when the undo stack changes
    editor.on("change:changesCount", updateUndoRedoState);
    // Also update after undo/redo actions
    editor.on("undo", updateUndoRedoState);
    editor.on("redo", updateUndoRedoState);

    // STORY-8.1: subscribe to the same mutation events the live-preview
    // hook listens to and flip the dirty flag. The hook itself stays the
    // owner of preview rendering — we just piggy-back on the same signal
    // because the dirty notion ("user mutated the canvas since the last
    // save") is exactly that.
    const markDirty = () => {
      dirtyRef.current = true;
    };
    for (const eventName of LIVE_PREVIEW_EVENTS) {
      editor.on(eventName, markDirty);
    }

    // ------------------------------------------------------------------
    // STORY-A5.2: Override the built-in asset manager to open our
    // AssetPickerModal instead of the default GrapesJS asset dialog.
    // This hooks into GrapesJS's native image-selection flow: when a
    // user double-clicks an image or uses the image trait's "Change"
    // button, GrapesJS runs the `open-assets` command — which we
    // intercept here.
    // ------------------------------------------------------------------

    editor.Commands.add("open-assets", {
      // justified: GrapesJS command run() signature uses `any` for opts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run(ed: Editor, _sender: any, opts?: any) {
        const target = (opts?.target as Component | undefined) ?? ed.getSelected() ?? undefined;
        setPickerTargetComponentRef.current(target ?? null);
        setIsEditorPickerOpenRef.current(true);
      },
      stop() {
        setIsEditorPickerOpenRef.current(false);
      },
    });

    // ------------------------------------------------------------------
    // STORY-A5.2: "Swap from Library" toolbar button on mj-image
    // components. Adds an explicit button to the component toolbar
    // whenever an mj-image is selected, giving users a discoverable
    // entry point besides double-clicking the image.
    // ------------------------------------------------------------------

    editor.Commands.add("swap-from-library", {
      run(ed: Editor) {
        const selected = ed.getSelected() ?? undefined;
        setPickerTargetComponentRef.current(selected ?? null);
        setIsEditorPickerOpenRef.current(true);
      },
    });

    // SVG icon for the toolbar button (grid/gallery icon)
    const swapIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">' +
      '<path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"/>' +
      "</svg>";

    editor.on("component:selected", (component: Component) => {
      // Detect mj-image: grapesjs-mjml registers the type as 'mj-image'
      const compType = component.get("type");
      if (compType === "mj-image") {
        const toolbar = [...(component.get("toolbar") ?? [])];
        const hasSwapBtn = toolbar.some(
          (btn) =>
            typeof btn.command === "string" &&
            btn.command === "swap-from-library",
        );
        if (!hasSwapBtn) {
          toolbar.push({
            label: swapIconSvg,
            command: "swap-from-library",
            attributes: { title: "Swap from Library" },
          });
          component.set("toolbar", toolbar);
        }
      }
    });

    // Initial state
    updateUndoRedoState();
  }, []);

  const handleUndo = useCallback(() => {
    editorRef.current?.UndoManager.undo();
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.UndoManager.redo();
  }, []);

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  const emailerQuery = useQuery({
    queryKey: ["emailer", emailerId],
    queryFn: () => getEmailer(emailerId),
    enabled: !Number.isNaN(emailerId),
  });

  const versionQuery = useQuery({
    queryKey: ["emailerVersion", emailerId, "latest"],
    queryFn: () => getLatestVersion(emailerId),
    enabled: !Number.isNaN(emailerId),
    retry: false, // 404 if no version exists yet -- that's expected
  });

  // Once the version loads, keep a local copy for the editor
  // (useQuery onSuccess was removed in v5, so we use a derived effect)
  if (versionQuery.data && !activeVersion) {
    setActiveVersion(versionQuery.data);
  }

  // ------------------------------------------------------------------
  // Generate mutation
  // ------------------------------------------------------------------

  const generateMutation = useMutation({
    mutationFn: () => generateEmailer(emailerId),
    onSuccess: (data: GenerateResponse) => {
      const version: EmailerVersionRead = {
        id: data.version_id,
        emailer_id: emailerId,
        version_number: data.version_number,
        mjml_source: data.mjml_source,
        compiled_html: data.compiled_html,
        subject_line: data.subject_line,
        preheader: data.preheader,
        model_used: data.model_used,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        created_at: new Date().toISOString(),
      };
      setActiveVersion(version);
      setPreviewVersion(null);
      // Invalidate so next time the query re-fetches fresh data
      queryClient.invalidateQueries({
        queryKey: ["emailerVersion", emailerId, "latest"],
      });
      // Refresh the version list if history panel is open
      queryClient.invalidateQueries({
        queryKey: ["emailerVersions", emailerId],
      });
      // STORY-7.8 AC-1: refresh the cost badge after every generate.
      queryClient.invalidateQueries({
        queryKey: ["emailerCost", emailerId],
      });
    },
  });

  const handleGenerate = useCallback(() => {
    generateMutation.mutate();
  }, [generateMutation]);

  // ------------------------------------------------------------------
  // Save mutation (STORY-4.2)
  // ------------------------------------------------------------------

  // STORY-7.12 AC-3: dismissable save-error toast. The toast becomes
  // visible automatically whenever ``saveMutation`` enters an error state
  // and is hidden when the user clicks Revert, the X, or kicks off a new
  // save (the latter resets the error). Tracked via a per-error "dismissed"
  // flag rather than a separate visibility boolean so we don't have to
  // wire dismissal into every code path that triggers a save.
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => {
      const editor = editorRef.current;
      if (!editor) throw new Error("Editor not ready");

      // Commit pending inline-RTE edits before reading the model. Without
      // this, getHtml() can return pre-edit MJML when the user clicks
      // Save while their cursor is still inside an <mj-text>. See the
      // helper's JSDoc and UAT 2026-04-25 defect #8 for the full why.
      commitPendingEdits(editor);

      // GrapesJS + grapesjs-mjml: getHtml() returns the MJML source
      const mjml = editor.getHtml();
      return saveVersion(emailerId, mjml);
    },
    onMutate: () => {
      // Any new save attempt clears the previous "dismissed" state so the
      // next failure (if any) re-shows the toast.
      setSaveErrorDismissed(false);
    },
    onSuccess: (data: EmailerVersionRead) => {
      setActiveVersion(data);
      setPreviewVersion(null);
      // STORY-8.1: a successful save absorbs all pending edits, so the
      // canvas is clean again until the user mutates it next.
      dirtyRef.current = false;
      // Invalidate version queries to refresh lists and latest
      queryClient.invalidateQueries({
        queryKey: ["emailerVersion", emailerId, "latest"],
      });
      queryClient.invalidateQueries({
        queryKey: ["emailerVersions", emailerId],
      });
      // STORY-7.8 AC-1: refresh the cost badge after every save. A bare
      // save doesn't *itself* hit the LLM, but it follows a generate or
      // refine often enough that re-fetching here keeps the badge in
      // sync without a follow-up refetch storm.
      queryClient.invalidateQueries({
        queryKey: ["emailerCost", emailerId],
      });
    },
  });

  const handleSave = useCallback(() => {
    saveMutation.mutate();
  }, [saveMutation]);

  // STORY-7.12 AC-3: clicking Revert restores the canvas to the
  // currently-active version's MJML. The active version row on the server
  // hasn't moved (no new version was created — 422 short-circuits) so the
  // canvas getting back to that exact source IS rolling back the bad edit.
  const handleRevertToActiveVersion = useCallback(() => {
    const editor = editorRef.current;
    if (editor && activeVersion?.mjml_source) {
      // grapesjs-mjml: setComponents accepts a raw MJML string and rebuilds
      // the canvas tree from it.
      editor.setComponents(activeVersion.mjml_source);
    }
    // Dismiss the toast and reset the mutation so the user can save again.
    setSaveErrorDismissed(true);
    saveMutation.reset();
  }, [activeVersion?.mjml_source, saveMutation]);

  const handleDismissSaveError = useCallback(() => {
    setSaveErrorDismissed(true);
  }, []);

  // Whether the toast should be on screen right now. Computed instead of
  // stored so it tracks the mutation state automatically.
  const saveErrorToastVisible = saveMutation.isError && !saveErrorDismissed;
  const saveErrorMessage =
    saveMutation.error instanceof Error ? saveMutation.error.message : null;
  const isSaveValidationError =
    saveMutation.error instanceof MJMLValidationError;
  // Avoid an unused-variable warning while keeping the symbol available
  // for future structured rendering of `errors[]` on the toast.
  void isSaveValidationError;
  // Belt-and-braces: if the user navigates away from / back to the page
  // while a stale error is still in the mutation state, treat it as
  // dismissed so they don't see a phantom toast on mount.
  useEffect(() => {
    if (!saveMutation.isError) {
      setSaveErrorDismissed(false);
    }
  }, [saveMutation.isError]);

  // ------------------------------------------------------------------
  // Export mutation (STORY-5.1)
  // ------------------------------------------------------------------

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Share preview link dialog (STORY-4.5)
  // ------------------------------------------------------------------

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      // STORY-5.4 AC-1: before issuing GET /export, commit any pending
      // inline-RTE edits and force a Save so the latest version on the
      // server reflects what the user is looking at on the canvas. The
      // backend serves `version.compiled_html` from the latest version
      // row, so without this the user can download stale bytes (the
      // export silently shipping the previous save).
      const editor = editorRef.current;
      if (editor) {
        commitPendingEdits(editor);
        // STORY-5.4 AC-2: if Save fails, abort the export and surface
        // the error in the existing `exportError` UI — never fall back
        // to stale HTML.
        await saveMutation.mutateAsync();
      }
      // No editor yet (rare — user opened the page and clicked Export
      // before GrapesJS finished mounting): there cannot be pending
      // edits to commit, so go straight to download. The disabled-state
      // on the button already requires `compiledHtml` to be truthy.

      await exportHtml(emailerId);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : "Export failed"
      );
    } finally {
      setIsExporting(false);
    }
  }, [emailerId, saveMutation]);

  // ------------------------------------------------------------------
  // Version history callbacks
  // ------------------------------------------------------------------

  const handleHistoryPreview = useCallback(
    (version: EmailerVersionRead) => {
      setPreviewVersion(version);
    },
    []
  );

  const handleHistoryRestore = useCallback(
    (version: EmailerVersionRead) => {
      // Restore by setting the old version as the active version.
      // Per AC: "Restore creates a new version from the old MJML" --
      // but since we don't have a save/createVersion API endpoint yet,
      // for now we simply load the old MJML into the editor.
      // When the user next saves, it will persist as a new version.
      setActiveVersion(version);
      setPreviewVersion(null);
    },
    []
  );

  const handleHistoryClose = useCallback(() => {
    setHistoryOpen(false);
    setPreviewVersion(null);
  }, []);

  // ------------------------------------------------------------------
  // Chat panel callbacks (STORY-4.3)
  // ------------------------------------------------------------------

  // STORY-8.1: surfaced from <ChatPanel> so the auto-save timer can skip
  // ticks while a refine round-trip is in flight (we don't want a save
  // and a refine producing competing version rows).
  const [chatRefinePending, setChatRefinePending] = useState(false);

  const handleChatApply = useCallback(
    (version: EmailerVersionRead) => {
      setActiveVersion(version);
      setPreviewVersion(null);
      // STORY-8.1: applying a refine swaps the active version (the
      // GrapesjsEditor remounts via its `key={activeVersion.id}` prop),
      // so the freshly mounted editor is clean by construction. Be
      // explicit anyway in case the remount races with a stray event.
      dirtyRef.current = false;
      // Invalidate version queries so version history refreshes
      queryClient.invalidateQueries({
        queryKey: ["emailerVersion", emailerId, "latest"],
      });
      queryClient.invalidateQueries({
        queryKey: ["emailerVersions", emailerId],
      });
      // STORY-7.8 AC-1: refresh the cost badge after every applied refine.
      queryClient.invalidateQueries({
        queryKey: ["emailerCost", emailerId],
      });
    },
    [queryClient, emailerId]
  );

  const handleChatClose = useCallback(() => {
    setChatOpen(false);
  }, []);

  // ------------------------------------------------------------------
  // STORY-8.1: auto-version every 5 minutes of active editing
  // ------------------------------------------------------------------
  //
  // Behaviour (mirrors the story spec):
  //
  //  1. While the page is mounted, an emailer has a version, and the tab
  //     is visible, schedule an auto-save every AUTO_SAVE_INTERVAL_MS.
  //  2. Suspend the timer when `document.visibilityState === "hidden"` —
  //     we clear the interval on hide and re-arm on show, so the next
  //     tick is one full interval after returning (per spec note 3).
  //  3. On each tick, only fire if:
  //       - the canvas is dirty (a `component:*` event has fired since
  //         the last successful save — the (a) approach in the spec, see
  //         the markDirty subscription in `handleEditorReady`),
  //       - no save is already in flight,
  //       - no generate or chat-refine is in flight.
  //  4. Use `mutateAsync` so we can `await` and ensure overlapping ticks
  //     don't pile on (the in-flight check above is the primary guard;
  //     this is belt-and-braces).
  //
  // We deliberately keep the latest mutators / flags in refs read inside
  // the tick instead of putting them in the effect deps array — otherwise
  // the interval would clear and re-arm on every keystroke (which sets
  // dirty) or every render (which can change saveMutation identity), and
  // the user would never get a tick to fire.
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  const generatePendingRef = useRef(generateMutation.isPending);
  generatePendingRef.current = generateMutation.isPending;
  const chatRefinePendingRef = useRef(chatRefinePending);
  chatRefinePendingRef.current = chatRefinePending;
  const hasVersionRef = useRef(!!activeVersion);
  hasVersionRef.current = !!activeVersion;

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      // Don't auto-save before the first version exists.
      if (!hasVersionRef.current) return;
      // Skip clean canvases — we never produce identical version rows.
      if (!dirtyRef.current) return;
      // Skip if any save is already pending.
      if (saveMutationRef.current.isPending) return;
      // Skip if a generate or chat refine is racing us — both create
      // their own version rows on success.
      if (generatePendingRef.current) return;
      if (chatRefinePendingRef.current) return;
      // Editor must be mounted; without it the save mutationFn throws.
      if (!editorRef.current) return;

      // Fire and forget — onSuccess clears `dirtyRef.current`. We catch
      // here so an unhandled rejection (e.g. validation 422 on a
      // mid-edit auto-save) doesn't bubble up; the existing save-error
      // toast already surfaces the user-visible error path on manual
      // saves and we deliberately don't trigger that for auto-saves
      // (the user didn't click Save and shouldn't see a modal-style
      // toast for a background tick).
      saveMutationRef.current.mutateAsync().catch(() => {
        // intentionally swallowed — see comment above
      });
    };

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, AUTO_SAVE_INTERVAL_MS);
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    // Arm immediately if visible at mount; otherwise wait for the show.
    if (!document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
    // emailerId is the only meaningful re-arm key: on emailer change we
    // want a fresh interval (and the dirty flag has already been reset
    // by the editor remount).
  }, [emailerId]);

  // ------------------------------------------------------------------
  // Loading & error states
  // ------------------------------------------------------------------

  if (emailerQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-base">
        <div className="text-center">
          <div
            role="status"
            className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"
          />
          <p className="mt-2 text-body text-ink-muted">Loading emailer...</p>
        </div>
      </div>
    );
  }

  if (emailerQuery.isError) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-base">
        <div
          role="alert"
          className="rounded-ds-md border border-danger/30 bg-danger-subtle p-lg text-center"
        >
          <p className="text-title text-danger">Failed to load emailer</p>
          <p className="mt-1 text-body text-danger">
            {emailerQuery.error instanceof Error
              ? emailerQuery.error.message
              : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const emailer = emailerQuery.data;
  const hasVersion = !!activeVersion;
  // If previewing a past version, show its HTML; otherwise show active version
  const compiledHtml =
    previewVersion?.compiled_html ?? activeVersion?.compiled_html ?? null;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="flex h-screen flex-col bg-surface-base">
      {/* Slim themed header: wordmark + emailer identity + user menu. This
          editor lives outside the standard AppShell (full-screen), so it
          carries its own chrome. */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-chrome px-md">
        <Wordmark />

        <div className="mx-1 h-6 w-px bg-border-default" aria-hidden="true" />

        <Link
          to="/"
          title="Back to emailers"
          aria-label="Back to emailers"
          className="inline-flex h-9 w-9 items-center justify-center rounded-ds-sm text-ink-body transition-colors duration-fast hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
        </Link>

        <h1 className="truncate text-title text-ink-strong">
          {emailer?.name ?? `Emailer #${id}`}
        </h1>

        {emailer?.status && (
          <StatusBadge tone="neutral">{emailer.status}</StatusBadge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* STORY-7.6: user menu + logout control */}
          <UserMenu />
        </div>
      </header>

      {/* Authorization Context Bar — this is an authenticated screen outside
          the standard AppShell, so the authorization boundary must remain
          visible (DESIGN.md §5, signature component). */}
      <AuthorizationContextBar />

      {/* Editor toolbar: Ghost buttons for the workspace actions (DESIGN.md §5
          Two-Pane Editor Shell, toolbar uses Ghost buttons). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-surface-chrome px-md py-2">
        {/* STORY-7.8 AC-1: running USD cost for this emailer with a hover
            breakdown. Owns its own React Query key; refreshed by the
            generate / save / chat-apply success handlers above. */}
        <CostBadge emailerId={emailerId} />

        <div className="mx-1 h-6 w-px bg-border-default" aria-hidden="true" />

        {/* Undo / Redo (STORY-4.2 AC-3) */}
        <Button
          variant="ghost"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          className="w-9 px-0"
          leadingIcon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 110 14H4a1 1 0 110-2h7a5 5 0 100-10H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          }
        />
        <Button
          variant="ghost"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          className="w-9 px-0"
          leadingIcon={
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.293 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 9H9a5 5 0 100 10h7a1 1 0 110 2H9a7 7 0 110-14h5.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          }
        />

        <div className="mx-1 h-6 w-px bg-border-default" aria-hidden="true" />

        {/* Save (STORY-4.2) */}
        <Button
          variant="ghost"
          onClick={handleSave}
          disabled={!hasVersion}
          loading={saveMutation.isPending}
          title="Save current edits as new version"
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
            </svg>
          }
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>

        {/* STORY-7.12 AC-3: the toolbar no longer renders an inline save
            error; the Toast at the bottom of the page (rendered below) owns
            that surface and carries a Revert action. The
            ``data-testid="save-error-banner"`` lives on that toast so the
            STORY-7.10 AC-8 spec keeps passing. */}

        {/* Export HTML (STORY-5.1) */}
        <Button
          variant="ghost"
          onClick={handleExport}
          disabled={!hasVersion || !compiledHtml}
          loading={isExporting}
          title="Export HTML file"
          aria-label="Export HTML"
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          }
        >
          {isExporting ? "Exporting..." : "Export HTML"}
        </Button>

        {/* Export error (inline, paired with text per the Two Signal Rule) */}
        {exportError && (
          <span role="alert" className="text-caption font-normal normal-case tracking-normal text-danger">
            {exportError}
          </span>
        )}

        {/* Share preview (STORY-4.5) */}
        <Button
          variant="ghost"
          onClick={() => setShareDialogOpen(true)}
          disabled={!hasVersion}
          title="Create a shareable read-only preview link"
          aria-label="Share preview"
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.79l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
            </svg>
          }
        >
          Share preview
        </Button>

        <div className="mx-1 h-6 w-px bg-border-default" aria-hidden="true" />

        {/* Chat toggle (STORY-4.3). Pressed state uses the accent-subtle fill
            (DESIGN.md: active conveyed by fill, never a side stripe). */}
        <Button
          variant="ghost"
          onClick={() => {
            setChatOpen((prev) => {
              if (!prev) setHistoryOpen(false); // mutually exclusive
              return !prev;
            });
          }}
          aria-pressed={chatOpen}
          className={chatOpen ? "bg-accent-subtle text-accent" : ""}
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z" clipRule="evenodd" />
            </svg>
          }
        >
          Chat
        </Button>

        {/* Version History toggle */}
        <Button
          variant="ghost"
          onClick={() => {
            setHistoryOpen((prev) => {
              if (!prev) {
                setChatOpen(false); // mutually exclusive
                setPreviewVersion(null);
              }
              return !prev;
            });
          }}
          aria-pressed={historyOpen}
          className={historyOpen ? "bg-accent-subtle text-accent" : ""}
          leadingIcon={
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          }
        >
          History
        </Button>

        {/* Generate / Regenerate — the one high-emphasis action in the
            toolbar (DESIGN.md One Voice Rule). */}
        <Button
          variant="primary"
          onClick={handleGenerate}
          loading={generateMutation.isPending}
          className="ml-auto"
        >
          {generateMutation.isPending
            ? "Generating..."
            : hasVersion
              ? "Regenerate"
              : "Generate"}
        </Button>
      </div>

      {/* Preview-version banner */}
      {previewVersion && (
        <div className="flex items-center justify-between border-b border-border-subtle bg-info-subtle px-md py-2">
          <p className="text-caption font-normal normal-case tracking-normal text-info">
            Previewing version {previewVersion.version_number}
            {previewVersion.subject_line && (
              <span className="ml-1 text-info/80">
                ({previewVersion.subject_line})
              </span>
            )}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreviewVersion(null)}
          >
            Clear preview
          </Button>
        </div>
      )}

      {/* Generation error banner */}
      {generateMutation.isError && (
        <div
          role="alert"
          className="border-b border-danger/30 bg-danger-subtle px-md py-2 text-caption font-normal normal-case tracking-normal text-danger"
        >
          Generation failed:{" "}
          {generateMutation.error instanceof Error
            ? generateMutation.error.message
            : "Unknown error"}
        </div>
      )}

      {/* Two-pane editor area + optional side panel (history or chat).
          The edit pane and preview canvas split is draggable; the side panel
          (when open) keeps its own fixed width to the right. */}
      <div className="flex min-h-0 flex-1">
        <div ref={splitContainerRef} className="flex min-w-0 flex-1">
          {/* Left pane: GrapesJS WYSIWYG editor (themed chrome). */}
          <div
            className="flex min-w-0 flex-col border-r border-border-subtle"
            style={{ flexBasis: `${editPaneFraction * 100}%` }}
          >
            {/* Read-only asset strip (STORY-2.6 AC-8) */}
            <AssetStrip emailerId={emailerId} />

            {hasVersion && activeVersion.mjml_source ? (
              <GrapesjsEditor
                key={activeVersion.id}
                mjmlSource={activeVersion.mjml_source}
                onEditorInit={handleEditorReady}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-surface-sunken">
                {versionQuery.isLoading ? (
                  <div className="text-center">
                    <div
                      role="status"
                      className="mx-auto h-6 w-6 animate-spin rounded-full border-4 border-accent border-t-transparent"
                    />
                    <p className="mt-2 text-body text-ink-muted">
                      Loading editor...
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-body text-ink-body">No content yet.</p>
                    <p className="mt-1 text-body text-ink-muted">
                      Click{" "}
                      <span className="font-medium text-accent">
                        Generate
                      </span>{" "}
                      to create your email template.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Draggable divider with a border-strong handle (DESIGN.md §5
              Two-Pane Editor Shell). Pure layout; no editor/preview behavior
              is touched. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and preview panes"
            data-testid="pane-divider"
            onPointerDown={handleDividerPointerDown}
            onPointerMove={handleDividerPointerMove}
            onPointerUp={handleDividerPointerUp}
            className="group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border-strong transition-colors hover:bg-accent"
          >
            <span
              aria-hidden="true"
              className="h-8 w-0.5 rounded-ds-full bg-surface-raised/70 group-hover:bg-on-accent/70"
            />
          </div>

          {/* Preview pane: the email canvas is ALWAYS light (it mimics a real
              inbox), framed on a surface-sunken gutter so it reads as "the
              artifact" rather than part of the themed app (DESIGN.md §2, §5). */}
          <div
            className="min-w-0 bg-surface-sunken"
            style={{ flexBasis: `${(1 - editPaneFraction) * 100}%` }}
          >
            {/* STORY-4.6: PreviewPane derives content from the live editor
                between saves and snaps to `compiledHtml` on save / AI apply /
                history restore. The mode-swap is handled inside the hook. */}
            <PreviewPane
              compiledHtml={compiledHtml}
              editor={editorInstance}
            />
          </div>
        </div>

        {/* Right side panel: Version History (slide-out) */}
        {historyOpen && (
          <VersionHistory
            emailerId={emailerId}
            activeVersionNumber={activeVersion?.version_number ?? null}
            onPreview={handleHistoryPreview}
            onRestore={handleHistoryRestore}
            onClose={handleHistoryClose}
          />
        )}

        {/* Right side panel: Chat (slide-out, STORY-4.3) */}
        {chatOpen && (
          <ChatPanel
            emailerId={emailerId}
            onApply={handleChatApply}
            onClose={handleChatClose}
            onPendingChange={setChatRefinePending}
          />
        )}
      </div>

      {/* Share preview dialog (STORY-4.5) */}
      {shareDialogOpen && (
        <ShareLinkDialog
          emailerId={emailerId}
          currentVersionId={activeVersion?.id ?? null}
          onClose={() => setShareDialogOpen(false)}
        />
      )}

      {/* STORY-A5.2: Asset picker for GrapesJS image swap.
          Opens when the user triggers the overridden asset manager
          (double-click image) or clicks the "Swap from Library"
          toolbar button on an mj-image component. */}
      <AssetPickerModal
        isOpen={isEditorPickerOpen}
        onClose={handleEditorPickerClose}
        onSelect={handleEditorPickerSelect}
      />

      {/* STORY-7.12 AC-3: save-error toast.
          The ``data-testid="save-error-banner"`` is preserved from the
          old inline span so STORY-7.10 AC-8's e2e spec (which asserts
          the visible text contains "MJML validation") keeps passing.
          We pass the server error string as ``description`` so it shows
          up in the rendered text — the AC-8 assertion uses
          ``toContainText`` which matches the concatenated text content. */}
      {saveErrorToastVisible && (
        <Toast
          data-testid="save-error-banner"
          title="Editor produced invalid markup."
          description={saveErrorMessage}
          action={{
            label: "Revert to last saved version",
            onClick: handleRevertToActiveVersion,
          }}
          onDismiss={handleDismissSaveError}
        />
      )}
    </div>
  );
}
