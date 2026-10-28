import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Editor } from "grapesjs";
import {
  useLivePreviewHtml,
  LIVE_PREVIEW_DEBOUNCE_MS,
  LIVE_PREVIEW_EVENTS,
} from "./useLivePreviewHtml";

// justified: GrapesJS Editor type carries ~50 nested manager types we don't
// model in tests; we synthesize the minimum surface the hook touches.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeEditor {
  editor: Editor;
  fire: (event: string) => void;
  setHtml: (html: string) => void;
  /** call count of `runCommand('mjml-code-to-html')` */
  compileCalls: () => number;
  /** call count of `editor.off(eventName, handler)` */
  offCalls: () => number;
}

function makeFakeEditor(initialHtml = "<html>v0</html>"): FakeEditor {
  const handlers = new Map<string, Set<() => void>>();
  let html = initialHtml;
  let compileCount = 0;
  let offCount = 0;

  const editor: any = {
    on: (event: string, handler: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => {
      offCount += 1;
      handlers.get(event)?.delete(handler);
    },
    runCommand: (cmd: string) => {
      if (cmd === "mjml-code-to-html") {
        compileCount += 1;
        return { html, errors: [] };
      }
      return undefined;
    },
  };

  return {
    editor: editor as Editor,
    fire: (event: string) => {
      handlers.get(event)?.forEach((h) => h());
    },
    setHtml: (next: string) => {
      html = next;
    },
    compileCalls: () => compileCount,
    offCalls: () => offCount,
  };
}

describe("useLivePreviewHtml", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in server-compiled mode when savedCompiledHtml is provided", () => {
    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useLivePreviewHtml(fake.editor, "<html>saved</html>")
    );

    expect(result.current.html).toBe("<html>saved</html>");
    expect(result.current.mode).toBe("server-compiled");
  });

  it("starts in empty mode with no saved HTML and no editor", () => {
    const { result } = renderHook(() => useLivePreviewHtml(null, null));

    expect(result.current.html).toBeNull();
    expect(result.current.mode).toBe("empty");
  });

  describe("live mode (AC-2)", () => {
    it.each(LIVE_PREVIEW_EVENTS)(
      "recomputes after the debounce window when %s fires",
      (eventName) => {
        const fake = makeFakeEditor("<html>live-1</html>");
        const { result } = renderHook(() =>
          useLivePreviewHtml(fake.editor, "<html>saved</html>")
        );

        // Simulate a user edit
        fake.setHtml("<html>live-2</html>");
        act(() => {
          fake.fire(eventName);
        });

        // Before debounce expires, no recompute yet
        expect(fake.compileCalls()).toBe(0);
        expect(result.current.html).toBe("<html>saved</html>");

        // Advance past the debounce window
        act(() => {
          vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
        });

        expect(fake.compileCalls()).toBe(1);
        expect(result.current.html).toBe("<html>live-2</html>");
        expect(result.current.mode).toBe("live");
      }
    );

    it("debounces a burst of mutation events into a single recompute", () => {
      const fake = makeFakeEditor("<html>burst</html>");
      renderHook(() =>
        useLivePreviewHtml(fake.editor, "<html>saved</html>")
      );

      // Fire all four events plus a few extras within the debounce window
      act(() => {
        fake.fire("component:update");
        vi.advanceTimersByTime(50);
        fake.fire("component:add");
        vi.advanceTimersByTime(50);
        fake.fire("component:remove");
        vi.advanceTimersByTime(50);
        fake.fire("component:styleUpdate");
        vi.advanceTimersByTime(50);
        fake.fire("component:update");
      });

      // Still inside the debounce window (last fire reset the timer)
      expect(fake.compileCalls()).toBe(0);

      act(() => {
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      });

      // One recompute, not five
      expect(fake.compileCalls()).toBe(1);
    });

    it("subscribes to exactly the four enumerated GrapesJS events", () => {
      const onSpy = vi.fn();
      const editor: any = {
        on: onSpy,
        off: vi.fn(),
        runCommand: () => ({ html: "" }),
      };

      renderHook(() => useLivePreviewHtml(editor as Editor, null));

      const subscribed = onSpy.mock.calls.map((c) => c[0]);
      expect(subscribed.sort()).toEqual([...LIVE_PREVIEW_EVENTS].sort());
      expect(subscribed).toHaveLength(4);
    });

    it("retains last painted HTML when compilation returns null (AC-4 no-flash)", () => {
      const fake = makeFakeEditor("<html>good</html>");
      const { result } = renderHook(() =>
        useLivePreviewHtml(fake.editor, "<html>saved</html>")
      );

      // First successful live compile
      act(() => {
        fake.fire("component:update");
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      });
      expect(result.current.html).toBe("<html>good</html>");

      // Now make runCommand return a malformed value (simulates plugin
      // glitch / mid-edit invalid MJML). Last good HTML must remain.
      (fake.editor as any).runCommand = () => null;

      act(() => {
        fake.fire("component:update");
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      });
      expect(result.current.html).toBe("<html>good</html>");
    });

    it("unsubscribes from all four events on unmount", () => {
      const fake = makeFakeEditor();
      const { unmount } = renderHook(() =>
        useLivePreviewHtml(fake.editor, null)
      );

      unmount();

      // off() should have been called once per subscribed event
      expect(fake.offCalls()).toBe(LIVE_PREVIEW_EVENTS.length);
    });
  });

  describe("server-compiled snap (AC-3)", () => {
    it("snaps to new savedCompiledHtml when it changes by reference", () => {
      const fake = makeFakeEditor();
      const { result, rerender } = renderHook(
        ({ saved }: { saved: string | null }) =>
          useLivePreviewHtml(fake.editor, saved),
        { initialProps: { saved: "<html>v1</html>" as string | null } }
      );

      expect(result.current.html).toBe("<html>v1</html>");
      expect(result.current.mode).toBe("server-compiled");

      // Save / AI apply / history restore — produces a new compiled_html
      rerender({ saved: "<html>v2</html>" });
      expect(result.current.html).toBe("<html>v2</html>");
      expect(result.current.mode).toBe("server-compiled");
    });

    it("cancels a pending live recompute when a save snap arrives mid-debounce (AC-4)", () => {
      const fake = makeFakeEditor("<html>live-pending</html>");
      const { result, rerender } = renderHook(
        ({ saved }: { saved: string | null }) =>
          useLivePreviewHtml(fake.editor, saved),
        { initialProps: { saved: "<html>v1</html>" as string | null } }
      );

      // User mutates the canvas — debounce timer started
      act(() => {
        fake.fire("component:update");
      });
      expect(fake.compileCalls()).toBe(0);

      // Save fires while debounce is still ticking
      rerender({ saved: "<html>v2-server-compiled</html>" });
      expect(result.current.html).toBe("<html>v2-server-compiled</html>");
      expect(result.current.mode).toBe("server-compiled");

      // Now flush — the cancelled live recompute must NOT run and clobber
      // the server-compiled HTML we just snapped to.
      act(() => {
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      });
      expect(fake.compileCalls()).toBe(0);
      expect(result.current.html).toBe("<html>v2-server-compiled</html>");
    });

    it("does not regress to live mode just because the saved value re-equals the previous", () => {
      const fake = makeFakeEditor("<html>burst</html>");
      const initial = "<html>same-ref</html>";
      const { result, rerender } = renderHook(
        ({ saved }: { saved: string | null }) =>
          useLivePreviewHtml(fake.editor, saved),
        { initialProps: { saved: initial as string | null } }
      );

      // First mutate to flip into live mode
      act(() => {
        fake.fire("component:update");
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      });
      expect(result.current.mode).toBe("live");

      // Re-render with the SAME saved string reference — should NOT snap
      // back to server-compiled (no save actually happened).
      rerender({ saved: initial });
      expect(result.current.mode).toBe("live");
      expect(result.current.html).toBe("<html>burst</html>");
    });
  });

  describe("editor not yet mounted", () => {
    it("falls back to savedCompiledHtml when editor is null", () => {
      const { result } = renderHook(() =>
        useLivePreviewHtml(null, "<html>only-saved</html>")
      );
      expect(result.current.html).toBe("<html>only-saved</html>");
      expect(result.current.mode).toBe("server-compiled");
    });

    it("subscribes only after the editor becomes available", () => {
      const fake = makeFakeEditor("<html>late</html>");
      const { result, rerender } = renderHook(
        ({ ed }: { ed: Editor | null }) =>
          useLivePreviewHtml(ed, "<html>saved</html>"),
        { initialProps: { ed: null as Editor | null } }
      );

      expect(result.current.html).toBe("<html>saved</html>");

      rerender({ ed: fake.editor });

      act(() => {
        fake.fire("component:update");
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS);
      });

      expect(result.current.html).toBe("<html>late</html>");
      expect(result.current.mode).toBe("live");
    });
  });
});
