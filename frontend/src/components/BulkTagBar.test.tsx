import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BulkTagBar from "./BulkTagBar";
import type { BulkTagBarProps } from "./BulkTagBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps: BulkTagBarProps = {
  selectedCount: 3,
  onAddTag: vi.fn(),
  onRemoveTag: vi.fn(),
  onDeselectAll: vi.fn(),
  isLoading: false,
  existingTags: ["banner", "hero", "icon", "background"],
};

function renderBar(overrides: Partial<BulkTagBarProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<BulkTagBar {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BulkTagBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Renders with correct selected count
  // -------------------------------------------------------------------------
  it("renders with the correct selected count", () => {
    renderBar({ selectedCount: 5 });
    expect(screen.getByTestId("bulk-tag-selected-count")).toHaveTextContent(
      "5 selected"
    );
  });

  it("renders with selectedCount of 1", () => {
    renderBar({ selectedCount: 1 });
    expect(screen.getByTestId("bulk-tag-selected-count")).toHaveTextContent(
      "1 selected"
    );
  });

  // -------------------------------------------------------------------------
  // 2. "Deselect all" calls callback
  // -------------------------------------------------------------------------
  it("calls onDeselectAll when 'Deselect all' is clicked", async () => {
    const onDeselectAll = vi.fn();
    const user = userEvent.setup();
    renderBar({ onDeselectAll });

    await user.click(screen.getByTestId("bulk-tag-deselect-all"));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 3. Tag input accepts text
  // -------------------------------------------------------------------------
  it("accepts text in the tag input", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "promo");
    expect(input).toHaveValue("promo");
  });

  // -------------------------------------------------------------------------
  // 4. "Add Tag" button calls onAddTag with input value
  // -------------------------------------------------------------------------
  it("calls onAddTag with the input value when 'Add Tag' is clicked", async () => {
    const onAddTag = vi.fn();
    const user = userEvent.setup();
    renderBar({ onAddTag });

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "festival");
    await user.click(screen.getByTestId("bulk-tag-add-btn"));

    expect(onAddTag).toHaveBeenCalledWith("festival");
  });

  it("does not call onAddTag when input is empty", async () => {
    const onAddTag = vi.fn();
    const user = userEvent.setup();
    renderBar({ onAddTag });

    await user.click(screen.getByTestId("bulk-tag-add-btn"));
    expect(onAddTag).not.toHaveBeenCalled();
  });

  it("clears the input after calling onAddTag", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "promo");
    await user.click(screen.getByTestId("bulk-tag-add-btn"));

    expect(input).toHaveValue("");
  });

  // -------------------------------------------------------------------------
  // 5. "Remove Tag" button calls onRemoveTag with input value
  // -------------------------------------------------------------------------
  it("calls onRemoveTag with the input value when 'Remove Tag' is clicked", async () => {
    const onRemoveTag = vi.fn();
    const user = userEvent.setup();
    renderBar({ onRemoveTag });

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "banner");
    await user.click(screen.getByTestId("bulk-tag-remove-btn"));

    expect(onRemoveTag).toHaveBeenCalledWith("banner");
  });

  it("does not call onRemoveTag when input is empty", async () => {
    const onRemoveTag = vi.fn();
    const user = userEvent.setup();
    renderBar({ onRemoveTag });

    await user.click(screen.getByTestId("bulk-tag-remove-btn"));
    expect(onRemoveTag).not.toHaveBeenCalled();
  });

  it("clears the input after calling onRemoveTag", async () => {
    const user = userEvent.setup();
    renderBar();

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "banner");
    await user.click(screen.getByTestId("bulk-tag-remove-btn"));

    expect(input).toHaveValue("");
  });

  // -------------------------------------------------------------------------
  // 6. Buttons disabled when isLoading
  // -------------------------------------------------------------------------
  it("disables both buttons and input when isLoading is true", () => {
    renderBar({ isLoading: true });

    expect(screen.getByTestId("bulk-tag-add-btn")).toBeDisabled();
    expect(screen.getByTestId("bulk-tag-remove-btn")).toBeDisabled();
    expect(screen.getByTestId("bulk-tag-input")).toBeDisabled();
  });

  it("shows loading spinners when isLoading is true", () => {
    renderBar({ isLoading: true });

    expect(screen.getByTestId("bulk-tag-add-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-tag-remove-spinner")).toBeInTheDocument();
  });

  it("does not show loading spinners when isLoading is false", () => {
    renderBar({ isLoading: false });

    expect(
      screen.queryByTestId("bulk-tag-add-spinner")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("bulk-tag-remove-spinner")
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 7. Enter key triggers Add Tag
  // -------------------------------------------------------------------------
  it("calls onAddTag when Enter is pressed with text in input", async () => {
    const onAddTag = vi.fn();
    const user = userEvent.setup();
    renderBar({ onAddTag });

    const input = screen.getByTestId("bulk-tag-input");
    await user.type(input, "promo{Enter}");

    expect(onAddTag).toHaveBeenCalledWith("promo");
  });
});
