import { expect, test } from "bun:test";
import { latestFinancialPeriod } from "./latest-financial-period";

test("period selection rejects malformed and impossible dates without normalizing them into a new period", () => {
  const valid = { date: "2024-02-29", value: 0 };
  const invalid = ["", "TTM", "2026-2-28", "2026-02-29", "2026-04-31", "2026-13-01", "2026-06-30T00:00:00Z"];
  const rows = [valid, ...invalid.map(date => ({ date, value: 100 }))];
  expect(latestFinancialPeriod(rows, row => row.date)).toBe(valid);
  expect(latestFinancialPeriod(rows.slice(1), row => row.date)).toBeUndefined();
  expect(latestFinancialPeriod([], row => String(row))).toBeUndefined();
});

test("equal periods preserve last source precedence and never prefer a larger or more complete value", () => {
  const first = { date: "2025-12-31", value: 100, availableAt: "2026-03-01" };
  const last = { date: "2025-12-31", value: 0, availableAt: "2026-02-01" };
  expect(latestFinancialPeriod([first, last, { date: "2024-12-31", value: 200 }], row => row.date)).toBe(last);
  const partial = { date: "2026-06-30" };
  expect(latestFinancialPeriod([partial, first, last], row => row.date)).toBe(partial);
});
