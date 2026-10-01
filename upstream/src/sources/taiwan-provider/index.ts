import type {
  DataProvider,
  MarketDataRequestContext,
  SearchRequestContext,
} from "../../types/data-provider";
import type {
  CompanyProfile,
  FinancialStatement,
  HolderData,
  HolderRecord,
  OptionContract,
  OptionsChain,
  PricePoint,
  Quote,
  TickerFinancials,
} from "../../types/financials";
import type { InstrumentSearchResult } from "../../types/instrument";
import type { ChartResolutionSupport } from "../../time-series/resolution";
import type { TimeRange } from "../../time-series/range";
import { httpFetch } from "../../utils/http-transport";

/**
 * Small, deliberately boring adapters for official Taiwanese public data.
 *
 * This is a spike, not a second market-data platform. It only implements the
 * methods needed to prove that Gloomberb's existing router, panes, and CLI can
 * consume TWSE/TPEx/MOPS/TDCC/TAIFEX data. Unsupported methods are left absent
 * so the existing Yahoo provider remains the normal fallback.
 */

export const TAIWAN_PROVIDER_ID = "taiwan-official";

const TWSE_OPENAPI = "https://openapi.twse.com.tw/v1";
const TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1";
const TDCC_OPENAPI = "https://openapi.tdcc.com.tw/v1";
const TAIFEX_OPENAPI = "https://openapi.taifex.com.tw/v1";
const TWSE_HISTORY = "https://www.twse.com.tw";

type JsonRecord = Record<string, unknown>;
type TaiwanVenue = "TWSE" | "TPEX" | "TAIFEX";
type TaiwanTargetKind = "stock" | "future" | "option";

interface TaiwanTarget {
  code: string;
  venue: TaiwanVenue;
  kind: TaiwanTargetKind;
  symbol: string;
}

interface MopsRows {
  profile: JsonRecord | undefined;
  revenue: JsonRecord | undefined;
  income: JsonRecord[];
  balance: JsonRecord[];
}

interface TaifexOptionRow extends JsonRecord {
  __expiry?: number;
  __expiryText?: string;
}

const JSON_CACHE_TTL_MS = 30_000;
const TDCC_CACHE_TTL_MS = 10 * 60_000;

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function number(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const raw = text(value).replace(/,/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!raw || raw === "-" || raw === "--" || raw === "N/A") return undefined;
  const parsed = Number(raw.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function percent(value: unknown): number | undefined {
  const parsed = number(value);
  return parsed == null ? undefined : parsed;
}

function codeOf(row: JsonRecord): string {
  return text(row["公司代號"] ?? row["SecuritiesCompanyCode"] ?? row["CompanyCode"] ?? row["股票代號"] ?? row["Code"]);
}

function rowName(row: JsonRecord): string | undefined {
  return text(row["公司名稱"] ?? row["CompanyName"] ?? row["公司簡稱"] ?? row["CompanyAbbreviation"] ?? row["Name"]) || undefined;
}

function first(row: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key]) !== "") return row[key];
  }
  return undefined;
}

function parsedDate(value: unknown): Date | undefined {
  const raw = text(value).replace(/\//g, "-");
  if (!raw) return undefined;
  const minguoDashed = /^(\d{2,3})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (minguoDashed) {
    const date = new Date(Date.UTC(Number(minguoDashed[1]) + 1911, Number(minguoDashed[2]) - 1, Number(minguoDashed[3]), 8));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (ymd) {
    const date = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 8));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) {
    const date = new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), 8));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const minguo = /^(\d{2,3})(\d{2})(\d{2})$/.exec(raw);
  if (minguo) {
    const date = new Date(Date.UTC(Number(minguo[1]) + 1911, Number(minguo[2]) - 1, Number(minguo[3]), 8));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? undefined : iso;
}

function dateOnly(value: unknown): string | undefined {
  const date = parsedDate(value);
  return date ? date.toISOString().slice(0, 10) : undefined;
}

function minguoPeriodDate(value: unknown, season?: unknown): string | undefined {
  const raw = text(value);
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 90 || year > 200) return dateOnly(value);
  const quarter = Number(text(season));
  if (quarter === 1) return `${year + 1911}-03-31`;
  if (quarter === 2) return `${year + 1911}-06-30`;
  if (quarter === 3) return `${year + 1911}-09-30`;
  if (quarter === 4) return `${year + 1911}-12-31`;
  return `${year + 1911}-12-31`;
}

function endOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0, 8)).toISOString().slice(0, 10);
}

