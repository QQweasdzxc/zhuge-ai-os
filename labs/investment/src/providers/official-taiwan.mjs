import { makeEvidence, unavailableEvidence } from "../lib/contract.mjs";
import { fetchCached, ProviderError } from "../lib/http-cache.mjs";
import { first, monthStarts, normalizeDate, number, rows, staleByCalendarDays, text } from "../lib/normalize.mjs";
import { calculateIndicators } from "../domain/indicators.mjs";

export const SYMBOLS = Object.freeze([
  { symbol: "2330.TW", code: "2330", venue: "TWSE", instrumentType: "個股", displayName: "台積電" },
  { symbol: "0050.TW", code: "0050", venue: "TWSE", instrumentType: "ETF", displayName: "元大台灣50" },
  { symbol: "6488.TWO", code: "6488", venue: "TPEx", instrumentType: "個股", displayName: "環球晶" },
]);

const BASE = Object.freeze({
  twseOpen: "https://openapi.twse.com.tw/v1",
  twseWeb: "https://www.twse.com.tw",
  tpexOpen: "https://www.tpex.org.tw/openapi/v1",
  tdccOpen: "https://openapi.tdcc.com.tw/v1",
  taifexOpen: "https://openapi.taifex.com.tw/v1",
});

const API = Object.freeze({
  twseQuotes: `${BASE.twseOpen}/exchangeReport/STOCK_DAY_ALL`,
  tpexQuotes: `${BASE.tpexOpen}/tpex_mainboard_daily_close_quotes`,
  twseProfile: `${BASE.twseOpen}/opendata/t187ap03_L`,
  tpexProfile: `${BASE.tpexOpen}/mopsfin_t187ap03_O`,
  twseRevenue: `${BASE.twseOpen}/opendata/t187ap05_L`,
  tpexRevenue: `${BASE.tpexOpen}/mopsfin_t187ap05_O`,
  twseIncome: `${BASE.twseOpen}/opendata/t187ap06_L_ci`,
  tpexIncome: `${BASE.tpexOpen}/mopsfin_t187ap06_O_ci`,
  twseBalance: `${BASE.twseOpen}/opendata/t187ap07_L_ci`,
  tpexBalance: `${BASE.tpexOpen}/mopsfin_t187ap07_O_ci`,
  tdccHolders: `${BASE.tdccOpen}/opendata/1-5`,
  twseMargin: `${BASE.twseOpen}/exchangeReport/MI_MARGN`,
  tpexMargin: `${BASE.tpexOpen}/tpex_mainboard_margin_balance`,
  tpexInstitutional: `${BASE.tpexOpen}/tpex_3insti_daily_trading`,
  taifexFutures: `${BASE.taifexOpen}/DailyMarketReportFut`,
  twseNotices: `${BASE.twseOpen}/opendata/t187ap04_L`,
  tpexNotices: `${BASE.tpexOpen}/mopsfin_t187ap04_O`,
});

const ttl = Object.freeze({ quote: 30_000, list: 60_000, history: 30 * 60_000, mops: 10 * 60_000, tdcc: 10 * 60_000, derivatives: 30_000 });

function symbolInfo(value) {
  const raw = text(value).toUpperCase();
  const found = SYMBOLS.find((item) => item.symbol === raw || item.code === raw);
  if (!found) throw new ProviderError("SYMBOL_NOT_FOUND");
  return found;
}

function dateFromRow(row, keys = ["Date", "日期", "資料日期", "出表日期"]) {
  return normalizeDate(first(row, keys));
}

function evidenceFromResult({ result, provider, source, data, dataTimestamp, note, staleDays = 5, partial = false, status = null }) {
  return makeEvidence({
    status: status ?? (data == null ? "UNAVAILABLE" : partial ? "PARTIAL" : "AVAILABLE"),
    dataTruth: result?.fallback ? "FALLBACK" : "OFFICIAL",
    provider,
    source,
    dataTimestamp,
    fetchedAt: result?.fetchedAt ?? null,
    stale: staleByCalendarDays(dataTimestamp, staleDays),
    delayed: true,
    fallback: result?.fallback ?? false,
    attribution: provider,
    license: "以來源機關各資料集與使用條款為準；本 Lab 僅呈現公開讀取結果，不提供雲端再散布。",
    note,
    errorCode: result?.errorCode ?? null,
    data,
  });
}

async function getJson(url, ttlMs) {
  return fetchCached(url, { ttlMs, timeoutMs: 15_000 });
}

async function fetchEvidence(url, provider, ttlMs, mapper, note, staleDays = 5) {
  try {
    const result = await getJson(url, ttlMs);
    const mapped = mapper(result.value, result);
    if (!mapped || mapped.data == null) {
      return evidenceFromResult({ result, provider, source: [url], data: null, dataTimestamp: null, note: mapped?.note ?? note, staleDays, status: mapped?.status });
    }
    return evidenceFromResult({ result, provider, source: [url], data: mapped.data, dataTimestamp: mapped.dataTimestamp, note: mapped.note ?? note, staleDays, partial: mapped.partial, status: mapped.status });
  } catch (error) {
    return unavailableEvidence(provider, [url], error?.code ?? "PROVIDER_READ_FAILED", note);
  }
}

