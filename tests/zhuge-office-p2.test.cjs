"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = p => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

test("P2 three named native roles with stable idle/synthetic provenance", () => {
  const bridge = read("integrations/habblaud/overrides/client/src/adapters/zhuge-bridge.ts");
  for (const id of ["zhuge-crew-pm", "zhuge-crew-codex", "zhuge-crew-gem"])
    assert.ok(bridge.includes(id), "missing crew character " + id);
  assert.match(bridge, /crewRoom: RoomInfo/);
  assert.match(bridge, /crewAgents: AgentInfo\[\]/);
  assert.match(bridge, /status: 'idle'/);
  assert.match(bridge, /zhuge-showcase-only/);
  assert.match(bridge, /尚無真實工程事件來源/);
  assert.doesNotMatch(bridge.slice(bridge.indexOf("const crewAgents"),bridge.indexOf("return {",bridge.indexOf("const crewAgents"))), /status:\s*['"]working['"]/);
});
test("P2 native clicking a cast member opens readable role dossier; others retain decisions", () => {
  const entry = read("integrations/habblaud/overrides/client/src/adapters/zhuge-entry.ts");
  const hud = read("integrations/habblaud/overrides/client/src/ui/zhuge-hud.ts");
  assert.match(entry, /showZhugeRole\(sel\.id\)/);
  assert.match(entry, /showZhugeDecisions/);
  assert.match(hud, /showZhugeRole/);
  assert.match(hud, /非即時 CLI/);
  assert.doesNotMatch(hud, /innerHTML/);
  assert.match(hud, /zhuge-role-roster/);
});
test("P2 work descriptions preserve P1 primary destination, new-tab security, disabled unknown links", () => {
  const src = read("assets/zhuge-office-furnishings.js");
  assert.match(src, /data\.zgfInfo = work\.id/);
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
