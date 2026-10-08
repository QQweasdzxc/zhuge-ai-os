import test from "node:test";
import assert from "node:assert/strict";
import { createFinMindBrokerBranchProvider } from "../../../supabase/functions/_shared/finmind-broker-branches.mjs";

const now = () => new Date("2026-10-08T02:00:00.000Z");

test("broker branch provider is read-only, server-secret gated, and market scoped", async () => {
  const anonymous = createFinMindBrokerBranchProvider({ now });
  const locked = await anonymous.getLatestBranchReport({ symbol: "2330", market: "TW" });
  assert.equal(locked.status, "SECRET_REQUIRED");
  assert.equal(locked.data.rows.length, 0);
  const notApplicable = await anonymous.getLatestBranchReport({ symbol: "AAPL", market: "US" });
  assert.equal(notApplicable.status, "NOT_APPLICABLE");
  assert.equal(notApplicable.dataTimestamp, null);
});

test("FinMind daily branch rows are server fetched, bounded, and retain source date and units", async () => {
  let requested = null;
  const provider = createFinMindBrokerBranchProvider({
    token: "server-only-test-token",
    now,
    fetcher: async (url, options) => {
      requested = { url: new URL(url), options };
      return {
        ok: true,
        status: 200,
        async json() { return { status: 200, data: [
          { stock_id: "2330", date: "2026-10-07", securities_trader: "分點甲", buy: 1200, sell: 700 },
          { stock_id: "2330", date: "2026-10-07", securities_trader: "分點甲", buy: 300, sell: 100 },
          { stock_id: "2330", date: "2026-10-06", securities_trader_id: "分點乙", buy: 900, sell: 1200 },
          { stock_id: "2317", date: "2026-10-07", securities_trader: "其他股票分點", buy: 9000, sell: 0 },
          { stock_id: "2330", date: "2026-10-08", securities_trader: "未來列", buy: 9000, sell: 0 },
          { stock_id: "2330", date: "2026-10-07", securities_trader: "缺值列", buy: null, sell: 10 },
        ] }; },
      };
    },
  });
  const result = await provider.getLatestBranchReport({ symbol: "2330.TW", market: "TW" });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.provider, "FinMind TaiwanStockTradingDailyReport · delayed source data");
  assert.equal(result.dataTimestamp, "2026-10-07");
  assert.deepEqual(result.data.rows.map(item => [item.branch, item.buy, item.sell, item.net, item.unit]), [["分點甲", 1500, 800, 700, "shares"]]);
  assert.deepEqual(result.data.recentSourceDates, ["2026-10-06", "2026-10-07"]);
  assert.equal(result.data.summary.net, 700);
  assert.equal(requested.url.searchParams.get("dataset"), "TaiwanStockTradingDailyReport");
  assert.equal(requested.url.searchParams.get("data_id"), "2330");
  assert.equal(requested.url.searchParams.get("end_date"), "2026-10-07", "do not treat the current in-progress session as a full historical day");
  assert.equal(requested.url.searchParams.get("token"), "server-only-test-token");
  assert.equal(requested.options.method, "GET");
  assert.equal(JSON.stringify(result).includes("server-only-test-token"), false);
  assert.equal(JSON.stringify(result).includes("2317"), false);
});

test("invalid symbols fail closed without sending a provider request", async () => {
  let calls = 0;
  const provider = createFinMindBrokerBranchProvider({ token: "test", now, fetcher: async () => { calls += 1; throw new Error("should not fetch"); } });
  const result = await provider.getLatestBranchReport({ symbol: "https://attacker.example", market: "TW" });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.errorCode, "SYMBOL_INVALID");
  assert.equal(calls, 0);
});