function minguoMonthDate(value: unknown): string | undefined {
  const match = /^(\d{2,3})(\d{2})$/.exec(text(value));
  if (!match) return dateOnly(value);
  return endOfMonth(Number(match[1]) + 1911, Number(match[2]));
}

function canonicalStockCode(ticker: string): string {
  const raw = text(ticker).toUpperCase();
  return raw.replace(/\.(?:TW|TWO)$/, "").replace(/^TWSE:/, "").replace(/^TPEX:/, "");
}

function normalizeExchange(exchange?: string): TaiwanVenue | undefined {
  const value = text(exchange).toUpperCase();
  if (["TWSE", "TPE", "TPEE", "TAI", "XTAI"].includes(value)) return "TWSE";
  if (["TPEX", "TWO", "ROCO", "OTC"].includes(value)) return "TPEX";
  if (["TAIFEX", "TFE", "TAIEX"].includes(value)) return "TAIFEX";
  return undefined;
}

function targetFor(ticker: string, exchange?: string): TaiwanTarget | undefined {
  const raw = text(ticker).toUpperCase();
  if (["TX=F", "TXF", "TAIFEX:TXF", "TAIFEX:TX=F"].includes(raw)) {
    return { code: "TXF", venue: "TAIFEX", kind: "future", symbol: "TX=F" };
  }
  if (["TXO", "TAIEX", "TAIFEX:TXO"].includes(raw)) {
    return { code: "TXO", venue: "TAIFEX", kind: "option", symbol: "TXO" };
  }
  if (!/^\d{4,6}(?:\.(?:TW|TWO))?$/.test(raw)) return undefined;
  const suffix = raw.endsWith(".TWO") ? "TPEX" : raw.endsWith(".TW") ? "TWSE" : undefined;
  const venue = suffix ?? normalizeExchange(exchange) ?? "TWSE";
  if (venue === "TAIFEX") return undefined;
  const code = canonicalStockCode(raw);
  return { code, venue, kind: "stock", symbol: `${code}.${venue === "TWSE" ? "TW" : "TWO"}` };
}

function localSnapshotTimestamp(value: unknown): number {
  const date = parsedDate(value);
  return date?.getTime() ?? Date.now();
}

function apiPath(venue: TaiwanVenue, path: string): string {
  if (venue === "TWSE") return `${TWSE_OPENAPI}/${path}`;
  if (venue === "TPEX") return `${TPEX_OPENAPI}/${path}`;
  return `${TAIFEX_OPENAPI}/${path}`;
}

function asRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter((row): row is JsonRecord => !!row && typeof row === "object");
  if (value && typeof value === "object") {
    const record = value as JsonRecord;
    for (const key of ["data", "Data", "result", "results", "rows", "Rows"]) {
      if (Array.isArray(record[key])) return asRows(record[key]);
    }
  }
  return [];
}

function latestByDate(rows: JsonRecord[]): JsonRecord | undefined {
  return [...rows].sort((left, right) => {
    const l = parsedDate(first(left, ["出表日期", "Date", "資料日期", "日期"]))?.getTime() ?? 0;
    const r = parsedDate(first(right, ["出表日期", "Date", "資料日期", "日期"]))?.getTime() ?? 0;
    return r - l;
  })[0];
}

function statementField(row: JsonRecord, keys: string[]): number | undefined {
  return number(first(row, keys));
}