function lookupQuoteRow(payload, item) {
  const sourceRows = rows(payload);
  const row = item.venue === "TWSE"
    ? sourceRows.find((candidate) => text(candidate.Code) === item.code)
    : sourceRows.find((candidate) => text(candidate.SecuritiesCompanyCode) === item.code);
  if (!row) return null;
  const close = number(item.venue === "TWSE" ? row.ClosingPrice : row.Close);
  const date = dateFromRow(row);
  if (close == null || !date) return null;
  return {
    date,
    name: text(item.venue === "TWSE" ? row.Name : row.CompanyName) || item.displayName,
    close,
    change: number(row.Change),
    changePercent: null,
    volume: number(item.venue === "TWSE" ? row.TradeVolume : row.TradingShares),
    open: number(item.venue === "TWSE" ? row.OpeningPrice : row.Open),
    high: number(item.venue === "TWSE" ? row.HighestPrice : row.High),
    low: number(item.venue === "TWSE" ? row.LowestPrice : row.Low),
    instrumentType: item.instrumentType,
  };
}

export async function loadQuote(value) {
  const item = symbolInfo(value);
  const url = item.venue === "TWSE" ? API.twseQuotes : API.tpexQuotes;
  try {
    const result = await getJson(url, ttl.quote);
    const quote = lookupQuoteRow(result.value, item);
    if (!quote) return evidenceFromResult({ result, provider: item.venue, source: [url], data: null, dataTimestamp: null, note: "官方日收資料尚未包含此代碼或欄位格式改變。", status: "UNAVAILABLE" });
    const changePercent = quote.change != null && quote.close - quote.change !== 0
      ? quote.change / (quote.close - quote.change) * 100
      : null;
    return evidenceFromResult({
      result,
      provider: item.venue,
      source: [url],
      data: { ...quote, changePercent },
      dataTimestamp: quote.date,
      note: "官方最新可得收盤資料；不是盤中即時報價。漲跌幅依同列官方收盤與漲跌欄位計算。",
      staleDays: 5,
      partial: changePercent == null,
    });
  } catch (error) {
    return unavailableEvidence(item.venue, [url], error?.code ?? "PROVIDER_READ_FAILED", "官方收盤資料暫時無法讀取；不以其他來源填補。" );
  }
}

function normalizeHistoryRow(row) {
  if (Array.isArray(row)) {
    const date = normalizeDate(row[0]);
    if (!date) return null;
    return { date, volume: number(row[1]), transactionValue: number(row[2]), open: number(row[3]), high: number(row[4]), low: number(row[5]), close: number(row[6]) };
  }
  const date = dateFromRow(row, ["日期", "Date"]);
  if (!date) return null;
  return {
    date,
    volume: number(first(row, ["成交股數", "TradeVolume", "volume"])),
    transactionValue: number(first(row, ["成交金額", "TradeValue"])),
    open: number(first(row, ["開盤價", "OpeningPrice", "open"])),
    high: number(first(row, ["最高價", "HighestPrice", "high"])),
    low: number(first(row, ["最低價", "LowestPrice", "low"])),
    close: number(first(row, ["收盤價", "ClosingPrice", "close"])),
  };
}

