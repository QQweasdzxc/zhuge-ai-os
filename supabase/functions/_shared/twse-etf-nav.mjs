const API_ROOT = "https://mis.twse.com.tw/stock/api/getETFNav.jsp";
const PAGE_URL = "https://mis.twse.com.tw/stock/etf_nav.jsp";

function finite(value) {
  const text = String(value ?? "").trim().replace(/[,%％\s]/g, "");
  if (!text || text === "-" || text === "--") return null;
  const result = Number(text);
  return Number.isFinite(result) ? result : null;
}

function symbolFromRow(row) {
  const candidate = String(row?.symbol || row?.code || row?.ticker || row?.stock_id || row?.ex_ch || row?.ch || row?.a || "").trim().toUpperCase();
  const match = /(?:^|[_|])([A-Z0-9]{1,10})(?:\.(?:TW|TWO))?(?:$|\||\.)/.exec(candidate) || /^([A-Z0-9]{1,10})$/.exec(candidate);
  return match?.[1] || "";
}

function validDate(value) {
  const raw = String(value ?? "").trim();
  const normalized = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : "";
}

function dataRows(payload) {
  if (Array.isArray(payload?.msgArray)) return payload.msgArray;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

/** Authenticated caller reaches this bounded official-source adapter via the existing read Edge. */
export function createTwseEtfNavProvider({ fetcher = globalThis.fetch, now = () => Date.now(), timeoutMs = 10_000 } = {}) {
  async function getFundEvidence(input = {}) {
    const symbol = String(input.symbol || "").trim().toUpperCase();
    const market = String(input.market || "TW").trim().toUpperCase();
    const venue = String(input.venue || "TWSE").trim().toUpperCase();
    const fetchedAt = new Date(Number(now())).toISOString();
    if (market !== "TW" || !["TWSE", "TPEX"].includes(venue) || !/^[A-Z0-9]{1,10}$/.test(symbol)) {
      return Object.freeze({ status: market === "US" ? "NOT_APPLICABLE" : "UNAVAILABLE", symbol, market, venue, provider: "TWSE MIS ETF NAV", sourceUrl: PAGE_URL, fetchedAt, dataTimestamp: null, data: null, errorCode: "REQUEST_INVALID", note: "ETF NAV 僅接受已解析的台灣市場代碼。" });
    }
    if (typeof fetcher !== "function") return Object.freeze({ status: "UNAVAILABLE", symbol, market, venue, provider: "TWSE MIS ETF NAV", sourceUrl: PAGE_URL, fetchedAt, dataTimestamp: null, data: null, errorCode: "FETCH_UNAVAILABLE", note: "官方 ETF NAV 來源無法讀取；未使用市價或其他資料替代。" });
    const url = new URL(API_ROOT);
    url.searchParams.set("ex_ch", `${venue === "TPEX" ? "otc" : "tse"}_${symbol.toLowerCase()}.tw`);
    url.searchParams.set("json", "1");
    url.searchParams.set("delay", "0");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url.href, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response?.ok) throw Object.assign(new Error("ETF_NAV_HTTP_ERROR"), { code: `HTTP_${Number(response?.status) || 0}` });
      const payload = await response.json();
      const row = dataRows(payload).find(item => symbolFromRow(item) === symbol);
      if (!row) return Object.freeze({ status: "UNAVAILABLE", symbol, market, venue, provider: "TWSE MIS ETF NAV", sourceUrl: PAGE_URL, requestUrl: url.href, fetchedAt, dataTimestamp: null, data: null, errorCode: "ETF_NAV_SYMBOL_NOT_FOUND", note: "官方 ETF NAV feed 沒有此代碼的來源列；不以收盤價或估算補值。" });
      const nav = finite(row.f ?? row.nav ?? row.estimatedNav);
      const price = finite(row.e ?? row.price ?? row.marketPrice);
      const reportedPremiumDiscountPct = finite(row.g ?? row.premiumDiscountPct);
      const unitsOutstanding = finite(row.c ?? row.unitsOutstanding);
      const unitsOutstandingChange = finite(row.d ?? row.unitsOutstandingChange);
      const date = validDate(row.i ?? row.date ?? row.dataDate);
      const time = String(row.j ?? row.time ?? "").trim();
      const dataTimestamp = date ? `${date}${time ? ` ${time}` : ""}` : null;
      if (nav === null || nav <= 0 || !date) return Object.freeze({ status: "UNAVAILABLE", symbol, market, venue, provider: "TWSE MIS ETF NAV", sourceUrl: PAGE_URL, requestUrl: url.href, fetchedAt, dataTimestamp, data: null, errorCode: "ETF_NAV_FIELDS_MISSING", note: "官方 feed 缺少正值 NAV 或有效來源日期；不顯示不完整估值。" });
      return Object.freeze({
        status: unitsOutstanding !== null || unitsOutstandingChange !== null ? "AVAILABLE" : "PARTIAL",
        symbol, market, venue,
        provider: "TWSE MIS ETF NAV feed",
        sourceUrl: PAGE_URL,
        requestUrl: url.href,
        fetchedAt,
        dataTimestamp,
        data: Object.freeze({ nav, price, reportedPremiumDiscountPct, unitsOutstanding, unitsOutstandingChange, currency: "TWD", date, time: time || null }),
        errorCode: null,
        note: "NAV 為 TWSE MIS ETF feed 同筆來源預估淨值；市場價、NAV、受益權單位數與單位數變動各自保留來源時間，不把單位變動稱為資金淨流入。",
      });
    } catch (error) {
      return Object.freeze({ status: "UNAVAILABLE", symbol, market, venue, provider: "TWSE MIS ETF NAV", sourceUrl: PAGE_URL, requestUrl: url.href, fetchedAt, dataTimestamp: null, data: null, errorCode: error?.name === "AbortError" ? "TIMEOUT" : error?.code || "ETF_NAV_PROVIDER_FAILED", note: "官方 ETF NAV 來源暫時無法驗證；不以市價或其他資料補值。" });
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({ provider: "twse-mis-etf-nav", readOnly: true, getFundEvidence });
}

export const twseEtfNavSource = Object.freeze({ page: PAGE_URL, endpoint: API_ROOT, documentedFeedFields: Object.freeze({ e: "price", f: "estimated NAV", g: "reported premium/discount", c: "units outstanding", d: "change in units", i: "source date", j: "source time" }) });
