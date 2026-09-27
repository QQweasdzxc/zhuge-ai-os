const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Transaction = require("../../modules/investment/models/transaction.js");
const Repository = require("../../modules/investment/services/supabase-investment-repository.js");
const TransactionsPage = require("../../modules/investment/pages/transactions-page.js");

const ROOT = path.join(__dirname, "..", "..");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

test("Investment transaction model normalizes buy/sell and cost fields", () => {
  const buy = Transaction.normalize({
    id: "transaction-buy",
    trade_type: "買進",
    market: "tw",
    quantity: "3",
    price: "100.5",
    gross_amount: "301.5",
    fee: "2",
    tax: "0",
    net_amount: "-303.5",
    currency: "twd",
    idempotency_key: "buy-20260915-001"
  });
  const sell = Transaction.normalize({ trade_type: "賣出", quantity: 1, price: 120 });

  assert.equal(buy.tradeType, "BUY");
  assert.equal(buy.market, "TW");
  assert.equal(buy.quantity, 3);
  assert.equal(buy.grossAmount, 301.5);
  assert.equal(buy.fee, 2);
  assert.equal(buy.netAmount, -303.5);
  assert.equal(buy.currency, "TWD");
  assert.equal(buy.idempotencyKey, "buy-20260915-001");
  assert.equal(sell.tradeType, "SELL");
});

test("Transaction repository writes only through the controlled Investment RPC", async () => {
  const calls = [];
  const data = {
    async select(table, query) {
      calls.push({ type: "select", table, query });
      if (table === "app_users") return [{ id: "owner-1", email: "owner@example.com" }];
      if (table === "portfolios") return [{ id: "portfolio-1", name: "主要投資組合", base_currency: "TWD", is_default: true }];
      return [];
    },
    async rpc(name, payload) {
      calls.push({ type: "rpc", name, payload });
      return [{ transaction_id: "transaction-new", idempotent: false }];
    }
  };
  const repository = Repository.create({
    userId: USER_ID,
    data,
    gateway: data,
    sessionSnapshot: { isAuthenticated: true, aal: "aal2" }
  });

  const result = await repository.recordTransaction({
    tradeDate: "2026-09-15",
    tradeType: "BUY",
    symbol: "2330",
    name: "台積電",
    market: "TW",
    quantity: 1,
    price: 1000,
    fee: 10,
    tax: 0,
    currency: "TWD",
    idempotencyKey: "investment-buy-001"
  });

  assert.equal(result.transaction_id, "transaction-new");
  assert.deepEqual(calls.filter(call => call.type === "rpc").map(call => call.name), ["investment_record_transaction"]);
  assert.equal(calls.filter(call => call.type === "select" && call.table === "transactions").length, 0);
  const rpc = calls.find(call => call.type === "rpc");
  assert.equal(rpc.payload.p_portfolio_id, "portfolio-1");
  assert.equal(rpc.payload.p_trade_type, "BUY");
  assert.equal(rpc.payload.p_fee, 10);
  assert.equal(rpc.payload.p_idempotency_key, "investment-buy-001");
});

test("Transaction page exposes the three Investment domain inputs and canonical result boundary", () => {
  const html = TransactionsPage.render({
    transactions: [{
      id: "transaction-1",
      tradeType: "BUY",
      tradeDate: "2026-09-15",
      symbol: "2330",
      quantity: 1,
      price: 1000,
      netAmount: -1010,
      currency: "TWD"
    }]
  }, {
    escape: value => String(value ?? "").replace(/[&<>"']/g, ""),
    format: { currency: (value, code) => `${code} ${value}` },
    transactionWrite: { status: "idle", form: {} }
  });

  assert.match(html, /交易紀錄/);
  assert.match(html, /買入/);
  assert.match(html, /賣出/);
  assert.match(html, /手續費／交易成本/);
  assert.match(html, /移動加權平均成本法/);
  assert.match(html, /既有 opening positions 維持為 Opening Baseline/);
  assert.match(html, /現金流/);
  assert.match(html, /買入支出/);
  assert.match(html, /data-investment-transaction-form/);
  assert.match(html, /2330/);
});

test("Investment lifecycle migration defines one baseline-aware calculation and history projection", () => {
  const sql = fs.readFileSync(path.join(ROOT, "docs/supabase/20260915_investment_transaction_lifecycle_v1.sql"), "utf8");

  assert.match(sql, /investment-transaction-lifecycle-v1/);
  assert.match(sql, /opening_baseline_plus_post_activation_transactions_moving_weighted_average_v1/);
  assert.match(sql, /create or replace function public\.investment_calculated_positions/i);
  assert.match(sql, /transaction\.created_at\s*>=\s*v_activation_at/i);
  assert.match(sql, /v_invested_cost\s*:=\s*v_invested_cost\s*\+\s*v_buy_cost/i);
  assert.match(sql, /v_realized_pnl\s*:=\s*v_realized_pnl\s*\+/i);
  assert.match(sql, /v_position_status\s*:=\s*'history'/i);
  assert.match(sql, /'ivtk-history'/i);
  assert.match(sql, /create or replace function public\.investment_record_transaction/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /revoke all on table public\.transactions/i);
  assert.match(sql, /drop view if exists public\.investment_current_positions_view/i);
});

test("Investment projection read hotfix preserves the single owner-scoped authority", () => {
  const sql = fs.readFileSync(path.join(ROOT, "docs/supabase/20260915_investment_projection_authenticated_read_hotfix_v1.sql"), "utf8");
  const functionSql = fs.readFileSync(path.join(ROOT, "docs/supabase/20260915_investment_transaction_lifecycle_v1.sql"), "utf8");

  assert.match(sql, /alter function public\.investment_calculated_positions\(\)\s*security definer/i);
  assert.match(sql, /set search_path\s*=\s*pg_catalog, public, auth, extensions, private, pg_temp/i);
  assert.match(sql, /revoke all on function public\.investment_calculated_positions\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.investment_calculated_positions\(\) to authenticated, service_role/i);
  assert.match(functionSql, /if v_auth_user_id is null then/i);
  assert.match(functionSql, /v_owner_id := private\.investment_current_owner_id\(\)/i);
  assert.match(functionSql, /where position\.user_id = v_owner_id/i);
  assert.match(functionSql, /where transaction\.user_id = v_owner_id/i);
});