export async function loadHistory(value) {
  const item = symbolInfo(value);
  if (item.venue !== "TWSE") {
    return makeEvidence({
      status: "NOT_CONNECTED", dataTruth: "NOT_CONNECTED", provider: "TPEx",
      source: ["https://www.tpex.org.tw/"], stale: null, delayed: true,
      note: "官方最新收盤已接入；6488 官方歷史機器查詢尚未完成相容性驗證，因此技術指標不以 Yahoo 或其他歷史資料補空。",
      errorCode: "HISTORY_NOT_CONNECTED",
    });
  }
  const dates = monthStarts(3);
  const sources = dates.map((date) => `${BASE.twseWeb}/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${item.code}`);
  const results = await Promise.allSettled(sources.map((url) => fetchCached(url, { ttlMs: ttl.history, timeoutMs: 15_000 })));
  const bars = [];
  let fetchedAt = null;
  let failureCount = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") {
      failureCount += 1;
      continue;
    }
    fetchedAt = [fetchedAt, result.value.fetchedAt].filter(Boolean).sort().at(-1) ?? null;
    const responseRows = rows(result.value.value);
    for (const row of responseRows) {
      const normalized = normalizeHistoryRow(row);
      if (normalized?.close != null) bars.push(normalized);
    }
  }
  const unique = [...new Map(bars.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const dataTimestamp = unique.at(-1)?.date ?? null;
  return makeEvidence({
    status: !unique.length ? "UNAVAILABLE" : failureCount ? "PARTIAL" : "AVAILABLE",
    dataTruth: "OFFICIAL",
    provider: "TWSE",
    source: sources,
    dataTimestamp,
    fetchedAt,
    stale: staleByCalendarDays(dataTimestamp, 5),
    delayed: true,
    fallback: false,
    note: "最近三個日曆月官方日 OHLCV；未還原除權息／分割，不作績效回測。",
    errorCode: !unique.length ? "HISTORY_NOT_CONNECTED" : failureCount ? "HISTORY_MONTH_PARTIAL" : null,
    data: unique.length ? unique : null,
  });
}

function mopsEndpoint(item, kind) {
  if (!["profile", "revenue", "income", "balance", "notices"].includes(kind)) {
    throw new ProviderError("UNSUPPORTED_DATASET");
  }
  const base = item.venue === "TPEx" ? BASE.tpexOpen : `${BASE.twseOpen}/opendata`;
  const names = {
    profile: item.venue === "TPEx" ? "mopsfin_t187ap03_O" : "t187ap03_L",
    revenue: item.venue === "TPEx" ? "mopsfin_t187ap05_O" : "t187ap05_L",
    income: item.venue === "TPEx" ? "mopsfin_t187ap06_O_ci" : "t187ap06_L_ci",
    balance: item.venue === "TPEx" ? "mopsfin_t187ap07_O_ci" : "t187ap07_L_ci",
    notices: item.venue === "TPEx" ? "mopsfin_t187ap04_O" : "t187ap04_L",
  };
  return `${base}/${names[kind]}`;
}

function mopsRow(payload, item) {
  return rows(payload).find((row) => text(first(row, ["公司代號", "證券代號", "CompanyCode"])) === item.code) ?? null;
}

function sourceOrUnavailable(item, url, kind) {
  return makeEvidence({
    status: "NOT_APPLICABLE", dataTruth: "NOT_CONNECTED", provider: "MOPS", source: [url],
    delayed: true, stale: null, errorCode: "ETF_COMPANY_DATA_NOT_APPLICABLE",
    note: kind === "profile"
      ? "0050 是 ETF，不適用營運公司基本資料；基金成分、持股權重與淨值尚未接入。"
      : "0050 是 ETF，不適用營運公司月營收或財報；基金持股、配息與淨值尚未接入。",
  });
}

export async function loadMops(value, kind) {
  const item = symbolInfo(value);
  const url = mopsEndpoint(item, kind);
  if (item.instrumentType === "ETF" && ["profile", "revenue", "income", "balance"].includes(kind)) return sourceOrUnavailable(item, url, kind);
  try {
    const result = await fetchCached(url, { ttlMs: ttl.mops, timeoutMs: 15_000 });
    const row = mopsRow(result.value, item);
    if (!row) return evidenceFromResult({ result, provider: "MOPS", source: [url], data: null, dataTimestamp: null, note: "官方揭露資料表未找到此標的；不以替代資料補空。" });
    const published = normalizeDate(first(row, ["出表日期", "Date"]));
    if (kind === "profile") {
      return evidenceFromResult({ result, provider: "MOPS", source: [url], data: {
        name: text(first(row, ["公司名稱", "CompanyName"])) || null,
        industry: text(first(row, ["產業別", "Industry"])) || null,
        business: text(first(row, ["主要經營業務", "Description"])) || null,
        venue: item.venue,
      }, dataTimestamp: published, note: "公司基本資料；產業欄位保留官方原文，不推測轉換代碼。", staleDays: 90 });
    }
    if (kind === "revenue") {
      const periodRaw = text(first(row, ["資料年月", "RevenueMonth"]));
      const match = /^(\d{2,3})(\d{2})$/.exec(periodRaw);
      const period = match ? `${Number(match[1]) + 1911}-${match[2]}` : null;
      const data = {
        period,
        amountThousandTwd: number(first(row, ["營業收入-當月營收", "Revenue"])),
        previousMonthThousandTwd: number(first(row, ["營業收入-上月營收", "RevenueLastMonth"])),
        previousYearThousandTwd: number(first(row, ["營業收入-去年當月營收", "RevenueLastYear"])),
        monthOverMonthPercent: number(first(row, ["營業收入-上月比較增減(%)", "RevenueLastMonthPercentage"])),
        yearOverYearPercent: number(first(row, ["營業收入-去年同月增減(%)", "RevenueLastYearPercentage"])),
        unit: "新台幣千元",
      };
      return evidenceFromResult({ result, provider: "MOPS", source: [url], data, dataTimestamp: period ? `${period}-28` : published, note: "最新可得月營收；來源日期使用資料年月，金額單位為新台幣千元。", staleDays: 75, partial: data.amountThousandTwd == null });
    }

    const year = number(first(row, ["年度", "Year"]));
    const quarter = number(first(row, ["季別", "Season"]));
    const actualYear = year != null && year < 1911 ? year + 1911 : year;
    const period = actualYear && quarter ? `${actualYear}-${String(quarter * 3).padStart(2, "0")}` : published?.slice(0, 7) ?? null;
    const data = kind === "income" ? {
      period,
      scope: "年初至本季累計（非單季）",
      unit: "新台幣千元；EPS 為元",
      revenueThousandTwd: number(first(row, ["營業收入", "Revenue"])),
      grossProfitThousandTwd: number(first(row, ["營業毛利（毛損）淨額", "營業毛利（毛損）", "GrossProfit"])),
      operatingIncomeThousandTwd: number(first(row, ["營業利益（損失）", "營業利益", "OperatingIncome"])),
      netIncomeThousandTwd: number(first(row, ["本期淨利（淨損）", "NetIncome"])),
      eps: number(first(row, ["基本每股盈餘（元）", "EPS"])),
    } : {
      period,
      scope: "期末餘額（非期間流量）",
      unit: "新台幣千元",
      assetsThousandTwd: number(first(row, ["資產總計", "資產總額", "TotalAssets"])),
      liabilitiesThousandTwd: number(first(row, ["負債總計", "負債總額", "TotalLiabilities"])),
      equityThousandTwd: number(first(row, ["權益總額", "權益總計", "TotalEquity"])),
    };
    const valuePresent = Object.entries(data).some(([key, field]) => key !== "period" && key !== "scope" && key !== "unit" && field != null);
    return evidenceFromResult({ result, provider: "MOPS", source: [url], data: valuePresent ? data : null, dataTimestamp: period ? `${period}-30` : published, note: kind === "income" ? "最新可得損益；數字是年初至本季累計，不是單季。" : "最新可得資產負債；數字為期末存量，不是期間流量。", staleDays: 160, partial: !valuePresent });
  } catch (error) {
    return unavailableEvidence("MOPS", [url], error?.code ?? "PROVIDER_READ_FAILED", "MOPS 官方資料暫時無法讀取。" );
  }
}

export async function loadHolders(value) {
  const item = symbolInfo(value);
  try {
    const result = await fetchCached(API.tdccHolders, { ttlMs: ttl.tdcc, timeoutMs: 20_000 });
    const matching = rows(result.value).filter((row) => text(first(row, ["證券代號", "股票代號"])) === item.code);
    if (!matching.length) return evidenceFromResult({ result, provider: "TDCC", source: [API.tdccHolders], data: null, dataTimestamp: null, note: "集保股權分級資料未找到此代碼。" });
    const date = normalizeDate(first(matching[0], ["資料日期", "\uFEFF資料日期"]));
    const data = matching.map((row) => ({
      band: text(first(row, ["持股分級"])),
      holders: number(first(row, ["人數"])),
      shares: number(first(row, ["股數"])),
      percent: number(first(row, ["占集保庫存數比例%"])),
    }));
    return evidenceFromResult({ result, provider: "TDCC", source: [API.tdccHolders], data, dataTimestamp: date, note: "每週集保戶股權分散級距；不是法人名單，也不能直接視為大戶進出。第16級為差異數，第17級為合計。", staleDays: 14, partial: !date });
  } catch (error) {
    return unavailableEvidence("TDCC", [API.tdccHolders], error?.code ?? "PROVIDER_READ_FAILED", "集保股權分級資料暫時無法讀取。" );
  }
}

function arrayRowObject(fields, record) {
  if (!Array.isArray(record)) return record;
  return Object.fromEntries((fields ?? []).slice(0, record.length).map((field, index) => [field, record[index]]));
}

export async function loadInstitutional(value, tradeDate = null) {
  const item = symbolInfo(value);
  if (item.venue === "TWSE") {
    const queryDate = (tradeDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date())).replace(/-/g, "");
    const url = `${BASE.twseWeb}/fund/T86?response=json&date=${queryDate}&selectType=ALLBUT0999`;
    try {
      const result = await getJson(url, 30 * 60_000);
      const match = rows(result.value?.data).map((record) => arrayRowObject(result.value.fields, record))
        .find((row) => text(first(row, ["證券代號"])) === item.code);
      if (!match) return evidenceFromResult({ result, provider: "TWSE", source: [url], data: null, dataTimestamp: normalizeDate(result.value?.date), note: "TWSE 三大法人資料未找到此標的或該交易日尚未發布。" });
      const data = {
        foreignNetShares: number(first(match, ["外陸資買賣超股數(不含外資自營商)"])),
        trustNetShares: number(first(match, ["投信買賣超股數"])),
        dealerNetShares: number(first(match, ["自營商買賣超股數"])),
        allThreeNetShares: number(first(match, ["三大法人買賣超股數"])),
      };
      return evidenceFromResult({ result, provider: "TWSE", source: [url], data, dataTimestamp: normalizeDate(result.value?.date) ?? queryDate, note: "官方三大法人日買賣超股數；是當日交易流量，不是法人持股名單。", staleDays: 5, partial: Object.values(data).some((entry) => entry == null) });
    } catch (error) {
      return unavailableEvidence("TWSE", [url], error?.code ?? "PROVIDER_READ_FAILED", "三大法人資料暫時無法讀取。" );
    }
  }

  const url = API.tpexInstitutional;
  try {
    const result = await getJson(url, ttl.list);
    const match = rows(result.value).filter((row) => text(row.SecuritiesCompanyCode) === item.code)
      .sort((a, b) => String(b.Date).localeCompare(String(a.Date)))[0];
    if (!match) return evidenceFromResult({ result, provider: "TPEx", source: [url], data: null, dataTimestamp: null, note: "TPEx 三大法人資料未找到此標的。" });
    const date = normalizeDate(match.Date);
    const data = {
      foreignNetShares: number(first(match, ["ForeignInvestorsIncludeMainlandAreaInvestors-Difference", "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference"])),
      trustNetShares: number(first(match, ["SecuritiesInvestmentTrustCompanies-Difference"])),
      dealerNetShares: number(first(match, ["Dealers-Difference", "DealersDifference"])),
    };
    return evidenceFromResult({ result, provider: "TPEx", source: [url], data, dataTimestamp: date, note: "官方三大法人日買賣超股數；資料欄位保留交易所定義，不推論機構持倉。", staleDays: 5, partial: Object.values(data).some((entry) => entry == null) });
  } catch (error) {
    return unavailableEvidence("TPEx", [url], error?.code ?? "PROVIDER_READ_FAILED", "三大法人資料暫時無法讀取。" );
  }
}