function statementFromRows(income: JsonRecord[], balance: JsonRecord[]): FinancialStatement[] {
  const keys = new Map<string, { income?: JsonRecord; balance?: JsonRecord }>();
  for (const row of income) {
    const key = `${text(first(row, ["年度", "Year"]))}:${text(first(row, ["季別", "Season"]))}`;
    if (key !== ":") keys.set(key, { ...keys.get(key), income: row });
  }
  for (const row of balance) {
    const key = `${text(first(row, ["年度", "Year"]))}:${text(first(row, ["季別", "Season"]))}`;
    if (key !== ":") keys.set(key, { ...keys.get(key), balance: row });
  }

  return [...keys.entries()].map(([key, rows]) => {
    const [year, season] = key.split(":");
    const row = rows.income ?? rows.balance ?? {};
    const date = minguoPeriodDate(year, season) ?? `${year}-12-31`;
    const statement: FinancialStatement = {
      date,
      dateSource: "provider",
      providerDate: text(first(row, ["出表日期", "Date"])) || undefined,
      currency: "TWD",
      totalRevenue: statementField(rows.income ?? {}, ["營業收入", "TotalRevenue"]),
      costOfRevenue: statementField(rows.income ?? {}, ["營業成本", "CostOfRevenue"]),
      grossProfit: statementField(rows.income ?? {}, ["營業毛利（毛損）淨額", "營業毛利（毛損）", "GrossProfit"]),
      operatingExpense: statementField(rows.income ?? {}, ["營業費用", "OperatingExpense"]),
      operatingIncome: statementField(rows.income ?? {}, ["營業利益（損失）", "營業利益", "OperatingIncome"]),
      pretaxIncome: statementField(rows.income ?? {}, ["稅前淨利（淨損）", "PretaxIncome"]),
      taxProvision: statementField(rows.income ?? {}, ["所得稅費用（利益）", "TaxProvision"]),
      netIncome: statementField(rows.income ?? {}, ["本期淨利（淨損）", "NetIncome"]),
      netIncomeIncludingNoncontrollingInterests: statementField(rows.income ?? {}, ["本期淨利（淨損）", "NetIncome"]),
      netIncomeCommonStockholders: statementField(rows.income ?? {}, ["淨利（淨損）歸屬於母公司業主", "NetIncomeCommonStockholders"]),
      basicEps: statementField(rows.income ?? {}, ["基本每股盈餘（元）", "BasicEPS"]),
      eps: statementField(rows.income ?? {}, ["基本每股盈餘（元）", "BasicEPS"]),
      totalAssets: statementField(rows.balance ?? {}, ["資產總計", "TotalAssets"]),
      currentAssets: statementField(rows.balance ?? {}, ["流動資產", "CurrentAssets"]),
      totalLiabilities: statementField(rows.balance ?? {}, ["負債總計", "TotalLiabilities"]),
      currentLiabilities: statementField(rows.balance ?? {}, ["流動負債", "CurrentLiabilities"]),
      totalEquity: statementField(rows.balance ?? {}, ["權益總計", "EquityTotal", "TotalEquity"]),
      commonStock: statementField(rows.balance ?? {}, ["股本", "CommonStock"]),
      shareIssued: statementField(rows.balance ?? {}, ["普通股股數", "已發行普通股數", "ShareIssued"]),
    };
    return Object.fromEntries(Object.entries(statement).filter(([, value]) => value !== undefined)) as FinancialStatement;
  }).sort((left, right) => left.date.localeCompare(right.date));
}

function mopsStatementRows(rows: JsonRecord[], code: string): JsonRecord[] {
  return rows.filter((row) => codeOf(row) === code);
}

function parseTwseHistoryRows(value: unknown): PricePoint[] {
  if (!value || typeof value !== "object") return [];
  const root = value as JsonRecord;
  const fields = Array.isArray(root.fields) ? root.fields.map(text) : [];
  const rows = Array.isArray(root.data) ? root.data : [];
  const index = (names: string[]) => {
    const found = fields.findIndex((field) => names.includes(field));
    return found >= 0 ? found : undefined;
  };
  const dateIndex = index(["日期"]);
  const openIndex = index(["開盤價"]);
  const highIndex = index(["最高價"]);
  const lowIndex = index(["最低價"]);
  const closeIndex = index(["收盤價"]);
  const volumeIndex = index(["成交股數"]);
  const parsed: Array<PricePoint | undefined> = rows.map((raw) => {
    const row = Array.isArray(raw) ? raw : [];
    const date = parsedDate(row[dateIndex ?? 0]);
    const close = number(row[closeIndex ?? 6]);
    if (!date || close == null) return undefined;
    return {
      date,
      open: number(row[openIndex ?? 3]),
      high: number(row[highIndex ?? 4]),
      low: number(row[lowIndex ?? 5]),
      close,
      volume: number(row[volumeIndex ?? 1]),
    } satisfies PricePoint;
  });
  return parsed.filter((row): row is PricePoint => !!row);
}

function rangeMonths(range: TimeRange): number {
  if (range === "1M") return 1;
  if (range === "3M") return 3;
  if (range === "6M") return 6;
  if (range === "1Y") return 12;
  if (range === "5Y") return 60;
  if (range === "ALL") return 240;
  return 1;
}

function monthStarts(count: number): Array<{ year: number; month: number }> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - (count - index - 1), 1));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });
}

function latestTaifexDate(rows: JsonRecord[]): string | undefined {
  return dateOnly(latestByDate(rows)?.["Date"] ?? latestByDate(rows)?.["日期"]);
}

function taifexNumber(row: JsonRecord, keys: string[]): number | undefined {
  return number(first(row, keys));
}

