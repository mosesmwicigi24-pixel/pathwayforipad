// Give screen — pure presentation helpers for the recurring-schedule detail and
// the giving-history status chips. The React tree isn't exercised here (the suite
// stays render-free like the other screen tests); we lock the wire→label/colour
// mapping so the schedule detail and history chips stay correct against the
// backend contracts (GET /giving/schedules, GET /giving/history).
import { describe, it, expect } from "vitest";
import { freqLabel, methodLabel, historyStatusChip } from "../src/screens/givingHelpers";
import { palette } from "../src/theme/tokens";

describe("Give: recurring schedule labels", () => {
  it("renders a human cadence per frequency", () => {
    expect(freqLabel("weekly")).toBe("Every week");
    expect(freqLabel("monthly")).toBe("Every month");
  });

  it("maps known payment methods to friendly labels", () => {
    expect(methodLabel("mpesa")).toBe("M-Pesa");
    expect(methodLabel("airtel")).toBe("Airtel Money");
    expect(methodLabel("card")).toBe("Card");
    expect(methodLabel("paypal")).toBe("PayPal");
  });
});

describe("Give: giving-history status chips", () => {
  it("colours succeeded with the success token", () => {
    const chip = historyStatusChip("succeeded");
    expect(chip.bg).toBe(palette.successBg);
    expect(chip.fg).toBe(palette.successText);
    expect(chip.label).toBe("Succeeded");
  });

  it("colours processing with the warning/gold token", () => {
    const chip = historyStatusChip("processing");
    expect(chip.fg).toBe(palette.goldChipText);
    expect(chip.label).toBe("Processing");
  });

  it("colours failed with the error token", () => {
    const chip = historyStatusChip("failed");
    expect(chip.fg).toBe(palette.error);
    expect(chip.label).toBe("Failed");
  });

  it("colours refunded with a muted token", () => {
    const chip = historyStatusChip("refunded");
    expect(chip.fg).toBe(palette.ink600);
    expect(chip.label).toBe("Refunded");
  });

  it("falls back to a capitalised label for unknown statuses", () => {
    const chip = historyStatusChip("pending");
    expect(chip.label).toBe("Pending");
    expect(chip.fg).toBe(palette.ink600);
  });
});