export async function loadMargin(value) {
  const item = symbolInfo(value);
  const url = item.venue === "TWSE" ? API.twseMargin : API.tpexMargin;
  return fetchEvidence(url, item.venue, ttl.list, (payload, result) => {
    const row = rows(payload).find((candidate) => text(first(candidate, item.venue === "TWSE" ? ["股票代號"] : ["SecuritiesCompanyCode"])) === item.code);
    if (!row) return { data: null, note: "官方融資融券表未找到此標的。" };
    const data = item.venue === "TWSE" ? {
      marginBalancePrevious: number(first(row, ["融資前日餘額"])),
      marginBalance: number(first(row, ["融資今日餘額"])),
      shortBalancePrevious: number(first(row, ["融券前日餘額"])),
      shortBalance: number(first(row, ["融券今日餘額"])),
      unit: "交易所表列股數",
    } : {
      marginBalancePrevious: number(first(row, ["MarginPurchaseBalancePreviousDay"])),
      marginBalance: number(first(row, ["MarginPurchaseBalance"])),
      shortBalancePrevious: number(first(row, ["ShortSaleBalancePreviousDay"])),
      shortBalance: number(first(row, ["ShortSaleBalance"])),
      unit: "交易所表列股數",
    };
    const date = normalizeDate(first(row, ["Date", "日期", "資料日期"])) ?? normalizeDate(result.value?.date);
    return { data, dataTimestamp: date, note: "官方融資融券餘額；融資與融券分開呈現，不混用金額與股數。", partial: !date || Object.values(data).slice(0, 4).some((entry) => entry == null) };
  }, "融資融券官方表暫時無法讀取。", 5);
}

