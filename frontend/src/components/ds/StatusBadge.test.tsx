import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("ds/StatusBadge", () => {
  it("renders its label", () => {
    render(<StatusBadge tone="success">Generated</StatusBadge>);
    expect(screen.getByText("Generated")).toBeInTheDocument();
  });

  it("always renders a leading icon so meaning is not color-only (Two-Signal Rule)", () => {
    const tones = ["success", "warning", "danger", "info", "neutral"] as const;
    for (const tone of tones) {
      const { container, unmount } = render(
        <StatusBadge tone={tone}>{tone}</StatusBadge>
      );
      expect(container.querySelector("svg")).toBeInTheDocument();
      unmount();
    }
  });

  it("accepts a custom icon override", () => {
    render(
      <StatusBadge icon={<span data-testid="custom-icon">!</span>}>
        Custom
      </StatusBadge>
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });
});
