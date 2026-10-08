import { MiniMarketChart } from "../components/mini-market-chart.mjs?v=20261008-1337";
import { portfolioHistoryForPosition } from "./history.mjs?v=20261008-1337";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function number(value, digits = 2) {
  if (!finite(value)) return "—";
  return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits });
}

function money(value, currency) {
  if (!finite(value)) return "—";
  const code = currency === "USD" ? "US$" : currency === "TWD" ? "NT$" : "";
  const numeric = Number(value);
  const amount = number(Math.abs(numeric), currency === "USD" ? 2 : 0);
  return (numeric < 0 ? "-" : "") + code + amount;
}

function signedMoney(value, currency) {
  if (!finite(value)) return "—";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${money(numeric, currency)}`;
}

function dateLabel(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "尚無資料時間";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function statusLabel(status) {
  return status === "AVAILABLE" ? "資料可用" : "部分欄位缺漏";
}

function stateMessage(result = {}) {
  const states = {
    LOADING: ["正在讀取正式持股", "只讀取目前帳號可見的持股摘要；不會修改正式投資資料。", "讀取完成後會顯示持股卡。"],
    SESSION_REQUIRED: ["需要先登入 Zhuge AI OS", "登入後才會依正式權限讀取持股。", "登入後重新整理此 Lab。"],
    APP_ACCESS_REQUIRED: ["目前帳號尚未取得 Investment 使用權", "Lab 不會自行提高權限或改用其他資料。", "請聯絡管理者確認目前帳號的使用權。"],
    MFA_REQUIRED: ["需要完成 Investment 安全驗證", "持股受到現有 MFA 門檻保護；Lab 不會繞過或自行解鎖。", "請完成既有安全驗證後重新讀取。"],
    ACCESS_UNAVAILABLE: ["目前無法確認 Investment 使用權", "為保護持股，尚未讀取 Portfolio。", "稍後重試；如持續發生，請聯絡管理者確認存取狀態。"],
    OWNER_MAPPING_REQUIRED: ["目前登入身份尚未完成 Investment 對應", "無法安全確認持股資料的擁有者，因此未讀取持股。", "請聯絡系統管理員完成正式帳號對應。"],
    EMPTY: ["目前沒有可顯示的持股", "canonical Portfolio 沒有回傳目前持有部位；Lab 不會建立或補入標的。", "目前沒有需要操作的持股資料。"],
    UNAVAILABLE: ["目前無法讀取正式持股", "本區不顯示快取或假資料，也不影響其他研究功能。", "可重新整理；若持續發生，稍後再試。"],
  };
  return states[result.status] || states.UNAVAILABLE;
}

export function renderPortfolioMiniChart(position = {}, evidence = null) {
  return MiniMarketChart({
    evidence,
    mode: "portfolio",
    averageCost: position.averageCost,
    currency: position.currency,
  });
}

export function renderPortfolioSection(result = {}, histories = new Map()) {
  const readAt = result.loadedAt ? `<span class="portfolio-read-at">讀取時間：${escapeHtml(dateLabel(result.loadedAt))}</span>` : "";
  let body = "";
  if (result.status === "AVAILABLE" && Array.isArray(result.positions) && result.positions.length) {
    body = `<div class="portfolio-holdings-grid">${result.positions.map((position) => {
      const history = portfolioHistoryForPosition(histories, position);
      return renderPortfolioCard(position, history);
    }).join("")}</div>`;
  } else {
    const [title, impact, next] = stateMessage(result);
    const action = result.status === "EMPTY"
      ? ""
      : ["SESSION_REQUIRED", "APP_ACCESS_REQUIRED", "MFA_REQUIRED"].includes(result.status)
        ? `<a class="secondary-button" href="../">返回 Lab 實驗室</a>`
        : `<button class="secondary-button" type="button" data-action="refresh">重新讀取</button>`;
    body = `<div class="portfolio-state" data-state="${escapeHtml(result.status || "UNAVAILABLE")}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(impact)}</p><p>${escapeHtml(next)}</p>${action}</div>`;
  }
  return `<section class="portfolio-section" aria-labelledby="portfolio-heading"><div class="section-title"><h2 id="portfolio-heading">我的持股</h2>${readAt}</div><p class="portfolio-source-note">來源：investment_current_positions_view · 持股估值／非即時；估值時間與估值來源依每筆資料顯示。研究行情僅作為獨立歷史圖表，不回寫持股估值。</p>${body}</section>`;
}