export async function loadAnnouncements(value) {
  const item = symbolInfo(value);
  if (item.instrumentType === "ETF") {
    return makeEvidence({ status: "NOT_APPLICABLE", dataTruth: "NOT_CONNECTED", provider: "MOPS", source: [mopsEndpoint(item, "notices")], delayed: true, note: "ETF 不適用單一營運公司重大訊息；基金公告尚未接入。", errorCode: "ETF_ISSUER_NOTICES_NOT_CONNECTED" });
  }
  const url = mopsEndpoint(item, "notices");
  try {
    const result = await fetchCached(url, { ttlMs: ttl.mops, timeoutMs: 15_000 });
    const data = rows(result.value).filter((row) => text(first(row, ["公司代號", "證券代號"])) === item.code)
      .map((row) => ({
        date: normalizeDate(first(row, ["發言日期", "出表日期", "Date"])),
        time: text(first(row, ["發言時間"])),
        title: text(first(row, ["主旨", "主旨 ", "Subject"])),
        source: "MOPS 重大訊息",
      }))
      .filter((entry) => entry.title)
      .sort((a, b) => `${b.date ?? ""} ${b.time}`.localeCompare(`${a.date ?? ""} ${a.time}`))
      .slice(0, 8);
    const date = data[0]?.date ?? normalizeDate(result.value?.date);
    return evidenceFromResult({ result, provider: "MOPS", source: [url], data, dataTimestamp: date, note: "官方重大訊息，不等同媒體新聞或獨立查證結論。標題連回資料來源；不推論公告內容真偽。", staleDays: 30, partial: !data.length });
  } catch (error) {
    return unavailableEvidence("MOPS", [url], error?.code ?? "PROVIDER_READ_FAILED", "官方公告暫時無法讀取。" );
  }
}

