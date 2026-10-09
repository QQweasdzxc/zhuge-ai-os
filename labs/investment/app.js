import { createReadOnlyPortfolioAdapter } from "./src/portfolio/readonly-adapter.mjs";
import { createLabMarketProvider } from "./src/providers/lab-market-provider.mjs";
import { loadPortfolioHistoryMap } from "./src/portfolio/history.mjs?v=20261009-1705";
import { formalWatchlistMembership } from "./src/portfolio/research-context.mjs";
import { renderPortfolioResearchContext, renderPortfolioSection } from "./src/portfolio/view.mjs?v=20261009-1705";
import { MiniMarketChart } from "./src/components/mini-market-chart.mjs?v=20261009-1705";
import { renderResearchOhlcvChart } from "./src/components/research-ohlcv-chart.mjs?v=20261009-1705";
import { renderUsTreasuryContext } from "./src/components/us-treasury-context.mjs";
import { renderGlobalFxContext } from "./src/components/global-fx-context.mjs";
import { renderInstitutionalFlowSummary } from "./src/components/institutional-flow-view.mjs?v=20261009-1705";
import { renderChipCycleObservation } from "./src/components/chip-cycle-observation.mjs?v=20261009-1705";
import { renderTaiwanScanResults } from "./src/components/taiwan-scan-results.mjs?v=20261009-1705";
import { renderTaiwanSectorHeatmap } from "./src/components/taiwan-sector-heatmap.mjs?v=20261009-1705";
import { renderTaiwanMarginBalance, renderTdccOwnership } from "./src/components/taiwan-positioning-evidence.mjs?v=20261009-1705";
import { recordTdccLocalObservation } from "./src/domain/tdcc-local-observations.mjs?v=20261009-1705";
import { calculateIndicators } from "./src/domain/indicators.mjs";
import { buildTechnicalSignalMatrix, renderTechnicalSignalMatrix } from "./src/domain/technical-signal-matrix.mjs?v=20261009-1705";
import { buildChipCycleObservation } from "./src/domain/chip-cycle-observation.mjs?v=20261009-1705";
import { filtersForTaiwanSector } from "./src/domain/taiwan-market-scan.mjs";
import { buildSmaCrossoverSignals, runSmaCrossoverBacktest } from "./src/domain/sma-crossover-backtest.mjs";
import { buildInvestmentAiEvidencePack, createInvestmentAiProvider } from "./src/ai/analysis-contract.mjs";
import { renderAiResearchPanel } from "./src/components/ai-research-panel.mjs";
import { normalizeWatchlistNotificationSettings, buildWatchlistNotificationSchedule, buildWatchlistNotificationDigest } from "./src/watchlist/notifications.mjs";
import { renderTdccHistoricalSeries } from "./src/components/tdcc-history.mjs";
import { calculateCrossMarketCorrelation } from "./src/domain/cross-market-correlation.mjs";
import { renderCrossMarketCorrelation } from "./src/components/cross-market-correlation.mjs";
import { normalizeTaiwanEtfFundEvidence } from "./src/domain/etf-fund-evidence.mjs";
import { renderTaiwanEtfFundEvidence } from "./src/components/etf-fund-evidence.mjs";
import { normalizeBrokerBranchEvidence } from "./src/domain/broker-branch-evidence.mjs";
import { renderBrokerBranchEvidence } from "./src/components/broker-branch-evidence.mjs";

const root = document.querySelector("#view-root");
const dialog = document.querySelector("[data-dialog]");
const dialogTitle = document.querySelector("[data-dialog-title]");
const dialogBody = document.querySelector("[data-dialog-body]");
const navButtons = [...document.querySelectorAll("[data-view]")];
const runtimeStatus = document.querySelector("[data-runtime-status]");
const STORE_LOCAL_WATCH = "zhuge.investment.sandbox.watch.v1";
const STORE_NOTES = "zhuge.investment.sandbox.notes.v1";
const STORE_NOTIFICATION_SETTINGS = "zhuge.lab-investment.watchlist-notifications.v1";
const GLOBAL_US_EQUITY_CONTEXT = Object.freeze([
  Object.freeze({ symbol: "AAPL", market: "US", name: "Apple" }),
  Object.freeze({ symbol: "NVDA", market: "US", name: "NVIDIA" }),
  Object.freeze({ symbol: "TSM", market: "US", name: "TSMC ADR" }),
]);
const symbolNames = Object.create(null);
const state = { view: "overview", market: "TW", symbol: "", home: null, research: null, intelligence: null, tdccLocalObservation: null, tdccPublishedHistory: null, aiAnalysis: { status: "IDLE", pack: null, result: null }, crossMarketCorrelation: null, notificationSettings: null, notificationDigest: null, marketContext: null, scan: null, backtest: null, scannerMode: "TW_MARKET", scannerPresentation: "table", taiwanScanFilters: { venue: "ALL", sort: "score", limit: 50, offset: 0 }, portfolio: { status: "LOADING", positions: [] }, portfolioHistories: new Map(), portfolioPromise: null, watchlist: { status: "LOADING", items: [] }, watchlistEvents: { status: "LOADING", items: [] }, closedHistory: { status: "LOADING", items: [] }, transactions: { status: "UNAVAILABLE", items: [] }, request: 0 };

let portfolioAdapter = null;
let labMarketProvider = null;
try {
  const platform = globalThis.ZhugeRuntimeSessionProvider?.createPlatform?.();
  const context = platform?.forModule?.("investment");
  if (context) {
    portfolioAdapter = createReadOnlyPortfolioAdapter({
      context,
      appAccess: globalThis.ZhugeAppAccess,
      appAccessGate: globalThis.ZhugeAppAccessGate,
    });
    const intelligenceProvider = globalThis.InvestmentIntelligenceProviders?.create?.({ invokeFunction: context.data.invokeFunction });
    if (intelligenceProvider) labMarketProvider = createLabMarketProvider({
      intelligenceProvider,
      invokeFunction: context.data.invokeFunction,
      authorize: () => portfolioAdapter.assertReadAccess(),
    });
  }
} catch {
  portfolioAdapter = null;
  labMarketProvider = null;
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const fmt = (value, digits = 2) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";
const fmtSigned = (value, digits = 2) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? `${Number(value) > 0 ? "+" : ""}${fmt(value, digits)}` : "—";
const marketCode = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "TW" || normalized === "US" ? normalized : "";
};
const statusNames = {
  AVAILABLE: "資料可用", PARTIAL: "部分欄位可用", NOT_APPLICABLE: "不適用此標的",
  NOT_CONNECTED: "尚未接通", PROVIDER_REVIEW_REQUIRED: "來源審查中", UNAVAILABLE: "暫時無法取得",
};
const truthNames = { OFFICIAL: "官方來源", REAL: "真實資料", FALLBACK: "同來源快取", DELAYED: "延遲資料", NOT_CONNECTED: "未接資料", UNAVAILABLE: "無可用資料", SIMULATED: "模擬資料（僅測試）" };

function evidenceState(evidence) {
  if (!evidence) return { what: "資料狀態未提供。", impact: "無法判讀此項研究內容。", action: "重新整理或查看資料來源。" };
  if (evidence.errorCode === "SERVER_PROXY_REQUIRED") return {
    what: "瀏覽器無法直接讀取這個官方資料來源。",
    impact: "此項數據保持未連線，不會以其他來源或模擬值替代。",
    action: "請確認目前 Runtime 有載入已授權的 Zhuge server-side provider；本頁不直接呼叫受 CORS 限制的來源。",
  };
  const states = {
    AVAILABLE: ["來源資料已載入。", "可以查看目前回傳的欄位。", evidence.stale ? "資料可能較舊；請先核對日期。" : "仍請以來源日期判斷時效。"],
    PARTIAL: ["只有部分欄位可用。", "缺漏欄位不會以 0 或估值補入。", "查看欄位與來源說明，必要時稍後重試。"],
    NOT_APPLICABLE: ["這項資料不適用此標的。", "不顯示推測或替代數值。", "可改看 ETF 持股／基金資料；目前尚未接通。"],
    NOT_CONNECTED: ["此資料能力尚未接通。", "這部分不會影響其他已載入證據。", "目前無需操作；保持未接狀態直到來源完成驗證。"],
    PROVIDER_REVIEW_REQUIRED: ["資料來源或使用授權仍在審查。", "目前不擷取、不顯示數值。", "待完成來源與授權審查後再接入。"],
    UNAVAILABLE: ["目前無法讀取資料來源。", "本區不提供舊值冒充最新資料，也不影響其他區塊。", "可按右上角重新整理；若持續發生，請查看來源資訊。"],
  };
  const [what, impact, action] = states[evidence.status] ?? states.UNAVAILABLE;
  return { what, impact, action };
}

