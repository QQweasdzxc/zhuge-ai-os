const num = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const text = value => String(value ?? "").trim();

function evidenceFor(value, fallbackProvider) {
  const item = value && typeof value === "object" ? value : {};
  const data = item.data && typeof item.data === "object" ? item.data : {};
  return Object.freeze({
    status: ["AVAILABLE", "PARTIAL", "NOT_APPLICABLE", "UNAVAILABLE"].includes(item.status) ? item.status : "UNAVAILABLE",
    provider: text(item.provider || fallbackProvider),
    source: text(Array.isArray(item.source) ? item.source[0] : item.source),
    dataTimestamp: text(item.dataTimestamp || item.asOf) || null,
    fetchedAt: text(item.fetchedAt) || null,
    data,
    note: text(item.note),
  });
}

function sourceDay(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
  return match?.[1] || null;
}

/** Preserve independent availability for ETF valuation, scale/flow, and holdings evidence. */
export function normalizeTaiwanEtfFundEvidence({ symbol = "", quote = null, nav = null, flow = null, constituents = null } = {}) {
  const quoteEvidence = evidenceFor(quote, "TWSE / TPEx daily close");
  const navEvidence = evidenceFor(nav, "ETF NAV provider");
  const flowEvidence = evidenceFor(flow, "ETF flow/scale provider");
  const constituentEvidence = evidenceFor(constituents, "ETF issuer holdings / PCF");
  const marketPrice = num(quoteEvidence.data.close ?? quoteEvidence.data.price);
  const navValue = num(navEvidence.data.nav ?? navEvidence.data.estimatedNav ?? navEvidence.data.iNAV);
  const priceDate = sourceDay(quoteEvidence.dataTimestamp || quoteEvidence.data.date);
  const navDate = sourceDay(navEvidence.dataTimestamp || navEvidence.data.date);
  const derivedPremiumDiscountPct = marketPrice !== null && navValue !== null && navValue > 0 && priceDate && navDate === priceDate
    ? (marketPrice / navValue - 1) * 100 : null;
  const reportedPremiumDiscountPct = num(navEvidence.data.reportedPremiumDiscountPct);
  const unitsOutstanding = num(navEvidence.data.unitsOutstanding);
  const unitsOutstandingChange = num(navEvidence.data.unitsOutstandingChange);
  const items = Array.isArray(constituentEvidence.data.items) ? constituentEvidence.data.items : [];
  const constituentsRows = items.flatMap(item => {
    const code = text(item?.symbol || item?.code);
    const name = text(item?.name);
    const weightPct = num(item?.weightPct ?? item?.weight);
    if (!code && !name) return [];
    return [Object.freeze({ symbol: code || null, name: name || null, weightPct })];
  });
  const scaleStatus = navEvidence.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE"
    : unitsOutstanding !== null || unitsOutstandingChange !== null ? "AVAILABLE" : "UNAVAILABLE";
  const componentStatuses = [navEvidence.status, flowEvidence.status, scaleStatus, constituentEvidence.status];
  const status = componentStatuses.every(value => value === "NOT_APPLICABLE") ? "NOT_APPLICABLE"
    : componentStatuses.every(value => value === "AVAILABLE") ? "AVAILABLE"
      : componentStatuses.some(value => value === "AVAILABLE" || value === "PARTIAL") ? "PARTIAL" : "UNAVAILABLE";
  return Object.freeze({
    contract: "zhuge-taiwan-etf-fund-evidence-v1",
    symbol: text(symbol).toUpperCase(),
    status,
    quote: Object.freeze({ status: quoteEvidence.status, provider: quoteEvidence.provider, dataTimestamp: priceDate, fetchedAt: quoteEvidence.fetchedAt, close: marketPrice, source: quoteEvidence.source }),
    nav: Object.freeze({ status: navEvidence.status, provider: navEvidence.provider, dataTimestamp: navDate, sourceTimestamp: navEvidence.dataTimestamp || text(navEvidence.data.date) || null, fetchedAt: navEvidence.fetchedAt, value: navValue, currency: text(navEvidence.data.currency) || null, reportedPremiumDiscountPct, derivedPremiumDiscountPct, premiumDiscountPct: derivedPremiumDiscountPct, source: navEvidence.source, note: navEvidence.note }),
    scale: Object.freeze({ status: scaleStatus, provider: navEvidence.provider, dataTimestamp: navDate, sourceTimestamp: navEvidence.dataTimestamp || text(navEvidence.data.date) || null, fetchedAt: navEvidence.fetchedAt, unitsOutstanding, unitsOutstandingChange, source: navEvidence.source, note: "單位數與單位數變動不等同現金申購贖回流量。" }),
    flow: Object.freeze({ status: flowEvidence.status, provider: flowEvidence.provider, dataTimestamp: flowEvidence.dataTimestamp || text(flowEvidence.data.date) || null, fetchedAt: flowEvidence.fetchedAt, netUnits: num(flowEvidence.data.netUnits), unitsOutstanding: num(flowEvidence.data.unitsOutstanding), fundScale: num(flowEvidence.data.fundScale), currency: text(flowEvidence.data.currency) || null, source: flowEvidence.source, note: flowEvidence.note }),
    constituents: Object.freeze({ status: constituentEvidence.status, provider: constituentEvidence.provider, dataTimestamp: constituentEvidence.dataTimestamp, fetchedAt: constituentEvidence.fetchedAt, items: Object.freeze(constituentsRows), source: constituentEvidence.source, note: constituentEvidence.note }),
    note: "NAV、價格、流量與成分各自保留來源與日期；不同日期不計算折溢價，缺值保持 unknown。",
  });
}
