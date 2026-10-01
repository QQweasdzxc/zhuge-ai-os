import type { HeadlessBundleResult, HeadlessBundleSection, HeadlessPaneEntry } from "../../../types/plugin";
import type { Evidence, Row, TaiwanResearchReport } from "./research";
import { assessIndustryImpact } from "./impact";

export const RESEARCH_VIEWS = [
  { value: "overview", label: "總覽" }, { value: "history", label: "日行情" }, { value: "operations", label: "營運" },
  { value: "ownership", label: "籌碼" }, { value: "radar", label: "產業" }, { value: "derivatives", label: "衍生" }, { value: "sources", label: "來源與缺口" },
];
export function numberText(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "未提供";
}
export function displayValue(value: unknown): string {
  return value == null || value === "" ? "未提供" : typeof value === "number" ? numberText(value) : typeof value === "string" ? value : JSON.stringify(value);
}
function entry(label: string, value: unknown): HeadlessPaneEntry { return { label, value, formatted: displayValue(value) }; }
function meta(data: Evidence<unknown>): HeadlessPaneEntry[] {
  return [entry("狀態", data.status), entry("Provider", data.provider), entry("資料時間", data.dataTimestamp),
    entry("出表時間", data.publishedAt), entry("讀取時間", data.fetchedAt),
    entry("時效", data.stale === null ? "未知（來源未提供資料日期）" : data.stale ? "stale／資料較舊" : "在研究時效預算內"),
    entry("行情類型", data.delayed ? "delayed／官方定期資料，非盤中即時" : "未聲明即時"),
    entry("Fallback", data.fallback ? "有：使用有日期的官方歷史最新收盤" : "無"), entry("Error code", data.errorCode),
    entry("說明", data.note), ...data.source.map((source) => entry("Source", source))];
}
function rowsOf(value: Row | null, labels: Record<string, string>): HeadlessPaneEntry[] {
  return Object.entries(labels).map(([key, label]) => entry(label, value?.[key]));
}

