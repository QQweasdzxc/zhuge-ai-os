import { MiniMarketChart } from "./mini-market-chart.mjs";

function historyBars(history) {
  const rows = Array.isArray(history?.bars)
    ? history.bars
    : Array.isArray(history?.data) ? history.data : [];
  return rows.map((bar) => ({
    ...bar,
    date: bar?.date || bar?.asOf || bar?.as_of || bar?.timestamp || null,
  }));
}

/** Render research OHLCV from one of the existing provider history shapes. */
export function renderResearchOhlcvChart(history, { market = "TW" } = {}) {
  const bars = historyBars(history);
  const hasData = bars.some((bar) => Number.isFinite(Number(bar?.close)));
  const status = history?.status === "NOT_CONNECTED" || history?.status === "PROVIDER_REVIEW_REQUIRED"
    ? history.status
    : history?.available === true || history?.status === "AVAILABLE"
      ? "AVAILABLE"
      : hasData ? "PARTIAL" : history?.status || "UNAVAILABLE";

  return MiniMarketChart({
    mode: "research",
    currency: market === "US" ? "USD" : "TWD",
    evidence: {
      status,
      data: bars,
      provider: history?.provider || history?.source || "Provider 未提供",
      source: history?.sourceUrl ? [history.sourceUrl] : Array.isArray(history?.source) ? history.source : [],
      dataTimestamp: history?.asOf || history?.dataTimestamp || null,
      fetchedAt: history?.receivedAt || history?.fetchedAt || null,
      stale: history?.stale === true ? true : history?.stale === false ? false : null,
      delayed: history?.delayed === true ? true : history?.delayed === false ? false : null,
      fallback: history?.fallback === true,
      errorCode: history?.error || history?.errorCode || null,
    },
  });
}

export const researchOhlcvChartContract = Object.freeze({ historyBars });