function optionExpiry(raw: unknown): { timestamp: number; text: string } | undefined {
  const value = text(raw);
  const date = parsedDate(value);
  if (date) return { timestamp: date.getTime(), text: date.toISOString().slice(0, 10) };
  const week = /^(\d{4})(\d{2})W(\d+)$/.exec(value);
  if (week) {
    const year = Number(week[1]);
    const month = Number(week[2]);
    const firstDay = new Date(Date.UTC(year, month - 1, 1, 8));
    const day = Math.min(28, Number(week[3]) * 7);
    const dateValue = new Date(Date.UTC(year, month - 1, day, 8));
    return { timestamp: dateValue.getTime(), text: firstDay.toISOString().slice(0, 7) };
  }
  return undefined;
}

function optionSide(value: unknown): "C" | "P" | undefined {
  const raw = text(value).toUpperCase();
  if (raw === "C" || raw.includes("買權") || raw.includes("CALL")) return "C";
  if (raw === "P" || raw.includes("賣權") || raw.includes("PUT")) return "P";
  return undefined;
}

function currentOptionPrice(row: JsonRecord): number {
  return taifexNumber(row, ["Close", "Last", "SettlementPrice", "收盤價", "最後成交價", "結算價"]) ?? 0;
}

export interface TaiwanRequestReceipt {
  source: string;
  fetchedAt: string;
  httpStatus: number | null;
  errorCode: string | null;
}

export class TaiwanApi {
  constructor(private readonly transport: typeof httpFetch = httpFetch) {}
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly receipts = new Map<string, TaiwanRequestReceipt>();

  receipt(url: string): TaiwanRequestReceipt | undefined {
    const receipt = this.receipts.get(url);
    return receipt ? { ...receipt } : undefined;
  }

  invalidate(): void { this.cache.clear(); }

  async json(url: string, ttlMs = JSON_CACHE_TTL_MS): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const pending = this.inFlight.get(url);
    if (pending) return pending;
    const request = (async () => {
      const receipt: TaiwanRequestReceipt = { source: url, fetchedAt: new Date().toISOString(), httpStatus: null, errorCode: null };
      try {
        const response = await this.transport(url, {
          headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
          signal: AbortSignal.timeout(20_000),
        });
        receipt.httpStatus = response.status;
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const raw = await response.text();
        let value: unknown;
        try { value = JSON.parse(raw.replace(/^\uFEFF/, "")); }
        catch { throw new Error("NON_JSON_RESPONSE"); }
        receipt.fetchedAt = new Date().toISOString();
        this.cache.set(url, { expiresAt: Date.now() + ttlMs, value });
        return value;
      } catch (error) {
        receipt.errorCode = error instanceof Error ? error.message : "REQUEST_FAILED";
        throw new Error(`Taiwan provider ${receipt.errorCode} for ${url}`);
      } finally {
        this.receipts.set(url, receipt);
      }
    })();
    this.inFlight.set(url, request);
    try { return await request; } finally { this.inFlight.delete(url); }
  }
}

// The research pane and the inherited DataProvider share one transport/cache.
export const taiwanOfficialApi = new TaiwanApi();
export const taiwanNormalization = { asRows, codeOf, text, number, first, dateOnly, minguoMonthDate, minguoPeriodDate };

export class TaiwanDataProvider implements DataProvider {
  readonly id = TAIWAN_PROVIDER_ID;
  readonly name = "Taiwan Official Open Data";
  // Supported Taiwan targets should exercise the official adapter first;
  // unsupported fields still traverse Gloom Cloud/Yahoo through the router.
  readonly priority = 50;
  private readonly api = taiwanOfficialApi;

  canProvide(ticker: string, exchange?: string): boolean {
    return !!targetFor(ticker, exchange);
  }

  private requireTarget(ticker: string, exchange?: string): TaiwanTarget {
    const target = targetFor(ticker, exchange);
    if (!target) throw new Error(`Taiwan official provider does not cover ${ticker}${exchange ? ` on ${exchange}` : ""}`);
    return target;
  }

  private async stockRows(target: TaiwanTarget, endpoint: string): Promise<JsonRecord[]> {
    return asRows(await this.api.json(apiPath(target.venue, endpoint)));
  }

  private async stockRow(target: TaiwanTarget, endpoint: string): Promise<JsonRecord> {
    const row = latestByDate((await this.stockRows(target, endpoint)).filter((candidate) => codeOf(candidate) === target.code));
    if (!row) throw new Error(`No ${target.venue} row for ${target.code} at ${endpoint}`);
    return row;
  }

