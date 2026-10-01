import { loadHome as loadProviderHome, loadMarketPulse, loadOpenPressure, loadResearch as loadProviderResearch, loadHistory as loadProviderHistory } from "./providers/official-taiwan.mjs";
import { loadBrowserQuote } from "./providers/browser-taiwan.mjs";
import { loadPriceRadar } from "./providers/price-radar.mjs";

const proxyRequiredHosts = new Set([
  "openapi.twse.com.tw",
  "openapi.taifex.com.tw",
  "thedocs.worldbank.org",
]);

function requiresServerProxy(evidence) {
  if (!evidence || typeof evidence !== "object" || evidence.data != null || !Array.isArray(evidence.source)) return false;
  return evidence.source.some((source) => {
    try {
      const url = new URL(source);
      return proxyRequiredHosts.has(url.hostname)
        || (url.hostname === "www.tpex.org.tw" && url.pathname.startsWith("/openapi/"));
    } catch { return false; }
  });
}

export function applyBrowserProviderBoundary(value) {
  if (Array.isArray(value)) return value.map(applyBrowserProviderBoundary);
  if (!value || typeof value !== "object") return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyBrowserProviderBoundary(item)]));
  if (!requiresServerProxy(mapped)) return mapped;
  return {
    ...mapped,
    status: "NOT_CONNECTED",
    dataTruth: "NOT_CONNECTED",
    fallback: false,
    data: null,
    errorCode: "SERVER_PROXY_REQUIRED",
    note: "此官方端點未允許靜態頁面的瀏覽器跨來源讀取。保留未接狀態；需要 Zhuge 受控 server-side proxy，沒有使用假值或其他來源替代。",
  };
}

export async function loadHome() {
  const base = await loadProviderHome(loadBrowserQuote);
  const trends = await Promise.all(base.cards.map(async (card) => ({ symbol: card.symbol, history: await loadHistory(card.symbol) })));
  return applyBrowserProviderBoundary({ ...base, trends });
}

export async function loadHistory(symbol) {
  return applyBrowserProviderBoundary(await loadProviderHistory(symbol));
}

export async function loadResearch(symbol) {
  return applyBrowserProviderBoundary(await loadProviderResearch(symbol, loadPriceRadar, loadBrowserQuote));
}

export async function loadMarket() {
  return applyBrowserProviderBoundary(await loadMarketPulse());
}

export async function loadOpening() {
  return applyBrowserProviderBoundary(await loadOpenPressure());
}

export async function loadRadar() {
  return applyBrowserProviderBoundary(await loadPriceRadar());
}
