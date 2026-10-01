import { taiwanDataProvider, taiwanOfficialApi, taiwanNormalization as n } from "../../../sources/taiwan-provider";
import type { PricePoint } from "../../../types/financials";
import { loadPriceRadar, type RadarItem } from "./radar";

export const LAB_SYMBOLS = ["2330.TW", "0050.TW", "6488.TWO"] as const;
export type LabSymbol = typeof LAB_SYMBOLS[number];
export type EvidenceStatus = "PASS" | "PARTIAL" | "NOT_CONNECTED" | "UNAVAILABLE" | "PROVIDER_REVIEW_REQUIRED";
export type Row = Record<string, unknown>;
export interface Evidence<T> {
  status: EvidenceStatus;
  provider: string;
  source: string[];
  dataTimestamp: string | null;
  publishedAt: string | null;
  fetchedAt: string | null;
  stale: boolean | null;
  delayed: boolean;
  fallback: boolean;
  note: string;
  errorCode: string | null;
  totalRecords?: number;
  data: T | null;
}
export interface ResearchQuote {
  name: string; price: number; currency: "TWD"; change: number | null; changePercent: number | null;
  volume: number | null; open: number | null; high: number | null; low: number | null;
}
export interface TaiwanResearchReport {
  schema: "zhuge-taiwan-research-workbench-v1";
  symbol: LabSymbol;
  venue: "TWSE" | "TPEX";
  generatedAt: string;
  quote: Evidence<ResearchQuote>;
  history: Evidence<Array<{ date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null }>>;
  profile: Evidence<Row>;
  revenue: Evidence<Row>;
  income: Evidence<Row>;
  balance: Evidence<Row>;
  holders: Evidence<Row[]>;
  futures: Evidence<Row[]>;
  options: Evidence<Row[]>;
  radar: RadarItem[];
  gaps: Array<{ capability: string; status: EvidenceStatus; note: string }>;
}

export function resolveLabSymbol(value: string): LabSymbol {
  const raw = value.trim().toUpperCase();
  const canonical = raw === "2330" || raw === "0050" ? `${raw}.TW` : raw === "6488" ? "6488.TWO" : raw;
  if (!(LAB_SYMBOLS as readonly string[]).includes(canonical)) throw new Error("LAB_SCOPE_ONLY_2330_0050_6488");
  return canonical as LabSymbol;
}

export function numeric(value: unknown): number | null { return n.number(value) ?? null; }
export function dateText(value: unknown): string | null {
  const raw = n.text(value);
  if (!/^\d{2,4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{7,8}$/.test(raw)) return null;
  const parts = raw.includes("-") || raw.includes("/") ? raw.split(/[-/]/).map(Number)
    : [Number(raw.slice(0, -4)), Number(raw.slice(-4, -2)), Number(raw.slice(-2))];
  const [year, month, day] = parts;
  const actualYear = year! < 1911 ? year! + 1911 : year!;
  const date = new Date(Date.UTC(actualYear, month! - 1, day!));
  return date.getUTCFullYear() === actualYear && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

export function ageStale(date: string | null, maxDays: number, now = Date.now()): boolean | null {
  if (!date) return null;
  const timestamp = Date.parse(`${date}T16:00:00+08:00`);
  if (!Number.isFinite(timestamp)) return null;
  // Freshness budget is a calendar-day research budget, NOT a trading calendar.
  return now - timestamp > maxDays * 86_400_000;
}

export function evidence<T>(provider: string, source: string[], data: T | null, dataTimestamp: string | null, note: string, maxDays: number,
  overrides: Partial<Evidence<T>> = {}): Evidence<T> {
  const receipts = source.map((url) => taiwanOfficialApi.receipt(url)).filter(Boolean);
  return {
    status: data === null ? "UNAVAILABLE" : dataTimestamp ? "PASS" : "PARTIAL",
    provider, source, dataTimestamp, publishedAt: null,
    fetchedAt: receipts.map((r) => r!.fetchedAt).sort().at(-1) ?? null,
    stale: ageStale(dataTimestamp, maxDays), delayed: true, fallback: false, note,
    errorCode: data === null ? receipts.find((r) => r?.errorCode)?.errorCode ?? "NO_MATCHING_OFFICIAL_ROW" : null,
    data, ...overrides,
  };
}

function officialEndpoints(symbol: LabSymbol) {
  const otc = symbol.endsWith(".TWO");
  const root = otc ? "https://www.tpex.org.tw/openapi/v1/" : "https://openapi.twse.com.tw/v1/opendata/";
  return {
    quote: otc ? `${root}tpex_mainboard_daily_close_quotes` : "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    profile: `${root}${otc ? "mopsfin_t187ap03_O" : "t187ap03_L"}`,
    revenue: `${root}${otc ? "mopsfin_t187ap05_O" : "t187ap05_L"}`,
    income: `${root}${otc ? "mopsfin_t187ap06_O_ci" : "t187ap06_L_ci"}`,
    balance: `${root}${otc ? "mopsfin_t187ap07_O_ci" : "t187ap07_L_ci"}`,
  };
}

async function dataset(url: string, code?: string, ttl = 10 * 60_000): Promise<Row[]> {
  const rows = n.asRows(await taiwanOfficialApi.json(url, ttl));
  return code ? rows.filter((row) => n.codeOf(row) === code || n.text(row["證券代號"]) === code) : rows;
}

function latest(rows: Row[]): Row | null {
  return [...rows].sort((a, b) => {
    const period = (row: Row) => `${n.text(row["年度"] ?? row.Year)}-${n.text(row["季別"] ?? row.Season)}-${n.text(row["資料年月"] ?? row.RevenueMonth)}-${n.text(row["出表日期"] ?? row.Date)}`;
    return period(b).localeCompare(period(a));
  })[0] ?? null;
}

export function revenuePeriod(value: unknown): string | null {
  const match = /^(\d{2,3}|\d{4})(\d{2})$/.exec(n.text(value));
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]);
  if (month < 1 || month > 12 || year < 90) return null;
  return new Date(Date.UTC(year < 1911 ? year + 1911 : year, month, 0)).toISOString().slice(0, 10);
}