  private async quoteForStock(target: TaiwanTarget): Promise<Quote> {
    const endpoint = target.venue === "TWSE" ? "exchangeReport/STOCK_DAY_ALL" : "tpex_mainboard_daily_close_quotes";
    const rows = await this.stockRows(target, endpoint);
    let row = rows.find((candidate) => codeOf(candidate) === target.code);
    if (target.venue === "TWSE") {
      // STOCK_DAY_ALL is an OpenAPI snapshot and can lag the exchange by a
      // session. The official per-symbol daily endpoint is still public and
      // supplies the current close, so use it for the quote while retaining
      // STOCK_DAY_ALL as the bulk/name fallback.
      const now = new Date();
      const monthUrl = `${TWSE_HISTORY}/exchangeReport/STOCK_DAY?response=json&date=${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}01&stockNo=${encodeURIComponent(target.code)}`;
      try {
        const root = await this.api.json(monthUrl);
        if (root && typeof root === "object") {
          const source = root as JsonRecord;
          const fields = Array.isArray(source.fields) ? source.fields.map(text) : [];
          const daily = Array.isArray(source.data) ? source.data : [];
          const dailyRows = daily
            .filter((value): value is unknown[] => Array.isArray(value))
            .map((values) => Object.fromEntries(fields.map((field, index) => [field, values[index]])) as JsonRecord)
            .filter((candidate) => parsedDate(candidate["日期"]));
          const latest = dailyRows.at(-1);
          if (latest) row = { ...latest, Code: target.code, Name: row?.["Name"] };
        }
      } catch {
        // Keep the OpenAPI quote if the legacy endpoint is temporarily down.
      }
    }
    if (!row) throw new Error(`No ${target.venue} quote for ${target.code}`);
    const price = number(first(row, ["ClosingPrice", "Close", "收盤價", "成交價"]));
    if (price == null) throw new Error(`No close price for ${target.symbol}`);
    const change = number(first(row, ["Change", "ChangePrice", "漲跌價差", "漲跌"]));
    const previousClose = change == null ? undefined : price - change;
    const timestamp = localSnapshotTimestamp(first(row, ["Date", "日期"]));
    const name = rowName(row);
    const shares = number(first(row, ["IssuedShares", "發行股數"]));
    return {
      symbol: target.symbol,
      instrumentType: target.code === "0050" ? "ETF" : "EQUITY",
      providerId: this.id,
      price,
      currency: "TWD",
      change: change ?? 0,
      changePercent: previousClose && previousClose !== 0 && change != null ? (change / previousClose) * 100 : 0,
      previousClose,
      regularClose: price,
      regularCloseSessionDate: dateOnly(first(row, ["Date", "日期"])),
      changeSessionDate: dateOnly(first(row, ["Date", "日期"])),
      marketCap: shares != null ? shares * price : undefined,
      volume: number(first(row, ["Volume", "TradingShares", "成交股數"])),
      name,
      lastUpdated: timestamp,
      exchangeName: target.venue,
      fullExchangeName: target.venue === "TWSE" ? "Taiwan Stock Exchange" : "Taipei Exchange",
      listingExchangeName: target.venue,
      listingExchangeFullName: target.venue === "TWSE" ? "Taiwan Stock Exchange" : "Taipei Exchange",
      marketState: "CLOSED",
      sessionConfidence: "explicit",
      dataSource: "delayed",
      provenance: {
        price: { providerId: this.id, dataSource: "delayed" },
        session: { providerId: this.id, dataSource: "delayed" },
        listing: { providerId: this.id, dataSource: "delayed" },
      },
      open: number(first(row, ["OpeningPrice", "Open", "開盤價"])),
      high: number(first(row, ["HighestPrice", "High", "最高價"])),
      low: number(first(row, ["LowestPrice", "Low", "最低價"])),
    };
  }

  private async futureRows(): Promise<JsonRecord[]> {
    return asRows(await this.api.json(`${TAIFEX_OPENAPI}/DailyMarketReportFut`));
  }

  private async futureRow(): Promise<JsonRecord> {
    const rows = (await this.futureRows()).filter((row) => text(row["Contract"]).toUpperCase() === "TX");
    const regular = rows.filter((row) => text(row["TradingSession"]) === "一般");
    const row = regular[0] ?? rows[0] ?? latestByDate(rows);
    if (!row) throw new Error("No TAIFEX TXF quote");
    return row;
  }

