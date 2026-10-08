const CONTRACT = "zhuge-investment-ai-analysis-v1";
const CONTEXT_CONTRACT = "zhuge-investment-ai-evidence-pack-v1";
const text = (value, max = 600) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];
const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const safeHttpsUrl = value => {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.href.slice(0, 1000) : ""; }
  catch { return ""; }
};

const FORBIDDEN_ADVICE = /買進|賣出|買入|賣出|買點|賣點|目標價|停損|下單|buy\s|sell\s|price target|stop.loss/i;

/** Whitelist-only evidence pack. Personal portfolio rows and credentials are never accepted. */
export function buildInvestmentAiEvidencePack(input = {}) {
  const symbol = text(input.symbol, 24).toUpperCase();
  const market = text(input.market, 8).toUpperCase();
  if (!/^(?:[A-Z0-9][A-Z0-9._-]{0,19}|\^[A-Z0-9._-]{1,19})$/.test(symbol) || !["TW", "US"].includes(market)) {
    throw Object.assign(new Error("AI evidence pack requires a resolved market and symbol."), { code: "AI_CONTEXT_IDENTITY_INVALID" });
  }

  const quoteInput = input.quote && typeof input.quote === "object" ? input.quote : {};
  const quote = Object.freeze({
    available: quoteInput.available === true,
    price: quoteInput.available === true ? number(quoteInput.price) : null,
    currency: text(quoteInput.currency, 8),
    provider: text(quoteInput.provider || quoteInput.source, 120),
    observedAt: text(quoteInput.asOf || quoteInput.dataTimestamp, 40),
    freshness: text(quoteInput.freshness, 24) || "unknown",
    delayed: quoteInput.delayed === true,
  });

  const bars = list(input.history?.bars).slice(-40).flatMap(item => {
    const date = text(item?.date || item?.asOf, 32).slice(0, 10);
    const close = number(item?.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0) return [];
    return [Object.freeze({ date, open: number(item.open), high: number(item.high), low: number(item.low), close, volume: number(item.volume) })];
  });

  const evidence = list(input.evidence).slice(0, 24).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const facts = list(item.facts).slice(0, 12).map(value => text(value, 220)).filter(Boolean);
    return [Object.freeze({
      id: `E${String(index + 1).padStart(2, "0")}`,
      type: text(item.type, 40) || "observation",
      title: text(item.title, 180),
      summary: text(item.summary, 500),
      source: text(item.source || item.provider, 120),
      sourceUrl: safeHttpsUrl(item.sourceUrl),
      observedAt: text(item.observedAt || item.dataTimestamp, 40),
      freshness: text(item.freshness, 24) || "unknown",
      facts: Object.freeze(facts),
      limitations: Object.freeze(list(item.limitations).slice(0, 8).map(value => text(value, 240)).filter(Boolean)),
    })];
  });

  const missing = [];
  if (!quote.available || quote.price === null) missing.push("latest_research_quote");
  if (bars.length < 20) missing.push("20_valid_daily_ohlcv_bars");
  if (!evidence.length) missing.push("source_attributed_research_evidence");
  return Object.freeze({
    contract: CONTEXT_CONTRACT,
    generatedAt: text(input.generatedAt, 40) || new Date().toISOString(),
    identity: Object.freeze({ symbol, market, name: text(input.name, 120) }),
    quote,
    history: Object.freeze({ provider: text(input.history?.provider || input.history?.source, 120), asOf: text(input.history?.asOf, 40), bars: Object.freeze(bars) }),
    evidence: Object.freeze(evidence),
    missing: Object.freeze(missing),
    policy: Object.freeze({
      noPortfolioData: true,
      noTradeRecommendation: true,
      citeEvidenceIds: true,
      preserveUnknownAsMissing: true,
      noSyntheticValues: true,
    }),
  });
}

