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
    SESSION_REQUIRED: ["需要先登入 Zhuge AI OS", "登入後才會依正式權限讀取持股。", "請先登入，再重新整理此頁。"],
    APP_ACCESS_REQUIRED: ["目前帳號尚未取得 Investment 使用權", "Lab 不會自行提高權限或改用其他資料。", "請至正式 Investment 完成使用權流程。"],
    MFA_REQUIRED: ["需要完成 Investment 安全驗證", "持股受到現有 MFA 門檻保護；Lab 不會繞過或自行解鎖。", "前往正式 Investment 完成驗證，再返回 Lab。"],
    ACCESS_UNAVAILABLE: ["目前無法確認 Investment 使用權", "為保護持股，尚未讀取 Portfolio。", "稍後重試；若持續發生，請到正式 Investment 檢查存取狀態。"],
    OWNER_MAPPING_REQUIRED: ["目前登入身份尚未完成 Investment 對應", "無法安全確認持股資料的擁有者，因此未讀取持股。", "請聯絡系統管理員完成正式帳號對應。"],
    EMPTY: ["目前沒有可顯示的持股", "正式 Investment 沒有回傳目前持有部位；Lab 不會建立或補入標的。", "可前往正式 Investment 查看資料狀態。"],
    UNAVAILABLE: ["目前無法讀取正式持股", "本區不顯示快取或假資料，也不影響其他研究功能。", "可重新整理；若持續發生，稍後再試。"],
  };
  return states[result.status] || states.UNAVAILABLE;
}

function historyMeta(evidence = {}) {
  const provider = evidence.provider || "Provider 未提供";
  const dataDate = evidence.dataTimestamp || "日期未提供";
  const latency = evidence.delayed ? "延遲收盤" : "延遲狀態未標示";
  const freshness = evidence.stale === true ? "資料較舊" : evidence.stale === false ? "時效正常" : "時效未確認";
  const fallback = evidence.fallback ? "Fallback：同來源快取" : "Fallback：否";
  return `${provider} · ${dataDate} · ${latency} · ${freshness} · ${fallback}`;
}

