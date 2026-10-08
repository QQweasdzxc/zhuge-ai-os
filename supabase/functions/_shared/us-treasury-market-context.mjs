import { fetchCached } from "../../../labs/investment/src/lib/http-cache.mjs";

const SOURCE_BASE = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

function field(entry, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:(?:[\\w.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${escaped}\\s*>`, "i");
  return decodeXml(entry.match(pattern)?.[1]);
}

function numeric(value) {
  if (!value || /^(?:null|n\/a|na|--?)$/i.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

export function parseTreasuryTenYearRows(xml, { now = Date.now() } = {}) {
  const rows = [...String(xml || "").matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const rawDate = field(match[1], "NEW_DATE");
    const date = rawDate.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    const twoYearPct = numeric(field(match[1], "BC_2YEAR"));
    const tenYearPct = numeric(field(match[1], "BC_10YEAR"));
    const thirtyYearPct = numeric(field(match[1], "BC_30YEAR"));
    if (!date || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || tenYearPct === null) return null;
    return Object.freeze({ date, twoYearPct, tenYearPct, thirtyYearPct, tenYearMinusTwoYearPct: twoYearPct === null ? null : Number((tenYearPct - twoYearPct).toFixed(4)) });
  }).filter(Boolean).filter(row => row.date <= new Date(now).toISOString().slice(0, 10));
  rows.sort((left, right) => right.date.localeCompare(left.date));
  return rows[0] || null;
}

export async function loadTreasuryTenYearContext({ fetchImpl = fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const instant = Number(now());
  const year = new Date(instant).getUTCFullYear();
  const url = new URL(SOURCE_BASE);
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value", String(year));
  const sourceUrl = url.href;
  const unavailable = (errorCode, note) => Object.freeze({
    status: "UNAVAILABLE", available: false, provider: "U.S. Treasury Daily Treasury Yield Curve",
    source: [sourceUrl], dataTruth: "OFFICIAL", attribution: "U.S. Department of the Treasury",
    license: "依 U.S. Treasury 公開資料之現行條款與使用限制呈現；不代表可任意再散布。",
    data: null, dataTimestamp: null, fetchedAt: new Date(instant).toISOString(),
    freshness: "unavailable", stale: false, delayed: true, fallback: false, errorCode, note,
  });
  try {
    const result = await fetchCached(sourceUrl, {
      kind: "text",
      ttlMs: 60 * 60 * 1000,
      timeoutMs: Math.max(1000, Math.min(15000, Number(timeoutMs) || 8000)),
      fetchImpl,
      now: instant,
    });
    const xml = result.value;
    const row = parseTreasuryTenYearRows(xml, { now: instant });
    if (!row) return unavailable("TREASURY_SERIES_UNAVAILABLE", "美國財政部本年度 XML 沒有可驗證的 10 年期資料列。未使用 FRED、Yahoo 或估值替代。");
    const ageDays = Math.max(0, (Date.parse(new Date(instant).toISOString().slice(0, 10)) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000);
    const freshness = ageDays <= 4 ? "fresh" : "stale";
    return Object.freeze({
      status: freshness === "fresh" ? "AVAILABLE" : "PARTIAL", available: true,
      provider: "U.S. Treasury Daily Treasury Yield Curve", source: [sourceUrl],
      data: Object.freeze({
        series: "Daily Treasury par yield curve",
        twoYearPct: row.twoYearPct,
        tenYearPct: row.tenYearPct,
        thirtyYearPct: row.thirtyYearPct,
        tenYearMinusTwoYearPct: row.tenYearMinusTwoYearPct,
        date: row.date,
      }),
      dataTruth: "OFFICIAL", attribution: "U.S. Department of the Treasury",
      license: "依 U.S. Treasury 公開資料之現行條款與使用限制呈現；不代表可任意再散布。",
      dataTimestamp: row.date, fetchedAt: result.fetchedAt, freshness,
      stale: freshness === "stale", delayed: true, fallback: result.fallback === true,
      note: "官方每日公債殖利率是宏觀背景，並非股票行情、即時利率或買賣訊號。",
    });
  } catch (error) {
    return unavailable(error?.code === "TIMEOUT" ? "TREASURY_TIMEOUT" : "TREASURY_FETCH_FAILED", "美國財政部利率來源目前無法讀取；沒有用其他數值替代。");
  }
}
