// Money rendering (W4): integer minor units in, formatted display out — the
// UI never does float arithmetic beyond display division.
import { describe, it, expect } from "vitest";
import { money } from "../src/components/ops/Finance";

describe("money", () => {
  it("formats minor units with two decimals and the currency", () => {
    expect(money(500000, "KES")).toBe("KES 5,000.00");
    expect(money(1, "USD")).toBe("USD 0.01");
  });

  it("defaults the currency when the fund has none yet", () => {
    expect(money(0, null)).toBe("KES 0.00");
  });
});
