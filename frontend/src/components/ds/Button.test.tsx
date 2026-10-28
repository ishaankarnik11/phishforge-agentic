import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("ds/Button", () => {
  it("renders each variant and size without crashing", () => {
    const variants = ["primary", "secondary", "ghost", "danger"] as const;
    const sizes = ["sm", "md", "lg"] as const;
    for (const variant of variants) {
      for (const size of sizes) {
        const { unmount } = render(
          <Button variant={variant} size={size}>
            {variant}-{size}
          </Button>
        );
        expect(
          screen.getByRole("button", { name: `${variant}-${size}` })
        ).toBeInTheDocument();
        unmount();
      }
    }
  });

  it("defaults to type=button so it does not submit forms unexpectedly", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button", { name: "Click" })).toHaveAttribute(
      "type",
      "button"
    );
  });

  it("is disabled and does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Nope" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a spinner, sets aria-busy, and disables the control while loading", () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button", { name: /saving/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
  });

  it("hides the leading icon and shows the spinner instead while loading", () => {
    render(
      <Button loading leadingIcon={<span data-testid="lead">i</span>}>
        Go
      </Button>
    );
    expect(screen.queryByTestId("lead")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
  });
});
