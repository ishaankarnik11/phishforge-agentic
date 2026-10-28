import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import DesignTokensPage from "./DesignTokensPage";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("DesignTokensPage (STORY-AP0.2 token preview)", () => {
  it("renders the signature Authorization Context Bar copy", () => {
    render(<DesignTokensPage />);
    expect(screen.getByText("Authorized simulation")).toBeInTheDocument();
  });

  it("theme toggle drives the data-theme attribute on <html>", () => {
    render(<DesignTokensPage />);
    // System default leaves the attribute unset.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "system" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