export function statementPeriod(yearValue: unknown, quarterValue: unknown): string | null {
  const year = numeric(yearValue), quarter = numeric(quarterValue);
  if (year == null || !Number.isInteger(year) || year < 90 || quarter == null || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  return new Date(Date.UTC(year < 1911 ? year + 1911 : year, quarter * 3, 0)).toISOString().slice(0, 10);
}

export function missingMopsFields(kind: "profile" | "revenue" | "income" | "balance", data: Row): string[] {
  const fields = { profile: ["name"], revenue: ["amount", "momPercent", "yoyPercent"],
    income: ["revenue", "netIncome", "eps"], balance: ["assets", "liabilities", "equity"] }[kind];
  return fields.filter((field) => data[field] == null || data[field] === "");
}

export function normalizeRevenue(row: Row): Row {
  return {
    period: revenuePeriod(row["資料年月"] ?? row.RevenueMonth),
    amount: numeric(n.first(row, ["營業收入-當月營收", "Revenue"])),
    previousMonth: numeric(n.first(row, ["營業收入-上月營收", "RevenueLastMonth"])),
    previousYear: numeric(n.first(row, ["營業收入-去年當月營收", "RevenueLastYear", "RevenuePreviousYear"])),
    momPercent: numeric(n.first(row, ["營業收入-上月比較增減(%)", "RevenueLastMonthPercentage"])),
    yoyPercent: numeric(n.first(row, ["營業收入-去年同月增減(%)", "RevenueLastYearPercentage"])),
    unit: "TWD 千元", remarks: n.text(row["備註"] ?? row.Remark),
  };
}

export function normalizeStatement(row: Row, kind: "income" | "balance"): Row {
  const date = statementPeriod(row["年度"] ?? row.Year, row["季別"] ?? row.Season);
  return kind === "income" ? {
    period: date, scope: "年初至本季累計（非單季）", unit: "TWD 千元；EPS 為元",
    revenue: numeric(n.first(row, ["營業收入", "Revenue"])),
    grossProfit: numeric(n.first(row, ["營業毛利（毛損）淨額", "營業毛利（毛損）", "GrossProfit"])),
    operatingIncome: numeric(n.first(row, ["營業利益（損失）", "OperatingIncome"])),
    netIncome: numeric(n.first(row, ["本期淨利（淨損）", "NetIncome"])),
    eps: numeric(n.first(row, ["基本每股盈餘（元）", "EPS"])),
  } : {
    period: date, scope: "期末餘額（非流量）", unit: "TWD 千元",
    assets: numeric(n.first(row, ["資產總計", "資產總額", "TotalAssets"])),
    liabilities: numeric(n.first(row, ["負債總計", "負債總額", "TotalLiabilities"])),
    equity: numeric(n.first(row, ["權益總額", "權益總計", "TotalEquity"])),
  };
}

async function loadMops(symbol: LabSymbol, kind: "profile" | "revenue" | "income" | "balance"): Promise<Evidence<Row>> {
  const source = [officialEndpoints(symbol)[kind]];
  if (symbol === "0050.TW") return evidence<Row>("MOPS", source, null, null, "ETF 不是營運公司；公司營收／財報不適用。基金持股與淨值尚未接入。", 120,
    { status: "NOT_CONNECTED", errorCode: "ETF_COMPANY_FINANCIAL_NOT_APPLICABLE" });
  try {
    const row = latest(await dataset(source[0]!, symbol.split(".")[0]));
    if (!row) return evidence<Row>("MOPS", source, null, null, "此資料表未找到此標的。", 120);
    const published = dateText(row["出表日期"] ?? row.Date);
    const data = kind === "revenue" ? normalizeRevenue(row) : kind === "profile" ? {
      name: n.first(row, ["公司名稱", "CompanyName", "CompanyAbbreviation"]) ?? null,
      industry: n.first(row, ["產業別", "Industry"]) ?? null,
      description: n.first(row, ["主要經營業務", "Description"]) ?? null,
      website: n.first(row, ["網址", "WebAddress"]) ?? null,
    } : normalizeStatement(row, kind);
    const period = kind === "profile" ? published : typeof data.period === "string" ? data.period : null;
    const missing = missingMopsFields(kind, data);
    return evidence("MOPS", source, data, period, kind === "profile" ? "公司公開基本資料；產業代碼不猜測轉成名稱。" : String(data.unit),
      kind === "revenue" ? 75 : kind === "profile" ? 90 : 160, { publishedAt: published,
        ...(missing.length ? { status: "PARTIAL" as const, errorCode: "MOPS_FIELDS_MISSING", note: `部分欄位未提供：${missing.join(" / ")}；${String(data.unit ?? "公司基本資料")}` } : {}) });
  } catch {
    return evidence<Row>("MOPS", source, null, null, "官方來源暫不可用；其他區塊仍可閱讀。", 120);
  }
}

async function loadHolders(code: string): Promise<Evidence<Row[]>> {
  const source = ["https://openapi.tdcc.com.tw/v1/opendata/1-5"];
  try {
    const rows = await dataset(source[0]!, code);
    const date = dateText(rows[0]?.["\uFEFF資料日期"] ?? rows[0]?.["資料日期"]);
    const data = rows.map((row) => ({ band: n.text(row["持股分級"]), holders: numeric(row["人數"]), shares: numeric(row["股數"]), percent: numeric(row["占集保庫存數比例%"]) }));
    return evidence("TDCC", source, data.length ? data : null, date, "每週持股級距；第 16 級為差異數、第 17 級為合計，不能當大型股東加總。不是法人名單。", 14);
  } catch { return evidence<Row[]>("TDCC", source, null, null, "集保資料暫不可用。", 14); }
}

async function loadDerivative(kind: "futures" | "options"): Promise<Evidence<Row[]>> {
  const source = [`https://openapi.taifex.com.tw/v1/${kind === "futures" ? "DailyMarketReportFut" : "DailyMarketReportOpt"}`];
  try {
    const rows = (await dataset(source[0]!)).filter((r) => r.Contract === (kind === "futures" ? "TX" : "TXO") && r.TradingSession === "一般");
    const date = rows.map((r) => dateText(r.Date) ?? "").sort().at(-1) || null;
    const data = rows.filter((r) => dateText(r.Date) === date).map((r) => ({ date, expiry: n.text(r["ContractMonth(Week)"]),
      side: n.text(r.CallPut), strike: numeric(r.StrikePrice), close: numeric(r.Last ?? r.Close),
      settlement: numeric(r.SettlementPrice), volume: numeric(r.Volume), openInterest: numeric(r.OpenInterest),
    })).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
    return evidence("TAIFEX", source, data.length ? (kind === "options" ? data.slice(0, 60) : data) : null, date,
      kind === "futures" ? "TX 一般盤每日行情；不是即時報價或個股指標。" : "TXO 每日報表；只保留成交量最高 60 列。IV／Delta／買賣價差／Put-Call 比尚未接入，不補 0。", 5,
      { totalRecords: data.length, ...(kind === "options" && data.length ? { status: "PARTIAL" as const } : {}) });
  } catch { return evidence<Row[]>("TAIFEX", source, null, null, "衍生商品報表暫不可用。", 5); }
}

export function normalizeHistory(points: PricePoint[]) {
  return points.map((p) => ({ date: p.date.toISOString().slice(0, 10), open: p.open ?? null, high: p.high ?? null, low: p.low ?? null, close: p.close, volume: p.volume ?? null }));
}

export async function loadTaiwanResearch(value: string, force = false): Promise<TaiwanResearchReport> {
  const symbol = resolveLabSymbol(value), venue = symbol.endsWith(".TWO") ? "TPEX" : "TWSE", code = symbol.split(".")[0]!;
  if (force) taiwanOfficialApi.invalidate();
  const endpoints = officialEndpoints(symbol);
  const historySource: string[] = [];
  if (venue === "TWSE") for (let i = 2; i >= 0; i--) {
    const date = new Date(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - i);
    historySource.push(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01&stockNo=${code}`);
  }
  const [quoteResult, historyResult, profile, revenue, income, balance, holders, futures, options, radar] = await Promise.all([
    taiwanDataProvider.getQuote(symbol, venue).then((v) => ({ value: v, error: null })).catch((e) => ({ value: null, error: String(e) })),
    venue === "TWSE" ? taiwanDataProvider.getPriceHistory(symbol, venue, "3M").catch(() => []) : Promise.resolve([]),
    loadMops(symbol, "profile"), loadMops(symbol, "revenue"), loadMops(symbol, "income"), loadMops(symbol, "balance"),
    loadHolders(code), loadDerivative("futures"), loadDerivative("options"), loadPriceRadar(force),
  ]);
  const historyData = normalizeHistory(historyResult);
  const failedMonths = historySource.filter((url) => taiwanOfficialApi.receipt(url)?.errorCode);
  const history = evidence("TWSE", historySource, historyData.length ? historyData : null, historyData.at(-1)?.date ?? null,
    "最近三個日曆月的原始日 OHLCV；未還原除權息／分割，不用於回測。", 5,
    venue === "TPEX" ? { provider: "TPEx", status: "NOT_CONNECTED", errorCode: "TPEX_HISTORY_NOT_CONNECTED", note: "TPEx 歷史端點在 Gap Map 中；本輪保留 Spike 的未接入狀態。" }
      : failedMonths.length ? { status: "PARTIAL", errorCode: "HISTORY_MONTH_PARTIAL" } : {});
  const raw = quoteResult.value;
  const last = historyData.at(-1), previous = historyData.at(-2);
  const aligned = !!raw && !!last && last.date === raw.regularCloseSessionDate && last.close === raw.price;
  const datedHistoryFallback = !!last && (!raw?.regularCloseSessionDate || last.date > raw.regularCloseSessionDate);
  const dataDate = datedHistoryFallback ? last!.date : raw?.regularCloseSessionDate ?? null;
  const price = datedHistoryFallback ? last!.close : raw?.price;
  const useHistoryChange = aligned || datedHistoryFallback;
  const change = useHistoryChange && previous ? last!.close - previous.close : raw?.previousClose != null ? raw.price - raw.previousClose : null;
  const changePercent = useHistoryChange && previous?.close ? (last!.close / previous.close - 1) * 100
    : raw?.previousClose ? ((raw.price / raw.previousClose) - 1) * 100 : null;
  const name = n.text(profile.data?.name) || raw?.name || symbol;
  const quote = evidence<ResearchQuote>(venue === "TPEX" ? "TPEx" : "TWSE", [endpoints.quote, ...historySource], price == null ? null : {
    name, price, currency: "TWD", change, changePercent,
    volume: datedHistoryFallback ? last!.volume : raw?.volume ?? (aligned ? last?.volume ?? null : null),
    open: datedHistoryFallback ? last!.open : raw?.open ?? null, high: datedHistoryFallback ? last!.high : raw?.high ?? null, low: datedHistoryFallback ? last!.low : raw?.low ?? null,
  }, dataDate, "最新可取得官方收盤，不是盤中即時行情；漲跌僅由有日期且對齊的官方日資料或官方前收計算。", 5,
  { fallback: !!datedHistoryFallback, ...(price != null && change === null ? { status: "PARTIAL" as const } : {}) });
  const actualProfile = symbol === "0050.TW" ? evidence<Row>("TWSE", [endpoints.quote], { name, instrumentType: "ETF", issuerReference: "https://www.yuantaetfs.com/product/detail/0050/Basic_information", constituents: null },
    dataDate, "僅有 ETF 名稱／商品種類；成分、持股權重、淨值與產業曝險尚未接入。發行商頁供人工核對。", 90,
    { status: "PARTIAL", errorCode: "ETF_CONSTITUENTS_NOT_CONNECTED" }) : profile;
  return {
    schema: "zhuge-taiwan-research-workbench-v1", symbol, venue, generatedAt: new Date().toISOString(), quote, history, profile: actualProfile,
    revenue, income, balance, holders, futures, options, radar,
    gaps: ["三大法人", "融資融券", "借券 / SBL", "股利", "估值", "ETF constituents", "新聞 / 公告", "Put / Call Ratio", "期貨法人部位", "年度財報歷史", "月營收歷史", "重大訊息 / filings"]
      .map((capability) => ({ capability, status: "NOT_CONNECTED", note: "官方來源與接入方式見 TAIWAN_PROVIDER_GAP_MAP_V2.md；未呼叫，不以替代資料補空。" })),
  };
}
