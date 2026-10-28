import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";
import { Input } from "./Input";

describe("ds/Field", () => {
  it("associates the label with the control and renders help text", () => {
    render(
      <Field label="Sender email" help="Use the impersonated address">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>
    );
    const input = screen.getByLabelText("Sender email");
    expect(input).toBeInTheDocument();
    expect(
      screen.getByText("Use the impersonated address")
    ).toBeInTheDocument();
  });

  it("renders an (optional) affordance when not required", () => {
    render(
      <Field label="Logo" required={false}>
        {({ id }) => <Input id={id} />}
      </Field>
    );
    expect(screen.getByText("(optional)")).toBeInTheDocument();
  });

  it("shows the error as an alert with text (Two-Signal Rule) and marks the control invalid", () => {
    render(
      <Field label="Sender email" error="Enter a valid email address">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid email address");
    expect(screen.getByLabelText("Sender email")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
  });

  it("hides help text once an error is present", () => {
    render(
      <Field label="Name" help="Helper text" error="Required">
        {({ id, describedBy, invalid }) => (
          <Input id={id} aria-describedby={describedBy} invalid={invalid} />
        )}
      </Field>
    );
    expect(screen.queryByText("Helper text")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});
