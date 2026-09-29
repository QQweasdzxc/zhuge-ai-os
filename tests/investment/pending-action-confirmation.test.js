const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Repository = require("../../modules/investment/services/supabase-investment-repository.js");
const TransactionsPage = require("../../modules/investment/pages/transactions-page.js");
const Hub = require("../../shared/components/global-floating-hub.js");

const ROOT = path.join(__dirname, "..", "..");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

test("pending Investment actions are owner-scoped Cloud reads and confirm through one controlled RPC", async () => {
  const calls = [];
  const data = {
    async select(table, query) {
      calls.push({ type: "select", table, query });
      if (table === "app_users") return [{ id: "owner-1" }];
      if (table === "investment_pending_actions") return [{
        id: "pending-1", portfolio_id: "portfolio-1", action_type: "record_transaction", status: "pending",
        source: "zhuge_screenshot_review", title: "0050 新交易", summary: "等待確認",
        transaction_payload: { tradeDate: "2026-09-15", tradeType: "BUY", symbol: "0050", quantity: 28, price: 106.69, currency: "TWD", market: "TW" },
        evidence: { beforeQuantity: 709, afterQuantity: 737 }, idempotency_key: "zhuge-0050-20260915"
      }];
      return [];
    },
    async rpc(name, payload) {
      calls.push({ type: "rpc", name, payload });
      return { action_id: "pending-1", status: "confirmed", transaction_id: "tx-1", idempotent: false };
    }
  };
  const repository = Repository.create({ userId: USER_ID, data, gateway: data, sessionSnapshot: { isAuthenticated: true, aal: "aal2" } });
  const pending = await repository.loadPendingActions();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].transaction.symbol, "0050");
  assert.equal(pending[0].evidence.afterQuantity, 737);
  const result = await repository.confirmPendingAction("pending-1");
  assert.equal(result.transaction_id, "tx-1");
  assert.deepEqual(calls.filter(call => call.type === "rpc").map(call => call.name), ["investment_confirm_pending_action"]);
  assert.equal(calls.filter(call => call.type === "select" && call.table === "transactions").length, 0);
});

test("transactions page renders Human-in-the-loop pending action before canonical ledger", () => {
  const html = TransactionsPage.render({
    pendingActions: [{ id: "pending-1", source: "諸葛辨識", title: "0050 新交易", summary: "已與 SB 比對", transaction: { tradeType: "BUY", symbol: "0050", name: "元大台灣50", quantity: 28, price: 106.69, currency: "TWD" }, evidence: { beforeQuantity: 709, afterQuantity: 737 } }],
    transactions: []
  }, {
    escape: value => String(value ?? "").replace(/[&<>"']/g, ""),
    format: { currency: (value, code) => `${code} ${value}` },
    pendingActionWrite: { status: "idle", activeId: "" }, transactionWrite: { status: "idle", form: {} }
  });
  assert.match(html, /待我確認/);
  assert.match(html, /0050/);
  assert.match(html, /709 → <b>737 股<\/b>/);
  assert.match(html, /data-investment-pending-confirm="pending-1"/);
  assert.match(html, /不確認就不會寫入 SB/);
});

test("migration keeps pending proposal separate from canonical transaction and confirms via existing contract", () => {
  const sql = fs.readFileSync(path.join(ROOT, "docs", "supabase", "20260917_investment_pending_action_confirmation_v1.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.investment_pending_actions/i);
  assert.match(sql, /create or replace function public\.investment_confirm_pending_action/i);
  assert.match(sql, /public\.investment_record_transaction\(/i);
  assert.match(sql, /status = 'confirmed'/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /private\.investment_current_owner_id\(\)/i);
  assert.doesNotMatch(sql, /alter table public\.transactions disable row level security/i);
});

test("Global Floating Hub source exposes personal pending confirmation entry and count RPC", () => {
  const source = fs.readFileSync(path.join(ROOT, "shared", "components", "global-floating-hub.js"), "utf8");
  assert.match(source, /待我確認/);
  assert.match(source, /investment_pending_action_count/);
  assert.match(source, /data-hub-investment-pending-badge/);
  assert.match(source, /#transactions/);
  assert.equal(typeof Hub.mount, "function");
});
