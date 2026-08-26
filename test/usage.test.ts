import { describe, expect, test } from "bun:test";
import {
  addAdvisorUsage,
  emptyAdvisorUsageTotals,
  formatAdvisorUsage,
  formatAdvisorUsageStatus,
  formatAdvisorUsageTotals,
  snapshotAdvisorUsage,
} from "../src/usage.js";

describe("Advisor usage", () => {
  test("normalizes token and provider cost fields", () => {
    expect(
      snapshotAdvisorUsage({
        cacheRead: 20,
        cacheWrite: 3,
        cost: { total: 0.012_34 },
        input: 1200,
        output: 456,
        totalTokens: 1656,
      })
    ).toEqual({
      cacheRead: 20,
      cacheWrite: 3,
      cost: 0.012_34,
      input: 1200,
      output: 456,
      totalTokens: 1656,
    });
    expect(snapshotAdvisorUsage({ input: "unknown" })).toBeUndefined();
    expect(snapshotAdvisorUsage({ totalCost: 0.5 })).toEqual({ cost: 0.5 });
  });

  test("formats individual usage without treating missing fields as zero", () => {
    expect(
      formatAdvisorUsage({
        cost: { total: 0.012_34 },
        input: 1200,
        output: 456,
      })
    ).toBe("↑1.2k · ↓456 · $0.0123");
    expect(formatAdvisorUsage({})).toBeUndefined();
  });

  test("aggregates known usage and reports calls without usage data", () => {
    const totals = emptyAdvisorUsageTotals();
    addAdvisorUsage(totals, {
      cost: { total: 0.01 },
      input: 1000,
      output: 100,
    });
    addAdvisorUsage(totals, undefined);

    expect(totals).toEqual({
      cacheRead: undefined,
      cacheWrite: undefined,
      calls: 2,
      cost: 0.01,
      costCalls: 1,
      input: 1000,
      knownCalls: 1,
      output: 100,
      totalTokens: undefined,
    });
    expect(formatAdvisorUsageTotals(totals)).toBe(
      "↑1.0k · ↓100 · $0.0100 · 1 without usage data"
    );
    expect(formatAdvisorUsageStatus(totals)).toBe(
      "Advisor: 2 calls · ↑1.0k · ↓100 · $0.0100 · 1 without usage data"
    );
  });
});
