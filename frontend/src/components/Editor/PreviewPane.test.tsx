import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "grapesjs";
import PreviewPane from "./PreviewPane";
import { LIVE_PREVIEW_DEBOUNCE_MS } from "./useLivePreviewHtml";

// justified: GrapesJS Editor type carries dozens of nested manager types we
// do not exercise in this component test. We synthesize the subset
// `useLivePreviewHtml` consumes.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface FakeEditor {
  editor: Editor;
  fire: (event: string) => void;
  setHtml: (html: string) => void;
}

function makeFakeEditor(initial = "<html>live</html>"): FakeEditor {
  const handlers = new Map<string, Set<() => void>>();
  let html = initial;
  const editor: any = {
    on: (event: string, handler: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => {
      handlers.get(event)?.delete(handler);
    },
    runCommand: (cmd: string) => {
      if (cmd === "mjml-code-to-html") return { html, errors: [] };
      return undefined;
    },
  };
  return {
    editor: editor as Editor,
    fire: (event: string) => handlers.get(event)?.forEach((h) => h()),
    setHtml: (next: string) => {
      html = next;
    },
  };
}

describe("PreviewPane", () => {
  it("shows placeholder when compiledHtml is null and no editor", () => {
    render(<PreviewPane compiledHtml={null} />);

    expect(
      screen.getByText(/no preview available/i)
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Email preview")).not.toBeInTheDocument();
  });

  it("renders iframe with compiled HTML", () => {
    const html = "<html><body>Hello</body></html>";
    render(<PreviewPane compiledHtml={html} />);

    const iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute("srcdoc")).toBe(html);
  });

  it("defaults to desktop viewport (AC-6)", () => {
    render(<PreviewPane compiledHtml="<html></html>" />);

    const desktopBtn = screen.getByRole("button", { name: /desktop/i });
    const mobileBtn = screen.getByRole("button", { name: /mobile/i });

    expect(desktopBtn.getAttribute("aria-pressed")).toBe("true");
    expect(mobileBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches to mobile viewport on click (AC-6)", async () => {
    const user = userEvent.setup();
    render(<PreviewPane compiledHtml="<html></html>" />);

    const mobileBtn = screen.getByRole("button", { name: /mobile/i });
    await user.click(mobileBtn);

    expect(mobileBtn.getAttribute("aria-pressed")).toBe("true");

    const iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
    expect(iframe.style.width).toBe("375px");
  });

  it("switches back to desktop viewport (AC-6)", async () => {
    const user = userEvent.setup();
    render(<PreviewPane compiledHtml="<html></html>" />);

    // Go to mobile first
    await user.click(screen.getByRole("button", { name: /mobile/i }));

    // Back to desktop
    const desktopBtn = screen.getByRole("button", { name: /desktop/i });
    await user.click(desktopBtn);

    expect(desktopBtn.getAttribute("aria-pressed")).toBe("true");

    const iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
    expect(iframe.style.width).toBe("100%");
  });

  describe("with a live editor (STORY-4.6)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-paints iframe srcDoc from live editor on component:update (AC-2)", async () => {
      const fake = makeFakeEditor("<html>v1-live</html>");
      render(
        <PreviewPane
          compiledHtml="<html>v0-saved</html>"
          editor={fake.editor}
        />
      );

      // Sanity: starts on the saved HTML
      let iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBe("<html>v0-saved</html>");

      // User edits → mutation event → after debounce, iframe should reflect
      // the live editor output.
      fake.setHtml("<html>v1-live</html>");
      await act(async () => {
        fake.fire("component:update");
        await vi.advanceTimersByTimeAsync(LIVE_PREVIEW_DEBOUNCE_MS);
      });

      iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBe("<html>v1-live</html>");
    });

    it("snaps to new server-compiled HTML when compiledHtml prop changes (AC-3)", () => {
      const fake = makeFakeEditor();
      const { rerender } = render(
        <PreviewPane
          compiledHtml="<html>v1-saved</html>"
          editor={fake.editor}
        />
      );

      let iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBe("<html>v1-saved</html>");

      rerender(
        <PreviewPane
          compiledHtml="<html>v2-saved</html>"
          editor={fake.editor}
        />
      );

      iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBe("<html>v2-saved</html>");
    });

    it("does not flicker the srcDoc on save snap (AC-4)", () => {
      const fake = makeFakeEditor("<html>live-mid-edit</html>");
      const { rerender } = render(
        <PreviewPane
          compiledHtml="<html>v1-saved</html>"
          editor={fake.editor}
        />
      );

      // Mid-edit (debounce in flight, no recompute yet)
      act(() => {
        fake.fire("component:update");
      });

      // Save lands BEFORE debounce expires
      rerender(
        <PreviewPane
          compiledHtml="<html>v2-server-compiled</html>"
          editor={fake.editor}
        />
      );

      // Iframe immediately reflects the server-compiled HTML — no
      // intermediate empty/blank srcDoc state.
      const iframe = screen.getByTitle("Email preview") as HTMLIFrameElement;
      expect(iframe.getAttribute("srcdoc")).toBe(
        "<html>v2-server-compiled</html>"
      );

      // Flush the debounce; the now-cancelled live recompute must not
      // overwrite the snap.
      act(() => {
        vi.advanceTimersByTime(LIVE_PREVIEW_DEBOUNCE_MS * 2);
      });
      expect(iframe.getAttribute("srcdoc")).toBe(
        "<html>v2-server-compiled</html>"
      );
    });
  });
});
