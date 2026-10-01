import { expect, test } from "bun:test";
import { formatChange } from "./format";

test("compensation comparisons preserve fractional changes and reported zero", () => {
  // Captured AAPL 2026 proxy, fiscal 2025 versus fiscal 2024.
  expect(formatChange(74_294_811, 74_609_802)).toBe("-0.42%");
  expect(formatChange(100.42, 100)).toBe("+0.42%");
  expect(formatChange(0, 100)).toBe("-100%");
  expect(formatChange(100, 100)).toBe("0%");
  expect(formatChange(100.001, 100)).toBe("+<0.01%");
  expect(formatChange(99.999, 100)).toBe("-<0.01%");
});

test("compensation comparisons require finite amounts and a positive prior year", () => {
  for (const missing of [null, undefined, Number.NaN, Infinity, -Infinity]) {
    expect(formatChange(missing, 100)).toBe("");
    expect(formatChange(100, missing)).toBe("");
  }
  expect(formatChange(0, 0)).toBe("");
  expect(formatChange(100, 0)).toBe("");
  expect(formatChange(100, -1)).toBe("");
  expect(formatChange(Number.MAX_VALUE, Number.MIN_VALUE)).toBe("");
});
