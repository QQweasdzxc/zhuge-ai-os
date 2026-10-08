import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBrokerBranchEvidence } from "../src/domain/broker-branch-evidence.mjs";
import { renderBrokerBranchEvidence } from "../src/components/broker-branch-evidence.mjs";

test("broker branch summary keeps source date and only aggregates complete same-unit rows", () => {
  const result = normalizeBrokerBranchEvidence({ market: "TW", symbol: "2330", evidence: {
    status: "AVAILABLE", provider: "Authorized delayed provider", dataTimestamp: "2026-10-07", fetchedAt: "2026-10-08T00:00:00Z", source: "https://provider.example/branches",
    data: { rows: [{ date: "2026-10-07", branchName: "Branch A", buy: 120, sell: 90, unit: "shares" }, { date: "2026-10-07", branchName: "Branch B", buy: 20, sell: 25, unit: "shares" }] },
  } });
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(result.summary, { buy: 140, sell: 115, net: 25, unit: "shares" });
  assert.equal(result.dataTimestamp, "2026-10-07");
  assert.equal(result.rows[0].date, "2026-10-07");
  assert.match(renderBrokerBranchEvidence(result), /來源日期/);
});

test("broker branch source gates and incomplete rows never borrow institutional values", () => {
  const gated = normalizeBrokerBranchEvidence({ market: "TW", symbol: "2330", evidence: { status: "SECRET_REQUIRED", provider: "Licensed branch provider" } });
  assert.equal(gated.status, "SECRET_REQUIRED");
  assert.match(renderBrokerBranchEvidence(gated), /需要已授權/);
  const noService = renderBrokerBranchEvidence(normalizeBrokerBranchEvidence({
    market: "TW", symbol: "2330",
    evidence: { status: "SECRET_REQUIRED", note: "分點資料：尚未設定資料服務。" },
  }));
  assert.match(noService, /分點資料：尚未設定資料服務/);
  const partial = normalizeBrokerBranchEvidence({ market: "TW", symbol: "2330", evidence: { status: "AVAILABLE", provider: "Partial source", data: { rows: [{ branchName: "Branch A", buy: 10, sell: null }] } } });
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.summary, null);
  assert.equal(normalizeBrokerBranchEvidence({ market: "US", symbol: "AAPL" }).status, "NOT_APPLICABLE");
});

test("truncated broker rows never render a partial subtotal as a complete source-day total", () => {
  const partial = normalizeBrokerBranchEvidence({
    symbol: "2330",
    evidence: {
      status: "PARTIAL",
      provider: "FinMind daily branch source",
      dataTimestamp: "2026-10-07",
      data: {
        rows: [{ branch: "分點甲", date: "2026-10-07", buy: 100, sell: 40, net: 60, unit: "shares" }],
        summary: { buy: 100, sell: 40, net: 60, unit: "shares", complete: false },
      },
    },
  });
  assert.equal(partial.summary, null);
  const html = renderBrokerBranchEvidence(partial);
  assert.match(html, /來源列未完整/);
  assert.doesNotMatch(html, /最新來源日合計/);
});
