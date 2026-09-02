const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

const Position = require("../../modules/investment/models/position.js");
const Repository = require("../../modules/investment/services/supabase-investment-repository.js");

function snapshotGateway({ snapshot = null, items = [], reconciliation = null, reconciliationItems = [], rpcResult = [{ snapshot_id: "snapshot-1" }] } = {}) {
  const calls = [];
  const rows = {
    app_users: [{ id: "legacy-owner-1", display_name: "Owner", email: "owner@example.com" }],
    portfolios: [{ id: "portfolio-1", name: "主要投資組合", base_currency: "TWD", is_default: true }],
    opening_positions: [{
      id: "opening-1", portfolio_id: "portfolio-1", symbol: "0050", name: "元大台灣50", market: "TW",
      quantity: 651, avg_cost: 65.45, invested_cost: 46404, last_price: 108.45,
      market_value: 70681, unrealized_pnl: 24277, unrealized_pct: 52.32, currency: "TWD"
    }],
    broker_position_snapshots: snapshot ? [snapshot] : [],
    broker_position_reconciliations: reconciliation ? [reconciliation] : [],
    broker_position_reconciliation_items: reconciliationItems,
    current_broker_positions_view: items.map(item => ({
      ...item,
      snapshot_id: item.snapshot_id || snapshot?.id,
      item_id: item.item_id || item.id
    }))
  };
  return {
    calls,
    async select(table, query) {
      calls.push({ type: "select", table, query });
      return rows[table] || [];
    },
    async rpc(name, payload) {
      calls.push({ type: "rpc", name, payload });
      return rpcResult;
    }
  };
}

function authenticatedRepository(data) {
  return Repository.create({
    userId: USER_ID,
    data,
    sessionSnapshot: { isAuthenticated: true, aal: "aal2" }
  });
}

test("latest confirmed Broker Snapshot takes precedence and preserves broker market value", async () => {
  const data = snapshotGateway({
    snapshot: {
      id: "snapshot-20260902", portfolio_id: "portfolio-1", broker: "Fubon AI PRO",
      snapshot_at: "2026-09-02T00:29:00.000Z", verification: "pm_confirmed", position_count: 2,
      source: "fubon_ai_pro_position_snapshot", content_hash: "a".repeat(64),
      idempotency_key: "fubon-20260902-0829-pm-confirmed", created_at: "2026-09-02T00:30:00.000Z"
    },
    items: [
      {
        id: "item-mrvl", snapshot_id: "snapshot-20260902", symbol: "MRVL", name: "Marvell Technology",
        market: "US", currency: "USD", quantity: 1, avg_cost: 253.71, invested_cost: 253.71,
        last_price: 210.39, market_value: 209.86, unrealized_pnl: -43.85, unrealized_pct: -17.28,
        market_value_source: "broker_supplied", raw_broker_values: { market_value: 209.86 }
      },
      {
        id: "item-0050", snapshot_id: "snapshot-20260902", symbol: "0050", name: "元大台灣50",
        market: "TW", currency: "TWD", quantity: 709, avg_cost: 65.45, invested_cost: 46404,
        last_price: 108.45, market_value: 76891, unrealized_pnl: 30302, unrealized_pct: 65.30,
        market_value_source: "broker_supplied", raw_broker_values: { market_value: 76891 }
      }
    ]
  });

  const positions = await authenticatedRepository(data).loadPositions();

  assert.deepEqual(positions.map(position => position.symbol).sort(), ["0050", "MRVL"]);
  assert.equal(positions.find(position => position.symbol === "0050").quantity, 709);
  assert.equal(positions.find(position => position.symbol === "MRVL").lastPrice, 210.39);
  assert.equal(positions.find(position => position.symbol === "MRVL").marketValue, 209.86);
  assert.equal(positions.find(position => position.symbol === "MRVL").marketValueSource, "broker_supplied");
  assert.equal(positions.find(position => position.symbol === "MRVL").rawBrokerValues.market_value, 209.86);
  assert.equal(data.calls.filter(call => call.table === "opening_positions").length, 0);
  assert.equal(data.calls.filter(call => call.table === "current_broker_positions_view").length, 1);
});

test("an incomplete latest Snapshot fails closed instead of falling back to legacy positions", async () => {
  const data = snapshotGateway({
    snapshot: {
      id: "snapshot-incomplete", portfolio_id: "portfolio-1", broker: "Fubon AI PRO",
      snapshot_at: "2026-09-02T00:29:00.000Z", verification: "pm_confirmed", position_count: 2,
      source: "fubon_ai_pro_position_snapshot", content_hash: "b".repeat(64),
      idempotency_key: "fubon-20260902-0829-incomplete", created_at: "2026-09-02T00:30:00.000Z"
    },
    items: [{
      id: "item-only", snapshot_id: "snapshot-incomplete", symbol: "0050", name: "元大台灣50",
      market: "TW", currency: "TWD", quantity: 709, avg_cost: 65.45, invested_cost: 46404,
      last_price: 108.45, market_value: 76891, unrealized_pnl: 30302, unrealized_pct: 65.30,
      market_value_source: "broker_supplied", raw_broker_values: {}
    }]
  });

  await assert.rejects(authenticatedRepository(data).loadPositions(), error => {
    assert.equal(error.code, "INVESTMENT_SNAPSHOT_INCOMPLETE");
    assert.equal(error.expected, 2);
    assert.equal(error.actual, 1);
    return true;
  });
  assert.equal(data.calls.filter(call => call.table === "opening_positions").length, 0);
  assert.equal(data.calls.filter(call => call.table === "current_broker_positions_view").length, 1);
});

