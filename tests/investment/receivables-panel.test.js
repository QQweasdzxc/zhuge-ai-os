const test = require("node:test");
const assert = require("node:assert/strict");
const Panel = require("../../modules/investment/components/receivables-panel.js");
const format = require("../../modules/investment/utils/formatters.js");

const escape = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const deps = { escape, format };
const rows = [
  { id: "r1", amount: 34898, counterparty: "TQ-116 專案", reason: "退回款項", occurred_on: "2026-11-10", status: "advanced", task_ref: "TQ-116" },
  { id: "r2", amount: 12000, counterparty: "廠商<script>", reason: "代墊<b>運費", occurred_on: "2026-11-12", status: "billed", task_ref: "https://example.com/t/9", visibility: "shared" },
  { id: "r3", amount: 500, counterparty: "同事", reason: "代墊午餐", occurred_on: "2026-11-01", status: "received" }
];

test("renders one row per receivable with status, visibility and escaped text", () => {
  const html = Panel.render(rows, deps);
  assert.equal((html.match(/investment-receivable-row/g) || []).length, 3 + 0);
  assert.match(html, /代墊未請款/);
  assert.match(html, /已請款/);
  assert.match(html, /已收/);
  assert.match(html, /私人/);
  assert.match(html, /允許同步（未啟用）/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>運費/);
  assert.match(html, /&lt;script&gt;/);
});

test("open total sums only advanced and billed, never received or returned", () => {
  const summary = Panel.summarize(rows.map(Panel.normalize));
  assert.equal(summary.open.TWD, 46898);
  assert.equal(summary.openCount, 2);
  const html = Panel.render(rows, deps);
  assert.match(html, /未收合計 NT\$ 46,898（2 筆）/);
});

test("next-step buttons expose only allowed transitions as data attributes", () => {
  const html = Panel.render(rows, deps);
  assert.match(html, /data-receivable-id="r1" data-receivable-next="billed"/);
  assert.match(html, /data-receivable-id="r1" data-receivable-next="returned"/);
  assert.match(html, /data-receivable-id="r2" data-receivable-next="received"/);
  assert.match(html, /data-receivable-id="r2" data-receivable-next="advanced"/);
  assert.doesNotMatch(html, /data-receivable-id="r3" data-receivable-next=/);
});

test("task ref is a plain label by default and a link only for https urls", () => {
  const html = Panel.render(rows, deps);
  assert.match(html, /關聯任務：TQ-116/);
  assert.match(html, /<a class="investment-receivable-task" href="https:\/\/example\.com\/t\/9"/);
  const evil = Panel.render([{ id: "r9", amount: 1, counterparty: "x", reason: "y", occurred_on: "2026-11-17", status: "advanced", task_ref: 'javascript:alert(1)' }], deps);
  assert.doesNotMatch(evil, /href="javascript/);
});

test("boundary note is explicit that the task link is reference-only, not sync", () => {
  const html = Panel.render(rows, deps);
  assert.match(html, /僅為參照連結/);
  assert.match(html, /雙向同步尚未啟用/);
});

test("add form defaults new records to private with optional task ref", () => {
  const html = Panel.render(rows, deps);
  assert.match(html, /data-receivable-form="create"/);
  assert.match(html, /<option value="private" selected>私人（只留在島）<\/option>/);
  assert.match(html, /關聯任務（選填/);
});

test("empty state explains how to add the first receivable", () => {
  const html = Panel.render([], deps);
  assert.match(html, /目前沒有應收款/);
  assert.match(html, /未收合計 NT\$ 0（0 筆）/);
});

test("unknown status falls back to advanced; unknown currency is preserved", () => {
  const item = Panel.normalize({ id: "rx", amount: "100.5", currency: "usd", status: "weird" });
  assert.equal(item.status, "advanced");
  assert.equal(item.currency, "USD");
  assert.equal(item.amount, 100.5);
});