export function renderPortfolioCard(position = {}, history = null) {
  const currency = position.currency;
  const pnlClass = finite(position.unrealizedPnl) && Number(position.unrealizedPnl) > 0
    ? "positive"
    : finite(position.unrealizedPnl) && Number(position.unrealizedPnl) < 0 ? "negative" : "neutral";
  const researchSymbol = escapeHtml(position.researchSymbol || position.symbol || "");
  const market = position.market === "TW" || position.market === "US"
    ? position.market
    : position.marketLabel === "TW" || position.marketLabel === "US" ? position.marketLabel : "";
  const researchAction = market
    ? `<button class="primary-button" type="button" data-action="portfolio-research" data-market="${market}" data-venue="${escapeHtml(position.venue || "")}" data-name="${escapeHtml(position.name || "")}" data-symbol="${researchSymbol}">查看研究</button>`
    : `<span class="portfolio-research-unresolved" role="status">市場身分未確認</span>`;
  return `<article class="portfolio-holding-card" data-portfolio-symbol="${escapeHtml(position.symbol || "")}" data-status="${escapeHtml(position.status || "PARTIAL")}">
    <div class="portfolio-card-head"><div><h3>${escapeHtml(position.name || "未命名標的")}</h3><span class="ticker">${escapeHtml(position.symbol || "—")} · ${escapeHtml(position.marketLabel || "市場未提供")}</span></div><span class="status-chip" data-status="${escapeHtml(position.status || "PARTIAL")}">${statusLabel(position.status)}</span></div>
    <div class="portfolio-quantity"><strong>${number(position.quantity, 4)}</strong><span>股／單位</span></div>
    <dl class="portfolio-values">
      <div><dt>平均成本／股</dt><dd>${money(position.averageCost, currency)}</dd></div>
      <div><dt>投入成本</dt><dd>${money(position.investedCost, currency)}</dd></div>
      <div><dt>持股估值／非即時</dt><dd>${money(position.lastPrice, currency)}</dd></div>
      <div><dt>目前市值</dt><dd>${money(position.marketValue, currency)}</dd></div>
      <div><dt>未實現損益</dt><dd class="${pnlClass}">${signedMoney(position.unrealizedPnl, currency)}</dd></div>
      <div><dt>損益率</dt><dd class="${pnlClass}">${finite(position.unrealizedPct) ? `${number(position.unrealizedPct)}%` : "—"}</dd></div>
    </dl>
    ${renderPortfolioMiniChart(position, history)}
    <div class="portfolio-card-source"><span>持股來源：${escapeHtml(position.portfolioSource || "Zhuge Investment Portfolio")}</span><span>估值時間 effective_at：${escapeHtml(dateLabel(position.asOf))}</span><span>market_value_source：${escapeHtml(position.marketValueSource || "來源未提供")} · 非即時</span></div>
    <div class="portfolio-card-footer"><span>${statusLabel(position.status)}</span>${researchAction}</div>
  </article>`;
}

export function renderPortfolioResearchContext(position) {
  if (!position) return "";
  return `<section class="portfolio-research-context" aria-label="持股研究脈絡"><div><strong>我的持股</strong><span>${escapeHtml(position.name)} · ${escapeHtml(position.symbol)} · ${escapeHtml(position.marketLabel)}</span></div><dl>
    <div><dt>持有股數</dt><dd>${number(position.quantity, 4)}</dd></div>
    <div><dt>平均成本／股</dt><dd>${money(position.averageCost, position.currency)}</dd></div>
    <div><dt>未實現損益</dt><dd>${signedMoney(position.unrealizedPnl, position.currency)}</dd></div>
    <div><dt>損益率</dt><dd>${finite(position.unrealizedPct) ? `${number(position.unrealizedPct)}%` : "—"}</dd></div>
  </dl><p>持股僅作為研究脈絡，不代表加碼、減碼、買進或賣出建議。</p></section>`;
}

export const portfolioDisplayFormat = Object.freeze({ number, money, signedMoney, dateLabel });
