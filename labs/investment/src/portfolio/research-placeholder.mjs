const unavailableEvidence = (symbol, capability) => Object.freeze({
  status: "NOT_CONNECTED",
  dataTruth: "NOT_CONNECTED",
  provider: "未接通",
  source: Object.freeze([]),
  dataTimestamp: null,
  fetchedAt: null,
  stale: false,
  delayed: false,
  fallback: false,
  errorCode: "NOT_CONNECTED",
  note: `${symbol} 的${capability}尚未接通可核實資料來源；不使用模擬或替代數值。`,
  data: null,
});

export function createUnconnectedResearch({ symbol, market = "OTHER", name = symbol, assetType = "個股" } = {}) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const notConnected = capability => unavailableEvidence(normalized, capability);
  const quote = notConnected("行情");
  return Object.freeze({
    symbol: normalized,
    instrumentType: assetType === "ETF" ? "ETF" : "個股",
    quote,
    history: notConnected("歷史行情"),
    indicators: notConnected("技術指標"),
    profile: notConnected("基本資料"),
    revenue: notConnected("月營收"),
    income: notConnected("財務報表"),
    balance: notConnected("資產負債資料"),
    holders: notConnected("股權分散資料"),
    institutional: notConnected("法人資料"),
    margin: notConnected("融資融券資料"),
    futuresContext: notConnected("期貨背景資料"),
    announcements: notConnected("公告資料"),
    industryRadar: Object.freeze([]),
    gaps: Object.freeze([{
      capability: "個股研究資料",
      status: "NOT_CONNECTED",
      note: `${market} 市場的 ${name || normalized} 尚無已核實且可用的 Lab Provider。持股仍可檢視；研究資料不補假值。`,
    }]),
  });
}
