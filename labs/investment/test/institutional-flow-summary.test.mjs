import assert from "node:assert/strict";
import test from "node:test";
import { summarizeInstitutionalFlows } from "../src/domain/institutional-flow-summary.mjs";

const day = (index, foreignNetShares = 10) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`,
  foreignNetShares,
  trustNetShares: -2,
  dealerNetShares: 3,
  allThreeNetShares: foreignNetShares + 1,
});

test("institutional 5/10 session totals and directional streaks use the exact dated source rows", () => {
  const result = summarizeInstitutionalFlows(Array.from({ length: 10 }, (_, index) => day(index)));
  assert.equal(result.points.length, 10);
  assert.equal(result.fiveSessions.complete, true);
  assert.equal(result.fiveSessions.foreignNetShares, 50);
  assert.equal(result.fiveSessions.trustNetShares, -10);
  assert.equal(result.tenSessions.complete, true);
  assert.equal(result.tenSessions.allThreeNetShares, 110);
  assert.deepEqual(result.streaks.foreignNetShares, { direction: "BUY", sessions: 10, netShares: 100, through: "2026-09-10" });
  assert.deepEqual(result.streaks.trustNetShares, { direction: "SELL", sessions: 10, netShares: -20, through: "2026-09-10" });
});

test("short or incomplete series stays partial and never zero-fills missing sessions", () => {
  const rows = [day(0), day(1), { ...day(2), dealerNetShares: null }, day(3)];
  const result = summarizeInstitutionalFlows(rows);
  assert.equal(result.fiveSessions.complete, false);
  assert.equal(result.fiveSessions.foreignNetShares, null);
  assert.equal(result.fiveSessions.dealerNetShares, null);
  assert.equal(result.tenSessions.sessions, 4);
  assert.equal(result.tenSessions.complete, false);
  assert.equal(result.streaks.foreignNetShares.sessions, 4);
  assert.equal(result.points.some(point => point.dealerNetShares === 0), false);
});

test("neutral and missing latest values stop a consecutive-flow streak", () => {
  const neutral = summarizeInstitutionalFlows([day(0, 8), day(1, 0)]);
  const missing = summarizeInstitutionalFlows([day(0, 8), { ...day(1), foreignNetShares: null }]);
  assert.deepEqual(neutral.streaks.foreignNetShares, { direction: "NEUTRAL", sessions: 0, netShares: null, through: "2026-09-02" });
  assert.deepEqual(missing.streaks.foreignNetShares, { direction: "UNAVAILABLE", sessions: 0, netShares: null, through: "2026-09-02" });
});

test("invalid calendar dates are excluded instead of normalizing into another date", () => {
  const result = summarizeInstitutionalFlows([day(0), { ...day(1), date: "2026-09-31" }]);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0].date, "2026-09-01");
});
