import test from "node:test";
import assert from "node:assert/strict";
import { renderAiResearchPanel } from "../src/components/ai-research-panel.mjs";

test("AI research panel explains its evidence boundary and does not fake an analysis", () => {
  const idle = renderAiResearchPanel({});
  assert.match(idle, /不傳入持股資料/);
  assert.match(idle, /data-action="analyze-ai"/);
  const gated = renderAiResearchPanel({ status: "SECRET_REQUIRED", pack: { evidence: [{}], history: { bars: [] }, missing: ["source_attributed_research_evidence"] } });
  assert.match(gated, /AI 分析服務尚未設定/);
  assert.match(gated, /尚未設定/);
  assert.match(gated, /不會產生模擬分析/);
  assert.match(gated, /1 項/);
  const unavailable = renderAiResearchPanel({ status: "PARTIAL", pack: { evidence: [], history: { bars: [] }, missing: ["20_valid_daily_ohlcv_bars"] } });
  assert.match(unavailable, /資料不足/);
});
