import test from "node:test";
import assert from "node:assert/strict";
import { first, monthStarts, normalizeDate, number, rows, staleByCalendarDays } from "../src/lib/normalize.mjs";

test("official provider values normalize without turning missing markers into zero", () => {
  assert.equal(number("1,234.5"), 1234.5);
  assert.equal(number("--"), null);
  assert.equal(number(""), null);
  assert.equal(number("(12)"), -12);
  assert.equal(first({ a: "", b: "20260930" }, ["a", "b"]), "20260930");
  assert.equal(rows({ data: [["x"], null] }).length, 1);
});

test("ROC and Gregorian dates validate calendar days", () => {
  assert.equal(normalizeDate("115/09/30"), "2026-09-30");
  assert.equal(normalizeDate("20260930"), "2026-09-30");
  assert.equal(normalizeDate("115/02/30"), null);
});

test("month query window uses Taipei calendar months and source date drives stale flag", () => {
  assert.deepEqual(monthStarts(3, new Date("2026-10-01T00:00:00Z")), ["20260801", "20260901", "20261001"]);
  assert.equal(typeof staleByCalendarDays("2026-09-30", 5), "boolean");
  assert.equal(staleByCalendarDays(null, 5), null);
});
