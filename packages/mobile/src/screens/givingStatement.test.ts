import { describe, it, expect } from "vitest";
import { isSettled, statementTotalMinor, groupByMonth, monthLabel, shortRef } from "./givingStatement";
import type { GivingRecord } from "../api/types";

function rec(over: Partial<GivingRecord>): GivingRecord {
  return {
    transaction_id: "t",
    amount_minor: 250000,
    currency: "KES",
    status: "succeeded",
    fund: "tithe",
    method: "mpesa",
    provider_ref: "QFR8K2",
    created_at: "2026-05-25T09:00:00Z",
    settled_at: "2026-05-25T09:01:00Z",
    ...over,
  };
}

const records: GivingRecord[] = [
  rec({ transaction_id: "1", fund: "tithe", amount_minor: 250000, status: "succeeded", created_at: "2026-05-25T09:00:00Z" }),
  rec({ transaction_id: "2", fund: "offering", amount_minor: 50000, status: "processing", created_at: "2026-05-18T09:00:00Z" }),
  rec({ transaction_id: "3", fund: "mission", amount_minor: 100000, status: "succeeded", created_at: "2026-05-11T09:00:00Z" }),
  rec({ transaction_id: "4", fund: "offering", amount_minor: 50000, status: "refunded", created_at: "2026-03-23T09:00:00Z" }),
  rec({ transaction_id: "5", fund: "tithe", amount_minor: 250000, status: "succeeded", created_at: "2026-03-09T09:00:00Z" }),
];

describe("isSettled", () => {
  it("recognizes settled statuses only", () => {
    expect(isSettled("succeeded")).toBe(true);
    expect(isSettled("settled")).toBe(true);
    expect(isSettled("processing")).toBe(false);
    expect(isSettled("refunded")).toBe(false);
  });
});

describe("statementTotalMinor", () => {
  it("sums settled gifts only (excludes processing + refunded)", () => {
    // 250000 + 100000 + 250000 = 600000 (May processing 50000 + Mar refund 50000 excluded)
    expect(statementTotalMinor(records)).toBe(600000);
  });
});

describe("groupByMonth", () => {
  it("buckets by calendar month, newest first, with settled-only subtotals", () => {
    const groups = groupByMonth(records);
    expect(groups.map((g) => g.key)).toEqual(["2026-05", "2026-03"]);
    expect(groups[0]!.label).toBe("MAY 2026");
    expect(groups[0]!.totalMinor).toBe(350000); // 250000 + 100000 (processing excluded)
    expect(groups[1]!.totalMinor).toBe(250000); // refund excluded
    // newest-first within the month
    expect(groups[0]!.records.map((r) => r.transaction_id)).toEqual(["1", "2", "3"]);
  });
});

describe("monthLabel + shortRef", () => {
  it("formats a month label", () => {
    expect(monthLabel("2026-04-14T00:00:00Z")).toBe("APRIL 2026");
  });
  it("normalizes a provider ref to the last 8 alphanumerics, uppercased", () => {
    expect(shortRef("ref-qfr8k2")).toBe("REFQFR8K2".slice(-8)); // "EFQFR8K2"
    expect(shortRef("QFR8K2")).toBe("QFR8K2");
    expect(shortRef(null)).toBeNull();
    expect(shortRef("---")).toBeNull();
  });
});
