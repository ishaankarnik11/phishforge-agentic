import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";
import { Section } from "./Section";

describe("ds/Card", () => {
  it("renders children", () => {
    render(<Card>card body</Card>);
    expect(screen.getByText("card body")).toBeInTheDocument();
  });

  it("adds the hover Raise lift only when interactive (no resting shadow)", () => {
    const { rerender, container } = render(<Card>flat</Card>);
    expect(container.firstChild).not.toHaveClass("hover:shadow-raise");
    rerender(<Card interactive>lift</Card>);
    expect(container.firstChild).toHaveClass("hover:shadow-raise");
  });
});

describe("ds/Section", () => {
  it("renders a headline title, description, action, and children", () => {
    render(
      <Section
        title="Recent simulations"
        description="Your latest templates"
        action={<button type="button">New</button>}
      >
        <p>content</p>
      </Section>
    );
    expect(
      screen.getByRole("heading", { name: "Recent simulations" })
    ).toBeInTheDocument();
    expect(screen.getByText("Your latest templates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
