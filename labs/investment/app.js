import { loadHome, loadResearch, loadMarket, loadOpening, loadRadar, loadHistory } from "./src/browser-runtime.mjs?v=20261002-0015";
import { createReadOnlyPortfolioAdapter } from "./src/portfolio/readonly-adapter.mjs";
import { createUnconnectedResearch } from "./src/portfolio/research-placeholder.mjs";
import { loadPortfolioHistoryMap } from "./src/portfolio/history.mjs?v=20261002-0015";
import { renderPortfolioResearchContext, renderPortfolioSection } from "./src/portfolio/view.mjs?v=20261002-0015";

const root = document.querySelector("#view-root");
const dialog = document.querySelector("[data-dialog]");
const dialogTitle = document.querySelector("[data-dialog-title]");
const dialogBody = document.querySelector("[data-dialog-body]");
const navButtons = [...document.querySelectorAll("[data-view]")];
const runtimeStatus = document.querySelector("[data-runtime-status]");
const STORE_WATCH = "zhuge.investment.sandbox.watch.v1";
const STORE_NOTES = "zhuge.investment.sandbox.notes.v1";
const symbolNames = Object.assign(Object.create(null), {
  "2330.TW": "台積電", "0050.TW": "元大台灣50", "6488.TWO": "環球晶", AAPL: "Apple", NVDA: "NVIDIA",
});
const SUPPORTED_RESEARCH_SYMBOLS = new Set(["2330.TW", "0050.TW", "6488.TWO"]);
const state = { view: "home", symbol: "2330.TW", home: null, research: null, portfolio: { status: "LOADING", positions: [] }, portfolioHistories: new Map(), portfolioPromise: null, request: 0 };

