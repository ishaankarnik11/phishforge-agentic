import { describe, it, expect, vi } from "vitest";
import type { Editor } from "grapesjs";
import { commitPendingEdits } from "./commitPendingEdits";

// justified: GrapesJS Editor type has ~50 nested manager types we do not use here
/* eslint-disable @typescript-eslint/no-explicit-any */

describe("commitPendingEdits", () => {
  it("blurs the canvas iframe's active element so the RTE commits its buffer", () => {
    const blur = vi.fn();
    const fakeActiveEl: any = Object.create(HTMLElement.prototype);
    fakeActiveEl.blur = blur;

    const editor: any = {
      Canvas: {
        getDocument: () => ({ activeElement: fakeActiveEl }),
      },
      select: vi.fn(),
    };

    commitPendingEdits(editor as Editor);

    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("clears the GrapesJS selection so the component tree is the source of truth", () => {
    const select = vi.fn();
    const editor: any = {
      Canvas: {
        getDocument: () => ({ activeElement: null }),
      },
      select,
    };

    commitPendingEdits(editor as Editor);

    expect(select).toHaveBeenCalledWith(undefined);
  });

  it("is a no-op on the active-element when nothing is focused", () => {
    const editor: any = {
      Canvas: {
        getDocument: () => ({ activeElement: null }),
      },
      select: vi.fn(),
    };

    expect(() => commitPendingEdits(editor as Editor)).not.toThrow();
  });

  it("tolerates a missing Canvas manager (older grapesjs builds)", () => {
    const editor: any = {
      Canvas: undefined,
      select: vi.fn(),
    };

    expect(() => commitPendingEdits(editor as Editor)).not.toThrow();
    expect(editor.select).toHaveBeenCalledWith(undefined);
  });

  it("swallows errors thrown by editor.select(undefined) on older builds", () => {
    const editor: any = {
      Canvas: { getDocument: () => ({ activeElement: null }) },
      select: vi.fn().mockImplementation(() => {
        throw new Error("not supported");
      }),
    };

    expect(() => commitPendingEdits(editor as Editor)).not.toThrow();
  });

  it("does not blur non-HTMLElement active nodes (e.g. document.body in jsdom edge cases)", () => {
    // activeElement could be an SVGElement or something exotic — only HTMLElement should be blurred.
    const fakeNonHtmlActive = { blur: vi.fn() };
    const editor: any = {
      Canvas: {
        getDocument: () => ({ activeElement: fakeNonHtmlActive }),
      },
      select: vi.fn(),
    };

    commitPendingEdits(editor as Editor);

    expect(fakeNonHtmlActive.blur).not.toHaveBeenCalled();
  });
});