test("Snapshot reconciliation read-back verifies the parent count and returns every machine status", async () => {
  const data = snapshotGateway({
    reconciliation: {
      id: "reconciliation-20260902", portfolio_id: "portfolio-1", previous_snapshot_id: null,
      previous_source: "legacy_opening_positions", previous_snapshot_at: "2026-06-30T00:00:00.000Z",
      current_snapshot_id: "snapshot-20260902", item_count: 2, unchanged_count: 0,
      changed_count: 1, new_count: 1, missing_count: 0, unknown_count: 0,
      created_at: "2026-09-02T00:30:00.000Z"
    },
    reconciliationItems: [
      { id: "reconciliation-item-0050", reconciliation_id: "reconciliation-20260902", market: "TW", symbol: "0050", status: "CHANGED", quantity_delta: 58, invested_cost_delta: 0, differences: { quantity: { previous: 651, current: 709 } }, reason: "Snapshot quantity differs from previous evidence." },
      { id: "reconciliation-item-2330", reconciliation_id: "reconciliation-20260902", market: "TW", symbol: "2330", status: "NEW", quantity_delta: null, invested_cost_delta: null, differences: {}, reason: "Symbol exists only in current Snapshot evidence." }
    ]
  });

  const result = await authenticatedRepository(data).loadBrokerSnapshotReconciliation("snapshot-20260902", "portfolio-1");

  assert.equal(result.reconciliation.id, "reconciliation-20260902");
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.status), ["CHANGED", "NEW"]);
  const childQuery = data.calls.find(call => call.table === "broker_position_reconciliation_items").query;
  assert.match(childQuery, /reconciliation_id=eq\.reconciliation-20260902/);
  assert.doesNotMatch(childQuery, /user_id=/);
});

test("controlled Snapshot write uses only the RPC boundary and forces PM confirmation", async () => {
  const data = snapshotGateway({ rpcResult: [{
    snapshot_id: "snapshot-1",
    reconciliation_id: "reconciliation-1",
    position_count: 1,
    was_existing: false
  }] });
  const repository = authenticatedRepository(data);

  const result = await repository.createBrokerPositionSnapshot({
    broker: "Fubon AI PRO",
    snapshotAt: "2026-09-02T00:29:00.000Z",
    source: "fubon_ai_pro_position_snapshot",
    idempotencyKey: "fubon-20260902-0829-pm-confirmed",
    positions: [{
      userId: "attacker-user",
      portfolioId: "attacker-portfolio",
      symbol: "MRVL",
      name: "Marvell Technology",
      market: "US",
      currency: "USD",
      quantity: 1,
      averageCost: 253.71,
      investedCost: 253.71,
      lastPrice: 210.39,
      marketValue: 209.86,
      unrealizedPnl: -43.85,
      unrealizedPercent: -17.28,
      rawBrokerValues: { market_value: 209.86 }
    }]
  });

  assert.equal(result.snapshot_id, "snapshot-1");
  assert.deepEqual(data.calls.filter(call => call.type === "rpc").map(call => call.name), ["create_broker_position_snapshot"]);
  assert.equal(data.calls.filter(call => call.type === "select").filter(call => call.table === "broker_position_snapshots").length, 0);
  const rpcCall = data.calls.find(call => call.type === "rpc");
  assert.equal(rpcCall.payload.p_portfolio_id, "portfolio-1");
  assert.equal(rpcCall.payload.p_verification, "pm_confirmed");
  assert.equal(rpcCall.payload.p_positions[0].symbol, "MRVL");
  assert.equal("user_id" in rpcCall.payload.p_positions[0], false);
  assert.equal("portfolio_id" in rpcCall.payload.p_positions[0], false);
  assert.equal(rpcCall.payload.p_positions[0].market_value, 209.86);
});

test("Position normalization preserves explicit zero evidence values", () => {
  const position = Position.normalize({
    symbol: "ZERO",
    quantity: 0,
    averageCost: 0,
    investedCost: 0,
    lastPrice: 0,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPercent: 0,
    marketValueSource: "broker_supplied"
  });
  assert.equal(position.investedCost, 0);
  assert.equal(position.marketValue, 0);
  assert.equal(position.unrealizedPnl, 0);
  assert.equal(position.unrealizedPercent, 0);
});

test("Snapshot migration declares the append-only evidence, AAL2 read policy, and controlled write contract", () => {
  const migration = fs.readFileSync(path.join(ROOT, "docs", "supabase", "20260902_broker_position_snapshot_model.sql"), "utf8");
  for (const table of [
    "broker_position_snapshots",
    "broker_position_snapshot_items",
    "broker_position_reconciliations",
    "broker_position_reconciliation_items",
    "broker_position_snapshot_audits"
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`create policy ${table}_select_aal2`));
  }
  assert.match(migration, /status text not null check \(status in \('UNCHANGED', 'CHANGED', 'NEW', 'MISSING_FROM_SNAPSHOT', 'UNKNOWN'\)\)/);
  assert.match(migration, /create or replace function public\.create_broker_position_snapshot/);
  assert.match(migration, /security definer/);
  assert.match(migration, /auth\.jwt\(\) ->> 'aal'/);
  assert.match(migration, /grant execute on function public\.create_broker_position_snapshot[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.create_broker_position_snapshot[\s\S]*from public, anon/);
  assert.match(migration, /create or replace view public\.current_broker_positions_view[\s\S]*security_invoker = true/);
  assert.doesNotMatch(migration, /insert into public\.(opening_positions|transactions)/);
  assert.doesNotMatch(migration, /update public\.(opening_positions|transactions)/);
  assert.doesNotMatch(migration, /delete from public\.(opening_positions|transactions)/);
});
