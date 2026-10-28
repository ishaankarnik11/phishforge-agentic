import { describe, it, expect } from "vitest";
import { formatUsd } from "./formatCost";

describe("formatUsd", () => {
  it("formats positive numbers with $ and 4 decimal places", () => {
    expect(formatUsd(0.0234)).toBe("$0.0234");
    expect(formatUsd(1.5)).toBe("$1.5000");
  });

  it("formats zero as $0.0000", () => {
    expect(formatUsd(0)).toBe("$0.0000");
  });

  it("rounds to 4 decimal places", () => {
    expect(formatUsd(0.123456789)).toBe("$0.1235");
  });

  it("falls back to $0.0000 for null / undefined / NaN", () => {
    expect(formatUsd(null)).toBe("$0.0000");
    expect(formatUsd(undefined)).toBe("$0.0000");
    expect(formatUsd(NaN)).toBe("$0.0000");
  });

  it("renders large amounts with thousands separator", () => {
    expect(formatUsd(1234.5678)).toBe("$1,234.5678");
  });
});