export function buildInvestmentAiPrompt(pack) {
  if (pack?.contract !== CONTEXT_CONTRACT) throw Object.assign(new Error("AI evidence pack contract is invalid."), { code: "AI_CONTEXT_CONTRACT_INVALID" });
  return Object.freeze({
    contract: CONTRACT,
    system: "You are a source-grounded investment research summarizer. Use only the supplied evidence. Do not give buy/sell recommendations, price targets, stop-losses, order instructions, or personalized financial advice. If evidence is missing, say so. Every observation must cite one or more supplied evidence IDs. Return JSON matching the schema exactly; never invent values or sources.",
    user: JSON.stringify(pack),
    responseSchema: Object.freeze({
      type: "object",
      required: ["contract", "summary", "observations", "insufficientEvidence", "limitations", "tradeAction"],
      properties: Object.freeze({
        contract: { const: CONTRACT },
        summary: { type: "string", maxLength: 900 },
        observations: { type: "array", maxItems: 8, items: { type: "object", required: ["text", "evidenceIds"], properties: { text: { type: "string", maxLength: 360 }, evidenceIds: { type: "array", items: { type: "string" } } } } },
        insufficientEvidence: { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } },
        limitations: { type: "array", maxItems: 12, items: { type: "string", maxLength: 240 } },
        tradeAction: { const: "NONE" },
      }),
    }),
  });
}

export function validateInvestmentAiResult(value, pack) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.contract !== CONTRACT || value.tradeAction !== "NONE") {
    throw Object.assign(new Error("AI response does not satisfy the Zhuge result contract."), { code: "AI_RESULT_CONTRACT_INVALID" });
  }
  if (["recommendation", "targetPrice", "buyPoint", "sellPoint", "order"].some(key => Object.hasOwn(value, key))) {
    throw Object.assign(new Error("AI response contains a prohibited trade recommendation field."), { code: "AI_RESULT_TRADE_FIELD_REJECTED" });
  }
  const summary = text(value.summary, 900);
  if (!summary || FORBIDDEN_ADVICE.test(summary)) throw Object.assign(new Error("AI summary is empty or includes a prohibited trade instruction."), { code: "AI_RESULT_CONTENT_REJECTED" });
  const allowedIds = new Set(list(pack?.evidence).map(item => item.id));
  const observations = list(value.observations).slice(0, 8).map(item => {
    const observation = text(item?.text, 360);
    const evidenceIds = list(item?.evidenceIds).map(id => text(id, 8)).filter(id => allowedIds.has(id));
    if (!observation || FORBIDDEN_ADVICE.test(observation) || !evidenceIds.length) {
      throw Object.assign(new Error("AI observation must be non-prescriptive and cite supplied evidence."), { code: "AI_RESULT_OBSERVATION_REJECTED" });
    }
    return Object.freeze({ text: observation, evidenceIds: Object.freeze([...new Set(evidenceIds)]) });
  });
  return Object.freeze({
    contract: CONTRACT,
    status: pack?.missing?.length ? "PARTIAL" : "AVAILABLE",
    summary,
    observations: Object.freeze(observations),
    insufficientEvidence: Object.freeze(list(value.insufficientEvidence).slice(0, 12).map(item => text(item, 160)).filter(Boolean)),
    limitations: Object.freeze(list(value.limitations).slice(0, 12).map(item => text(item, 240)).filter(Boolean)),
    tradeAction: "NONE",
    generatedAt: new Date().toISOString(),
  });
}

/** The API secret stays behind a server provider; browser code only supplies an authorized invoker. */
export function createInvestmentAiProvider({ invoke = null, authorize = async () => false } = {}) {
  return Object.freeze({
    async analyze(pack) {
      if (pack?.contract !== CONTEXT_CONTRACT) throw Object.assign(new Error("AI evidence pack contract is invalid."), { code: "AI_CONTEXT_CONTRACT_INVALID" });
      if (!(await authorize())) return Object.freeze({ status: "ACCESS_REQUIRED", result: null });
      if (typeof invoke !== "function") return Object.freeze({ status: "SECRET_REQUIRED", result: null, provider: "AIOS-approved server-side model provider" });
      const prompt = buildInvestmentAiPrompt(pack);
      const raw = await invoke({ contract: CONTRACT, prompt });
      if (raw?.status === "SECRET_REQUIRED") return Object.freeze({ status: "SECRET_REQUIRED", result: null, provider: text(raw.provider, 120) });
      return Object.freeze({ status: "READY", result: validateInvestmentAiResult(raw?.result ?? raw, pack), provider: text(raw?.provider, 120) || "AIOS server-side provider" });
    },
  });
}

export const investmentAiContracts = Object.freeze({ contract: CONTRACT, contextContract: CONTEXT_CONTRACT });