let portfolioAdapter = null;
try {
  const platform = globalThis.ZhugeRuntimeSessionProvider?.createPlatform?.();
  const context = platform?.forModule?.("investment");
  if (context) portfolioAdapter = createReadOnlyPortfolioAdapter({
    context,
    appAccess: globalThis.ZhugeAppAccess,
    appAccessGate: globalThis.ZhugeAppAccessGate,
  });
} catch {
  portfolioAdapter = null;
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const list = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const fmt = (value, digits = 2) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";
const fmtSigned = (value, digits = 2) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? `${Number(value) > 0 ? "+" : ""}${fmt(value, digits)}` : "—";
const statusNames = {
  AVAILABLE: "資料可用", PARTIAL: "部分欄位可用", NOT_APPLICABLE: "不適用此標的",
  NOT_CONNECTED: "尚未接通", PROVIDER_REVIEW_REQUIRED: "來源審查中", UNAVAILABLE: "暫時無法取得",
};
const truthNames = { OFFICIAL: "官方來源", REAL: "真實資料", FALLBACK: "同來源快取", DELAYED: "延遲資料", NOT_CONNECTED: "未接資料", UNAVAILABLE: "無可用資料", SIMULATED: "模擬資料（僅測試）", YAHOO: "Yahoo", FINMIND: "FinMind" };

function evidenceState(evidence) {
  if (!evidence) return { what: "資料狀態未提供。", impact: "無法判讀此項研究內容。", action: "重新整理或查看資料來源。" };
  if (evidence.errorCode === "SERVER_PROXY_REQUIRED") return {
    what: "瀏覽器無法直接讀取這個官方資料來源。",
    impact: "此項數據保持未連線，不會以其他來源或模擬值替代。",
    action: "需要 Zhuge 受控的伺服器代理；本 Lab 不會自行建立或呼叫代理。",
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
  navButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
}

function pageHead(title, description, controls = "") {
  return `<header class="page-head"><div><p class="eyebrow">Zhuge Investment Sandbox</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${controls ? `<div class="head-actions">${controls}</div>` : ""}</header>`;
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

function registerPortfolioSymbols(result) {
  for (const position of list(result?.positions)) {
    const symbol = String(position.researchSymbol || position.symbol || "").toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,15}(?:\.(?:TW|TWO))?$/.test(symbol)) continue;
    if (!Object.hasOwn(symbolNames, symbol)) symbolNames[symbol] = position.name || symbol;
  }
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
      state.portfolio = await portfolioAdapter.load();
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

function portfolioPositionForSymbol(symbol) {
  const target = String(symbol || "").toUpperCase();
  const code = target.replace(/\.(TW|TWO)$/, "");
  return list(state.portfolio?.positions).find(position => {
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
  catch { return loadHomeView(); }
  if (route.startsWith("research/")) {
    const symbol = route.slice("research/".length).toUpperCase();
    if (/^[A-Z0-9][A-Z0-9.-]{0,15}(?:\.(?:TW|TWO))?$/.test(symbol)) loadResearchView(symbol);
    else loadHomeView();
    return;
  }
  if (["home", "opening", "market", "radar", "watchlist"].includes(route)) {
    showView(route);
    return;
  }
  loadHomeView();
}

function navigateToResearch(symbol) {
  const safeSymbol = String(symbol || "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}(?:\.(?:TW|TWO))?$/.test(safeSymbol)) return;
  navigateHash(`research/${encodeURIComponent(safeSymbol)}`);
}

function quoteHeadline(evidence) {
  if (!evidence?.data) return `<div class="empty-state">${esc(evidenceState(evidence).what)}<br>${esc(evidenceState(evidence).action)}</div>`;
  const data = evidence.data;
  const change = Number(data.changePercent);
  return `<div class="quote-number">${fmt(data.close)}<small>TWD / 股</small></div><div class="quote-change ${Number.isFinite(change) ? change > 0 ? "positive" : change < 0 ? "negative" : "neutral" : "neutral"}">${fmtSigned(data.change)} · ${fmtSigned(change)}%</div>`;
}

function sparkline(history) {
  const closes = list(history?.data).map((item) => Number(item.close)).filter(Number.isFinite);
  if (closes.length < 2) return `<p class="tiny-note">${esc(history?.note || "尚無可用歷史線圖")}</p>`;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const points = closes.map((value, index) => `${(index / (closes.length - 1) * 300).toFixed(1)},${(34 - (value - min) / range * 28).toFixed(1)}`).join(" ");
  return `<svg class="sparkline" viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="官方日收歷史走勢，${closes.length} 筆"> <path class="area" d="M${points.replaceAll(" ", " L")} L300,40 L0,40 Z"></path><path d="M${points.replaceAll(" ", " L")}"></path></svg>`;
}

function quoteChip(quote) {
  if (!quote?.data) return badge(quote);
  const change = Number(quote.data.changePercent);
  const cls = change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
  return `<span class="quote-change ${cls}">${fmtSigned(change)}%</span>`;
}

function renderStockCard(card, history) {
  const quote = card.quote;
  const displayName = card.name || card.displayName || symbolNames[card.symbol];
  const date = quote?.dataTimestamp || "日期未提供";
  const revenue = card.revenue?.data?.yearOverYearPercent;
  const companyRevenue = card.instrumentType !== "ETF" && Number.isFinite(Number(revenue));
  return `<article class="stock-card">
    <div class="stock-card-top"><div><h2 class="stock-name">${esc(displayName)}</h2><span class="ticker">${esc(card.symbol)} · ${esc(card.venue)}</span></div>${quoteChip(quote)}</div>
    ${quoteHeadline(quote)}
    ${sparkline(history)}
    <p class="tiny-note">${esc(quote?.provider || "來源未提供")} · ${esc(date)} · ${quote?.delayed ? "延遲收盤" : ""}</p>
    ${companyRevenue ? `<p class="tiny-note">最近月營收年增 ${fmtSigned(revenue)}% · ${esc(card.revenue.data.period || "期間未提供")}</p>` : `<p class="tiny-note">${card.instrumentType === "ETF" ? "ETF：公司營收不適用；基金持股與淨值未接通。" : "營運資料可進入研究頁查看。"}</p>`}
    <div class="stock-card-footer"><span class="ticker">${badge(quote)}</span><button class="primary-button" data-action="research" data-symbol="${esc(card.symbol)}">個股研究</button></div>
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
  root.innerHTML = `${pageHead("研究總覽", "先看三檔起始研究標的的官方收盤與有來源的脈搏。這裡不輸出綜合分數或買賣方向。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}
    <div class="callout"><strong>資料定位</strong><p>官方日收為延遲行情，不是盤中即時報價；價格變動與營收只是不同期間的原始證據，不代表未來報酬。</p></div>
    ${renderPortfolioSection(state.portfolio, state.portfolioHistories)}
    <div class="section-title"><h2>研究標的</h2><span>2330 · 0050 · 6488</span></div>
    <div class="research-grid">${cards}</div>
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

function renderResearch(data) {
  state.research = data;
  state.symbol = data.symbol;
  const quote = data.quote;
  const currentCard = state.home?.cards?.find((item) => item.symbol === data.symbol);
  const portfolioPosition = portfolioPositionForSymbol(data.symbol);
  const displayName = symbolNames[data.symbol] || portfolioPosition?.name || data.symbol;
  const notes = loadNotes();
  const noteText = notes[data.symbol] || "";
  const history = data.history?.data;
  const chart = Array.isArray(history) && history.length > 1 ? makeChart(history) : `<div class="empty-state">${esc(data.history?.note || "目前沒有可用歷史線圖")}</div>`;
  const barNote = history?.length ? `共 ${history.length} 筆 · ${history[0].date} 至 ${history.at(-1).date}` : "歷史資料未接通";
  const fundamental = data.instrumentType === "ETF" ? `${displayName} 為 ETF，不顯示營運公司財報作為基金基本面。基金成分、權重、淨值與配息資料仍未接通。` : "公司揭露為官方最新可得資訊；財報期間與欄位口徑依來源呈現。";
  root.innerHTML = `${pageHead(`${data.symbol} 個股研究`, `${displayName} · ${data.instrumentType} · 研究只讀取有來源的證據，不形成買賣指令。`, `<button class="secondary-button" data-action="home">返回總覽</button><button class="primary-button" data-action="toggle-watch" data-symbol="${esc(data.symbol)}">${isWatched(data.symbol) ? "移出觀察" : "加入觀察"}</button>`)}
    ${renderPortfolioResearchContext(portfolioPosition)}
    <div class="layout-two"><section class="surface"><div class="evidence-head"><div><p class="eyebrow">OFFICIAL CLOSE</p><h2>${esc(currentCard?.name || symbolNames[data.symbol])} · ${esc(data.symbol)}</h2></div>${badge(quote)}</div>${quoteHeadline(quote)}<p class="tiny-note">${esc(quote?.note || "最新可得官方收盤資料")} · ${esc(quote?.dataTimestamp || "資料日期未提供")}</p></section><section class="surface"><h2>觀察筆記</h2><p class="tiny-note">只保存在目前瀏覽器，不會送到 Cloud。</p><div class="note-editor"><textarea data-note-input aria-label="個股觀察筆記" placeholder="記錄待查問題或個人觀察…">${esc(noteText)}</textarea><div><button class="primary-button" data-action="save-note" data-symbol="${esc(data.symbol)}">儲存筆記</button> <span class="flash" data-note-status></span></div></div></section></div>
    <div class="section-title"><h2>價格與技術</h2><span>${esc(barNote)}</span></div><div class="layout-two"><section class="surface"><div class="evidence-head"><h2>官方日收歷史</h2>${badge(data.history)}</div>${chart}<p class="tiny-note">${esc(data.history?.note || "未提供")}</p><details><summary>來源與證據</summary>${sourceDetails(data.history)}</details></section>${indicatorRows(data.indicators)}</div>
    <div class="section-title"><h2>營運與基本面</h2><span>不適用／未接欄位保留原狀</span></div><div class="evidence-grid">${evidenceCard("公司基本資料", data.profile, data.profile?.data ? `<div class="metric-row"><div class="metric"><label>公司</label><strong>${esc(data.profile.data.name || "—")}</strong></div><div class="metric"><label>產業（官方原文）</label><strong>${esc(data.profile.data.industry || "—")}</strong></div><div class="metric"><label>交易市場</label><strong>${esc(data.profile.data.venue || "—")}</strong></div></div><p class="evidence-note">${esc(data.profile.data.business || "業務描述未提供")}</p>` : "")}${evidenceCard("月營收", data.revenue, data.revenue?.data ? `<div class="evidence-value">${fmt(data.revenue.data.amountThousandTwd, 0)}<small> 千元</small></div><p class="tiny-note">${esc(data.revenue.data.period || "期間未提供")} · 年增 ${fmtSigned(data.revenue.data.yearOverYearPercent)}% · 月增 ${fmtSigned(data.revenue.data.monthOverMonthPercent)}%</p>` : "")}${evidenceCard("最新損益", data.income, data.income?.data ? `<p>${esc(data.income.data.period || "期間未提供")} · ${esc(data.income.data.scope || "")}</p><p>營收 ${fmt(data.income.data.revenueThousandTwd, 0)} 千元 · EPS ${fmt(data.income.data.eps, 2)} 元</p>` : "")}${evidenceCard("資產負債", data.balance, data.balance?.data ? `<p>${esc(data.balance.data.period || "期間未提供")} · ${esc(data.balance.data.scope || "")}</p><p>資產 ${fmt(data.balance.data.assetsThousandTwd, 0)} 千元 · 負債 ${fmt(data.balance.data.liabilitiesThousandTwd, 0)} 千元 · 權益 ${fmt(data.balance.data.equityThousandTwd, 0)} 千元</p>` : "")}</div>
    <p class="tiny-note">${esc(fundamental)}</p>
    <div class="section-title"><h2>籌碼與市場背景</h2><span>股數／級距定義依原始提供者</span></div><div class="evidence-grid">${renderHolders(data.holders)}${renderInstitutional(data.institutional)}${renderMargin(data.margin)}${evidenceCard("臺指期背景（盤後）", data.futuresContext, data.futuresContext?.data ? `<div class="evidence-value">${fmt(data.futuresContext.data.last, 2)}</div><p class="tiny-note">${esc(data.futuresContext.data.contract)} ${esc(data.futuresContext.data.contractMonth)} · ${esc(data.futuresContext.data.session)} · 漲跌 ${fmtSigned(data.futuresContext.data.change, 2)}</p>` : "")}</div>
    <div class="section-title"><h2>官方公告與來源缺口</h2><span>公告不等同媒體新聞</span></div><div class="layout-two">${renderAnnouncements(data.announcements)}<section class="surface"><h2>尚未接通的研究能力</h2><ul>${list(data.gaps).map((gap) => `<li><strong>${esc(gap.capability)}</strong> · ${esc(gap.status)}<br><span class="tiny-note">${esc(gap.note)}</span></li>`).join("")}</ul><p class="tiny-note">${esc(data.industryRadar?.[0]?.note || "產業價格證據不會自動轉為個股好壞方向。")}</p></section></div>
    <div class="section-title"><h2>產業價格參考</h2><span>來源取得不等於個股曝險已知</span></div><div class="evidence-grid">${radarSummary(data.industryRadar)}</div>`;
}

function makeChart(history) {
  const items = history.slice(-80).filter((row) => Number.isFinite(Number(row.close)));
  if (items.length < 2) return `<div class="empty-state">歷史樣本不足，無法繪製線圖。</div>`;
  const values = items.map((row) => Number(row.close));
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1) * 960).toFixed(1)},${(172 - (value - min) / range * 150).toFixed(1)}`).join(" ");
  return `<div class="chart-wrap"><svg class="price-chart" viewBox="0 0 960 190" role="img" aria-label="${items.length} 筆官方日收走勢"><polyline points="${points}"></polyline><circle cx="960" cy="${(172 - (values.at(-1) - min) / range * 150).toFixed(1)}" r="4"></circle></svg><div class="chart-labels"><span>${esc(items[0].date)} · ${fmt(values[0])}</span><span>${esc(items.at(-1).date)} · ${fmt(values.at(-1))}</span></div></div>`;
}

function renderHolders(ev) {
  const rows = list(ev?.data);
  const content = rows.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>持股級距</th><th>戶數</th><th>股數</th><th>占比</th></tr></thead><tbody>${rows.slice(0, 12).map((row) => `<tr><td>${esc(row.band)}</td><td>${fmt(row.holders, 0)}</td><td>${fmt(row.shares, 0)}</td><td>${fmt(row.percent, 2)}%</td></tr>`).join("")}</tbody></table></div>` : "";
  return evidenceCard("TDCC 股權分散", ev, content);
}

function renderInstitutional(ev) {
  const d = ev?.data;
  const labels = [["外資淨買賣超", d?.foreignNetShares], ["投信淨買賣超", d?.trustNetShares], ["自營商淨買賣超", d?.dealerNetShares], ["三大法人合計", d?.allThreeNetShares]];
  const content = d ? `<div class="data-table-wrap"><table class="data-table"><tbody>${labels.map(([name, value]) => `<tr><th>${esc(name)}</th><td>${fmtSigned(value, 0)} 股</td></tr>`).join("")}</tbody></table></div>` : "";
  return evidenceCard("三大法人", ev, content);
}

function renderMargin(ev) {
  const d = ev?.data;
  const content = d ? `<div class="metric-row"><div class="metric"><label>融資餘額</label><strong>${fmt(d.marginBalance, 0)}</strong></div><div class="metric"><label>融券餘額</label><strong>${fmt(d.shortBalance, 0)}</strong></div><div class="metric"><label>表列單位</label><strong>${esc(d.unit)}</strong></div></div>` : "";
  return evidenceCard("融資融券", ev, content);
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

function renderOpening(data) {
  root.innerHTML = `${pageHead("開盤壓力", "整理前一個可取得的台灣官方收盤、臺指期盤後與公告線索。缺少的海外來源明確保留，不用推估值替代。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}<div class="callout"><strong>沒有綜合壓力分數</strong><p>美股、SOX、ADR、匯率與宏觀資料未接通；目前不能據此判斷開盤方向。</p></div><div class="section-title"><h2>官方可取得的前一日線索</h2><span>${esc(data.generatedAt || "")}</span></div><div class="evidence-grid">${evidenceCard("加權指數", data.taiwanIndex, data.taiwanIndex?.data ? `<div class="evidence-value">${fmt(data.taiwanIndex.data.index, 2)}</div><p class="tiny-note">${esc(data.taiwanIndex.data.date)} · 漲跌 ${fmtSigned(data.taiwanIndex.data.change, 2)}</p>` : "")}${evidenceCard("臺指期盤後", data.nightFutures, data.nightFutures?.data ? `<div class="evidence-value">${fmt(data.nightFutures.data.last, 2)}</div><p class="tiny-note">${esc(data.nightFutures.data.contractMonth)} · ${esc(data.nightFutures.data.session)} · ${esc(data.nightFutures.data.date || data.nightFutures.dataTimestamp || "")}</p>` : "")}${evidenceCard("美股主要指數", data.usMajorIndices, "")}${evidenceCard("SOX 半導體指數", data.sox, "")}${evidenceCard("台積電 ADR / 關聯先行股", data.adr, "")}${evidenceCard("匯率", data.foreignExchange, "")}${evidenceCard("公告事件", data.events, list(data.events?.data).length ? `<ul>${data.events.data.map((row) => `<li>${esc(row.date || "日期未提供")} · ${esc(row.symbol)} · ${esc(row.title)}</li>`).join("")}</ul>` : "")}</div>`;
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
  root.innerHTML = `${pageHead("產業價格雷達", "只呈現來源授權已審且實際讀取的參考資料；價格變化不代表研究標的直接曝險或股價方向。", `<button class="secondary-button" data-action="refresh">↻ 更新來源</button>`)}<div class="callout"><strong>目前已審來源</strong><p>World Bank Pink Sheet 為月均參考價，依 CC BY 4.0 標示。DRAM/NAND、SOX、SCFI 尚未通過自動化／再使用審查，因此不呼叫、不填值。</p></div><div class="section-title"><h2>已審與待審來源</h2><span>全部保留狀態與證據</span></div><div class="evidence-grid">${content}</div><div class="surface" style="margin-top:16px"><h2>個股影響邊界</h2><p>本 Lab 尚未為 2330、0050、6488 建立有來源、可驗證的商品成本或營收曝險模型。取得油價／銅價，不等於可判定其利多或利空。0050 成分與權重未接通，亦不以 ETF 名稱推導成分股曝險。</p></div>`;
}

function loadWatch() { try { const value = JSON.parse(localStorage.getItem(STORE_WATCH) || "[]"); return Array.isArray(value) ? value.filter((item) => symbolNames[item]) : []; } catch { return []; } }
function loadNotes() { try { const value = JSON.parse(localStorage.getItem(STORE_NOTES) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function isWatched(symbol) { return loadWatch().includes(symbol); }

function renderWatchlist() {
  const watched = loadWatch();
  const notes = loadNotes();
  const cards = watched.map((symbol) => {
    const card = state.home?.cards?.find((item) => item.symbol === symbol);
    const note = notes[symbol] || "尚未記錄個人筆記。";
    return `<div class="watch-row"><div><h3>${esc(symbolNames[symbol])} <span class="ticker">${esc(symbol)}</span></h3><div class="tiny-note">${card?.quote?.data ? `${fmt(card.quote.data.close)} 元 · ${esc(card.quote.dataTimestamp)} · ` : "報價暫無 · "}${quoteChip(card?.quote)}</div><p class="tiny-note">${esc(note.slice(0, 110))}</p></div><div class="watch-controls"><button class="secondary-button" data-action="research" data-symbol="${esc(symbol)}">研究</button><button class="secondary-button" data-action="remove-watch" data-symbol="${esc(symbol)}">移除</button></div></div>`;
  }).join("");
  root.innerHTML = `${pageHead("觀察與筆記", "觀察清單與筆記只存於這個瀏覽器，不會寫入正式 Investment 或雲端資料。", `<button class="secondary-button" data-action="add-symbol">＋ 新增標的</button>`)}<section class="surface"><h2>我的觀察</h2>${watched.length ? cards : `<div class="empty-state"><p>目前沒有觀察標的。</p><p>可從下方研究池加入 2330、0050 或 6488。</p><button class="primary-button" data-action="add-symbol">選擇研究標的</button></div>`}</section><div class="section-title"><h2>研究池</h2><span>官方行情支援範圍</span></div><div class="research-grid">${list(state.home?.cards).map((card) => renderStockCard(card, null)).join("")}</div>`;
}

function renderError(message, retry = true) {
  root.innerHTML = `<div class="error-state"><strong>頁面資料暫時無法載入</strong><p>${esc(message)}</p><p>其他已載入資料不受影響；可重新整理再試。</p>${retry ? `<button class="primary-button" data-action="refresh">重新整理</button>` : ""}</div>`;
}

async function loadHomeView() {
  state.view = "home"; applyNav();
  const { requestId } = startRequest("正在讀取可由瀏覽器存取的官方來源…");
  try {
    const [data, portfolio] = await Promise.all([loadHome(), loadPortfolioSnapshot()]);
    const histories = await loadPortfolioHistoryMap({
      positions: portfolio.positions,
      trends: data.trends,
      loadHistory: async (symbol) => {
        if (SUPPORTED_RESEARCH_SYMBOLS.has(symbol)) return loadHistory(symbol);
        const position = list(portfolio.positions).find((item) => String(item.researchSymbol || item.symbol).toUpperCase() === symbol);
        return createUnconnectedResearch({
          symbol,
          market: position?.market || "OTHER",
          name: position?.name || symbol,
          assetType: position?.assetType || "個股",
        }).history;
      },
    });
    if (requestId === state.request) {
      state.portfolioHistories = histories;
      renderHome(data);
    }
  }
  catch (error) { if (error.name !== "AbortError" && requestId === state.request) renderError("總覽來源回應無法使用。這裡不會以快取 fixture 或模擬值填入。 "); }
}

async function loadResearchView(symbol = state.symbol) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}(?:\.(?:TW|TWO))?$/.test(normalizedSymbol)) return renderError("研究代碼格式無法辨識。", false);
  const position = portfolioPositionForSymbol(normalizedSymbol);
  const displayName = symbolNames[normalizedSymbol] || position?.name || normalizedSymbol;
  if (!symbolNames[normalizedSymbol] && !position) return renderError("此代碼不在已核對的研究池或目前持股中。", false);
  state.view = "research"; state.symbol = normalizedSymbol; applyNav();
  const { requestId } = startRequest(`正在讀取 ${displayName} 的可用研究來源…`);
  try {
    const data = SUPPORTED_RESEARCH_SYMBOLS.has(normalizedSymbol)
      ? await loadResearch(normalizedSymbol)
      : createUnconnectedResearch({
        symbol: normalizedSymbol,
        market: position?.market || "OTHER",
        name: displayName,
        assetType: position?.assetType || "個股",
      });
    if (requestId === state.request) renderResearch(data);
  } catch (error) { if (error.name !== "AbortError" && requestId === state.request) renderError(`${normalizedSymbol} 研究資料暫時無法載入；未以其他來源替代。`); }
}

async function loadSimpleView(view) {
  state.view = view; applyNav();
  const loaders = { market: loadMarket, opening: loadOpening, radar: loadRadar };
  const loader = loaders[view];
  if (!loader) return renderError("此頁面目前無法使用。", false);
  const titles = { market: "正在讀取官方市場統計…", opening: "正在彙整已接通的開盤線索…", radar: "正在讀取審核允許的價格來源…" };
  const { requestId } = startRequest(titles[view]);
  try {
    const data = await loader();
    if (requestId !== state.request) return;
    if (view === "market") renderMarket(data);
    else if (view === "opening") renderOpening(data);
    else renderRadar(data.items);
  } catch (error) { if (error.name !== "AbortError" && requestId === state.request) renderError("來源暫時無法回應；不會用模擬值填補。 "); }
}

async function showView(view) {
  if (view === "home") return loadHomeView();
  if (view === "research") return loadResearchView(state.symbol);
  if (view === "watchlist") {
    state.view = view; applyNav();
    if (!state.home) { await loadHomeView(); state.view = view; applyNav(); }
    return renderWatchlist();
  }
  return loadSimpleView(view);
}

async function refreshCurrent() {
  await loadPortfolioSnapshot(true);
  if (state.view === "research") return loadResearchView(state.symbol);
  return showView(state.view);
}

function toggleWatch(symbol, forceRemove = false) {
  const watched = loadWatch();
  const exists = watched.includes(symbol);
  const next = forceRemove || exists ? watched.filter((value) => value !== symbol) : [...watched, symbol];
  try { localStorage.setItem(STORE_WATCH, JSON.stringify(next)); } catch {}
  if (state.view === "research" && state.research) renderResearch(state.research);
  else if (state.view === "watchlist") renderWatchlist();
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
  dialogTitle.textContent = "選擇研究標的";
  dialogBody.innerHTML = `<p>僅顯示本 Lab 已核對的台灣研究池。</p><div class="segmented">${Object.entries(symbolNames).map(([symbol, name]) => `<button class="symbol-button" data-action="pick-watch" data-symbol="${esc(symbol)}">加入 ${esc(name)} · ${esc(symbol)}</button>`).join("")}</div><p class="tiny-note">輸入其他代碼不會自動轉用未審 Provider。觀察清單只保存在此瀏覽器。</p>`;
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
    navigateHash(view === "research" ? `research/${encodeURIComponent(state.symbol)}` : view);
    return;
  }
  if (event.target.closest("[data-refresh]")) { refreshCurrent(); return; }
  const actionNode = event.target.closest("[data-action]");
  if (!actionNode) return;
  const action = actionNode.dataset.action;
  const symbol = actionNode.dataset.symbol;
  if (action === "research" || action === "portfolio-research") { dialog.close?.(); navigateToResearch(symbol); }
  else if (action === "home") navigateHash("home");
  else if (action === "toggle-watch") toggleWatch(symbol);
  else if (action === "remove-watch") toggleWatch(symbol, true);
  else if (action === "pick-watch") { toggleWatch(symbol); dialog.close(); state.view = "watchlist"; applyNav(); renderWatchlist(); }
  else if (action === "save-note") saveNote(symbol);
  else if (action === "refresh") refreshCurrent();
  else if (action === "add-symbol") showSymbolPicker();
});
document.querySelector("[data-dialog-close]").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
window.addEventListener("hashchange", routeFromHash);

runtimeStatus.textContent = "AIOS 同源 Lab · 唯讀";

loadPortfolioSnapshot().finally(routeFromHash);