  private async quoteForFuture(): Promise<Quote> {
    const row = await this.futureRow();
    const price = taifexNumber(row, ["Last", "SettlementPrice"]);
    if (price == null) throw new Error("No TAIFEX TXF last price");
    const change = taifexNumber(row, ["Change", "漲跌"]);
    const previousClose = change == null ? undefined : price - change;
    const date = first(row, ["Date", "日期"]);
    return {
      symbol: "TX=F",
      instrumentType: "FUTURE",
      providerId: this.id,
      price,
      currency: "TWD",
      change: change ?? 0,
      changePercent: previousClose && change != null ? (change / previousClose) * 100 : 0,
      previousClose,
      regularClose: taifexNumber(row, ["SettlementPrice", "結算價"]),
      regularCloseSessionDate: dateOnly(date),
      changeSessionDate: dateOnly(date),
      volume: taifexNumber(row, ["Volume", "成交量"]),
      name: "臺股期貨",
      lastUpdated: localSnapshotTimestamp(date),
      exchangeName: "TAIFEX",
      fullExchangeName: "Taiwan Futures Exchange",
      listingExchangeName: "TAIFEX",
      listingExchangeFullName: "Taiwan Futures Exchange",
      marketState: "CLOSED",
      sessionConfidence: "explicit",
      dataSource: "delayed",
      provenance: {
        price: { providerId: this.id, dataSource: "delayed" },
        session: { providerId: this.id, dataSource: "delayed" },
        listing: { providerId: this.id, dataSource: "delayed" },
      },
      open: taifexNumber(row, ["Open", "開盤價"]),
      high: taifexNumber(row, ["High", "最高價"]),
      low: taifexNumber(row, ["Low", "最低價"]),
    };
  }

