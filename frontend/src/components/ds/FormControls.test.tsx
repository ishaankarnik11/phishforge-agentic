import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./Input";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

describe("ds form controls", () => {
  it("Input accepts typed text", async () => {
    render(<Input aria-label="email" />);
    const input = screen.getByLabelText("email");
    await userEvent.type(input, "sana@example.com");
    expect(input).toHaveValue("sana@example.com");
  });

  it("Input marks itself invalid via aria-invalid when invalid", () => {
    render(<Input aria-label="email" invalid />);
    expect(screen.getByLabelText("email")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("Input renders machine values in mono", () => {
    render(<Input aria-label="domain" mono defaultValue="acme.example" />);
    expect(screen.getByLabelText("domain").className).toContain("font-mono");
  });

  it("Select renders its options and reflects selection", async () => {
    render(
      <Select aria-label="urgency" defaultValue="low">
        <option value="low">Low</option>
        <option value="high">High</option>
      </Select>
    );
    const select = screen.getByLabelText("urgency");
    await userEvent.selectOptions(select, "high");
    expect(select).toHaveValue("high");
  });

  it("Textarea accepts multi-line input and supports mono", async () => {
    render(<Textarea aria-label="mjml" mono />);
    const ta = screen.getByLabelText("mjml");
    expect(ta.className).toContain("font-mono");
    await userEvent.type(ta, "<mjml>");
    expect(ta).toHaveValue("<mjml>");
  });
});