export function renderPortfolioSparkline(position = {}, evidence = null) {
  const rows = Array.isArray(evidence?.data) ? evidence.data : [];
  const bars = rows
    .filter((item) => item && finite(item.close) && Number(item.close) >= 0)
    .slice(-20);
  const cost = finite(position.averageCost) ? Number(position.averageCost) : null;
  const status = evidence?.status || "NOT_CONNECTED";
  const meta = historyMeta(evidence || {});

  if (bars.length < 2) {
    const state = status === "NOT_CONNECTED" || status === "PROVIDER_REVIEW_REQUIRED" ? "NOT_CONNECTED" : "UNAVAILABLE";
    const message = state === "NOT_CONNECTED"
      ? "歷史行情尚未接通"
      : bars.length === 1 ? "歷史行情樣本不足 2 筆" : "歷史行情暫時無法取得";
    return `<section class="portfolio-sparkline" data-history-status="${escapeHtml(state)}" data-has-cost-reference="false" aria-label="近期價格走勢">
      <div class="portfolio-sparkline-head"><strong>近 20 日價格走勢</strong><span class="status-chip" data-status="${escapeHtml(state)}">${escapeHtml(state)}</span></div>
      <p class="portfolio-sparkline-empty">${message}</p>
      <p class="portfolio-sparkline-meta">${escapeHtml(meta)}${evidence?.errorCode ? ` · 狀態：${escapeHtml(evidence.errorCode)}` : ""}</p>
    </section>`;
  }

  const values = bars.map((item) => Number(item.close));
  const scaleValues = cost === null ? values : [...values, cost];
  let min = Math.min(...scaleValues);
  let max = Math.max(...scaleValues);
  if (max === min) {
    const pad = Math.max(Math.abs(max) * 0.02, 1);
    min -= pad;
    max += pad;
  }
  const yFor = (value) => 58 - ((value - min) / (max - min)) * 46;
  const points = values.map((value, index) => ({
    x: 4 + (index / (values.length - 1)) * 292,
    y: yFor(value),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L296,62 L4,62 Z`;
  const direction = values.at(-1) > values[0] ? "up" : values.at(-1) < values[0] ? "down" : "flat";
  const latest = points.at(-1);
  const costLine = cost === null ? "" : `<line class="portfolio-sparkline-cost" data-average-cost-reference="true" x1="4" x2="296" y1="${yFor(cost).toFixed(1)}" y2="${yFor(cost).toFixed(1)}"><title>平均成本 ${escapeHtml(money(cost, position.currency))}</title></line>`;
  const costLabel = cost === null ? "未提供成本線" : `平均成本 ${money(cost, position.currency)}`;
  const aria = `近 20 日 ${bars.length} 筆收盤價走勢${cost === null ? "；未提供平均成本" : `；平均成本 ${money(cost, position.currency)}`}`;
  return `<section class="portfolio-sparkline" data-history-status="${escapeHtml(status)}" data-has-cost-reference="${cost === null ? "false" : "true"}" aria-label="近期價格走勢">
    <div class="portfolio-sparkline-head"><strong>近 20 日價格走勢</strong><span>${bars.length} 筆</span></div>
    <svg class="portfolio-sparkline-chart" viewBox="0 0 300 66" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(aria)}" data-point-count="${bars.length}">
      <title>${escapeHtml(aria)}</title>
      ${costLine}
      <path class="portfolio-sparkline-area portfolio-sparkline-${direction}" d="${area}"></path>
      <path class="portfolio-sparkline-line portfolio-sparkline-${direction}" d="${line}"></path>
      <circle class="portfolio-sparkline-latest portfolio-sparkline-${direction}" data-latest-point="true" cx="${latest.x.toFixed(1)}" cy="${latest.y.toFixed(1)}" r="3.4"><title>最新收盤 ${escapeHtml(money(values.at(-1), position.currency))}</title></circle>
    </svg>
    <div class="portfolio-sparkline-foot"><span>最新 ${escapeHtml(money(values.at(-1), position.currency))}</span><span>${escapeHtml(costLabel)}</span></div>
    <p class="portfolio-sparkline-meta">${escapeHtml(meta)}</p>
  </section>`;
}

export function renderPortfolioSection(result = {}, histories = new Map()) {
  const readAt = result.loadedAt ? `<span class="portfolio-read-at">讀取時間：${escapeHtml(dateLabel(result.loadedAt))}</span>` : "";
  let body = "";
  if (result.status === "AVAILABLE" && Array.isArray(result.positions) && result.positions.length) {
    body = `<div class="portfolio-holdings-grid">${result.positions.map((position) => {
      const history = histories?.get?.(position.researchSymbol) || histories?.get?.(position.symbol) || null;
      return renderPortfolioCard(position, history);
    }).join("")}</div>`;
  } else {
    const [title, impact, next] = stateMessage(result);
    const action = ["SESSION_REQUIRED", "APP_ACCESS_REQUIRED", "MFA_REQUIRED"].includes(result.status)
      ? `<a class="secondary-button" href="../../modules/investment/">前往正式 Investment</a>`
      : result.status === "EMPTY"
        ? `<a class="secondary-button" href="../../modules/investment/">查看正式 Investment</a>`
        : `<button class="secondary-button" type="button" data-action="refresh">重新讀取</button>`;
    body = `<div class="portfolio-state" data-state="${escapeHtml(result.status || "UNAVAILABLE")}"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(impact)}</p><p>${escapeHtml(next)}</p>${action}</div>`;
  }
  return `<section class="portfolio-section" aria-labelledby="portfolio-heading"><div class="section-title"><h2 id="portfolio-heading">我的持股</h2>${readAt}</div><p class="portfolio-source-note">來源：Zhuge Investment Portfolio · 只讀正式持股；價格為持股紀錄估值，非即時行情。</p>${body}</section>`;
}

export function renderPortfolioCard(position = {}, history = null) {
  const currency = position.currency;
  const pnlClass = finite(position.unrealizedPnl) && Number(position.unrealizedPnl) > 0
    ? "positive"
    : finite(position.unrealizedPnl) && Number(position.unrealizedPnl) < 0 ? "negative" : "neutral";
  const researchSymbol = escapeHtml(position.researchSymbol || position.symbol || "");
  return `<article class="portfolio-holding-card" data-portfolio-symbol="${escapeHtml(position.symbol || "")}" data-status="${escapeHtml(position.status || "PARTIAL")}">
    <div class="portfolio-card-head"><div><h3>${escapeHtml(position.name || "未命名標的")}</h3><span class="ticker">${escapeHtml(position.symbol || "—")} · ${escapeHtml(position.marketLabel || "市場未提供")}</span></div><span class="status-chip" data-status="${escapeHtml(position.status || "PARTIAL")}">${statusLabel(position.status)}</span></div>
    <div class="portfolio-quantity"><strong>${number(position.quantity, 4)}</strong><span>股／單位</span></div>
    <dl class="portfolio-values">
      <div><dt>平均成本／股</dt><dd>${money(position.averageCost, currency)}</dd></div>
      <div><dt>投入成本</dt><dd>${money(position.investedCost, currency)}</dd></div>
      <div><dt>目前價格</dt><dd>${money(position.lastPrice, currency)}</dd></div>
      <div><dt>目前市值</dt><dd>${money(position.marketValue, currency)}</dd></div>
      <div><dt>未實現損益</dt><dd class="${pnlClass}">${signedMoney(position.unrealizedPnl, currency)}</dd></div>
      <div><dt>損益率</dt><dd class="${pnlClass}">${finite(position.unrealizedPct) ? `${number(position.unrealizedPct)}%` : "—"}</dd></div>
    </dl>
    ${renderPortfolioSparkline(position, history)}
    <div class="portfolio-card-source"><span>持股來源：${escapeHtml(position.portfolioSource || "Zhuge Investment Portfolio")}</span><span>持股資料時間：${escapeHtml(dateLabel(position.asOf))}</span><span>估值來源：${escapeHtml(position.marketValueSource || "來源未提供")} · 非即時行情</span></div>
    <div class="portfolio-card-footer"><span>${statusLabel(position.status)}</span><button class="primary-button" type="button" data-action="portfolio-research" data-symbol="${researchSymbol}">查看研究</button></div>
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
