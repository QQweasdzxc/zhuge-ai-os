import test from "node:test";
import assert from "node:assert/strict";
import { buildInvestmentAiEvidencePack, buildInvestmentAiPrompt, createInvestmentAiProvider, validateInvestmentAiResult } from "../src/ai/analysis-contract.mjs";

const pack = () => buildInvestmentAiEvidencePack({
  symbol: "AAPL", market: "US", name: "Apple", generatedAt: "2026-10-08T00:00:00Z",
  quote: { available: true, price: 234, currency: "USD", provider: "Fixture provider", asOf: "2026-10-07", delayed: true },
  history: { provider: "fixture", asOf: "2026-10-07", bars: Array.from({ length: 21 }, (_, index) => ({ date: `2026-09-${String(index + 10).padStart(2, "0")}`, close: 200 + index })) },
  evidence: [{ type: "technical", title: "MA20", facts: ["close above MA20"], source: "Fixture", sourceUrl: "https://example.test/source", observedAt: "2026-10-07", freshness: "fresh" }],
  portfolio: [{ symbol: "SECRET_HOLDING_SHOULD_NOT_ENTER" }],
});

test("AI evidence pack is whitelist-only and marks missing data truthfully", () => {
  const value = pack();
  assert.equal(value.identity.symbol, "AAPL");
  assert.equal(value.history.bars.length, 21);
  assert.equal(value.policy.noPortfolioData, true);
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /SECRET_HOLDING_SHOULD_NOT_ENTER/);
  assert.equal(Object.hasOwn(value, "portfolio"), false);
  const empty = buildInvestmentAiEvidencePack({ symbol: "NVDA", market: "US" });
  assert.deepEqual(empty.missing, ["latest_research_quote", "20_valid_daily_ohlcv_bars", "source_attributed_research_evidence"]);
});

test("prompt contract bans trade instructions and requires evidence identifiers", () => {
  const prompt = buildInvestmentAiPrompt(pack());
  assert.match(prompt.system, /Do not give buy\/sell recommendations/);
  assert.deepEqual(prompt.responseSchema.required, ["contract", "summary", "observations", "insufficientEvidence", "limitations", "tradeAction"]);
});

test("AI result rejects unsupported evidence ids and trade recommendation fields", () => {
  assert.throws(() => validateInvestmentAiResult({
    contract: "zhuge-investment-ai-analysis-v1", summary: "Observed data only.", tradeAction: "NONE", observations: [{ text: "Evidence", evidenceIds: ["E99"] }], limitations: [], insufficientEvidence: [],
  }, pack()), { code: "AI_RESULT_OBSERVATION_REJECTED" });
  assert.throws(() => validateInvestmentAiResult({
    contract: "zhuge-investment-ai-analysis-v1", summary: "買進。", tradeAction: "NONE", observations: [], limitations: [], insufficientEvidence: [],
  }, pack()), { code: "AI_RESULT_CONTENT_REJECTED" });
  assert.throws(() => validateInvestmentAiResult({
    contract: "zhuge-investment-ai-analysis-v1", summary: "Observed data.", tradeAction: "NONE", recommendation: "buy", observations: [], limitations: [], insufficientEvidence: [],
  }, pack()), { code: "AI_RESULT_TRADE_FIELD_REJECTED" });
});

test("AI provider distinguishes authorization and absent secret from implementation", async () => {
  const denied = await createInvestmentAiProvider({ authorize: async () => false }).analyze(pack());
  assert.equal(denied.status, "ACCESS_REQUIRED");
  const gated = await createInvestmentAiProvider({ authorize: async () => true }).analyze(pack());
  assert.equal(gated.status, "SECRET_REQUIRED");
  const ready = await createInvestmentAiProvider({
    authorize: async () => true,
    invoke: async () => ({ contract: "zhuge-investment-ai-analysis-v1", summary: "價格高於提供的 MA20 證據。", tradeAction: "NONE", observations: [{ text: "價格高於 MA20", evidenceIds: ["E01"] }], limitations: [], insufficientEvidence: [] }),
  }).analyze(pack());
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.result.observations[0].evidenceIds, ["E01"]);
});
