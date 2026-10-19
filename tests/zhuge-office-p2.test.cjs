"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

test("P2 fixed cast authority is Jackal/GPT/Codex/Gem and never impersonates a Provider session", () => {
  const bridge = read("integrations/habblaud/overrides/client/src/adapters/zhuge-bridge.ts");
  for (const id of ["zhuge-crew-pm", "zhuge-crew-gpt", "zhuge-crew-codex", "zhuge-crew-gem"])
    assert.ok(bridge.includes(id), "missing crew character " + id);
  assert.match(bridge, /crewRoom: RoomInfo/);
  assert.match(bridge, /crewAgents: AgentInfo\[\]/);
  assert.match(bridge, /status: 'idle'/);
  assert.match(bridge, /name: 'Jackal'/);
  assert.match(bridge, /name: 'GPT'/);
  assert.match(bridge, /zhuge-fixed-cast/);
  assert.match(bridge, /尚無可驗證的即時工作狀態/);
  assert.match(bridge, /固定像素角色（非真人位置／非 Provider Session）/);
  assert.doesNotMatch(bridge, /zhuge-module-|zhuge-pr-|AI OS 狀態觀察員/);
  assert.match(bridge, /verifiedHabblaudSnapshot/);
  assert.match(bridge, /input\.meta\?\.demo !== false/);
  assert.match(bridge, /streamOpen/);
  assert.doesNotMatch(bridge.slice(bridge.indexOf("const crewAgents"),bridge.indexOf("return {",bridge.indexOf("const crewAgents"))), /status:\s*['"]working['"]/);
});
test("P2 static modules/PRs are visible as read-only information; people statuses require a verified live source", () => {
  const entry = read("integrations/habblaud/overrides/client/src/adapters/zhuge-entry.ts");
  const hud = read("integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts");
  const bridge = read("integrations/habblaud/overrides/client/src/adapters/zhuge-bridge.ts");
  assert.match(entry, /showZhugeRole\(sel\.id\)/);
  assert.match(entry, /showZhugeDecisions/);
  assert.match(entry, /showZhugeStatus/);
  assert.match(entry, /this\.native\?\.readyState === EventSource\.OPEN/);
  assert.match(hud, /showZhugeRole/);
  assert.match(hud, /showZhugeStatus/);
  assert.match(hud, /靜態專案紀錄，不代表任何人或 AI 正在工作/);
  assert.match(hud, /noopener noreferrer/);
  assert.match(bridge, /return \[\];/);
  assert.doesNotMatch(hud, /innerHTML/);
  assert.match(hud, /zhuge-role-roster/);
});
test("P2 work descriptions preserve P1 primary destination, new-tab security, disabled unknown links", () => {
  const src = read("assets/zhuge-office-furnishings.js");
  assert.match(src, /info\.dataset\.zgfInfo = work\.id/);
  assert.match(src, /showMedalInfo\(work\)/);
  assert.match(src, /go\.href = routes\[work\.id\]/);
  assert.match(src, /go\.rel = "noopener noreferrer"/);
  assert.match(src, /slot\.append\(a, info\)/);
  assert.match(src, /PENDING|待補/);
  assert.doesNotMatch(src, /innerHTML/);
  const css = read("assets/zhuge-office-furnishings.css");
  assert.match(css, /\.zgf-work-details\[hidden\]/);
  assert.match(css, /\.zgf-medal-info/);
  assert.match(css, /max-width:700px/);
});
test("P2 native room overlay is applied only to the pinned upstream Reception and keeps the vendor untouched", () => {
  const build = read("integrations/habblaud/build.mjs");
  const overlay = read("integrations/habblaud/overrides/client/src/world/layout/zhuge-reception.ts");
  assert.match(build, /integrateZhugeReception\(a, wall\)/);
  assert.match(build, /world\/layout\/zhuge-reception\.ts/);
  assert.match(overlay, /core:recepcao/);
  assert.match(overlay, /b\.cap\(8\.5, 2, 0\.5, 7, wall\)/);
  assert.match(overlay, /b\.south\(8\.5, 7, 9, wall, \[\{ lx: 11, w: 2 \}\]\)/);
  assert.match(overlay, /b\.block\(8, 2, 1, 7\)/);
  assert.match(overlay, /'meeting_table'/);
  assert.equal(require("node:child_process").execFileSync("git", ["status", "--short", "third_party/multica"], { cwd: root, encoding: "utf8" }), "");
});