function sourceDetails(evidence) {
  const sources = list(evidence?.source).filter(Boolean).map((url) => {
    let safe = "";
    try { const parsed = new URL(url); if (parsed.protocol === "https:") safe = parsed.href; } catch {}
    return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(safe)}</a>` : esc(url);
  });
  const message = evidenceState(evidence);
  return `<div class="evidence-meta">
    <span>Provider：${esc(evidence?.provider || "未提供")}</span>
    <span>資料日期：${esc(evidence?.dataTimestamp || evidence?.publishedAt || "未提供")}</span>
    <span>讀取時間：${esc(evidence?.fetchedAt || "未提供")}</span>
    <span>真實性：${esc(truthNames[evidence?.dataTruth] || evidence?.dataTruth || "未提供")}${evidence?.delayed ? " · 延遲資料" : ""}${evidence?.stale === true ? " · 資料較舊" : ""}${evidence?.fallback ? " · 使用同來源快取" : ""}</span>
    ${evidence?.errorCode ? `<span>狀態代碼：${esc(evidence.errorCode)}</span>` : ""}
    ${sources.length ? `<span>來源：${sources.join(" · ")}</span>` : ""}
    ${evidence?.attribution ? `<span>標示：${esc(evidence.attribution)}</span>` : ""}
    ${evidence?.license ? `<span>授權：${esc(evidence.license)}</span>` : ""}
    <div class="state-explanation"><span>發生什麼：${esc(message.what)}</span><span>影響：${esc(message.impact)}</span><span>下一步：${esc(message.action)}</span></div>
    ${evidence?.note ? `<span>${esc(evidence.note)}</span>` : ""}
  </div>`;
}

function badge(evidence) {
  const status = evidence?.status || "UNAVAILABLE";
  const label = evidence?.errorCode === "SERVER_PROXY_REQUIRED" ? "需要安全資料代理" : statusNames[status] || status;
  return `<span class="status-chip" data-status="${esc(status)}">${esc(label)}</span>`;
}

function evidenceCard(title, evidence, content = "") {
  const body = evidence?.data != null && content ? content : `<div class="state-explanation"><span>發生什麼：${esc(evidenceState(evidence).what)}</span><span>影響：${esc(evidenceState(evidence).impact)}</span><span>下一步：${esc(evidenceState(evidence).action)}</span></div>`;
  return `<article class="evidence-card"><div class="evidence-head"><h3>${esc(title)}</h3>${badge(evidence)}</div>${body}${evidence?.note && evidence.data != null ? `<p class="evidence-note">${esc(evidence.note)}</p>` : ""}<details><summary>來源與證據</summary>${sourceDetails(evidence)}</details></article>`;
}

function loading(title = "正在讀取資料…") {
  root.innerHTML = `<div class="loading-state"><span class="spinner"></span><p>${esc(title)}</p></div>`;
}

function startRequest(message) {
  const requestId = ++state.request;
  loading(message);
  return { requestId };
}

function applyNav() {
  navButtons.forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function pageHead(title, description, controls = "") {
  return `<header class="page-head"><div><p class="eyebrow">Zhuge AI OS · Lab_投資</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${controls ? `<div class="head-actions">${controls}</div>` : ""}</header>`;
}

function portfolioErrorStatus(error) {
  const mapping = {
    SESSION_REQUIRED: "SESSION_REQUIRED",
    APP_ACCESS_REQUIRED: "APP_ACCESS_REQUIRED",
    MFA_REQUIRED: "MFA_REQUIRED",
    OWNER_MAPPING_REQUIRED: "OWNER_MAPPING_REQUIRED",
    ACCESS_GATE_UNAVAILABLE: "ACCESS_UNAVAILABLE",
    ACCESS_CHECK_UNAVAILABLE: "ACCESS_UNAVAILABLE",
    SECURITY_CHECK_UNAVAILABLE: "ACCESS_UNAVAILABLE",
    PORTFOLIO_ACCESS_DENIED: "ACCESS_UNAVAILABLE",
  };
  return mapping[error?.code] || "UNAVAILABLE";
}

function readErrorStatus(error) {
  return portfolioErrorStatus(error);
}

function registerPortfolioSymbols(result) {
  for (const position of list(result?.positions)) {
    const market = marketCode(position.market);
    if (!market) continue;
    rememberSymbol({
      symbol: position.researchSymbol || position.symbol,
      name: position.name,
      market,
      venue: position.venue,
    });
  }
}

function rememberSymbol({ symbol, name, market } = {}) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const normalizedMarket = marketCode(market);
  if (!normalizedMarket) return;
  if (!/^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^[A-Z0-9._-]{1,19})(?:\.(?:TW|TWO))?$/.test(normalized)) return;
  const label = String(name || "").trim() || normalized;
  symbolNames[normalizedMarket + ":" + normalized] = label;
}

function symbolLabelFor(symbol, market = state.market, fallback = "") {
  const normalized = String(symbol || "").toUpperCase();
  const normalizedMarket = marketCode(market);
  return (normalizedMarket ? symbolNames[normalizedMarket + ":" + normalized] : "")
    || fallback
    || normalized;
}

function registerWatchlistSymbols(result) {
  for (const item of list(result?.items)) {
    rememberSymbol({ symbol: item.symbol, name: item.name, market: item.market });
  }
}

async function loadCanonicalWatchlist() {
  if (!portfolioAdapter?.loadWatchlist) throw Object.assign(new Error("Watchlist read authority unavailable."), { code: "ACCESS_UNAVAILABLE" });
  const result = await portfolioAdapter.loadWatchlist();
  registerWatchlistSymbols(result);
  return result;
}

async function loadWatchlistSnapshot(force = false) {
  if (!force && ["AVAILABLE", "EMPTY"].includes(state.watchlist?.status)) return state.watchlist;
  if (!portfolioAdapter?.loadWatchlist) {
    state.watchlist = { status: "UNAVAILABLE", items: [] };
    return state.watchlist;
  }
  try { state.watchlist = await loadCanonicalWatchlist(); }
  catch (error) { state.watchlist = { status: readErrorStatus(error), items: [] }; }
  return state.watchlist;
}

async function loadPortfolioSnapshot(force = false) {
  if (state.portfolioPromise && !force) return state.portfolioPromise;
  if (!force && state.portfolio.status !== "LOADING") return state.portfolio;
  const pending = (async () => {
    if (!portfolioAdapter) {
      state.portfolio = { status: "UNAVAILABLE", positions: [] };
      return state.portfolio;
    }
    try {
      state.portfolio = await portfolioAdapter.loadCurrentPositions();
      registerPortfolioSymbols(state.portfolio);
    } catch (error) {
      state.portfolio = { status: portfolioErrorStatus(error), positions: [] };
    }
    return state.portfolio;
  })();
  state.portfolioPromise = pending;
  try { return await pending; }
  finally { if (state.portfolioPromise === pending) state.portfolioPromise = null; }
}

function portfolioPositionForSymbol(symbol, market = state.market) {
  const requestedMarket = marketCode(market);
  if (!requestedMarket) return null;
  const target = String(symbol || "").toUpperCase();
  const code = target.replace(/\.(TW|TWO)$/, "");
  return list(state.portfolio?.positions).find(position => {
    if (marketCode(position.market) !== requestedMarket) return false;
    const candidate = String(position.researchSymbol || position.symbol || "").toUpperCase();
    return candidate === target || candidate.replace(/\.(TW|TWO)$/, "") === code;
  }) || null;
}

function navigateHash(route) {
  const next = `#${route}`;
  if (location.hash === next) routeFromHash();
  else location.hash = next;
}

function routeFromHash() {
  let route = "";
  try { route = decodeURIComponent(String(location.hash || "").replace(/^#/, "")); }
  catch { return showView("holdings"); }
  if (route === "" || route === "home") return showView("overview");
  const parts = route.split("/");
  if (parts[0] === "research" && parts[2]) return loadResearchView(parts[2], { market: parts[1], venue: parts[3] });
  if (["overview", "scanner", "market", "holdings", "watchlist", "history", "research", "chips", "technical", "backtest"].includes(parts[0])) {
    if (parts[0] === "research") return loadResearchView(state.symbol, { market: state.market });
    return showView(parts[0]);
  }
  return showView("overview");
}

function navigateToResearch(symbol, market, venue = "", name = "") {
  const safeSymbol = String(symbol || "").toUpperCase();
  if (!/^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^[A-Z0-9._-]{1,19})(?:\.(?:TW|TWO))?$/.test(safeSymbol)) return;
  const normalizedMarket = marketCode(market);
  if (!normalizedMarket) return;
  state.market = normalizedMarket;
  state.symbol = safeSymbol;
  rememberSymbol({ symbol: safeSymbol, name, market: normalizedMarket });
  navigateHash(`research/${normalizedMarket}/${encodeURIComponent(safeSymbol)}${normalizedMarket === "TW" && venue ? `/${encodeURIComponent(venue)}` : ""}`);
}

function researchLink(label, { symbol, market, venue = "", name = "", action = "open-research" } = {}) {
  const safeMarket = marketCode(market);
  if (!safeMarket) return `<span class="unresolved-market" aria-label="市場未確認，不能推定研究入口">${esc(label)}</span>`;
  return `<button class="text-link" type="button" data-action="${esc(action)}" data-market="${safeMarket}" data-venue="${esc(venue)}" data-name="${esc(name)}" data-symbol="${esc(symbol)}">${esc(label)}</button>`;
}

function quoteHeadline(evidence) {
  if (!evidence?.data) return `<div class="empty-state">${esc(evidenceState(evidence).what)}<br>${esc(evidenceState(evidence).action)}</div>`;
  const data = evidence.data;
  const change = Number(data.changePercent);
  return `<div class="quote-number">${fmt(data.close)}<small>TWD / 股</small></div><div class="quote-change ${Number.isFinite(change) ? change > 0 ? "positive" : change < 0 ? "negative" : "neutral" : "neutral"}">${fmtSigned(data.change)} · ${fmtSigned(change)}%</div>`;
}

function quoteChip(quote) {
  if (!quote?.data) return badge(quote);
  const change = Number(quote.data.changePercent);
  const cls = change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
  return `<span class="quote-change ${cls}">${fmtSigned(change)}%</span>`;
}

function renderStockCard(card, history) {
  const quote = card.quote;
  const chartHistory = history ?? list(state.home?.trends).find((entry) => entry.symbol === card.symbol)?.history;
  const displayName = card.name || card.displayName || symbolLabelFor(card.symbol, card.market, card.symbol);
  const date = quote?.dataTimestamp || "日期未提供";
  const revenue = card.revenue?.data?.yearOverYearPercent;
  const companyRevenue = card.instrumentType !== "ETF" && Number.isFinite(Number(revenue));
  return `<article class="stock-card">
    <div class="stock-card-top"><div><h2 class="stock-name">${esc(displayName)}</h2><span class="ticker">${esc(card.symbol)} · ${esc(card.venue)}</span></div>${quoteChip(quote)}</div>
    ${quoteHeadline(quote)}
    ${MiniMarketChart({ evidence: chartHistory, mode: "research", currency: "TWD" })}
    <p class="tiny-note">${esc(quote?.provider || "來源未提供")} · ${esc(date)} · ${quote?.delayed ? "延遲收盤" : ""}</p>
    ${companyRevenue ? `<p class="tiny-note">最近月營收年增 ${fmtSigned(revenue)}% · ${esc(card.revenue.data.period || "期間未提供")}</p>` : `<p class="tiny-note">${card.instrumentType === "ETF" ? "ETF：公司營收不適用；基金持股與淨值未接通。" : "營運資料可進入研究頁查看。"}</p>`}
    <div class="stock-card-footer"><span class="ticker">${badge(quote)}</span><button class="primary-button" data-action="research" data-market="${esc(card.market)}" data-venue="${esc(card.venue || "")}" data-name="${esc(displayName)}" data-symbol="${esc(card.symbol)}">個股研究</button></div>
    <details class="card-evidence"><summary>行情與營運來源</summary>${sourceDetails(quote)}${card.revenue ? sourceDetails(card.revenue) : ""}</details>
  </article>`;
}

function latestObservation(evidence, selector = (observations) => observations.at(-1)) {
  const observations = list(evidence?.data?.observations);
  return observations.length ? selector(observations) : null;
}

function radarSummary(items) {
  return list(items).slice(0, 2).map((item) => {
    const observations = list(item.data?.observations);
    const value = observations.length ? observations.map((entry) => `${entry.indicator} ${fmt(entry.value, 1)} ${entry.unit}`).join(" · ") : "無可顯示的已驗證數值";
    return evidenceCard(item.data?.label || item.provider, item, item.status === "AVAILABLE"
      ? `<div class="evidence-value">${esc(value)}</div><p class="tiny-note">月份 ${esc(item.dataTimestamp || "未提供")} · 月變化僅供參考</p>` : "");
  }).join("");
}

function renderHome(data) {
  state.home = data;
  const histories = new Map(list(data.trends).map((entry) => [entry.symbol, entry.history]));
  const cards = list(data.cards).map((card) => renderStockCard(card, histories.get(card.symbol))).join("");
  const marketIndex = data.market?.index;
  const breadth = data.market?.breadth;
  const pulseCards = [
    evidenceCard("加權指數日收", marketIndex, marketIndex?.data ? `<div class="evidence-value">${fmt(marketIndex.data.index, 2)}</div><p class="tiny-note">${esc(marketIndex.data.date)} · 漲跌 ${fmtSigned(marketIndex.data.change, 2)}</p>` : ""),
    evidenceCard("上市櫃漲跌家數", breadth, breadth?.data ? `<div class="metric-row"><div class="metric"><label>上漲</label><strong>${fmt(breadth.data.up, 0)}</strong></div><div class="metric"><label>下跌</label><strong>${fmt(breadth.data.down, 0)}</strong></div><div class="metric"><label>平盤</label><strong>${fmt(breadth.data.flat, 0)}</strong></div></div><p class="tiny-note">${esc(breadth.dataTimestamp)} · 含 ETF，非市值加權</p>` : ""),
  ].join("");
  root.innerHTML = `${pageHead("研究總覽", "顯示目前登入者或已選取研究標的的來源證據；不輸出綜合分數或買賣方向。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}
    <div class="callout"><strong>資料定位</strong><p>官方日收為延遲行情，不是盤中即時報價；價格變動與營收只是不同期間的原始證據，不代表未來報酬。</p></div>
    ${renderPortfolioSection(state.portfolio, state.portfolioHistories)}
    <div class="section-title"><h2>研究標的</h2><span>${list(data.cards).length} 檔</span></div>
    <div class="research-grid">${cards || `<p class="empty-state">請使用上方搜尋選擇研究標的；不預填特定股票。</p>`}</div>
    <div class="section-title"><h2>台灣市場脈搏</h2><span>來源日期分開顯示</span></div><div class="evidence-grid">${pulseCards}</div>
    <div class="section-title"><h2>產業價格參考</h2><span>月頻 · 不推導個股曝險</span></div><div class="evidence-grid">${radarSummary(data.radar)}</div>`;
}

function indicatorRows(indicators) {
  const data = indicators?.data;
  if (!data) return evidenceCard("技術指標", indicators, "");
  const rows = [
    ["MA5", data.sma5], ["MA20", data.sma20], ["RSI14", data.rsi14], ["K（KD）", data.kd?.k], ["D（KD）", data.kd?.d],
    ["MACD", data.macd?.macd], ["MACD Signal", data.macd?.signal], ["MACD Histogram", data.macd?.histogram],
    ["Bollinger 上緣", data.bollinger20?.upper], ["Bollinger 中線", data.bollinger20?.middle], ["Bollinger 下緣", data.bollinger20?.lower],
    ["最新成交量", data.volume?.latest], ["5 日均量", data.volume?.average5],
  ];
  return `<article class="evidence-card"><div class="evidence-head"><h3>技術指標 · 研究用</h3>${badge(indicators)}</div><div class="data-table-wrap"><table class="data-table"><tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${value == null ? "歷史樣本不足" : fmt(value, 3)}</td></tr>`).join("")}</tbody></table></div><p class="evidence-note">${esc(indicators.note)} · 實際 bars ${fmt(indicators.data.barsUsed, 0)} 筆</p><details><summary>來源與證據</summary>${sourceDetails(indicators)}</details></article>`;
}

function providerEvidence(title, evidence, body = "") {
  const status = evidence?.available === true || evidence?.status === "AVAILABLE" ? "AVAILABLE"
    : evidence?.status || (evidence?.error ? "UNAVAILABLE" : "PARTIAL");
  const wrapped = {
    status,
    data: evidence?.available === true ? (evidence.data ?? evidence) : evidence?.data ?? null,
    provider: evidence?.provider || evidence?.source || "Zhuge Investment Intelligence",
    source: [evidence?.sourceUrl, ...(Array.isArray(evidence?.source) ? evidence.source : [])].filter(Boolean),
    dataTimestamp: evidence?.asOf || evidence?.observedAt || evidence?.dataTimestamp || null,
    fetchedAt: evidence?.receivedAt || evidence?.fetchedAt || evidence?.generatedAt || null,
    stale: evidence?.stale === true || evidence?.freshness === "stale",
    delayed: evidence?.delayed === true,
    errorCode: evidence?.error || evidence?.errorCode || null,
    note: evidence?.summary || evidence?.note || "資料來源與時間以原始 Evidence 為準。",
  };
  const content = body || (wrapped.data ? `<p>${esc(evidence?.summary || evidence?.note || "")}</p>${Array.isArray(evidence?.facts) && evidence.facts.length ? `<ul class="evidence-facts">${evidence.facts.slice(0, 20).map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}` : "");
  return evidenceCard(title, wrapped, content);
}

function emptyProvider(name, status = "UNAVAILABLE", note = "資料來源沒有回傳可用資料。") {
  return Object.freeze({ available: false, status, symbol: state.symbol, market: state.market, provider: name, source: name, asOf: null, note, error: status });
}

function normalizedHistory(result, symbol = state.symbol) {
  return list(result?.histories).find(item => item.symbol === String(symbol).replace(/\.(TW|TWO)$/, "") && item.market === state.market)
    || list(result?.histories).find(item => item.symbol === String(symbol).toUpperCase() && item.market === state.market)
    || { available: false, bars: [], symbol, market: state.market, source: null, asOf: null, error: "HISTORY_UNAVAILABLE" };
}

function currentResearchAiEvidencePack() {
  const result = state.intelligence || {};
  const market = marketCode(state.market);
  const symbol = String(state.symbol || "").toUpperCase().replace(/\.(TW|TWO)$/, "");
  const context = list(result.contexts).find(item => item.symbol === symbol && item.market === market) || {};
  const quote = list(result.quotes).find(item => item.symbol === symbol && item.market === market) || {};
  const history = normalizedHistory(result, state.symbol);
  const bars = list(history.bars).map(item => ({ ...item, date: item.date || item.asOf || item.as_of }));
  const asNumber = value => value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  const indicators = calculateIndicators(bars.map(item => ({ ...item, close: asNumber(item.close), high: asNumber(item.high), low: asNumber(item.low), volume: asNumber(item.volume) })));
  const technical = buildTechnicalSignalMatrix(bars, indicators).map(item => ({
    type: "technical",
    title: item.label,
    summary: item.observation,
    source: `${item.source}; ${history.provider || history.source || "OHLCV provider"}`,
    observedAt: history.asOf || bars.at(-1)?.date,
    freshness: history.freshness || "unknown",
    facts: item.status === "AVAILABLE" ? [item.observation] : [],
    limitations: item.status === "AVAILABLE" ? [] : ["來源樣本不足，未形成此項觀察。"],
  }));
  const publicEvidence = list(context.evidence).map(item => ({
    type: item.type || "research",
    title: item.title || item.label || item.type || "Research evidence",
    summary: item.summary || "",
    source: item.source || item.provider,
    sourceUrl: list(item.sourceUrl || item.source)[0] || item.sourceUrl,
    observedAt: item.observedAt || item.dataTimestamp,
    freshness: item.freshness || (item.stale ? "stale" : "unknown"),
    facts: list(item.facts || (item.data != null ? [item.summary || item.note].filter(Boolean) : [])),
    limitations: list(item.limitations || item.note).filter(Boolean),
  }));
  return buildInvestmentAiEvidencePack({
    symbol, market, name: context.name || symbolLabelFor(symbol, market),
    quote: { available: quote.available === true, price: quote.price, currency: quote.currency, provider: quote.provider || quote.source, asOf: quote.asOf || quote.dataTimestamp, freshness: quote.freshness, delayed: quote.delayed },
    history: { bars, provider: history.provider || history.source, asOf: history.asOf },
    evidence: [...publicEvidence, ...technical],
  });
}

async function analyzeCurrentResearch() {
  const pack = currentResearchAiEvidencePack();
  const provider = createInvestmentAiProvider({
    authorize: async () => {
      if (!portfolioAdapter?.assertReadAccess) return false;
      await portfolioAdapter.assertReadAccess();
      return true;
    },
  });
  try {
    const response = await provider.analyze(pack);
    state.aiAnalysis = { status: response.status, pack, result: response.result };
  } catch (error) {
    state.aiAnalysis = { status: error?.code === "ACCESS_UNAVAILABLE" ? "ACCESS_REQUIRED" : "UNAVAILABLE", pack, result: null };
  }
  if (state.intelligence && state.view === "research") renderIntelligenceResearch(state.intelligence, state.symbol);
}

async function runCrossMarketCorrelation(form) {
  const referenceSymbol = String(new FormData(form).get("referenceSymbol") || "").trim().toUpperCase();
  if (state.market !== "TW" || !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(referenceSymbol) || !labMarketProvider) return;
  const rootStatus = form.closest(".cross-market-correlation")?.querySelector("[data-cross-market-status]");
  if (rootStatus) rootStatus.dataset.crossMarketStatus = "LOADING";
  try {
    const targetHistory = normalizedHistory(state.intelligence, state.symbol);
    const referenceHistory = await labMarketProvider.getHistory({ symbol: referenceSymbol, market: "US" });
    state.crossMarketCorrelation = {
      targetSymbol: String(state.symbol).toUpperCase().replace(/\.(TW|TWO)$/, ""),
      referenceSymbol,
      result: calculateCrossMarketCorrelation(targetHistory, referenceHistory),
    };
  } catch (error) {
    state.crossMarketCorrelation = {
      targetSymbol: String(state.symbol).toUpperCase().replace(/\.(TW|TWO)$/, ""),
      referenceSymbol,
      result: { status: "INSUFFICIENT_EVIDENCE", correlation: null, pairedReturns: 0, targetProvider: null, referenceProvider: null, note: `歷史資料目前不可用（${String(error?.code || "HISTORY_UNAVAILABLE").slice(0, 60)}）；不計算相關係數。` },
    };
  }
  if (state.intelligence && state.view === "research") renderIntelligenceResearch(state.intelligence, state.symbol);
}

function renderIntelligenceResearch(result, symbol = state.symbol) {
  state.intelligence = result;
  state.symbol = String(symbol).toUpperCase();
  const market = state.market;
  const canonical = state.symbol.replace(/\.(TW|TWO)$/, "");
  const quote = list(result?.quotes).find(item => item.symbol === canonical && item.market === market) || emptyProvider("Investment Intelligence");
  const history = normalizedHistory(result, state.symbol);
  const bars = list(history.bars).map(bar => ({ ...bar, date: bar.asOf || bar.date }));
  const indicators = calculateIndicators(bars.map(bar => ({ ...bar, close: Number(bar.close), high: Number(bar.high), low: Number(bar.low), volume: Number(bar.volume) })));
  const technicalMatrix = buildTechnicalSignalMatrix(bars, indicators);
  const context = list(result?.contexts).find(item => item.symbol === canonical && item.market === market) || {};
  const position = portfolioPositionForSymbol(state.symbol);
  const watchlisted = formalWatchlistMembership({ symbol: canonical, market, status: state.watchlist?.status, items: state.watchlist?.items });
  const watchlistContext = watchlisted === null ? "正式觀察名單尚未讀取" : watchlisted ? "已在正式觀察名單" : "目前不在正式觀察名單";
  const name = position?.name || symbolLabelFor(state.symbol, market, context.name || canonical) || canonical;
  if (state.aiAnalysis.pack?.identity?.symbol !== canonical || state.aiAnalysis.pack?.identity?.market !== market) state.aiAnalysis = { status: "IDLE", pack: null, result: null };
  if (state.crossMarketCorrelation?.targetSymbol !== canonical) state.crossMarketCorrelation = null;
  const priceText = quote.available && quote.price != null ? fmt(quote.price) : "—";
  const quoteSemantics = quote.available
    ? `${quote.priceKind ? `${quote.priceKind} · ` : ""}${quote.provider || quote.source || "來源未提供"} · ${quote.asOf || "資料時間未提供"} · ${quote.freshness || "時效未知"}${quote.coverage ? ` · ${quote.coverage}` : ""}${quote.stale ? " · 已過 freshness window" : ""}`
    : quote.error === "EXTERNAL_SECRET_REQUIRED"
      ? "Zhuge-owned US quote providers 目前無可用回應；Alpaca 僅是可選 fallback。未使用持股估值、模擬值或其他未核准來源。"
      : `尚無可驗證行情${quote.error ? `（${String(quote.error).slice(0, 80)}）` : ""}；不以持股估值或模擬數字替代。`;
  const chart = renderResearchOhlcvChart(history, { market });
  const evidence = list(context.evidence);
  const relationship = list(result?.relationships).find(item => item.symbol === canonical && item.market === "TW") || {};
  const etfComponent = list(relationship.evidence).find(item => item.type === "etf_component");
  const etfFund = list(relationship.evidence).find(item => item.type === "etf_fund");
  const etfPanel = etfComponent || etfFund ? (() => {
    const componentItems = list(etfComponent?.facts).flatMap(fact => {
      const match = /^component=([^:;]+)(?::([^;]+))?(?:;weight_pct=([-+\d.]+))?$/.exec(String(fact || ""));
      return match ? [{ symbol: match[1], name: match[2] || "", weightPct: match[3] === undefined ? null : Number(match[3]) }] : [];
    });
    const latestDailyBar = list(history.bars).at(-1) || null;
    const navEvidence = etfFund ? {
      status: etfFund.status || "UNAVAILABLE",
      provider: etfFund.source || etfFund.provider,
      source: etfFund.sourceUrl,
      dataTimestamp: etfFund.observedAt,
      fetchedAt: etfFund.fetchedAt,
      data: etfFund.data || {},
      note: etfFund.summary,
    } : { status: "UNAVAILABLE", provider: "TWSE MIS ETF NAV feed unavailable" };
    return renderTaiwanEtfFundEvidence(normalizeTaiwanEtfFundEvidence({
      symbol: canonical,
      quote: latestDailyBar ? { status: "AVAILABLE", provider: history.provider || history.source || "TWSE / TPEx daily history", dataTimestamp: latestDailyBar.date || latestDailyBar.asOf, fetchedAt: history.fetchedAt, source: history.sourceUrl || history.source, data: { close: latestDailyBar.close, date: latestDailyBar.date || latestDailyBar.asOf } } : { status: "UNAVAILABLE" },
      nav: navEvidence,
      flow: { status: "UNAVAILABLE", provider: "Independent ETF cash flow source not connected", note: "單位數變動不作為現金申購贖回流量替代。" },
      constituents: etfComponent ? { status: etfComponent.stale ? "PARTIAL" : componentItems.length ? "AVAILABLE" : "PARTIAL", provider: etfComponent.source || "ETF issuer PCF", source: etfComponent.sourceUrl, dataTimestamp: etfComponent.observedAt, fetchedAt: result.generatedAt, note: etfComponent.summary, data: { items: componentItems } } : { status: "UNAVAILABLE", provider: "ETF issuer PCF" },
    }));
  })() : "";
  const taiwanEvidence = list(result?.taiwanEvidence).find(item => item.symbol === canonical && item.market === "TW")?.evidence || {};
  const brokerBranchEvidence = normalizeBrokerBranchEvidence({
    market,
    symbol: canonical,
    evidence: taiwanEvidence.brokerBranches || (market === "TW" ? {
      status: "SECRET_REQUIRED",
      provider: "FinMind TaiwanStockTradingDailyReport · Sponsor dataset",
      source: "https://finmind.github.io/tutor/TaiwanMarket/Technical/",
      note: "分點資料：尚未設定資料服務。沒有用法人流量冒充分點資料。",
    } : null),
  });
  const brokerBranchPanel = renderBrokerBranchEvidence(brokerBranchEvidence);
  const localTdcc = state.tdccLocalObservation || {};
  const localObservations = list(localTdcc.observations).length ? list(localTdcc.observations) : [
    { date: localTdcc.previousDate, topThreeSourceLevelsPct: localTdcc.previousTopThreeSourceLevelsPct, source: localTdcc.source },
    { date: localTdcc.currentDate, topThreeSourceLevelsPct: localTdcc.currentTopThreeSourceLevelsPct, source: localTdcc.source },
  ].filter(item => item.date);
  const observationsByDate = new Map();
  // Published server history is the canonical source when a date overlaps a
  // browser-local observation; local dates remain a fallback for unarchived data.
  for (const item of [...localObservations, ...list(state.tdccPublishedHistory?.observations)]) {
    if (item?.date) observationsByDate.set(String(item.date).slice(0, 10), item);
  }
  const tdccObservations = [...observationsByDate.values()].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const tdccCompleteDateCount = new Set(tdccObservations.filter(item => item.topThreeSourceLevelsPct != null).map(item => item.date)).size;
  const tdccSeries = state.tdccPublishedHistory && list(state.tdccPublishedHistory.observations).length
    ? { ...state.tdccPublishedHistory, observations: tdccObservations, status: tdccCompleteDateCount >= 2 ? "AVAILABLE" : state.tdccPublishedHistory.status }
    : null;
  const chipCycle = market === "TW" ? buildChipCycleObservation({
    bars,
    institutionalSummary: taiwanEvidence.institutional?.data?.historySummary,
    tdccHistory: { observations: tdccObservations },
    historySource: history.source || history.provider || "OHLCV Provider",
    institutionalSource: taiwanEvidence.institutional?.provider || "TWSE / TPEx institutional source",
  }) : null;
  const news = list(result?.news).filter(item => !item.symbol || item.symbol === canonical).slice(0, 8);
  const strategy = context.strategyScan;
  const scanSummary = strategy?.matches?.length
    ? `<ul class="evidence-facts">${strategy.matches.slice(0, 8).map(item => `<li><strong>${esc(item.name || item.id)}</strong> · ${esc(item.status)} · ${esc(item.reason || "")} ${item.missing?.length ? `· 缺少 ${esc(item.missing.join(", "))}` : ""}</li>`).join("")}</ul>`
    : `<p>策略 Evidence 不足，尚無法列出可解釋的符合條件項目。</p>`;
  root.innerHTML = `${pageHead(`${canonical} · 個股研究`, `${name} · ${market === "TW" ? "台股" : "美股"} · 投資估值與研究行情分開；此處不下單。`, `<button class="secondary-button" data-action="refresh">↻ 重新讀取</button>`)}
    <div class="research-hero-grid"><section class="surface"><div class="evidence-head"><div><p class="eyebrow">${esc(market)} · RESEARCH QUOTE</p><h2>${esc(canonical)} ${esc(name)}</h2></div><span class="status-chip" data-status="${quote.available ? "AVAILABLE" : "UNAVAILABLE"}">${quote.available ? "研究行情" : "尚無行情"}</span></div><div class="evidence-value research-price">${priceText}<small>${esc(quote.currency || (market === "TW" ? "TWD" : "USD"))}</small></div><p class="tiny-note">${esc(quoteSemantics)}</p><p class="tiny-note">持股估值另讀取 investment_current_positions_view；不以研究行情回寫 Portfolio。</p></section>
    <section class="surface"><h2>個人投資脈絡</h2>${position ? `<p>${esc(position.name)} · ${esc(position.marketLabel)} · ${fmt(position.quantity, 4)} 股</p><p>估值 ${fmt(position.marketValue)} ${esc(position.currency)} · ${esc(position.asOf || "時間未提供")}</p><p class="tiny-note">來源：${esc(position.marketValueSource)}；持股估值／非即時。</p>` : `<p>此標的目前不在 canonical current holdings。</p>`}<p class="tiny-note">正式觀察名單：${esc(watchlistContext)}。</p><button class="secondary-button" data-action="open-chips" data-market="${market}" data-symbol="${esc(canonical)}" data-venue="${quote.venue || ""}">查看籌碼 / 市場 Evidence</button></section></div>
    <div class="research-grid research-evidence-grid"><section class="surface"><div class="section-title"><h2>歷史 OHLCV</h2><span>${esc(history.asOf || "資料時間未提供")} · ${bars.length} 筆</span></div>${chart}<p class="tiny-note">來源：${esc(history.source || history.provider || "未提供")} · 不可用資料保持空白。</p>${history.note ? `<p class="tiny-note">${esc(history.note)}</p>` : ""}</section>
    <section class="surface"><div class="section-title"><h2>技術指標 · 可追溯</h2><span>${esc(indicators.status)} · ${indicators.barsUsed} bars</span></div><div class="data-table-wrap"><table class="data-table"><tbody>${[["MA5",indicators.sma5],["MA20",indicators.sma20],["RSI14",indicators.rsi14],["KD K",indicators.kd?.k],["KD D",indicators.kd?.d],["MACD",indicators.macd?.macd],["MACD Signal",indicators.macd?.signal],["MACD Histogram",indicators.macd?.histogram],["Bollinger 上緣",indicators.bollinger20?.upper],["Bollinger 中線",indicators.bollinger20?.middle],["Bollinger 下緣",indicators.bollinger20?.lower],["成交量",indicators.volume?.latest]].map(([label,value]) => `<tr><th>${esc(label)}</th><td>${value == null ? "歷史樣本不足" : fmt(value, 4)}</td></tr>`).join("")}</tbody></table></div><p class="tiny-note">由實際 ${bars.length} 筆 provider OHLCV 即時計算；沒有資料時不補值。</p></section></div>
    <section class="surface"><div class="section-title"><h2>技術觀察矩陣</h2><span>條件描述，不產生買賣分數</span></div>${renderTechnicalSignalMatrix(technicalMatrix)}</section>
    <div class="research-grid research-evidence-grid"><section class="surface"><h2>可解釋的策略 Scanner</h2>${scanSummary}<p class="tiny-note">只列出策略狀態、支援 Evidence 與缺項；不產生黑箱綜合分數或買賣命令。</p></section><section class="surface"><h2>公司 / ETF / 產業 Evidence</h2>${evidence.length ? evidence.map(item => providerEvidence(item.title || item.type || "研究 Evidence", item)).join("") : `<p class="empty-state">尚無可顯示的基本資料或關聯 Evidence。</p>`}</section></div>
    ${etfPanel}
    ${renderAiResearchPanel(state.aiAnalysis)}
    ${market === "TW" ? renderCrossMarketCorrelation(state.crossMarketCorrelation?.result || null, canonical, state.crossMarketCorrelation?.referenceSymbol || "") : ""}
    <div class="section-title"><h2>籌碼與市場結構</h2><span>${market === "TW" ? "TWSE / TPEx / TDCC 原始口徑" : "台灣專屬欄位不適用美股"}</span></div><div class="evidence-grid">${renderInstitutional(taiwanEvidence.institutional || emptyProvider("TWSE / TPEx", market === "US" ? "NOT_APPLICABLE" : "UNAVAILABLE"))}${renderHolders(taiwanEvidence.ownership || emptyProvider("TDCC", market === "US" ? "NOT_APPLICABLE" : "UNAVAILABLE"), state.tdccLocalObservation)}${renderMargin(taiwanEvidence.margin || emptyProvider("TWSE / TPEx", market === "US" ? "NOT_APPLICABLE" : "UNAVAILABLE"))}${brokerBranchPanel}</div>${market === "TW" ? `${renderTdccHistoricalSeries(tdccSeries, { localObservations: tdccObservations })}${renderChipCycleObservation(chipCycle)}` : ""}
    <section class="surface"><div class="section-title"><h2>新聞與研究來源</h2><span>${news.length} 項</span></div>${news.length ? `<div class="news-list">${news.map(item => `<article><a href="${esc(item.sourceUrl || "#")}" target="_blank" rel="noopener noreferrer">${esc(item.title || "未命名訊息")}</a><p>${esc(item.summary || "摘要未提供")}</p><small>${esc(item.source || "來源未提供")} · ${esc(item.observedAt || "時間未提供")}</small></article>`).join("")}</div>` : `<p class="empty-state">目前沒有可驗證的相關新聞來源。</p>`}</section>
    <section class="surface"><div class="section-title"><h2>官方重大訊息</h2><span>公告不等同新聞或獨立查證</span></div>${renderAnnouncements(taiwanEvidence.announcements || emptyProvider("MOPS", market === "US" ? "NOT_APPLICABLE" : "UNAVAILABLE"))}</section>`;
}

function renderSearchResults(result) {
  const cards = result.items.map(item => `<article class="watch-row"><div><h3>${esc(item.symbol)} <span class="ticker">${esc(item.name)}</span></h3><p class="tiny-note">${esc(item.market)} · ${esc(item.venue)} · ${esc(item.industry || "產業資料未提供")} · ${esc(item.source || "來源未提供")}</p></div><button class="primary-button" data-action="open-research" data-market="${esc(item.market)}" data-symbol="${esc(item.symbol)}" data-venue="${esc(item.venue)}" data-name="${esc(item.name)}">開啟研究</button></article>`).join("");
  root.innerHTML = `${pageHead("股票搜尋", `${result.market === "TW" ? "台股" : "美股"} · ${esc(result.query)} · Catalog：${esc(Array.isArray(result.source) ? result.source.join(" / ") : result.source || "來源未提供")}`, "")}<section class="surface">${cards || `<p class="empty-state">Catalog 沒有找到符合項目。沒有使用猜測代碼。</p>`}</section>`;
}

function currentCandidateUniverse() {
  const rows = [
    ...list(state.portfolio?.positions).map(item => ({ symbol: item.researchSymbol || item.symbol, market: marketCode(item.market), name: item.name })),
    ...list(state.watchlist?.items).map(item => ({ symbol: item.symbol, market: marketCode(item.market), name: item.name })),
  ].filter(item => item.market && item.symbol);
  return Array.from(new Map(rows.map(item => [`${item.market}:${item.symbol}`, item])).values()).slice(0, 12);
}

function personalReadLabel(status, entity) {
  const readable = status === "AVAILABLE" || status === "EMPTY";
  if (readable) return entity === "positions"
    ? `${list(state.portfolio?.positions).length} 個目前部位`
    : `${list(state.watchlist?.items).length} 筆正式觀察`;
  const labels = {
    SESSION_REQUIRED: "登入後讀取",
    APP_ACCESS_REQUIRED: "需通過 Investment Access",
    MFA_REQUIRED: "需完成 MFA 驗證",
    OWNER_MAPPING_REQUIRED: "正式使用者映射尚未就緒",
    ACCESS_UNAVAILABLE: "授權狀態無法確認",
    UNAVAILABLE: "目前無法讀取",
    LOADING: "正在確認授權",
  };
  return labels[status] || "登入授權後讀取";
}

function renderOverview(result, watchlist) {
  const quoteRows = list(result?.quotes);
  const candidateKeys = new Set(currentCandidateUniverse().map(item => `${item.market}:${String(item.symbol).replace(/\.(TW|TWO)$/i, "")}`));
  const statusRows = list(result?.contexts)
    .filter(context => candidateKeys.has(`${context.market}:${context.symbol}`))
    .map(context => ({ symbol: context.symbol, market: marketCode(context.market), status: context.strategyScan?.status || "PARTIAL", matches: context.strategyScan?.matches?.length || 0 }));
  const hasPersonalAccess = ["AVAILABLE", "EMPTY"].includes(state.portfolio?.status)
    && ["AVAILABLE", "EMPTY"].includes(watchlist?.status);
  const scannerEmpty = hasPersonalAccess
    ? "目前沒有可掃描的已授權持股或正式觀察標的；可使用上方搜尋。"
    : "登入並通過 Investment Access 後，才會讀取持股與正式觀察名單供 Scanner 使用。";
  root.innerHTML = `${pageHead("Investment Lab 總覽", "台股與美股研究工作台。Portfolio、Research、Provider Evidence 使用不同欄位與時間語意。", `<button class="secondary-button" data-action="go-scanner">開啟選股雷達</button>`)}
    <div class="callout"><strong>資料真實性</strong><p>研究報價會顯示 provider 與時間；我的持股只顯示 canonical 估值與估值來源。兩者不互相覆寫。全站保留單一 AIOS Sidebar，本地功能使用上方分頁。</p></div>
    <div class="section-title"><h2>市場與全球脈絡</h2><span>參考背景，不是買賣訊號</span></div><div class="evidence-grid">${renderUsTreasuryContext(result?.globalMarketContext)}${renderGlobalFxContext(result?.globalReferenceContext)}${radarSummary(result?.globalCommodityContext)}</div><div class="section-title"><h3>個人標的與美股先行股票</h3><span>股票報價，不代表指數行情</span></div><div class="dense-quote-grid">${quoteRows.map(item => `<button class="dense-quote" data-action="open-research" data-market="${esc(item.market)}" data-symbol="${esc(item.symbol)}"><strong>${esc(item.symbol)}</strong><span>${item.available ? `${fmt(item.price)} ${esc(item.currency)}` : "—"}</span><small>${esc(item.provider || "Provider unavailable")} · ${esc(item.asOf || "時間未提供")}</small></button>`).join("") || `<p class="empty-state">目前沒有可驗證的標的行情回應。</p>`}</div>
    <div class="section-title"><h2>持股 / 觀察名單 Scanner</h2><span>${hasPersonalAccess ? `目前登入者的 canonical symbols · ${statusRows.length} 檔` : "個人資料需先通過 AIOS 授權"}</span></div><div class="evidence-grid">${statusRows.map(row => `<article class="evidence-card"><h3>${esc(row.symbol)} <span class="ticker">${esc(row.market || "市場未確認")}</span></h3><p>策略 Evidence 數 ${row.matches} · 狀態 ${esc(row.status)}</p>${row.market ? `<button class="secondary-button" data-action="open-research" data-market="${esc(row.market)}" data-symbol="${esc(row.symbol)}">查看研究</button>` : `<span class="tiny-note">市場未確認，不能推定研究路徑。</span>`}</article>`).join("") || `<p class="empty-state">${esc(scannerEmpty)}</p>`}</div>
    <div class="section-title"><h2>我的資料入口</h2></div><div class="summary-entry-grid"><button class="surface" data-action="go-view" data-view="holdings"><strong>我的持股</strong><span>${esc(personalReadLabel(state.portfolio?.status, "positions"))}</span></button><button class="surface" data-action="go-view" data-view="watchlist"><strong>我的觀察名單</strong><span>${esc(personalReadLabel(watchlist?.status, "watchlist"))}</span></button><button class="surface" data-action="go-view" data-view="history"><strong>我的平倉歷史</strong><span>${esc(state.closedHistory?.status === "AVAILABLE" || state.closedHistory?.status === "EMPTY" ? "正式平倉歷史" : personalReadLabel(state.closedHistory?.status || state.portfolio?.status, "history"))}</span></button></div>`;
}

function renderDenseMarket(result, twMarket) {
  const quotes = list(result?.quotes);
  const context = result || {};
  const index = twMarket?.index;
  const breadth = twMarket?.breadth;
  const institutionalRows = evidence => {
    const data = evidence?.data;
    if (!data) return "";
    const fields = [["外資", data.foreignNetShares], ["投信", data.trustNetShares], ["自營商", data.dealerNetShares], ["三大法人合計", data.allThreeNetShares]];
    return `<div class="data-table-wrap"><table class="data-table"><tbody>${fields.map(([label, value]) => `<tr><th>${label}</th><td>${value == null ? "—" : `${fmtSigned(value, 0)} 股`}</td></tr>`).join("")}</tbody></table></div><p class="tiny-note">${Number(data.securitiesRows || 0)} 個代碼列 · ${esc(data.dataDate || evidence.dataTimestamp || "日期未提供")}</p>`;
  };
  const marginRows = twMarket?.margin?.data ? ["TWSE", "TPEx"].map(venue => {
    const evidence = twMarket.margin.data[venue];
    const data = evidence?.data;
    return `<tr><th>${venue}</th><td>${data?.marginBalance == null ? "—" : `${fmt(data.marginBalance, 0)} 股`}</td><td>${data?.shortBalance == null ? "—" : `${fmt(data.shortBalance, 0)} 股`}</td><td>${esc(data?.dataDate || evidence?.dataTimestamp || "日期未提供")}</td><td>${Number(data?.securitiesRows || 0)} 列</td><td>${esc(evidence?.status || "UNAVAILABLE")}</td></tr>`;
  }).join("") : "";
  const marginContent = marginRows
    ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>市場</th><th>融資餘額</th><th>融券餘額</th><th>日期</th><th>列數</th><th>狀態</th></tr></thead><tbody>${marginRows}</tbody></table></div>`
    : "";
  root.innerHTML = `${pageHead("市場 / Global Context", "TWSE 官方市場統計與經授權的研究行情分開顯示。海外指標僅作背景參考。", `<button class="secondary-button" data-action="refresh">↻ 更新</button>`)}
    <div class="callout"><strong>Context only</strong><p>海外指數、匯率與商品是市場背景，不直接轉成個股買賣訊號。各項保留自己的 provider、日期與 freshness。</p></div>
    <div class="section-title"><h2>台股市場</h2><span>官方開放資料 · 日頻</span></div><div class="evidence-grid">${providerEvidence("TWSE 加權指數", index)}${providerEvidence("上市櫃市場廣度", breadth)}${providerEvidence("臺指期盤後情境", twMarket?.futures || {})}${evidenceCard("上市三大法人彙總", twMarket?.institutions, institutionalRows(twMarket?.institutions))}${evidenceCard("上櫃三大法人彙總", twMarket?.tpexInstitutions, institutionalRows(twMarket?.tpexInstitutions))}${evidenceCard("上市／上櫃融資融券餘額", twMarket?.margin, marginContent)}</div>
    <div class="section-title"><h2>美股先行股票</h2><span>${quotes.length} 個股票 · 不代表 S&amp;P / Nasdaq / SOX 指數</span></div><div class="dense-quote-grid">${quotes.map(item => `<button class="dense-quote" data-action="open-research" data-market="US" data-symbol="${esc(item.symbol)}"><strong>${esc(item.symbol)}</strong><span>${item.available ? `${fmt(item.price)} ${esc(item.currency)}` : "—"}</span><small>${esc(item.provider || "來源未提供")} · ${esc(item.asOf || "時間未提供")} · ${esc(item.freshness || "時效未知")}</small></button>`).join("")}</div>
    <div class="section-title"><h2>Global Market Context</h2><span>來源可用才顯示數字</span></div><div class="evidence-grid">${renderUsTreasuryContext(context.globalMarketContext)}${renderGlobalFxContext(context.globalReferenceContext)}${radarSummary(context.globalCommodityContext)}${providerEvidence("USD/TWD FX", context.fx)}${list(context.news).length ? `<article class="surface"><h2>相關市場新聞</h2><ul>${list(context.news).slice(0, 8).map(item => `<li><a href="${esc(item.sourceUrl || "#")}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a> · ${esc(item.source || "來源未提供")} · ${esc(item.observedAt || "時間未提供")}</li>`).join("")}</ul></article>` : `<p class="empty-state">沒有可顯示的宏觀新聞。</p>`}</div>`;
}

function renderBacktestResult(output) {
  if (!output) return "";
  const { plan, result } = output;
  if (!result) return `<div class="callout" data-backtest-plan="${esc(plan.status)}"><strong>${esc(plan.status === "INSUFFICIENT_EVIDENCE" ? "歷史不足" : plan.status === "NO_CROSSINGS" ? "期間內沒有交叉交易" : "回測不可用")}</strong><p>${esc(plan.reason)}</p></div>`;
  const metrics = result.metrics || {};
  const trades = list(result.trades).map(trade => `<tr><td>${esc(trade.entryAt || "—")}</td><td>${esc(trade.exitAt || "尚未平倉")}</td><td>${fmt(trade.entryPrice)}</td><td>${fmt(trade.exitPrice)}</td><td>${trade.return == null ? "—" : `${fmt(Number(trade.return) * 100, 2)}%`}</td></tr>`).join("");
  const settings = output.settings || { feeBps: 0, slippageBps: 0 };
  return `<section class="surface backtest-result" data-backtest-result="${esc(result.status)}"><div class="section-title"><h2>歷史回測結果</h2><span>${esc(result.status)} · ${Number(metrics.completedTrades || 0)} 筆已完成交易</span></div><div class="metric-row"><div class="metric"><label>勝率</label><strong>${metrics.winRate == null ? "—" : `${fmt(metrics.winRate * 100, 2)}%`}</strong></div><div class="metric"><label>累積報酬</label><strong>${metrics.cumulativeReturn == null ? "—" : `${fmtSigned(metrics.cumulativeReturn * 100, 2)}%`}</strong></div><div class="metric"><label>最大回撤</label><strong>${metrics.maxDrawdown == null ? "—" : `${fmt(metrics.maxDrawdown * 100, 2)}%`}</strong></div><div class="metric"><label>樣本數</label><strong>${Number(metrics.sampleCount || 0)}</strong></div></div><p class="tiny-note">執行時點：訊號於收盤確認，下一根 bar 開盤成交 · 成本：手續費 ${Number(settings.feeBps)} bps / 滑價 ${Number(settings.slippageBps)} bps。未納入市場特定稅費、股利、融資與公司行動調整。</p>${trades ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>進場日</th><th>出場日</th><th>進場價</th><th>出場價</th><th>單筆報酬</th></tr></thead><tbody>${trades}</tbody></table></div>` : `<p class="empty-state">目前沒有完整的進出場交易，不顯示推估績效。</p>`}${list(result.warnings).length ? `<ul class="tiny-note">${list(result.warnings).map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}</section>`;
}

function renderBacktestView({ history = null, output = null, loadingHistory = false, error = "" } = {}) {
  const target = state.symbol ? `${state.market} · ${state.symbol}` : "尚未選擇標的";
  const historyNote = history ? `${history.bars?.length || 0} 根 bars · ${esc(history.provider || "來源未提供")} · 資料日期 ${esc(history.asOf || "未提供")}` : "尚無歷史資料";
  const plan = output?.plan || (history ? buildSmaCrossoverSignals(history.bars, { provider: history.provider || "market history", sourceUrl: list(history.source)[0] || "" }) : null);
  const settings = output?.settings || { feeBps: 0, slippageBps: 0 };
  root.innerHTML = `${pageHead("策略回測", "使用選定標的的歷史 OHLCV 測試明確規則；只做回溯研究，不下單、不保存交易。", "")}<section class="surface backtest-setup"><div class="section-title"><h2>測試標的</h2><span>${esc(target)}</span></div>${state.symbol ? `<p>${historyNote}</p>` : `<p class="empty-state">先用上方股票搜尋選擇一檔台股或美股，再開啟策略回測。</p>`}${history?.available === false && history.bars?.length === 0 ? `<p class="error-state">此標的目前沒有可用的已驗證歷史行情；不會使用持股估值或模擬價格補值。</p>` : ""}${error ? `<p class="error-state">${esc(error)}</p>` : ""}${loadingHistory ? `<p class="loading-state">正在讀取歷史 OHLCV…</p>` : ""}${state.symbol ? `<form class="scanner-filter-form backtest-form" data-backtest-form><label>策略規則<select name="strategy" disabled><option value="sma">SMA ${Number(plan?.fastWindow || 5)} 上穿／下穿 SMA ${Number(plan?.slowWindow || 20)}</option></select></label><label>快線日數<input name="fastWindow" type="number" min="2" max="99" value="${Number(plan?.fastWindow || 5)}" required></label><label>慢線日數<input name="slowWindow" type="number" min="3" max="200" value="${Number(plan?.slowWindow || 20)}" required></label><label>單邊手續費（bps）<input name="feeBps" type="number" min="0" max="1000" step="0.1" value="${Number(settings.feeBps)}" required></label><label>單邊滑價（bps）<input name="slippageBps" type="number" min="0" max="1000" step="0.1" value="${Number(settings.slippageBps)}" required></label><button type="submit" class="primary-button" ${history?.bars?.length ? "" : "disabled"}>執行回測</button></form><p class="tiny-note">訊號只由已完成日 K 的收盤價計算，下一根日 K 開盤成交。0 bps 代表未計成本；請依市場／券商實際費率調整。行情未經還原調整時，報酬不適用於含股利或公司行動的精確績效核對。</p>${plan ? `<p class="tiny-note" data-backtest-evidence="${esc(plan.status)}">${esc(plan.reason)} · ${historyNote}</p>` : ""}` : ""}</section>${renderBacktestResult(output)}`;
}

async function loadBacktestView() {
  state.view = "backtest"; applyNav();
  if (!state.symbol) { state.backtest = null; renderBacktestView(); return; }
  const { requestId } = startRequest(`正在載入 ${state.symbol} 歷史回測資料…`);
  try {
    const history = await labMarketProvider.getHistory({ symbol: state.symbol, market: state.market });
    if (requestId !== state.request) return;
    state.backtest = { history, output: null };
    renderBacktestView({ history });
  } catch (error) {
    if (requestId !== state.request) return;
    state.backtest = null;
    renderBacktestView({ error: `歷史行情讀取失敗（${error?.code || "HISTORY_UNAVAILABLE"}）。資料保持空白。` });
  }
}

function runCurrentBacktest(form) {
  const history = state.backtest?.history;
  const engine = globalThis.InvestmentStrategyBacktest;
  if (!history || !list(history.bars).length || typeof engine?.run !== "function") {
    renderBacktestView({ history, error: "歷史資料或既有只讀回測 engine 不可用。" });
    return;
  }
  const fields = new FormData(form);
  const fastWindow = Number(fields.get("fastWindow"));
  const slowWindow = Number(fields.get("slowWindow"));
  const feeBps = Number(fields.get("feeBps"));
  const slippageBps = Number(fields.get("slippageBps"));
  const output = runSmaCrossoverBacktest(history.bars, engine, {
    fastWindow, slowWindow, feeBps, slippageBps,
    provider: history.provider || "market history",
    sourceUrl: list(history.source)[0] || "",
  });
  state.backtest.output = output;
  renderBacktestView({ history, output });
}

function appendTaiwanSectorSummary(scan) {
  const section = document.createElement("section");
  section.className = "surface scanner-sector-summary";
  const title = document.createElement("h2");
  title.textContent = "台股產業廣度 / 官方日收";
  section.appendChild(title);
  const note = document.createElement("p");
  note.className = "tiny-note";
  note.textContent = "按交易所公司產業分類彙整最新可得日收；上市與上櫃分開，平均漲跌幅為等權觀察，不是市值加權指數或交易訊號。";
  section.appendChild(note);
  const data = Array.isArray(scan?.sectorSummary) ? scan.sectorSummary : [];
  if (!data.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "目前沒有可驗證的產業分類日收資料。";
    section.appendChild(empty);
    root.appendChild(section);
    return;
  }
  section.insertAdjacentHTML("beforeend", renderTaiwanSectorHeatmap(data));
  root.appendChild(section);
}

function renderResearch(data) {
  state.research = data;
  state.symbol = data.symbol;
  const quote = data.quote;
  const currentCard = state.home?.cards?.find((item) => item.symbol === data.symbol);
  const portfolioPosition = portfolioPositionForSymbol(data.symbol);
  const displayName = symbolLabelFor(data.symbol, state.market, portfolioPosition?.name || data.symbol);
  const notes = loadNotes();
  const noteText = notes[data.symbol] || "";
  const history = data.history?.data;
  const chart = renderResearchOhlcvChart(data.history, { market: state.market });
  const barNote = history?.length ? `共 ${history.length} 筆 · ${history[0].date} 至 ${history.at(-1).date}` : "歷史資料未接通";
  const fundamental = data.instrumentType === "ETF" ? `${displayName} 為 ETF，不顯示營運公司財報作為基金基本面。基金成分、權重、淨值與配息資料仍未接通。` : "公司揭露為官方最新可得資訊；財報期間與欄位口徑依來源呈現。";
  root.innerHTML = `${pageHead(`${data.symbol} 個股研究`, `${displayName} · ${data.instrumentType} · 研究只讀取有來源的證據，不形成買賣指令。`, `<button class="secondary-button" data-action="home">返回總覽</button><button class="primary-button" data-action="toggle-watch" data-market="${state.market}" data-symbol="${esc(data.symbol)}">${isWatched(data.symbol, state.market) ? "移出觀察" : "加入觀察"}</button>`)}
    ${renderPortfolioResearchContext(portfolioPosition)}
    <div class="layout-two"><section class="surface"><div class="evidence-head"><div><p class="eyebrow">OFFICIAL CLOSE</p><h2>${esc(currentCard?.name || symbolLabelFor(data.symbol, state.market))} · ${esc(data.symbol)}</h2></div>${badge(quote)}</div>${quoteHeadline(quote)}<p class="tiny-note">${esc(quote?.note || "最新可得官方收盤資料")} · ${esc(quote?.dataTimestamp || "資料日期未提供")}</p></section><section class="surface"><h2>觀察筆記</h2><p class="tiny-note">只保存在目前瀏覽器，不會送到 Cloud。</p><div class="note-editor"><textarea data-note-input aria-label="個股觀察筆記" placeholder="記錄待查問題或個人觀察…">${esc(noteText)}</textarea><div><button class="primary-button" data-action="save-note" data-symbol="${esc(data.symbol)}">儲存筆記</button> <span class="flash" data-note-status></span></div></div></section></div>
    <div class="section-title"><h2>價格與技術</h2><span>${esc(barNote)}</span></div><div class="layout-two"><section class="surface"><div class="evidence-head"><h2>官方日收歷史</h2>${badge(data.history)}</div>${chart}<p class="tiny-note">${esc(data.history?.note || "未提供")}</p><details><summary>來源與證據</summary>${sourceDetails(data.history)}</details></section>${indicatorRows(data.indicators)}</div>
    <div class="section-title"><h2>營運與基本面</h2><span>不適用／未接欄位保留原狀</span></div><div class="evidence-grid">${evidenceCard("公司基本資料", data.profile, data.profile?.data ? `<div class="metric-row"><div class="metric"><label>公司</label><strong>${esc(data.profile.data.name || "—")}</strong></div><div class="metric"><label>產業（官方原文）</label><strong>${esc(data.profile.data.industry || "—")}</strong></div><div class="metric"><label>交易市場</label><strong>${esc(data.profile.data.venue || "—")}</strong></div></div><p class="evidence-note">${esc(data.profile.data.business || "業務描述未提供")}</p>` : "")}${evidenceCard("月營收", data.revenue, data.revenue?.data ? `<div class="evidence-value">${fmt(data.revenue.data.amountThousandTwd, 0)}<small> 千元</small></div><p class="tiny-note">${esc(data.revenue.data.period || "期間未提供")} · 年增 ${fmtSigned(data.revenue.data.yearOverYearPercent)}% · 月增 ${fmtSigned(data.revenue.data.monthOverMonthPercent)}%</p>` : "")}${evidenceCard("最新損益", data.income, data.income?.data ? `<p>${esc(data.income.data.period || "期間未提供")} · ${esc(data.income.data.scope || "")}</p><p>營收 ${fmt(data.income.data.revenueThousandTwd, 0)} 千元 · EPS ${fmt(data.income.data.eps, 2)} 元</p>` : "")}${evidenceCard("資產負債", data.balance, data.balance?.data ? `<p>${esc(data.balance.data.period || "期間未提供")} · ${esc(data.balance.data.scope || "")}</p><p>資產 ${fmt(data.balance.data.assetsThousandTwd, 0)} 千元 · 負債 ${fmt(data.balance.data.liabilitiesThousandTwd, 0)} 千元 · 權益 ${fmt(data.balance.data.equityThousandTwd, 0)} 千元</p>` : "")}</div>
    <p class="tiny-note">${esc(fundamental)}</p>
    <div class="section-title"><h2>籌碼與市場背景</h2><span>股數／級距定義依原始提供者</span></div><div class="evidence-grid">${renderHolders(data.holders)}${renderInstitutional(data.institutional)}${renderMargin(data.margin)}${evidenceCard("臺指期背景（盤後）", data.futuresContext, data.futuresContext?.data ? `<div class="evidence-value">${fmt(data.futuresContext.data.last, 2)}</div><p class="tiny-note">${esc(data.futuresContext.data.contract)} ${esc(data.futuresContext.data.contractMonth)} · ${esc(data.futuresContext.data.session)} · 漲跌 ${fmtSigned(data.futuresContext.data.change, 2)}</p>` : "")}</div>
    <div class="section-title"><h2>官方公告與來源缺口</h2><span>公告不等同媒體新聞</span></div><div class="layout-two">${renderAnnouncements(data.announcements)}<section class="surface"><h2>尚未接通的研究能力</h2><ul>${list(data.gaps).map((gap) => `<li><strong>${esc(gap.capability)}</strong> · ${esc(gap.status)}<br><span class="tiny-note">${esc(gap.note)}</span></li>`).join("")}</ul><p class="tiny-note">${esc(data.industryRadar?.[0]?.note || "產業價格證據不會自動轉為個股好壞方向。")}</p></section></div>
    <div class="section-title"><h2>產業價格參考</h2><span>來源取得不等於個股曝險已知</span></div><div class="evidence-grid">${radarSummary(data.industryRadar)}</div>`;
}

function renderHolders(ev, localObservation = null) {
  return evidenceCard("TDCC 股權分散", ev, renderTdccOwnership(ev, localObservation));
}

function recordResearchTdccObservation(symbol, market, taiwanEvidence = []) {
  if (market !== "TW") {
    state.tdccLocalObservation = null;
    return null;
  }
  const canonical = String(symbol || "").toUpperCase().replace(/\.(TW|TWO)$/, "");
  const item = list(taiwanEvidence).find(value => value?.market === "TW" && String(value?.symbol || "").toUpperCase().replace(/\.(TW|TWO)$/, "") === canonical);
  state.tdccLocalObservation = item?.evidence?.ownership
    ? recordTdccLocalObservation({ symbol: canonical, venue: item.venue, evidence: item.evidence.ownership })
    : null;
  return state.tdccLocalObservation;
}

function renderInstitutional(ev) {
  const d = ev?.data;
  const labels = [["外資淨買賣超", d?.foreignNetShares], ["投信淨買賣超", d?.trustNetShares], ["自營商淨買賣超", d?.dealerNetShares], ["三大法人合計", d?.allThreeNetShares]];
  const content = d ? `<div class="data-table-wrap"><table class="data-table"><tbody>${labels.map(([name, value]) => `<tr><th>${esc(name)}</th><td>${value == null ? "—" : `${fmtSigned(value, 0)} 股`}</td></tr>`).join("")}</tbody></table></div>${renderInstitutionalFlowSummary(d.historySummary)}` : "";
  return evidenceCard("三大法人", ev, content);
}

function renderMargin(ev) {
  return evidenceCard("融資融券", ev, renderTaiwanMarginBalance(ev));
}

function renderAnnouncements(ev) {
  const rows = list(ev?.data);
  const content = rows.length ? `<ol>${rows.map((row) => `<li><time>${esc(row.date || "日期未提供")} ${esc(row.time || "")}</time> · ${esc(row.title)} <span class="tiny-note">${esc(row.source)}</span></li>`).join("")}</ol>` : "";
  return evidenceCard("MOPS 重大訊息", ev, content);
}

function renderMarket(data) {
  const index = data.index, breadth = data.breadth, institutions = data.institutions;
  root.innerHTML = `${pageHead("大盤脈搏", "以官方日收統計呈現市場廣度；不將統計描述成預測或買賣訊號。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}<div class="callout"><strong>讀法</strong><p>漲跌家數包含 ETF、未依市值加權。加權指數與三大法人各自保留官方資料日期，不把缺值補成零。</p></div><div class="evidence-grid section-title-grid">${evidenceCard("加權指數", index, index?.data ? `<div class="evidence-value">${fmt(index.data.index, 2)}</div><p class="tiny-note">${esc(index.data.date)} · 成交量 ${fmt(index.data.volume, 0)} · 漲跌 ${fmtSigned(index.data.change, 2)}</p>` : "")}${evidenceCard("上市櫃漲跌分布", breadth, breadth?.data ? `<div class="metric-row"><div class="metric"><label>上漲</label><strong>${fmt(breadth.data.up, 0)}</strong></div><div class="metric"><label>下跌</label><strong>${fmt(breadth.data.down, 0)}</strong></div><div class="metric"><label>平盤</label><strong>${fmt(breadth.data.flat, 0)}</strong></div></div><p class="tiny-note">資料列數 ${fmt(breadth.data.rows, 0)} · 含 ETF</p>` : "")}${evidenceCard("上市三大法人彙總", institutions, institutions?.data ? `<div class="data-table-wrap"><table class="data-table"><tbody><tr><th>外資</th><td>${fmtSigned(institutions.data.foreignNetShares, 0)} 股</td></tr><tr><th>投信</th><td>${fmtSigned(institutions.data.trustNetShares, 0)} 股</td></tr><tr><th>自營商</th><td>${fmtSigned(institutions.data.dealerNetShares, 0)} 股</td></tr></tbody></table></div>` : "")}${evidenceCard("市場融資融券總量", data.margin, "")}${evidenceCard("產業類股廣度", data.sectors, "")}</div>`;
}

function renderRadar(items) {
  const content = list(items).map((item) => {
    const observations = list(item.data?.observations);
    let display = "";
    if (observations.length) {
      display = `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>指標</th><th>月份</th><th>月均值</th><th>月變化</th><th>單位</th></tr></thead><tbody>${observations.map((entry) => `<tr><td>${esc(entry.indicator)}</td><td>${esc(entry.month)}</td><td>${fmt(entry.value, 2)}</td><td>${fmtSigned(entry.changePercent)}%</td><td>${esc(entry.unit)}</td></tr>`).join("")}</tbody></table></div>`;
    }
    return evidenceCard(item.data?.label || item.provider, item, display);
  }).join("");
  root.innerHTML = `${pageHead("產業價格雷達", "只呈現來源授權已審且實際讀取的參考資料；價格變化不代表研究標的直接曝險或股價方向。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}<div class="callout"><strong>來源邊界</strong><p>只顯示已取得且保留來源、時間與單位的市場參考；未接通或授權未審的資料不會填值，也不會推導個股曝險。</p></div><div class="section-title"><h2>產業價格參考</h2><span>只顯示已驗證觀測</span></div><div class="evidence-grid">${content || `<p class="empty-state">目前沒有可顯示的已驗證產業觀測。</p>`}</div>`;
}

function loadLocalWatch() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_LOCAL_WATCH) || "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
      const candidate = typeof item === "string" ? { symbol: item, market: "" } : item;
      const symbol = String(candidate?.symbol || "").trim().toUpperCase();
      const market = marketCode(candidate?.market) || (/\.(TW|TWO)$/.test(symbol) ? "TW" : "");
      return /^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^[A-Z0-9._-]{1,19})(?:\.(?:TW|TWO))?$/.test(symbol)
        ? [{ symbol, market }]
        : [];
    });
  } catch { return []; }
}
function loadNotes() { try { const value = JSON.parse(localStorage.getItem(STORE_NOTES) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function loadNotificationSettings() {
  if (state.notificationSettings) return state.notificationSettings;
  try { state.notificationSettings = normalizeWatchlistNotificationSettings(JSON.parse(localStorage.getItem(STORE_NOTIFICATION_SETTINGS) || "{}")); }
  catch { state.notificationSettings = normalizeWatchlistNotificationSettings({}); }
  return state.notificationSettings;
}
function saveNotificationSettings(value) {
  state.notificationSettings = normalizeWatchlistNotificationSettings(value);
  try { localStorage.setItem(STORE_NOTIFICATION_SETTINGS, JSON.stringify(state.notificationSettings)); } catch {}
  state.notificationDigest = buildWatchlistNotificationDigest(state.watchlistEvents?.items, state.notificationSettings);
}
function localWatchKey(symbol, market) { return `${marketCode(market) || "UNRESOLVED"}:${String(symbol || "").toUpperCase()}`; }
function isWatched(symbol, market = state.market) { return loadLocalWatch().some(item => localWatchKey(item.symbol, item.market) === localWatchKey(symbol, market)); }

function renderWatchlist() {
  const canonical = state.watchlist || { status: "UNAVAILABLE", items: [] };
  const formalRows = list(canonical.items).map(item => `<article class="watch-row" data-watchlist-id="${esc(item.id)}"><div><h3>${researchLink(`${item.symbol || "—"} ${item.name || "名稱未提供"}`, { symbol: item.symbol, market: item.market })}</h3><dl class="watch-canonical-fields"><div><dt>市場</dt><dd>${esc(item.market || "—")}</dd></div><div><dt>狀態</dt><dd>${esc(item.status || "—")}</dd></div><div><dt>研究主題</dt><dd>${esc(item.researchTheme || "—")}</dd></div><div><dt>重要度</dt><dd>${item.importance == null ? "—" : esc(item.importance)}</dd></div><div><dt>更新時間</dt><dd>${esc(item.updatedAt || "—")}</dd></div></dl><p class="tiny-note">觀察原因：${esc(item.reason || "—")}</p></div></article>`).join("");
  const watched = loadLocalWatch();
  const notes = loadNotes();
  const localCards = watched.map(({ symbol, market }) => {
    const note = notes[localWatchKey(symbol, market)] || notes[symbol] || "尚未記錄個人筆記。";
    return `<article class="watch-row"><div><h3>${esc(symbolLabelFor(symbol, market))} <span class="ticker">${esc(symbol)}</span></h3><p class="tiny-note">${esc(note.slice(0, 110))}</p></div><div class="watch-controls"><button class="secondary-button" data-action="remove-watch" data-market="${market}" data-symbol="${esc(symbol)}">移除暫存</button></div></article>`;
  }).join("");
  const accessMessage = {
    SESSION_REQUIRED: "請登入後讀取正式觀察名單。",
    APP_ACCESS_REQUIRED: "目前帳號尚未取得 Investment 使用權。",
    MFA_REQUIRED: "請完成既有安全驗證後重新讀取。",
    OWNER_MAPPING_REQUIRED: "目前登入身份尚未完成 Investment 對應。",
    ACCESS_UNAVAILABLE: "目前無法確認 Investment 使用權。",
    UNAVAILABLE: "正式觀察名單暫時無法讀取；不會以本機資料替代。",
  };
  const formalContent = canonical.status === "AVAILABLE"
    ? formalRows || `<p class="empty-state">正式觀察名單目前沒有資料。</p>`
    : `<p class="portfolio-state" data-state="${esc(canonical.status)}">${esc(accessMessage[canonical.status] || accessMessage.UNAVAILABLE)}</p>`;
  const eventResult = state.watchlistEvents || { status: "UNAVAILABLE", items: [] };
  const eventRows = list(eventResult.items).map(item => `<article class="news-list-item" data-watch-event-market="${esc(item.market)}" data-watch-event-symbol="${esc(item.symbol)}"><div><strong>${esc(item.symbol)} ${esc(item.name)}</strong><span class="status-chip" data-status="PARTIAL">${esc(item.stale ? "候選訊息 · 來源結果較舊" : "候選訊息")}</span></div><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><p>${esc(item.summary || "來源未提供摘要")}</p><small>${esc(item.source || "來源未提供")} · ${esc(item.observedAt || "時間未提供")} · ${esc(item.market)}</small></article>`).join("");
  const eventContent = eventResult.status === "AVAILABLE" || eventResult.status === "PARTIAL"
    ? eventRows || `<p class="empty-state">本次沒有找到可顯示的候選訊息。</p>`
    : eventResult.status === "EMPTY"
      ? `<p class="empty-state">正式觀察名單目前沒有可檢查的標的。</p>`
      : `<p class="portfolio-state" data-state="${esc(eventResult.status)}">${esc(eventResult.note || "候選訊息目前不可讀取；正式名單仍可照常查看。")}</p>`;
  const settings = loadNotificationSettings();
  const schedule = buildWatchlistNotificationSchedule(settings);
  const digest = state.notificationDigest || buildWatchlistNotificationDigest(eventResult.items, settings);
  const notificationSettings = `<section class="surface watchlist-notification-settings"><div class="section-title"><h2>訊息摘要設定</h2><span>僅為本機設定預覽</span></div><p class="tiny-note">正式觀察名單仍為唯讀。此設定目前保存在本機瀏覽器，尚無背景排程或寄送服務；不會要求輸入 Email、Token 或 Secret。</p><form class="scanner-filter-form" data-notification-settings><label><span>啟用摘要</span><input type="checkbox" name="enabled" ${settings.enabled ? "checked" : ""}></label><label>頻率<select name="frequency"><option value="IMMEDIATE" ${settings.frequency === "IMMEDIATE" ? "selected" : ""}>事件觸發（需伺服器排程）</option><option value="DAILY" ${settings.frequency === "DAILY" ? "selected" : ""}>每日</option><option value="WEEKLY" ${settings.frequency === "WEEKLY" ? "selected" : ""}>每週</option></select></label><label>本地時間<input type="time" name="timeLocal" value="${esc(settings.timeLocal)}"></label><label>時區<input name="timezone" value="${esc(settings.timezone)}" maxlength="80"></label><label>送達偏好<select name="deliveryPreference"><option value="email" ${settings.deliveryPreference === "email" ? "selected" : ""}>Email</option><option value="push" ${settings.deliveryPreference === "push" ? "selected" : ""}>Push</option></select></label><button type="submit" class="secondary-button">儲存本機設定</button><button type="button" class="secondary-button" data-action="preview-notification-digest">產生候選摘要</button></form><p class="tiny-note" data-notification-schedule="${esc(schedule.cadence)}">排程契約：${esc(schedule.cadence)} · ${esc(schedule.timezone)} ${String(schedule.localHour).padStart(2, "0")}:${String(schedule.localMinute).padStart(2, "0")} · ${schedule.requiresServerScheduler ? "需要受控 server scheduler" : ""}</p><div class="callout" data-notification-digest="${esc(digest.status)}"><strong>候選摘要：${digest.itemCount} 項 · 寄送狀態 ${esc(digest.deliveryStatus)}</strong><p>${esc(digest.note)}${digest.requiresHumanReview ? " 需人工核對來源原文。" : ""}</p></div></section>`;
  root.innerHTML = `${pageHead("我的觀察名單", "正式名單直接讀取 canonical watchlists；此 Lab 不提供雲端寫入。", `<button class="secondary-button" data-action="refresh-watch-events">重新檢查訊息</button><button class="secondary-button" data-action="add-symbol">＋ 本機暫存</button>`)}<section class="surface"><h2>我的正式觀察名單</h2><p class="portfolio-source-note">來源：watchlists · 依目前登入帳號讀取</p>${formalContent}</section><section class="surface watchlist-events-section"><div class="section-title"><h2>觀察名單訊息候選</h2><span>${Number(eventResult.scannedCount || 0)} / ${Number(eventResult.totalCount || 0)} 檔已檢查</span></div><p class="tiny-note">候選來源是依股票代號／名稱搜尋的 Provider 結果，仍需核對原文，不代表已確認重大訊息。Email／推播需要 AIOS 通知服務設定；本區目前不寄送通知。</p>${eventContent}${eventResult.unscannedCount ? `<p class="tiny-note">尚有 ${Number(eventResult.unscannedCount)} 檔未檢查；按「重新檢查訊息」重跑目前可用範圍。</p>` : ""}</section>${notificationSettings}<section class="surface local-watchlist-section"><div class="section-title"><h2>本機暫存觀察</h2><span>只保存在此瀏覽器，不會與正式名單同步</span></div>${localCards || `<p class="empty-state">目前沒有本機暫存觀察。</p>`}</section>`;
}

async function loadWatchlistEventCandidates() {
  if (!labMarketProvider?.getWatchlistEventCandidates) {
    state.watchlistEvents = { status: "UNAVAILABLE", items: [], note: "AIOS authenticated provider unavailable." };
    if (state.view === "watchlist") renderWatchlist();
    return state.watchlistEvents;
  }
  const prior = state.watchlistEvents;
  state.watchlistEvents = { status: "LOADING", items: [], totalCount: prior?.totalCount || 0, scannedCount: 0, note: "正在讀取候選訊息。" };
  if (state.view === "watchlist") renderWatchlist();
  try {
    state.watchlistEvents = await labMarketProvider.getWatchlistEventCandidates(list(state.watchlist?.items), { maxSymbols: 20 });
  } catch (error) {
    state.watchlistEvents = { status: readErrorStatus(error), items: [], totalCount: list(state.watchlist?.items).length, scannedCount: 0, note: `候選訊息讀取失敗（${String(error?.code || "PROVIDER_UNAVAILABLE").slice(0, 80)}）；正式觀察名單仍可照常查看。` };
  }
  if (state.view === "watchlist") renderWatchlist();
  return state.watchlistEvents;
}

function renderClosedHistory() {
  const result = state.closedHistory || { status: "UNAVAILABLE", items: [] };
  const messages = {
    SESSION_REQUIRED: "請登入後讀取平倉歷史。",
    APP_ACCESS_REQUIRED: "目前帳號尚未取得 Investment 使用權。",
    MFA_REQUIRED: "請完成既有安全驗證後重新讀取。",
    OWNER_MAPPING_REQUIRED: "目前登入身份尚未完成 Investment 對應。",
    ACCESS_UNAVAILABLE: "目前無法確認 Investment 使用權。",
    UNAVAILABLE: "平倉歷史暫時無法讀取；不會自行推算或補入紀錄。",
  };
  const rows = list(result.items).map(item => {
    const market = marketCode(item.market);
    const transactionAction = market
      ? `<button class="secondary-button" data-action="transaction-details" data-market="${market}" data-symbol="${esc(item.symbol)}">讀取交易明細</button>`
      : `<span class="tiny-note">市場身分未確認，無法安全篩選交易明細。</span>`;
    return `<article class="watch-row"><div><h3>${researchLink(`${item.symbol || "—"} ${item.name || "名稱未提供"}`, { symbol: item.symbol, market: item.market })}</h3><dl class="watch-canonical-fields"><div><dt>市場</dt><dd>${esc(item.market || "—")}</dd></div><div><dt>幣別</dt><dd>${esc(item.currency || "—")}</dd></div><div><dt>已實現損益</dt><dd>${item.realizedPnl == null ? "—" : fmtSigned(item.realizedPnl)}</dd></div><div><dt>生效時間</dt><dd>${esc(item.effectiveAt || "—")}</dd></div><div><dt>來源類型 / ID</dt><dd>${esc(item.sourceKind || "—")} · ${esc(item.sourceId || "—")}</dd></div></dl>${transactionAction}</div></article>`;
  }).join("");
  const content = result.status === "AVAILABLE"
    ? rows || `<p class="empty-state">目前沒有可顯示的平倉歷史。</p>`
    : result.status === "EMPTY"
      ? `<p class="empty-state">目前沒有可顯示的平倉歷史。</p>`
      : `<p class="portfolio-state" data-state="${esc(result.status)}">${esc(messages[result.status] || messages.UNAVAILABLE)}</p>`;
  root.innerHTML = `${pageHead("我的平倉歷史", "來源：investment_current_positions_view · position_status = history · 唯讀 canonical projection。", "")}<section class="surface"><h2>已平倉部位</h2>${content}</section>`;
}

function renderError(message, retry = true) {
  root.innerHTML = `<div class="error-state"><strong>頁面資料暫時無法載入</strong><p>${esc(message)}</p><p>其他已載入資料不受影響；可重新整理再試。</p>${retry ? `<button class="primary-button" data-action="refresh">重新整理</button>` : ""}</div>`;
}

async function loadHoldingsView() {
  state.view = "holdings"; applyNav();
  const { requestId } = startRequest("正在讀取已授權的正式持股…");
  await loadPortfolioSnapshot(true);
  if (requestId !== state.request) return;
  if (state.portfolio.status === "AVAILABLE" && labMarketProvider) {
    state.portfolioHistories = await loadPortfolioHistoryMap({
      positions: state.portfolio.positions,
      loadHistory: async (symbol, position) => {
        const market = marketCode(position?.market);
        if (!market) return { available: false, bars: [], error: "MARKET_IDENTITY_UNRESOLVED" };
        const result = await labMarketProvider.getHistory({
          symbol,
          market,
          venue: position?.venue || "",
        });
        return {
          status: result.available === true ? "AVAILABLE" : list(result.bars).length ? "PARTIAL" : "UNAVAILABLE",
          dataTruth: "REAL",
          provider: result.provider || "Provider 未提供",
          source: result.source ? [result.source] : [],
          dataTimestamp: result.asOf || null,
          fetchedAt: null,
          stale: result.stale === true ? true : result.stale === false ? false : null,
          delayed: result.delayed === true ? true : result.delayed === false ? false : null,
          fallback: result.fallback === true,
          errorCode: result.error || null,
          data: list(result.bars).map(bar => ({ ...bar, date: bar.date || bar.asOf || null })),
        };
      },
    });
  } else {
    state.portfolioHistories = new Map();
  }
  if (requestId !== state.request) return;
  root.innerHTML = renderPortfolioSection(state.portfolio, state.portfolioHistories);
}

async function loadWatchlistView() {
  state.view = "watchlist"; applyNav();
  const { requestId } = startRequest("正在讀取已授權的正式觀察名單…");
  await loadWatchlistSnapshot(true);
  if (requestId !== state.request) return;
  if (state.watchlist.status === "AVAILABLE" || state.watchlist.status === "EMPTY") await loadWatchlistEventCandidates();
  else state.watchlistEvents = { status: state.watchlist.status, items: [], totalCount: 0, scannedCount: 0, note: "請先通過既有 AIOS 身分與授權檢查，再讀取候選訊息。" };
  if (requestId === state.request) renderWatchlist();
}

async function loadClosedHistoryView() {
  state.view = "history"; applyNav();
  const { requestId } = startRequest("正在讀取已授權的平倉歷史…");
  if (!portfolioAdapter?.loadClosedPositions) state.closedHistory = { status: "UNAVAILABLE", items: [] };
  else {
    try { state.closedHistory = await portfolioAdapter.loadClosedPositions(); }
    catch (error) { state.closedHistory = { status: readErrorStatus(error), items: [] }; }
  }
  if (requestId !== state.request) return;
  renderClosedHistory();
}

async function loadLabResearch(symbol = state.symbol, { market = state.market, venue = "", name = "" } = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!/^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^[A-Z0-9._-]{1,19})(?:\.(?:TW|TWO))?$/.test(normalizedSymbol)) return renderError("研究代碼格式無法辨識。", false);
  const requestedMarket = marketCode(market);
  if (!requestedMarket) return renderError("市場身份未確認；請從台股或美股搜尋結果重新開啟研究。", false);
  if (!labMarketProvider) return renderError("Investment Intelligence 尚未取得 AIOS authenticated runtime。請登入並完成既有 Access / MFA 驗證。", false);
  state.market = requestedMarket;
  state.view = "research"; state.symbol = normalizedSymbol; applyNav();
  const position = portfolioPositionForSymbol(normalizedSymbol);
  const displayName = name || position?.name || symbolLabelFor(normalizedSymbol, requestedMarket, normalizedSymbol);
  const { requestId } = startRequest(`正在讀取 ${displayName} · ${requestedMarket} 的來源 Evidence…`);
  try {
    await Promise.all([loadPortfolioSnapshot(), loadWatchlistSnapshot()]);
    const strategyIds = globalThis.InvestmentStrategyLibrary?.list?.().map(item => item.id) || [];
    const [data, tdccHistory] = await Promise.all([labMarketProvider.loadResearch([{ symbol: normalizedSymbol, market: requestedMarket, venue, name: displayName }], {
      strategyIds,
      portfolioContext: { currentPositionCount: state.portfolio.positions.length },
      includeTaiwanEvidence: true,
    }), requestedMarket === "TW" ? labMarketProvider.getTdccHistoricalSeries({ symbol: normalizedSymbol, market: requestedMarket, venue }) : Promise.resolve(null)]);
    if (requestId === state.request) {
      state.tdccPublishedHistory = tdccHistory;
      recordResearchTdccObservation(normalizedSymbol, requestedMarket, data?.taiwanEvidence);
      renderIntelligenceResearch(data, normalizedSymbol);
    }
  } catch (error) {
    if (requestId === state.request) renderError(`${normalizedSymbol} · ${requestedMarket} 研究讀取失敗（${error?.code || "SOURCE_UNAVAILABLE"}）。不會以模擬資料、Portfolio 估值或其他未核對來源替代。`);
  }
}

function scannerModeControls() {
  return '<div class="scanner-mode-bar" role="group" aria-label="選股雷達市場範圍">' +
    '<button class="secondary-button" data-action="scanner-mode" data-mode="TW_MARKET" aria-pressed="' + (state.scannerMode === "TW_MARKET") + '">台股全市場</button>' +
    '<button class="secondary-button" data-action="scanner-mode" data-mode="PERSONAL" aria-pressed="' + (state.scannerMode === "PERSONAL") + '">我的持股／觀察</button></div>';
}

function renderTaiwanMarketScanner(scan) {
  const filters = scan.filters || state.taiwanScanFilters;
  const options = list(scan.industryOptions).map(value =>
    '<option value="' + esc(value) + '"' + (filters.industry === value ? " selected" : "") + '>' + esc(value) + '</option>'
  ).join("");
  const from = scan.total ? filters.offset + 1 : 0;
  const to = Math.min(filters.offset + filters.limit, scan.total || 0);
  const coverage = scan.quoteCoverage || {};
  const catalog = scan.catalogCoverage || {};
  const sourceFailureText = list(scan.sourceFailures).length ? " · " + scan.sourceFailures.length + " 個公開來源暫時無法讀取" : "";
  root.innerHTML = pageHead("台股全市場選股雷達", "依 TWSE / TPEx 最新可得官方收盤資料排序。排名公式可追溯，資料延遲且不是買賣訊號。", '<button class="secondary-button" data-action="refresh">↻ 更新來源</button>') +
    scannerModeControls() +
    '<form class="scanner-filter-form" data-taiwan-scan-form>' +
    '<label>掛牌市場<select name="venue"><option value="ALL"' + (filters.venue === "ALL" ? " selected" : "") + '>上市櫃</option><option value="TWSE"' + (filters.venue === "TWSE" ? " selected" : "") + '>上市</option><option value="TPEX"' + (filters.venue === "TPEX" ? " selected" : "") + '>上櫃</option></select></label>' +
    '<label>產業<select name="industry"><option value="">全部產業</option>' + options + '</select></label>' +
    '<label>排序<select name="sort"><option value="score"' + (filters.sort === "score" ? " selected" : "") + '>透明參考分數</option><option value="change"' + (filters.sort === "change" ? " selected" : "") + '>漲跌幅</option><option value="trade_value"' + (filters.sort === "trade_value" ? " selected" : "") + '>成交金額</option><option value="volume"' + (filters.sort === "volume" ? " selected" : "") + '>成交量</option></select></label>' +
    '<label>最低收盤<input type="number" min="0" step="any" name="minPrice" value="' + (filters.minPrice ?? "") + '"></label>' +
    '<label>最高收盤<input type="number" min="0" step="any" name="maxPrice" value="' + (filters.maxPrice ?? "") + '"></label>' +
    '<label>最低漲跌幅 %<input type="number" step="any" name="minChangePct" value="' + (filters.minChangePct ?? "") + '"></label>' +
    '<label>最高漲跌幅 %<input type="number" step="any" name="maxChangePct" value="' + (filters.maxChangePct ?? "") + '"></label>' +
    '<label>最低成交股數<input type="number" min="0" step="1" name="minVolume" value="' + (filters.minVolume ?? "") + '"></label>' +
    '<label>最低成交金額 (NT$)<input type="number" min="0" step="any" name="minTradeValue" value="' + (filters.minTradeValue ?? "") + '"></label>' +
    '<button class="primary-button" type="submit">套用條件</button></form>' +
    '<div class="callout scanner-method-note"><strong>分數與資料口徑</strong><p>分數 = 套用條件後，同一掛牌市場、同一資料日內的日漲跌幅百分位 × 60% + 成交金額百分位 × 40%。它只代表當日相對排序，不是基本面評分、預測或交易建議。上市、上櫃與交易日期分開排名。來源列可能包含 ETF 或其他證券類型；未確認分類不猜測。無資料欄位保持「—」，不補 0。' + esc(sourceFailureText) + '</p>' +
    '<p>來源日期：' + esc(scan.dataTimestamp || "未提供") + ' · TWSE 報價：' + (coverage.TWSE ? "可用" : "未讀取") + ' · TPEx 報價：' + (coverage.TPEX ? "可用" : "未讀取") + ' · TWSE 產業：' + (catalog.TWSE ? "可用" : "未讀取") + ' · TPEx 產業：' + (catalog.TPEX ? "可用" : "未讀取") + ' · 官方收盤資料，非即時</p></div>' +
    '<div class="scanner-table-meta"><span>' + from + '–' + to + ' / ' + fmt(scan.total, 0) + ' 檔 · ' + esc(scan.status) + '</span><span>' + (scan.methodology?.score ? "公式可追溯" : "公式未提供") + '</span></div>' +
    '<div class="scanner-presentation-bar" role="group" aria-label="排名結果顯示方式"><button class="secondary-button" data-action="scanner-presentation" data-presentation="table" aria-pressed="' + (state.scannerPresentation === "table") + '">表格</button><button class="secondary-button" data-action="scanner-presentation" data-presentation="cards" aria-pressed="' + (state.scannerPresentation === "cards") + '">卡片</button></div>' +
    '<div class="scanner-results" data-presentation="' + (state.scannerPresentation === "cards" ? "cards" : "table") + '">' + renderTaiwanScanResults(scan.items, state.scannerPresentation) + '</div>' +
    '<div class="scanner-pagination"><button class="secondary-button" data-action="scanner-page" data-direction="previous"' + (filters.offset <= 0 ? " disabled" : "") + '>上一頁</button><span>' + from + '–' + to + ' / ' + fmt(scan.total, 0) + '</span><button class="secondary-button" data-action="scanner-page" data-direction="next"' + (filters.offset + filters.limit >= scan.total ? " disabled" : "") + '>下一頁</button></div>';
}

async function loadScannerView() {
  state.view = "scanner"; applyNav();
  const { requestId } = startRequest(state.scannerMode === "TW_MARKET" ? "正在讀取 TWSE / TPEx 全市場官方日收資料…" : "正在讀取登入者持股／觀察標的並計算策略 Evidence…");
  try {
    if (!labMarketProvider) throw Object.assign(new Error("Authenticated market provider unavailable."), { code: "ACCESS_UNAVAILABLE" });
    if (state.scannerMode === "TW_MARKET") {
      const scan = await labMarketProvider.getTaiwanMarketScan(state.taiwanScanFilters);
      if (requestId === state.request) {
        state.scan = scan;
        renderTaiwanMarketScanner(scan);
      }
      return;
    }
    await loadPortfolioSnapshot(true);
    try { state.watchlist = await loadCanonicalWatchlist(); }
    catch (error) { state.watchlist = { status: readErrorStatus(error), items: [] }; }
    const candidates = currentCandidateUniverse();
    if (!candidates.length) {
      if (requestId === state.request) root.innerHTML = `${pageHead("選股雷達", "使用目前登入者的持股與 canonical watchlists 建立 candidate set；不造假全市場結果。", "")}<div class="empty-state">目前沒有持股或正式觀察標的。請使用上方搜尋開啟個股研究，再將已核對的標的加入 canonical watchlists，或由 PM 在正式資料來源建立觀察項目。</div>`;
      return;
    }
    const strategyIds = globalThis.InvestmentStrategyLibrary?.list?.().map(item => item.id) || [];
    const result = await labMarketProvider.loadResearch(candidates, { strategyIds, portfolioContext: { currentPositionCount: state.portfolio.positions.length } });
    if (requestId !== state.request) return;
    state.scan = result;
    const cards = list(result.contexts).map(context => {
      const scan = context.strategyScan || {};
      const quote = list(result.quotes).find(item => item.symbol === context.symbol && item.market === context.market);
      const matchCount = list(scan.matches).filter(item => item.status === "READY").length;
      const partialCount = list(scan.matches).filter(item => item.status === "PARTIAL").length;
      return `<article class="evidence-card scanner-card"><div class="evidence-head"><h3>${esc(context.symbol)} <span class="ticker">${esc(context.market)}</span></h3><span class="status-chip" data-status="${esc(scan.status || "PARTIAL")}">${esc(scan.status || "PARTIAL")}</span></div><p class="evidence-value">${quote?.available ? fmt(quote.price) : "—"} <small>${esc(quote?.currency || "")}</small></p><p>${matchCount} 個策略證據可用 · ${partialCount} 個部分可用</p>${list(scan.matches).slice(0, 6).map(item => `<div class="scanner-match"><strong>${esc(item.name || item.id)}</strong><span>${esc(item.status)}</span><small>${esc(item.reason || "")}${item.missing?.length ? ` · 缺 ${esc(item.missing.join(", "))}` : ""}</small></div>`).join("")}<button class="primary-button" data-action="open-research" data-market="${esc(context.market)}" data-symbol="${esc(context.symbol)}">打開研究</button></article>`;
    }).join("");
    root.innerHTML = `${pageHead("選股雷達", "只掃描登入者持股與正式觀察名單；策略 Evidence 狀態與缺項可追溯，不輸出黑箱綜合分數或交易指令。", `<button class="secondary-button" data-action="refresh">↻ 重新掃描</button>`)}<div class="callout"><strong>Universe 與限制</strong><p>此模式只掃描登入者的持股與正式觀察名單。台股全市場每日掃描請切換「台股全市場」；美股全市場批次行情尚無已批准並驗證的來源，因此不假稱已掃過全市場。</p></div><div class="scanner-grid">${cards}</div>`;
  } catch (error) {
    if (requestId === state.request) renderError(`Scanner 讀取失敗（${error?.code || "SOURCE_UNAVAILABLE"}）。未使用模擬股票池。`);
  } finally {
    if (state.view === "scanner" && !root.querySelector(".scanner-mode-bar")) {
      root.insertAdjacentHTML("afterbegin", scannerModeControls());
    }
  }
}

async function loadOverviewView() {
  state.view = "overview"; applyNav();
  const { requestId } = startRequest("正在載入 AIOS 投資 Lab…");
  await loadPortfolioSnapshot(true);
  try { state.watchlist = await loadCanonicalWatchlist(); }
  catch (error) { state.watchlist = { status: readErrorStatus(error), items: [] }; }
  const candidates = currentCandidateUniverse();
  const contextSymbols = GLOBAL_US_EQUITY_CONTEXT;
  let result = { quotes: [], contexts: [], globalCommodityContext: [emptyProvider("World Bank Pink Sheet", "UNAVAILABLE", "通過 AIOS 認證的官方來源尚未回應；目前不顯示記錄值或估算值。")] };
  try {
    if (labMarketProvider) result = await labMarketProvider.getMarketContext([...contextSymbols, ...candidates.slice(0, 4)]);
  } catch {}
  if (requestId === state.request) renderOverview(result, state.watchlist);
}

async function loadDenseMarketView() {
  state.view = "market"; applyNav();
  const { requestId } = startRequest("正在讀取市場統計與海外參考行情…");
  let twMarket = {
    index: emptyProvider("TWSE", "UNAVAILABLE", "台灣市場摘要需要 AIOS 認證後讀取。"),
    breadth: emptyProvider("TWSE / TPEx", "UNAVAILABLE", "台灣市場廣度需要 AIOS 認證後讀取。"),
    institutions: emptyProvider("TWSE", "UNAVAILABLE", "法人市場資料需要 AIOS 認證後讀取."),
    tpexInstitutions: emptyProvider("TPEx", "UNAVAILABLE", "上櫃法人市場資料需要 AIOS 認證後讀取."),
    margin: emptyProvider("TWSE / TPEx", "UNAVAILABLE", "上市櫃融資融券市場彙總需要 AIOS 認證後讀取."),
  };
  let context = { quotes: [], news: [], fx: { available: false, provider: "FX" }, globalCommodityContext: [emptyProvider("World Bank Pink Sheet", "UNAVAILABLE", "通過 AIOS 認證的官方來源尚未回應；目前不顯示記錄值或估算值.")] };
  let sectorScan = null;
  try {
    if (labMarketProvider) {
      twMarket = await labMarketProvider.getTaiwanMarketOverview();
      sectorScan = await labMarketProvider.getTaiwanMarketScan({ venue: "ALL", sort: "score", limit: 1, offset: 0 });
    }
  } catch {}
  try {
    if (labMarketProvider) context = await labMarketProvider.getMarketContext(GLOBAL_US_EQUITY_CONTEXT);
  } catch {}
  if (requestId === state.request) {
    renderDenseMarket(context, twMarket);
    appendTaiwanSectorSummary(sectorScan);
  }
}

async function loadChipView() {
  state.view = "chips"; applyNav();
  const { requestId } = startRequest(`正在讀取 ${state.symbol} 籌碼與市場結構…`);
  try {
    const request = { symbol: state.symbol, market: state.market };
    const [result, history, tdccHistory] = await Promise.all([
      labMarketProvider.getTaiwanEvidence(request),
      state.market === "TW" ? labMarketProvider.getHistory(request) : Promise.resolve({ bars: [] }),
      state.market === "TW" ? labMarketProvider.getTdccHistoricalSeries(request) : Promise.resolve(null),
    ]);
    if (requestId !== state.request) return;
    state.tdccPublishedHistory = tdccHistory;
    state.tdccLocalObservation = state.market === "TW" && result?.evidence?.ownership
      ? recordTdccLocalObservation({ symbol: state.symbol, venue: result.venue, evidence: result.evidence.ownership })
      : null;
    const chipCycle = state.market === "TW"
      ? buildChipCycleObservation({ bars: history.bars, institutionalSummary: result.evidence.institutional?.data?.historySummary, tdccHistory })
      : null;
    const brokerBranchEvidence = normalizeBrokerBranchEvidence({
      market: state.market,
      symbol: state.symbol,
      evidence: result?.evidence?.brokerBranches || (state.market === "TW" ? {
        status: "SECRET_REQUIRED",
        provider: "FinMind TaiwanStockTradingDailyReport · Sponsor dataset",
        source: "https://finmind.github.io/tutor/TaiwanMarket/Technical/",
        note: "分點資料：尚未設定資料服務。沒有用法人流量冒充分點資料。",
      } : null),
    });
    root.innerHTML = `${pageHead(`${state.symbol} · 籌碼 / 事件`, "只列出所選市場適用且有來源的資料；美股不套用台灣法人、TDCC 或融資融券口徑。", `<button class="secondary-button" data-action="open-research" data-market="${state.market}" data-symbol="${esc(state.symbol)}">返回研究</button>`)}<div class="evidence-grid">${renderInstitutional(result.evidence.institutional)}${renderHolders(result.evidence.ownership, state.tdccLocalObservation)}${renderMargin(result.evidence.margin)}${renderAnnouncements(result.evidence.announcements)}${renderBrokerBranchEvidence(brokerBranchEvidence)}</div>${state.market === "TW" ? `${renderTdccHistoricalSeries(tdccHistory, { localObservations: state.tdccLocalObservation?.observations || [] })}${renderChipCycleObservation(chipCycle)}` : ""}`;
  } catch (error) { if (requestId === state.request) renderError(`籌碼來源讀取失敗（${error?.code || "PROVIDER_UNAVAILABLE"}）。`); }
}

async function loadResearchView(symbol = state.symbol, options = {}) { return loadLabResearch(symbol, options); }

async function showView(view) {
  if (view === "research") {
    if (!state.symbol) return renderError("請先使用上方股票搜尋選擇台股或美股，再查看個股研究。", false);
    return loadLabResearch(state.symbol, { market: state.market });
  }
  if (view === "technical") {
    const target = state.symbol;
    if (!target) {
      state.view = "technical"; applyNav();
      return renderError("請先使用上方股票搜尋選擇台股或美股，再查看技術分析。", false);
    }
    const result = await loadLabResearch(target, { market: state.market });
    if (state.view === "research") state.view = "technical";
    applyNav();
    if (state.intelligence) {
      const history = normalizedHistory(state.intelligence, target);
      const bars = list(history.bars).map(bar => ({ ...bar, date: bar.asOf || bar.date, close: Number(bar.close), high: Number(bar.high), low: Number(bar.low), volume: Number(bar.volume) }));
      const indicators = calculateIndicators(bars);
      const technicalMatrix = buildTechnicalSignalMatrix(bars, indicators);
      root.innerHTML = `${pageHead(`${target} · 技術分析`, "MA、RSI、KD、MACD、Bollinger 與 Volume 僅依實際 OHLCV 計算。", `<button class="secondary-button" data-action="open-research" data-market="${state.market}" data-symbol="${esc(target)}">返回個股研究</button>`)}${indicatorRows({ status: indicators.status, data: indicators, note: indicators.note, provider: history.provider, source: history.source, dataTimestamp: history.asOf })}<section class="surface"><div class="section-title"><h2>技術觀察矩陣</h2><span>條件描述，不產生買賣分數</span></div>${renderTechnicalSignalMatrix(technicalMatrix)}</section><section class="surface">${renderResearchOhlcvChart(history, { market: state.market })}</section>`;
    }
    return result;
  }
  if (view === "chips") return loadChipView();
  if (view === "overview") return loadOverviewView();
  if (view === "scanner") return loadScannerView();
  if (view === "market") return loadDenseMarketView();
  if (view === "holdings") return loadHoldingsView();
  if (view === "watchlist") return loadWatchlistView();
  if (view === "history") return loadClosedHistoryView();
  if (view === "backtest") return loadBacktestView();
  return loadOverviewView();
}

async function refreshCurrent() {
  return showView(state.view);
}

function toggleWatch(symbol, market = state.market, forceRemove = false) {
  market = marketCode(market);
  if (!market && !forceRemove) return;
  const watched = loadLocalWatch();
  const key = localWatchKey(symbol, market);
  const exists = watched.some(item => localWatchKey(item.symbol, item.market) === key);
  const next = forceRemove || exists
    ? watched.filter(item => localWatchKey(item.symbol, item.market) !== key)
    : [...watched, { symbol: String(symbol).toUpperCase(), market }];
  try { localStorage.setItem(STORE_LOCAL_WATCH, JSON.stringify(next)); } catch {}
  if (state.view === "watchlist") renderWatchlist();
}

function saveNote(symbol) {
  const field = document.querySelector("[data-note-input]");
  if (!field) return;
  const notes = loadNotes();
  const value = field.value.trim();
  if (value) notes[symbol] = value;
  else delete notes[symbol];
  try {
    localStorage.setItem(STORE_NOTES, JSON.stringify(notes));
    const status = document.querySelector("[data-note-status]");
    if (status) status.textContent = "已儲存在此瀏覽器";
  } catch {
    const status = document.querySelector("[data-note-status]");
    if (status) status.textContent = "瀏覽器儲存空間不可用，筆記未儲存";
  }
}

function showSymbolPicker() {
  dialogTitle.textContent = "新增本機暫存觀察";
  const choices = Object.entries(symbolNames)
    .filter(([key]) => key.includes(":"))
    .map(([key, name]) => {
      const [market, symbol] = key.split(":", 2);
      return `<button class="symbol-button" data-action="pick-watch" data-market="${market}" data-symbol="${esc(symbol)}">暫存 ${esc(name)} · ${esc(symbol)} · ${market}</button>`;
    });
  dialogBody.innerHTML = `<p>以下項目只存於此瀏覽器，不會寫入或取代正式 watchlists。</p>${choices.length ? `<div class="segmented">${choices.join("")}</div>` : `<p class="empty-state">請先使用上方市場搜尋找到標的；本機暫存不會猜測股票代號或名稱。</p>`}<p class="tiny-note">正式觀察名單只讀取 canonical watchlists；本機暫存不會混入正式名單。</p>`;
  dialog.showModal();
}

function evidenceDialog(card) {
  dialogTitle.textContent = card.querySelector("h3")?.textContent || "資料證據";
  dialogBody.innerHTML = sourceDetails(state.research?.[card.dataset.evidence] || {});
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]")?.dataset.view;
  if (view) {
    if (view === "research") navigateToResearch(state.symbol, state.market);
    else navigateHash(view);
    return;
  }
  if (event.target.closest("[data-refresh]")) { refreshCurrent(); return; }
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const symbol = actionNode.dataset.symbol;
  const market = marketCode(actionNode.dataset.market) || marketCode(portfolioPositionForSymbol(symbol, state.market)?.market);
  if (action === "research" || action === "portfolio-research" || action === "open-research") {
    dialog.close?.();
    const position = portfolioPositionForSymbol(symbol, market);
    navigateToResearch(symbol, market, actionNode.dataset.venue || position?.venue || "", actionNode.dataset.name || position?.name || symbolLabelFor(symbol, market));
  }
  else if (action === "go-view") navigateHash(actionNode.dataset.view || "overview");
  else if (action === "go-scanner") navigateHash("scanner");
  else if (action === "scanner-mode") { state.scannerMode = actionNode.dataset.mode === "PERSONAL" ? "PERSONAL" : "TW_MARKET"; loadScannerView(); }
  else if (action === "scanner-presentation") {
    state.scannerPresentation = actionNode.dataset.presentation === "cards" ? "cards" : "table";
    if (state.scannerMode === "TW_MARKET" && state.scan?.contract === "zhuge-taiwan-market-scan-v1") renderTaiwanMarketScanner(state.scan);
  }
  else if (action === "sector-scan") {
    state.scannerMode = "TW_MARKET";
    state.taiwanScanFilters = filtersForTaiwanSector(state.taiwanScanFilters, actionNode.dataset);
    navigateHash("scanner");
  }
  else if (action === "scanner-page") {
    state.taiwanScanFilters.offset = Math.max(0, state.taiwanScanFilters.offset + (actionNode.dataset.direction === "next" ? 1 : -1) * state.taiwanScanFilters.limit);
    loadScannerView();
  }
  else if (action === "open-chips") { state.symbol = symbol; state.market = market; navigateHash("chips"); }
  else if (action === "transaction-details") {
    if (!portfolioAdapter?.loadTransactions) { dialogTitle.textContent = "交易明細不可用"; dialogBody.textContent = "目前沒有通過 AIOS 身分與 Investment Access 驗證的唯讀 adapter。"; dialog.showModal(); return; }
    dialogTitle.textContent = `${symbol} · 交易明細`;
    dialogBody.innerHTML = `<p>讀取 owner-scoped canonical transactions；唯讀，不自行重建平倉帳。</p><div class="loading-state">正在讀取…</div>`;
    dialog.showModal();
    portfolioAdapter.loadTransactions({ symbol, market }).then(result => {
      if (!dialog.open) return;
      const rows = list(result.items).map(item => `<tr><td>${esc(item.tradeDate || "—")}</td><td>${esc(item.tradeType || "—")}</td><td>${esc(item.symbol)} ${esc(item.name)}</td><td>${fmt(item.quantity, 4)}</td><td>${fmt(item.price)} ${esc(item.currency)}</td><td>${fmt(item.netAmount)} ${esc(item.currency)}</td><td>${esc(item.source || "—")}</td></tr>`).join("");
      dialogBody.innerHTML = result.status === "AVAILABLE" ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>類型</th><th>標的</th><th>數量</th><th>價格</th><th>淨額</th><th>來源</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty-state">沒有可顯示的正式交易明細。</p>`;
    }).catch(error => { if (dialog.open) dialogBody.innerHTML = `<p class="error-state">交易明細讀取失敗（${esc(error?.code || "TRANSACTION_READ_UNAVAILABLE")}）。</p>`; });
  }
  else if (action === "home") navigateHash("home");
  else if (action === "toggle-watch") toggleWatch(symbol, market);
  else if (action === "remove-watch") toggleWatch(symbol, market, true);
  else if (action === "pick-watch") { toggleWatch(symbol, market); dialog.close(); state.view = "watchlist"; applyNav(); renderWatchlist(); }
  else if (action === "save-note") saveNote(symbol);
  else if (action === "refresh") refreshCurrent();
  else if (action === "run-backtest") { const form = actionNode.closest("[data-backtest-form]"); if (form) runCurrentBacktest(form); }
  else if (action === "refresh-watch-events") loadWatchlistEventCandidates();
  else if (action === "analyze-ai") analyzeCurrentResearch();
  else if (action === "preview-notification-digest") {
    state.notificationDigest = buildWatchlistNotificationDigest(state.watchlistEvents?.items, loadNotificationSettings());
    renderWatchlist();
  }
  else if (action === "add-symbol") showSymbolPicker();
});
document.addEventListener("submit", event => {
  const correlationForm = event.target.closest("[data-cross-market-form]");
  if (correlationForm) {
    event.preventDefault();
    runCrossMarketCorrelation(correlationForm);
    return;
  }
  const notificationForm = event.target.closest("[data-notification-settings]");
  if (notificationForm) {
    event.preventDefault();
    const fields = new FormData(notificationForm);
    saveNotificationSettings({
      enabled: fields.get("enabled") === "on",
      frequency: fields.get("frequency"),
      timeLocal: fields.get("timeLocal"),
      timezone: fields.get("timezone"),
      deliveryPreference: fields.get("deliveryPreference"),
    });
    renderWatchlist();
    return;
  }
  const backtestForm = event.target.closest("[data-backtest-form]");
  if (backtestForm) {
    event.preventDefault();
    runCurrentBacktest(backtestForm);
    return;
  }
  const form = event.target.closest("[data-taiwan-scan-form]");
  if (!form) return;
  event.preventDefault();
  const fields = new FormData(form);
  const numberField = name => fields.get(name) === "" ? null : Number(fields.get(name));
  state.taiwanScanFilters = {
    ...state.taiwanScanFilters,
    venue: String(fields.get("venue") || "ALL"),
    industry: String(fields.get("industry") || ""),
    sort: String(fields.get("sort") || "score"),
    minPrice: numberField("minPrice"),
    maxPrice: numberField("maxPrice"),
    minChangePct: numberField("minChangePct"),
    maxChangePct: numberField("maxChangePct"),
    minVolume: numberField("minVolume"),
    minTradeValue: numberField("minTradeValue"),
    offset: 0,
  };
  loadScannerView();
});
document.querySelector("[data-symbol-search-form]")?.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const market = form.querySelector("[data-market-select]")?.value === "US" ? "US" : "TW";
  const query = form.querySelector("[name=symbol]")?.value?.trim() || "";
  if (!query || !labMarketProvider) return;
  state.market = market;
  const { requestId } = startRequest(`正在搜尋 ${market === "TW" ? "台股" : "美股"} Catalog…`);
  try {
    const result = await labMarketProvider.searchSymbols({ market, query });
    if (requestId !== state.request) return;
    for (const item of result.items) rememberSymbol(item);
    if (result.items.length === 1) {
      const item = result.items[0];
      navigateToResearch(item.symbol, item.market, item.venue, item.name);
      return;
    }
    renderSearchResults(result);
  } catch (error) {
    if (requestId === state.request) renderError(`Catalog 搜尋失敗（${error?.code || "CATALOG_UNAVAILABLE"}）。請稍後重試；不會猜測代碼或名稱。`);
  }
});
document.querySelector("[data-dialog-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener("hashchange", routeFromHash);

runtimeStatus.textContent = "AIOS 同源 Lab · 唯讀";

routeFromHash();
