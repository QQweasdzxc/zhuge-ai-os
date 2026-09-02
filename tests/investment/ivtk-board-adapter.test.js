const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Position = require("../../modules/investment/models/position.js");
const Card = require("../../shared/components/task-card.js");
const Adapter = require("../../modules/investment/services/ivtk-board-adapter.js");

const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const format = {
  number: value => Number(value).toFixed(2),
  signed: value => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}`,
  percent: value => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`,
  currency: (value, code) => `${code} ${Number(value).toFixed(2)}`
};

test("Investment Position preserves explicit broker values and stable source identity", () => {
  const position = Position.normalize({
    id: "snapshot-item-1",
    source_kind: "broker_snapshot_item",
    source_id: "snapshot-item-1",
    symbol: "MRVL",
    market: "US",
    currency: "USD",
    quantity: 1,
    avg_cost: 253.710,
    invested_cost: 253.71,
    last_price: 210.39,
    market_value: 209.86,
    unrealized_pnl: -43.85,
    unrealized_pct: -17.28,
    market_value_source: "broker_reported"
  });

  assert.equal(position.sourceKind, "broker_snapshot_item");
  assert.equal(position.sourceId, "snapshot-item-1");
  assert.equal(position.marketValue, 209.86);
  assert.equal(position.lastPrice, 210.39);
  assert.equal(position.unrealizedPercent, -17.28);
});

test("IVTK adapter presents Investment data through shared Card and two approved workspaces", () => {
  const position = Position.normalize({
    id: "opening-1",
    source_kind: "opening_position",
    source_id: "opening-1",
    symbol: "2330",
    name: "台積電",
    market: "TW",
    currency: "TWD",
    quantity: 1,
    avg_cost: 2428,
    invested_cost: 2428,
    last_price: 2440,
    market_value: 2440,
    unrealized_pnl: 12,
    unrealized_pct: 0.49
  });
  const state = {
    positions: [position],
    watchlist: [],
    ivtk: {
      status: "ready",
      projectionStatus: "ready",
      projection: { position_count: 1, watchlist_count: 0 },
      board: {
        workspaces: [
          { id: "stocks", key: "ivtk-stocks", name: "股票投資", sortOrder: 10, active: true },
          { id: "watchlist", key: "ivtk-watchlist", name: "觀察名單", sortOrder: 20, active: true },
          { id: "archived", key: "qat-todo", name: "舊 QA", sortOrder: 30, active: false }
        ],
        tasks: [{ id: "task-1", workCode: "IVTK-001", title: "Investment Position Projection" }],
        links: [{ boardTaskId: "task-1", sourceKind: "opening_position", sourceId: "opening-1", cardKind: "position", active: true }]
      }
    }
  };
  const html = Adapter.renderBoard(state, {
    escape,
    format,
    card: Card,
    goldenMaster: {
      renderBoard: options => options.columns.map(column => `<section data-key="${column.key}">${column.cards.map(card => Adapter.renderPositionCard(card.position, card.link, card.task, { escape, format, card: Card })).join("")}</section>`).join("")
    }
  });

  assert.match(html, /data-key="ivtk-stocks"/);
  assert.match(html, /data-key="ivtk-watchlist"/);
  assert.match(html, /IVTK-001/);
  assert.match(html, /2330/);
  assert.match(html, /2440\.00/);
  assert.doesNotMatch(html, /QAT-001/);
});

test("IVTK migration keeps financial values out of board_tasks and documents the source precedence", () => {
  const file = path.join(__dirname, "../../docs/supabase/20260903_investment_ivtk_projection.sql");
  const sql = fs.readFileSync(file, "utf8");
  assert.match(sql, /create table if not exists public\.investment_ivtk_card_links/i);
  assert.match(sql, /create or replace view public\.investment_current_positions_view/i);
  assert.match(sql, /broker_position_snapshot_item.*opening_position|latest_snapshot/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.board_tasks[\s\S]*?(quantity|market_value|unrealized_pnl)/i);
});
