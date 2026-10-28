import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDeleteDialog from "./ConfirmDeleteDialog";
import type { ConfirmDeleteDialogProps } from "./ConfirmDeleteDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps: ConfirmDeleteDialogProps = {
  isOpen: true,
  assetName: "Diwali Festive Banner",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  isDeleting: false,
};

function renderDialog(overrides: Partial<ConfirmDeleteDialogProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<ConfirmDeleteDialog {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfirmDeleteDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Renders when isOpen=true, hidden when false
  // -----------------------------------------------------------------------
  it("renders the dialog when isOpen is true", () => {
    renderDialog();
    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();
    expect(screen.getByText("Delete Asset")).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    renderDialog({ isOpen: false });
    expect(
      screen.queryByTestId("confirm-delete-dialog"),
    ).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // 2. Shows asset name in the message
  // -----------------------------------------------------------------------
  it("displays the asset name in the confirmation message", () => {
    renderDialog({ assetName: "Credit Card Hero Image" });
    const message = screen.getByTestId("confirm-delete-message");
    expect(message).toHaveTextContent("Credit Card Hero Image");
    expect(message).toHaveTextContent(
      "This will hide it from the library but existing emailers using this asset will not be affected.",
    );
  });

  // -----------------------------------------------------------------------
  // 3. Cancel button calls onCancel
  // -----------------------------------------------------------------------
  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel });

    await user.click(screen.getByTestId("confirm-delete-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 4. Delete button calls onConfirm
  // -----------------------------------------------------------------------
  it("calls onConfirm when Delete button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onConfirm });

    await user.click(screen.getByTestId("confirm-delete-submit"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5. Delete button shows loading state when isDeleting=true
  // -----------------------------------------------------------------------
  it("shows spinner and 'Deleting...' text when isDeleting is true", () => {
    renderDialog({ isDeleting: true });

    expect(screen.getByTestId("confirm-delete-spinner")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-delete-submit")).toHaveTextContent(
      "Deleting...",
    );
    expect(screen.getByTestId("confirm-delete-submit")).toBeDisabled();
    expect(screen.getByTestId("confirm-delete-cancel")).toBeDisabled();
  });

  it("shows 'Delete' text when isDeleting is false", () => {
    renderDialog({ isDeleting: false });

    expect(
      screen.queryByTestId("confirm-delete-spinner"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-delete-submit")).toHaveTextContent(
      "Delete",
    );
    expect(screen.getByTestId("confirm-delete-submit")).not.toBeDisabled();
  });

  // -----------------------------------------------------------------------
  // 6. Escape key calls onCancel
  // -----------------------------------------------------------------------
  it("calls onCancel when Escape key is pressed", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel });

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel on Escape when isDeleting is true", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel, isDeleting: true });

    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 7. Backdrop click calls onCancel
  // -----------------------------------------------------------------------
  it("calls onCancel when clicking the backdrop", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel });

    await user.click(screen.getByTestId("confirm-delete-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel on backdrop click when isDeleting is true", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onCancel, isDeleting: true });

    await user.click(screen.getByTestId("confirm-delete-backdrop"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