export async function loadFuturesNight() {
  const url = API.taifexFutures;
  try {
    const result = await getJson(url, ttl.derivatives);
    const candidates = rows(result.value).filter((row) => text(row.Contract) === "TX" && text(row.TradingSession) === "盤後");
    candidates.sort((a, b) => `${b.Date ?? ""}:${b["ContractMonth(Week)"] ?? ""}`.localeCompare(`${a.Date ?? ""}:${a["ContractMonth(Week)"] ?? ""}`));
    const row = candidates[0];
    if (!row) return evidenceFromResult({ result, provider: "TAIFEX", source: [url], data: null, dataTimestamp: null, note: "官方報表目前沒有臺指期盤後資料。" });
    const date = normalizeDate(row.Date);
    return evidenceFromResult({ result, provider: "TAIFEX", source: [url], data: {
      contract: text(row.Contract), contractMonth: text(row["ContractMonth(Week)"]),
      last: number(row.Last), change: number(row.Change), changePercent: number(text(row["%"]).replace(/%$/, "")),
      volume: number(row.Volume), openInterest: number(row.OpenInterest), session: text(row.TradingSession),
    }, dataTimestamp: date, note: "臺指期官方盤後日報；延遲日資料，不是即時夜盤串流，也不是個股訊號。", staleDays: 5, partial: number(row.Last) == null });
  } catch (error) {
    return unavailableEvidence("TAIFEX", [url], error?.code ?? "PROVIDER_READ_FAILED", "臺指期盤後官方日報暫時無法讀取。" );
  }
}

async function loadMarketIndex() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const monthStart = `${year}${month}01`;
  const url = `${BASE.twseWeb}/rwd/zh/afterTrading/FMTQIK?response=json&date=${monthStart}`;
  try {
    const result = await getJson(url, 30 * 60_000);
    const candidates = rows(result.value?.data).map((row) => Array.isArray(row)
      ? { date: normalizeDate(row[0]), volume: number(row[1]), value: number(row[2]), trades: number(row[3]), index: number(row[4]), change: number(row[5]) }
      : null).filter((row) => row?.date).sort((a, b) => a.date.localeCompare(b.date));
    const row = candidates.at(-1);
    if (!row) return unavailableEvidence("TWSE", [url], "EMPTY_RESPONSE", "本月加權指數日資料目前沒有可用列。" );
    return evidenceFromResult({ result, provider: "TWSE", source: [url], data: row, dataTimestamp: row.date, note: "發行量加權股價指數日資料；每日收盤統計，不是盤中即時行情。", staleDays: 5 });
  } catch (error) {
    return unavailableEvidence("TWSE", [url], error?.code ?? "PROVIDER_READ_FAILED", "加權指數日資料暫時無法讀取。" );
  }
}

