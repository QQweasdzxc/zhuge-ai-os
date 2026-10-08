const API_URL = "https://api.finmindtrade.com/api/v4/data";
const SOURCE_URL = "https://finmind.github.io/tutor/TaiwanMarket/Technical/";
const MAX_ROWS = 50;

function dateInTaipei(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDate(value) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function unavailable({ status = "UNAVAILABLE", symbol, provider, source, fetchedAt, errorCode, note }) {
  return Object.freeze({
    contract: "zhuge-broker-branch-evidence-v1",
    status,
    market: "TW",
    symbol,
    provider,
    source,
    dataTimestamp: null,
    fetchedAt,
    data: Object.freeze({ rows: Object.freeze([]), recentSourceDates: Object.freeze([]), window: null }),
    errorCode: errorCode || null,
    note,
  });
}

function requestUrl(symbol, startDate, endDate, token) {
  const url = new URL(API_URL);
  url.searchParams.set("dataset", "TaiwanStockTradingDailyReport");
  url.searchParams.set("data_id", symbol);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  // FinMind's documented read endpoint accepts the private token as a query
  // parameter. It is only constructed server-side and never returned or logged.
  url.searchParams.set("token", token);
  return url;
}

/** Server-only, bounded, read-only FinMind branch data adapter. */
export function createFinMindBrokerBranchProvider({ token = "", fetcher = globalThis.fetch, now = () => new Date(), timeoutMs = 10_000 } = {}) {
  async function getLatestBranchReport(input = {}) {
    const symbol = String(input.symbol || "").trim().toUpperCase().replace(/\.(TW|TWO)$/i, "");
    const market = String(input.market || "TW").trim().toUpperCase();
    const fetchedAt = new Date(now()).toISOString();
    if (market === "US") return unavailable({ status: "NOT_APPLICABLE", symbol, provider: null, source: null, fetchedAt, note: "台灣券商分點資料不適用美股。" });
    if (market !== "TW" || !/^[A-Z0-9.-]{1,16}$/.test(symbol)) return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: "SYMBOL_INVALID", note: "市場或股票代碼無法辨識。" });
    if (!String(token || "").trim()) return unavailable({
      status: "SECRET_REQUIRED", symbol, provider: "FinMind TaiwanStockTradingDailyReport · Sponsor dataset",
      source: SOURCE_URL, fetchedAt, errorCode: "EXTERNAL_SECRET_REQUIRED",
      note: "分點資料：尚未設定資料服務。FinMind 歷史分點報告需要已授權的 Sponsor token；未以法人流量或猜測值代替。",
    });
    if (typeof fetcher !== "function") return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: "FETCH_UNAVAILABLE", note: "Server fetch 不可用。" });

    // Exclude the in-progress Taipei calendar day so a partial live session is
    // never presented as a complete historical branch report.
    const today = dateInTaipei(now());
    const endDate = dateInTaipei(new Date(Date.parse(`${today}T00:00:00+08:00`) - 86_400_000));
    const startDate = dateInTaipei(new Date(Date.parse(`${endDate}T00:00:00+08:00`) - 30 * 86_400_000));
    const url = requestUrl(symbol, startDate, endDate, String(token).trim());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url.href, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response?.ok) return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: `HTTP_${Number(response?.status) || 0}`, note: "分點來源暫時無法讀取；不以其他資料補值。" });
      const payload = await response.json();
      const apiStatus = Number(payload?.status);
      if (apiStatus !== 200 || !Array.isArray(payload?.data)) return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: "PROVIDER_RESPONSE_INVALID", note: "分點來源回應格式無法驗證。" });
      const byKey = new Map();
      for (const item of payload.data) {
        const rowSymbol = String(item?.stock_id || item?.data_id || symbol).trim().toUpperCase();
        const date = validDate(item?.date);
        const branch = String(item?.securities_trader || item?.securities_trader_id || item?.broker_id || "").trim().slice(0, 160);
        const buy = finite(item?.buy), sell = finite(item?.sell);
        if (rowSymbol !== symbol || !date || date < startDate || date > endDate || !branch || buy === null || sell === null) continue;
        const key = `${date}|${branch}`;
        const current = byKey.get(key) || { date, branch, buy: 0, sell: 0 };
        current.buy += buy;
        current.sell += sell;
        byKey.set(key, current);
      }
      const allRows = [...byKey.values()].map(item => Object.freeze({ ...item, net: item.buy - item.sell, unit: "shares" }))
        .sort((left, right) => right.date.localeCompare(left.date) || (right.buy + right.sell) - (left.buy + left.sell));
      if (!allRows.length) return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: "BRANCH_ROWS_EMPTY", note: "來源期間沒有此標的可驗證的券商分點列。" });
      const dataTimestamp = allRows[0].date;
      const latest = allRows.filter(item => item.date === dataTimestamp).sort((left, right) => (right.buy + right.sell) - (left.buy + left.sell));
      const rows = latest.slice(0, MAX_ROWS);
      const limited = latest.length > MAX_ROWS;
      const summary = rows.length ? Object.freeze({
        buy: rows.reduce((sum, item) => sum + item.buy, 0),
        sell: rows.reduce((sum, item) => sum + item.sell, 0),
        net: rows.reduce((sum, item) => sum + item.net, 0),
        unit: "shares",
        rowCount: latest.length,
        displayedRowCount: rows.length,
        complete: !limited,
      }) : null;
      return Object.freeze({
        contract: "zhuge-broker-branch-evidence-v1",
        status: limited ? "PARTIAL" : "AVAILABLE",
        market: "TW",
        symbol,
        provider: "FinMind TaiwanStockTradingDailyReport · delayed source data",
        source: SOURCE_URL,
        dataTimestamp,
        fetchedAt,
        data: Object.freeze({ rows: Object.freeze(rows), summary, recentSourceDates: Object.freeze([...new Set(allRows.map(item => item.date))].sort().slice(-20)), window: Object.freeze({ startDate, endDate }) }),
        errorCode: null,
        note: `資料為來源已發布的延遲分點列，最新日期 ${dataTimestamp}；買賣數量依來源原始單位呈現，沒有排序／主力意圖推論。${limited ? ` 最新日共有 ${latest.length} 個分點，只展示交易量前 ${MAX_ROWS} 列。` : ""}`,
      });
    } catch (error) {
      return unavailable({ symbol, provider: "FinMind TaiwanStockTradingDailyReport", source: SOURCE_URL, fetchedAt, errorCode: error?.name === "AbortError" ? "TIMEOUT" : "PROVIDER_READ_FAILED", note: "分點來源暫時無法讀取；不以其他資料補值。" });
    } finally {
      clearTimeout(timeout);
    }
  }

  return Object.freeze({ provider: "finmind-branch-report", readOnly: true, getLatestBranchReport });
}

export const finMindBrokerBranchSource = Object.freeze({ endpoint: API_URL, dataset: "TaiwanStockTradingDailyReport", documentation: SOURCE_URL, delayed: true });