export function projectResearch(report: TaiwanResearchReport, view = "all"): HeadlessBundleResult {
  const quote = report.quote.data;
  const overview: HeadlessBundleSection[] = [
    { title: `${report.symbol} ${quote?.name ?? "標的研究"}`, entries: [entry("價格（TWD）", quote?.price), entry("漲跌", quote?.change),
      entry("漲跌幅（%）", quote?.changePercent), entry("成交量（股）", quote?.volume), ...meta(report.quote)] },
    { title: "公司／ETF", entries: [...rowsOf(report.profile.data, { name: "名稱", instrumentType: "商品類型", industry: "產業（官方欄位）", description: "主要業務" }),
      entry("狀態", report.profile.status), entry("說明", report.profile.note)] },
    { title: "最新營運摘要", entries: [entry("營運來源", report.revenue.provider), entry("月營收狀態", report.revenue.status), entry("營收月份", report.revenue.data?.period),
      entry("月營收（千元）", report.revenue.data?.amount), entry("MoM（%）", report.revenue.data?.momPercent), entry("YoY（%）", report.revenue.data?.yoyPercent),
      entry("財報狀態", report.income.status), entry("財報期末", report.income.data?.period), entry("營收（千元）", report.income.data?.revenue),
      entry("EPS（元）", report.income.data?.eps), entry("口徑", report.income.data?.scope ?? report.income.note)] },
    { title: "研究範圍", entries: [entry("法人 / 融資融券", "NOT_CONNECTED；官方能力已盤點，未接入"),
      entry("產業訊號", "5 組限額；Oil / Copper 為月均價，其餘授權待審。切至「產業」查看。"),
      entry("使用提醒", "這是研究工作台，不是即時交易終端。請先看資料日期；不產生買賣建議。") ] },
  ];
  const history: HeadlessBundleSection[] = [
    { title: "日行情來源與口徑", entries: [...meta(report.history), entry("可用筆數", report.history.data?.length ?? null)] },
    { title: "原始 OHLCV（非還原價格）", columns: [
      { key: "date", header: "日期" }, { key: "open", header: "開" }, { key: "high", header: "高" }, { key: "low", header: "低" },
      { key: "close", header: "收" }, { key: "volume", header: "量（股）" },
    ], rows: [...(report.history.data ?? [])].reverse() },
  ];
  const operations: HeadlessBundleSection[] = [
    { title: "月營收（最新月份）", entries: [...rowsOf(report.revenue.data, { period: "月份", amount: "營收（千元）", previousMonth: "上月（千元）", previousYear: "去年同月（千元）", momPercent: "MoM（%）", yoyPercent: "YoY（%）", remarks: "備註" }), ...meta(report.revenue)] },
    { title: "綜合損益（年初至本季累計，非單季）", entries: [...rowsOf(report.income.data, { period: "期末", revenue: "營業收入（千元）", grossProfit: "毛利（千元）", operatingIncome: "營業利益（千元）", netIncome: "本期淨利（千元）", eps: "EPS（元）" }), ...meta(report.income)] },
    { title: "資產負債（期末餘額）", entries: [...rowsOf(report.balance.data, { period: "期末", assets: "資產（千元）", liabilities: "負債（千元）", equity: "權益（千元）" }), ...meta(report.balance)] },
  ];
  const ownership: HeadlessBundleSection[] = [
    { title: "TDCC 股權分散", entries: meta(report.holders) },
    { title: "股東持股級距", columns: [{ key: "band", header: "級距代碼" }, { key: "holders", header: "人數" }, { key: "shares", header: "股數" }, { key: "percent", header: "占集保（%）" }], rows: report.holders.data ?? [] },
  ];
  const radar: HeadlessBundleSection[] = report.radar.flatMap((item) => {
    const signal = { id: item.id, source: item.source, dataTimestamp: item.dataTimestamp, stale: item.stale, status: item.status as "PASS" | "PARTIAL" | "UNAVAILABLE" | "PROVIDER_REVIEW_REQUIRED",
      direction: item.observations[0]?.changePercent == null ? "unknown" as const : item.observations[0].changePercent > 0 ? "up" as const : item.observations[0].changePercent < 0 ? "down" as const : "flat" as const };
    const impact = assessIndustryImpact(signal, { symbol: report.symbol, kind: "unknown", verified: false, source: null,
      explanation: "尚未取得此公司或 ETF 對此價格的直接收入／成本曝險，不能以產業名稱補猜。" });
    return [
      { title: item.label, entries: [entry("狀態", item.status), ...item.observations.flatMap((o) => [entry(o.indicator, `${numberText(o.value)} ${o.unit}`), entry(`${o.indicator} 月變化`, `${numberText(o.changePercent)} %（${o.previousMonth ?? "未知"} → ${o.month}）`)]),
        entry("資料時間", item.dataTimestamp), entry("讀取時間", item.fetchedAt), entry("Provider", item.provider), entry("Source", item.source),
        entry("時效", item.stale === null ? "未取得" : item.stale ? "stale／月資料較舊" : "月頻資料；非今日價格"), entry("Attribution", item.attribution),
        entry("License", item.license), entry("Error code", item.errorCode), entry("說明", item.note), entry("對此標的", impact.Explanation),
        entry("Confidence", `${impact.Confidence.level}；是證據支持程度，不是報酬機率`)] },
    ];
  });
  const derivatives: HeadlessBundleSection[] = [
    { title: "台指期 TX（每日一般盤報表）", entries: meta(report.futures) },
    { title: "TX 各到期月份", columns: [{ key: "expiry", header: "到期月份" }, { key: "close", header: "最後成交" }, { key: "settlement", header: "結算" }, { key: "volume", header: "成交口數" }, { key: "openInterest", header: "未平倉口數" }], rows: report.futures.data ?? [] },
    { title: "台指選擇權 TXO", entries: [...meta(report.options), entry("報表合約列數", report.options.totalRecords ?? null), entry("顯示範圍", "成交量最高的 12 列；不含 IV 推估")] },
    { title: "TXO 活躍合約", columns: [{ key: "expiry", header: "到期" }, { key: "side", header: "買／賣權" }, { key: "strike", header: "履約價" }, { key: "close", header: "收盤" }, { key: "volume", header: "成交口數" }], rows: (report.options.data ?? []).slice(0, 12) },
  ];
  const sources: HeadlessBundleSection[] = [
    ...(["quote", "history", "profile", "revenue", "income", "balance", "holders", "futures", "options"] as const).map((key): HeadlessBundleSection => ({ title: key, entries: meta(report[key]) })),
    { title: "未接入能力", columns: [{ key: "capability", header: "能力" }, { key: "status", header: "狀態" }, { key: "note", header: "說明" }], rows: report.gaps.map((g) => ({ ...g })) },
    { title: "第三方邊界", entries: [entry("FinMind", "NOT_CONNECTED；僅為 aggregation / fallback / gap filler，非官方 Authority。未讀 Token、未購買方案。"),
      entry("Yahoo", "本研究窗不呼叫；原始 command 保留，但其 supplemental 資料不得冒充官方。") ] },
  ];
  const groups = { overview, history, operations, ownership, radar, derivatives, sources };
  const sections = view === "all" ? Object.values(groups).flat() : groups[view as keyof typeof groups] ?? overview;
  return { sections, symbols: [report.symbol], complete: [report.quote, report.history, report.profile, report.revenue, report.income, report.balance, report.holders, report.futures, report.options].every((e) => e.status === "PASS"),
    errors: [report.quote, report.history, report.profile, report.revenue, report.income, report.balance, report.holders, report.futures, report.options].filter((e) => e.status === "UNAVAILABLE").map((e) => `${e.provider}: ${e.errorCode}`),
    metadata: { report } };
}