async function loadTwseInstitutionalMarket(date) {
  const dateKey = String(date ?? "").replace(/-/g, "");
  if (!/^\d{8}$/.test(dateKey)) return makeEvidence({ status: "NOT_CONNECTED", dataTruth: "NOT_CONNECTED", provider: "TWSE", note: "尚無可對齊的官方交易日，無法彙總三大法人。", errorCode: "NO_ALIGNED_TRADE_DATE" });
  const url = `${BASE.twseWeb}/fund/T86?response=json&date=${dateKey}&selectType=ALLBUT0999`;
  try {
    const result = await getJson(url, 30 * 60_000);
    const fields = result.value?.fields ?? [];
    const dataRows = rows(result.value?.data).map((row) => arrayRowObject(fields, row));
    const sumField = (label) => {
      const values = dataRows.map((row) => number(row[label])).filter(Number.isFinite);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const data = {
      foreignNetShares: sumField("外陸資買賣超股數(不含外資自營商)"),
      trustNetShares: sumField("投信買賣超股數"),
      dealerNetShares: sumField("自營商買賣超股數"),
      allThreeNetShares: sumField("三大法人買賣超股數"),
      securitiesRows: dataRows.length,
    };
    const complete = Object.entries(data).filter(([key]) => key !== "securitiesRows").every(([, value]) => value != null);
    return evidenceFromResult({ result, provider: "TWSE", source: [url], data: complete ? data : null, dataTimestamp: normalizeDate(result.value?.date) ?? date, note: "依 TWSE T86 當日上市證券逐標的彙總；含 ETF，不等同交易所另行發布的市場分類總表。", staleDays: 5, partial: !complete });
  } catch (error) {
    return unavailableEvidence("TWSE", [url], error?.code ?? "PROVIDER_READ_FAILED", "上市三大法人日資料暫時無法讀取。" );
  }
}

async function loadMarketBreadth() {
  const sources = [API.twseQuotes, API.tpexQuotes];
  try {
    const [twse, tpex] = await Promise.all([getJson(sources[0], ttl.quote), getJson(sources[1], ttl.quote)]);
    const parsed = [
      ...rows(twse.value).map((row) => ({ date: dateFromRow(row), change: number(row.Change), venue: "TWSE" })),
      ...rows(tpex.value).map((row) => ({ date: dateFromRow(row), change: number(row.Change), venue: "TPEx" })),
    ].filter((row) => row.date && row.change != null);
    if (!parsed.length) return makeEvidence({ status: "UNAVAILABLE", dataTruth: "UNAVAILABLE", provider: "TWSE / TPEx", source: sources, note: "官方報價表沒有可計算的變動欄位。", errorCode: "SOURCE_SCHEMA_CHANGED" });
    const date = parsed.map((row) => row.date).sort().at(-1);
    const aligned = parsed.filter((row) => row.date === date);
    const data = {
      up: aligned.filter((row) => row.change > 0).length,
      down: aligned.filter((row) => row.change < 0).length,
      flat: aligned.filter((row) => row.change === 0).length,
      rows: aligned.length,
      includesEtf: true,
    };
    return makeEvidence({ status: "AVAILABLE", dataTruth: "OFFICIAL", provider: "TWSE / TPEx", source: sources, dataTimestamp: date,
      fetchedAt: [twse.fetchedAt, tpex.fetchedAt].sort().at(-1), stale: staleByCalendarDays(date, 5), delayed: true,
      fallback: false, note: "依兩交易所當日收盤報價漲跌欄位計數（含 ETF）；不是依市值加權的廣度指標。", data });
  } catch (error) {
    return unavailableEvidence("TWSE / TPEx", sources, error?.code ?? "PROVIDER_READ_FAILED", "上市櫃官方日收漲跌分布暫時無法讀取。" );
  }
}

export async function loadMarketPulse() {
  const [index, breadth] = await Promise.all([loadMarketIndex(), loadMarketBreadth()]);
  const tradeDate = index.dataTimestamp;
  const institutions = await loadTwseInstitutionalMarket(tradeDate);
  const notConnected = (provider, note, code) => makeEvidence({ status: "NOT_CONNECTED", dataTruth: "NOT_CONNECTED", provider, note, errorCode: code });
  return {
    generatedAt: new Date().toISOString(),
    index,
    breadth,
    institutions,
    margin: notConnected("TWSE / TPEx", "市場融資融券合計尚未完成口徑對齊；個股研究頁可查看官方個股餘額。", "MARKET_MARGIN_NOT_CONNECTED"),
    sectors: notConnected("TWSE / TPEx", "產業分類與全市場每日統計尚未完成資料口徑驗證。", "SECTOR_SUMMARY_NOT_CONNECTED"),
  };
}

export async function loadOpenPressure() {
  const [nightFutures, pulse, announcements] = await Promise.all([
    loadFuturesNight(), loadMarketPulse(), Promise.all(SYMBOLS.map((item) => loadAnnouncements(item.symbol))),
  ]);
  const notConnected = (provider, note, errorCode) => makeEvidence({ status: "PROVIDER_REVIEW_REQUIRED", dataTruth: "NOT_CONNECTED", provider, note, errorCode });
  const latestAnnouncements = announcements.flatMap((item, index) => (item.data ?? []).map((entry) => ({ ...entry, symbol: SYMBOLS[index].symbol })))
    .sort((a, b) => `${b.date ?? ""} ${b.time ?? ""}`.localeCompare(`${a.date ?? ""} ${a.time ?? ""}`)).slice(0, 10);
  return {
    generatedAt: new Date().toISOString(),
    taiwanIndex: pulse.index,
    nightFutures,
    usMajorIndices: notConnected("需先確認授權的國際行情來源", "美股主要指數尚未接入；不以 Yahoo 或模擬值填補。", "US_INDEX_PROVIDER_REVIEW_REQUIRED"),
    sox: notConnected("Nasdaq", "SOX 指數自動取得與展示授權尚未完成審查；不以 ETF 或產業印象替代。", "SOX_LICENSE_REVIEW_REQUIRED"),
    adr: notConnected("需先確認授權的美股報價來源", "TSMC ADR 與關聯先行股行情尚未接入。", "ADR_PROVIDER_REVIEW_REQUIRED"),
    foreignExchange: notConnected("需先確認官方匯率資料授權", "匯率與宏觀指標尚未接入。", "FX_PROVIDER_NOT_CONNECTED"),
    events: makeEvidence({ status: latestAnnouncements.length ? "AVAILABLE" : "PARTIAL", dataTruth: latestAnnouncements.length ? "OFFICIAL" : "NOT_CONNECTED", provider: "MOPS", source: announcements.flatMap((item) => item.source), dataTimestamp: latestAnnouncements[0]?.date ?? null, fetchedAt: new Date().toISOString(), delayed: true, stale: staleByCalendarDays(latestAnnouncements[0]?.date, 30), note: "僅彙整三檔研究標的的 MOPS 重大訊息；不代表完整市場事件行事曆。", data: latestAnnouncements }),
    note: "開盤壓力頁只整理有來源的資訊，不輸出買賣方向或交易建議。",
  };
}

export async function loadResearch(value, loadRadar, readQuote = loadQuote) {
  const item = symbolInfo(value);
  const quote = await readQuote(item.symbol);
  const quoteDate = quote.dataTimestamp;
  const [history, profile, revenue, income, balance, holders, institutional, margin, announcements, nightFutures, radar] = await Promise.all([
    loadHistory(item.symbol), loadMops(item.symbol, "profile"), loadMops(item.symbol, "revenue"),
    loadMops(item.symbol, "income"), loadMops(item.symbol, "balance"), loadHolders(item.symbol),
    loadInstitutional(item.symbol, quoteDate), loadMargin(item.symbol), loadAnnouncements(item.symbol), loadFuturesNight(), loadRadar(),
  ]);
  const indicators = history.data?.length ? makeEvidence({
    status: history.data.length >= 26 ? "AVAILABLE" : "PARTIAL", dataTruth: "OFFICIAL", provider: history.provider,
    source: history.source, dataTimestamp: history.dataTimestamp, fetchedAt: history.fetchedAt, stale: history.stale,
    delayed: true, fallback: history.fallback, note: "指標由研究頁載入的官方日 OHLCV 即時計算；短歷史時保留未能計算項目。", data: calculateIndicators(history.data),
  }) : makeEvidence({ status: history.status, dataTruth: history.dataTruth, provider: history.provider, source: history.source,
    dataTimestamp: history.dataTimestamp, fetchedAt: history.fetchedAt, stale: history.stale, delayed: history.delayed,
    fallback: history.fallback, note: history.note, errorCode: history.errorCode, data: null });
  return {
    symbol: item.symbol,
    instrumentType: item.instrumentType,
    generatedAt: new Date().toISOString(),
    quote,
    history,
    profile,
    revenue,
    income,
    balance,
    holders,
    institutional,
    margin,
    announcements,
    indicators,
    futuresContext: nightFutures,
    industryRadar: radar,
    gaps: [
      { capability: "新聞媒體全文", status: "NOT_CONNECTED", note: "只接官方重大訊息標題；媒體新聞來源與全文授權尚未審核。" },
      { capability: "股利與估值歷史", status: "NOT_CONNECTED", note: "本版未接入；不由近似欄位推算。" },
      ...(item.instrumentType === "ETF" ? [{ capability: "ETF 持股、成分與淨值", status: "NOT_CONNECTED", note: "基金持股、權重與淨值尚未接入；不使用指數成分替代。" }] : []),
      ...(item.venue === "TPEx" ? [{ capability: "6488 歷史 OHLCV", status: "NOT_CONNECTED", note: "官方歷史機器端點尚未完成驗證；技術指標不使用其他來源補空。" }] : []),
    ],
  };
}

export async function loadHome(readQuote = loadQuote) {
  const cards = await Promise.all(SYMBOLS.map(async (item) => {
    const [quote, revenue] = await Promise.all([
      readQuote(item.symbol),
      item.instrumentType === "ETF" ? Promise.resolve(makeEvidence({ status: "NOT_APPLICABLE", dataTruth: "NOT_CONNECTED", provider: "MOPS", note: "ETF 不適用營運公司月營收。", errorCode: "ETF_COMPANY_DATA_NOT_APPLICABLE" })) : loadMops(item.symbol, "revenue"),
    ]);
    const signals = [];
    if (quote.status === "AVAILABLE" && quote.data?.changePercent != null) signals.push({ label: "最新官方收盤漲跌", value: `${quote.data.changePercent >= 0 ? "+" : ""}${quote.data.changePercent.toFixed(2)}%`, date: quote.dataTimestamp, provider: quote.provider, source: quote.source });
    if (revenue.status === "AVAILABLE" && revenue.data?.yearOverYearPercent != null) signals.push({ label: "月營收年增率", value: `${revenue.data.yearOverYearPercent >= 0 ? "+" : ""}${revenue.data.yearOverYearPercent.toFixed(2)}%`, date: revenue.data.period, provider: revenue.provider, source: revenue.source });
    return { ...item, name: quote.data?.name ?? item.displayName, quote, revenue, signals: signals.slice(0, 2) };
  }));
  const [market, radar] = await Promise.all([loadMarketPulse(), loadRadarSafe()]);
  return { generatedAt: new Date().toISOString(), cards, market, radar };
}

async function loadRadarSafe() {
  const { loadPriceRadar } = await import("./price-radar.mjs");
  return loadPriceRadar();
}

export function supportedSymbol(value) {
  return SYMBOLS.find((item) => item.symbol === text(value).toUpperCase() || item.code === text(value).toUpperCase()) ?? null;
}

export const providerEndpoints = API;