  async getQuote(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<Quote> {
    const target = this.requireTarget(ticker, exchange);
    if (target.kind === "future") return this.quoteForFuture();
    if (target.kind !== "stock") throw new Error(`Use getOptionsChain for ${target.symbol}`);
    return this.quoteForStock(target);
  }

  private async mopsRows(target: TaiwanTarget): Promise<MopsRows> {
    const prefix = target.venue === "TWSE" ? "opendata/" : "";
    const profileEndpoint = target.venue === "TWSE" ? "t187ap03_L" : "mopsfin_t187ap03_O";
    const revenueEndpoint = target.venue === "TWSE" ? "t187ap05_L" : "mopsfin_t187ap05_O";
    const incomeEndpoint = target.venue === "TWSE" ? "t187ap06_L_ci" : "mopsfin_t187ap06_O_ci";
    const balanceEndpoint = target.venue === "TWSE" ? "t187ap07_L_ci" : "mopsfin_t187ap07_O_ci";
    const [profileRaw, revenueRaw, incomeRaw, balanceRaw] = await Promise.all([
      this.api.json(`${target.venue === "TWSE" ? TWSE_OPENAPI : TPEX_OPENAPI}/${prefix}${profileEndpoint}`),
      this.api.json(`${target.venue === "TWSE" ? TWSE_OPENAPI : TPEX_OPENAPI}/${prefix}${revenueEndpoint}`),
      this.api.json(`${target.venue === "TWSE" ? TWSE_OPENAPI : TPEX_OPENAPI}/${prefix}${incomeEndpoint}`),
      this.api.json(`${target.venue === "TWSE" ? TWSE_OPENAPI : TPEX_OPENAPI}/${prefix}${balanceEndpoint}`),
    ]);
    const profileRows = asRows(profileRaw).filter((row) => codeOf(row) === target.code);
    const revenueRows = asRows(revenueRaw).filter((row) => codeOf(row) === target.code);
    return {
      profile: latestByDate(profileRows),
      revenue: latestByDate(revenueRows),
      income: mopsStatementRows(asRows(incomeRaw), target.code),
      balance: mopsStatementRows(asRows(balanceRaw), target.code),
    };
  }

  private async profileFor(target: TaiwanTarget): Promise<{ profile?: CompanyProfile; name?: string; shares?: number; industry?: string }> {
    const rows = await this.mopsRows(target);
    const row = rows.profile;
    if (!row) return {};
    const industry = text(first(row, ["產業別", "Industry"]));
    const name = rowName(row);
    return {
      profile: {
        industry: industry || undefined,
      },
      name,
      shares: number(first(row, ["已發行普通股數或TDR原股發行股數", "已發行普通股數或股本", "發行股數", "NumberOfSharesIssued", "IssueShares"])),
      industry,
    };
  }

  async getTickerFinancials(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<TickerFinancials> {
    const target = this.requireTarget(ticker, exchange);
    if (target.kind !== "stock") {
      return {
        ...(target.kind === "future" ? { quote: await this.getQuote(target.symbol, target.venue) } : {}),
        financialCurrency: "TWD",
        annualStatements: [],
        quarterlyStatements: [],
        priceHistory: [],
      };
    }

    const quote = await this.getQuote(target.symbol, target.venue);
    let profile: CompanyProfile | undefined;
    let name = quote.name;
    let issuedShares: number | undefined;
    let monthlyRevenue: JsonRecord | undefined;
    let statements: FinancialStatement[] = [];
    try {
      const [mops, identity] = await Promise.all([this.mopsRows(target), this.profileFor(target)]);
      monthlyRevenue = mops.revenue;
      profile = identity.profile;
      name = identity.name ?? name;
      issuedShares = identity.shares;
      statements = statementFromRows(mops.income, mops.balance);
    } catch {
      // A quote remains useful when one MOPS dataset is temporarily unavailable.
    }

    const latestRevenue = number(first(monthlyRevenue ?? {}, ["營業收入-當月營收", "Revenue"]));
    const priorYearRevenue = number(first(monthlyRevenue ?? {}, ["營業收入-去年當月營收", "RevenuePreviousYear"]));
    const revenueGrowth = latestRevenue != null && priorYearRevenue ? (latestRevenue / priorYearRevenue) - 1 : undefined;
    const latestStatement = statements.at(-1);
    const marketCap = issuedShares != null ? issuedShares * quote.price : quote.marketCap;
    const fundamentals = {
      financialCurrency: "TWD",
      fetchedAt: new Date().toISOString(),
      marketCap,
      marketCapCurrency: "TWD",
      revenue: latestRevenue ?? latestStatement?.totalRevenue,
      netIncome: latestStatement?.netIncome,
      eps: latestStatement?.eps,
      operatingMargin: latestStatement?.totalRevenue && latestStatement.operatingIncome != null
        ? latestStatement.operatingIncome / latestStatement.totalRevenue : undefined,
      profitMargin: latestStatement?.totalRevenue && latestStatement.netIncome != null
        ? latestStatement.netIncome / latestStatement.totalRevenue : undefined,
      revenueGrowth,
      sharesOutstanding: issuedShares,
    };
    const priceHistory = await this.getPriceHistory(target.symbol, target.venue, "1M").catch(() => []);
    return {
      quote: { ...quote, name, marketCap },
      financialCurrency: "TWD",
      fundamentals,
      profile,
      annualStatements: statements.filter((statement) => statement.date.endsWith("12-31")),
      quarterlyStatements: statements,
      priceHistory,
    };
  }

  async getPriceHistory(ticker: string, exchange = "", range: TimeRange, _context?: MarketDataRequestContext): Promise<PricePoint[]> {
    const target = this.requireTarget(ticker, exchange);
    if (target.kind !== "stock" || target.venue !== "TWSE") {
      throw new Error(`Official history spike currently covers TWSE daily history only: ${target.symbol}`);
    }
    const results: PricePoint[] = [];
    for (const { year, month } of monthStarts(rangeMonths(range))) {
      const date = `${year}${String(month).padStart(2, "0")}01`;
      const url = `${TWSE_HISTORY}/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(target.code)}`;
      try {
        results.push(...parseTwseHistoryRows(await this.api.json(url)));
      } catch {
        // A holiday/future month is not a provider failure for the rest of the range.
      }
    }
    const deduped = new Map(results.map((point) => [point.date.toISOString().slice(0, 10), point]));
    return [...deduped.values()].sort((left, right) => left.date.getTime() - right.date.getTime());
  }

  getChartResolutionSupport(): ChartResolutionSupport[] {
    return [{ resolution: "1d", maxRange: "ALL" }];
  }

  async getHolders(ticker: string, exchange = "", _context?: MarketDataRequestContext): Promise<HolderData> {
    const target = this.requireTarget(ticker, exchange);
    if (target.kind !== "stock") throw new Error(`TDCC holders only apply to stocks: ${target.symbol}`);
    const rows = asRows(await this.api.json(`${TDCC_OPENAPI}/opendata/1-5`, TDCC_CACHE_TTL_MS))
      .filter((row) => text(row["證券代號"]).trim() === target.code);
    if (!rows.length) throw new Error(`No TDCC distribution rows for ${target.code}`);
    const holders: HolderRecord[] = rows.map((row) => ({
      providerId: this.id,
      ownerType: "direct",
      name: `持股分級 ${text(row["持股分級"])}`,
      reportDate: dateOnly(row["\uFEFF資料日期"] ?? row["資料日期"]),
      shares: number(row["股數"]),
      percentHeld: percent(row["占集保庫存數比例%"]),
    }));
    return {
      providerId: this.id,
      symbol: target.symbol,
      name: rows[0] ? text(rows[0]["證券名稱"]) || undefined : undefined,
      currency: "TWD",
      exchange: target.venue,
      asOf: holders.map((holder) => holder.reportDate ?? "").sort().at(-1) || undefined,
      holders,
    };
  }

  private async optionRows(): Promise<{ market: TaifexOptionRow[]; delta: JsonRecord[] }> {
    const [marketRaw, deltaRaw] = await Promise.all([
      this.api.json(`${TAIFEX_OPENAPI}/DailyMarketReportOpt`),
      this.api.json(`${TAIFEX_OPENAPI}/DailyOptionsDelta`),
    ]);
    const delta = asRows(deltaRaw);
    const market = asRows(marketRaw).filter((row) => text(row["Contract"]).toUpperCase() === "TXO").map((row) => ({ ...row }));
    const deltas = delta.filter((row) => text(row["Contract"]).toUpperCase() === "TXO");
    const deltaKey = (row: JsonRecord) => [
      text(row["Contract"]), text(row["ContractMonth(Week)"]), text(row["StrikePrice"]), text(row["CallPut"]),
    ].join("|");
    const deltaMap = new Map(deltas.map((row) => [deltaKey(row), row]));
    for (const row of market) {
      const deltaRow = deltaMap.get(deltaKey(row));
      const expiry = optionExpiry(first(deltaRow ?? {}, ["ContractSettlementDay", "履約日"]))
        ?? optionExpiry(first(row, ["ContractMonth(Week)"]));
      if (expiry) {
        row.__expiry = expiry.timestamp;
        row.__expiryText = expiry.text;
      }
    }
    return { market, delta };
  }

  async getOptionsChain(ticker: string, _exchange = "", expirationDate?: number, _context?: MarketDataRequestContext): Promise<OptionsChain> {
    const target = this.requireTarget(ticker, "TAIFEX");
    if (target.kind !== "option") throw new Error(`TAIFEX option chain expects TXO, received ${ticker}`);
    const { market } = await this.optionRows();
    const current = await this.quoteForFuture().catch(() => undefined);
    const asOf = latestTaifexDate(market);
    const contracts: OptionContract[] = [];
    const expiryDates = new Set<number>();
    for (const row of market) {
      if (row.__expiry == null || (expirationDate != null && row.__expiry !== expirationDate)) continue;
      const side = optionSide(row["CallPut"]);
      const strike = taifexNumber(row, ["StrikePrice", "履約價"]);
      if (!side || strike == null) continue;
      const lastPrice = currentOptionPrice(row);
      const inTheMoney = current?.price != null
        ? side === "C" ? current.price > strike : current.price < strike
        : false;
      expiryDates.add(row.__expiry);
      contracts.push({
        contractSymbol: `TXO-${text(row["ContractMonth(Week)"])}-${side}-${strike}`,
        strike,
        currency: "TWD",
        lastPrice,
        change: 0,
        percentChange: 0,
        volume: taifexNumber(row, ["Volume", "成交量"]),
        openInterest: taifexNumber(row, ["OpenInterest", "未平倉量"]),
        bid: taifexNumber(row, ["BestBid", "最佳買價"]) ?? 0,
        ask: taifexNumber(row, ["BestAsk", "最佳賣價"]) ?? 0,
        impliedVolatility: 0,
        inTheMoney,
        expiration: row.__expiry,
        lastTradeDate: localSnapshotTimestamp(row["Date"]),
      });
    }
    return {
      underlyingSymbol: "TXO",
      expirationDates: [...expiryDates].sort((left, right) => left - right),
      calls: contracts.filter((contract) => contract.contractSymbol.includes("-C-")),
      puts: contracts.filter((contract) => contract.contractSymbol.includes("-P-")),
      providerId: this.id,
      dataSource: "delayed",
      asOf: asOf ? `${asOf}T08:00:00.000Z` : new Date().toISOString(),
    };
  }

  async search(query: string, _context?: SearchRequestContext): Promise<InstrumentSearchResult[]> {
    const raw = text(query).toUpperCase();
    if (!/^\d{4,6}(?:\.(?:TW|TWO))?$/.test(raw)) return [];
    const target = targetFor(raw);
    if (!target) return [];
    try {
      const profile = await this.profileFor(target);
      return [{
        providerId: this.id,
        symbol: target.symbol,
        name: profile.name ?? target.symbol,
        exchange: target.venue,
        type: target.code === "0050" ? "ETF" : "EQUITY",
        currency: "TWD",
        primaryExchange: target.venue,
      }];
    } catch {
      return [];
    }
  }

  async getExchangeRate(fromCurrency: string): Promise<number> {
    if (text(fromCurrency).toUpperCase() === "USD") return 1;
    throw new Error("Taiwan official provider does not provide FX rates in this spike");
  }

  async getArticleSummary(_url: string): Promise<string | null> {
    return null;
  }
}

export const taiwanDataProvider = new TaiwanDataProvider();
