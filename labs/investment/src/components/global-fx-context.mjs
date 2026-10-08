function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function safeSourceUrl(value, seriesId, provider) {
  try {
    const url = new URL(value);
    if (provider === "FRED" && url.origin === "https://fred.stlouisfed.org"
      && url.pathname === "/graph/fredgraph.csv"
      && url.searchParams.get("id") === seriesId) return url.href;
    if (provider === "zhuge-yahoo-chart" && url.origin === "https://query1.finance.yahoo.com"
      && url.pathname === `/v8/finance/chart/${encodeURIComponent(seriesId)}`) return url.href;
    return "";
  } catch { return ""; }
}

function row(evidence) {
  const value = evidence?.available === true && finite(evidence?.data?.value)
    ? Number(evidence.data.value)
    : null;
  const seriesId = String(evidence?.seriesId || "");
  const provider = String(evidence?.provider || "");
  const source = (Array.isArray(evidence?.source) ? evidence.source : [])
    .map(url => safeSourceUrl(url, seriesId, provider)).find(Boolean);
  const freshness = escapeHtml(evidence?.freshness || "unavailable");
  const precision = evidence?.category === "market" ? 2 : 4;
  const marker = evidence?.category === "market" ? "market" : evidence?.category === "adr" ? "adr" : "fx";
  const delta = finite(evidence?.data?.change) ? Number(evidence.data.change) : null;
  const deltaPct = finite(evidence?.data?.changePct) ? Number(evidence.data.changePct) : null;
  const signed = number => `${number > 0 ? "+" : ""}${number.toLocaleString("en-US", { maximumFractionDigits: precision })}`;
  return `<tr data-global-category="${marker}" data-global-series="${escapeHtml(seriesId)}" data-status="${escapeHtml(evidence?.status || "UNAVAILABLE")}"><th scope="row">${escapeHtml(evidence?.label || seriesId || "匯率")}</th><td>${value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: precision })}</td><td>${delta === null ? "—" : `${signed(delta)}${evidence?.data?.previousDate ? `<small>較 ${escapeHtml(evidence.data.previousDate)}</small>` : ""}`}</td><td>${deltaPct === null ? "—" : `${deltaPct > 0 ? "+" : ""}${deltaPct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}</td><td>${escapeHtml(evidence?.unit || "資料不可用")}</td><td>${escapeHtml(evidence?.dataTimestamp || "日期未提供")}</td><td>${freshness}</td><td>${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(provider === "FRED" ? "FRED" : "Yahoo chart")}</a>` : "來源不可用"}</td></tr>`;
}

export function renderGlobalFxContext(items) {
  const records = Array.isArray(items) ? items : [];
  const market = records.filter(item => item?.category === "market");
  const adr = records.filter(item => item?.category === "adr");
  const fx = records.filter(item => item?.category !== "market" && item?.category !== "adr");
  const table = (rows, label, empty) => `<div class="section-title"><h3>${label}</h3><span>來源日期 · 延遲背景資料</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>項目</th><th>最新值</th><th>變化</th><th>變化率</th><th>單位</th><th>最新日期</th><th>Freshness</th><th>來源</th></tr></thead><tbody>${rows.map(row).join("") || `<tr><td colspan="8">${empty}</td></tr>`}</tbody></table></div>`;
  const available = records.some(item => item?.available === true);
  return `<article class="surface global-fx-context" data-global-fx-context="${available ? "available" : "unavailable"}">${table(market, "主要市場指數", "目前沒有可讀取的來源日期指數序列。")}${table(adr, "台灣 ADR 參考", "目前沒有可讀取的 ADR 行情。")}${table(fx, "主要匯率參考", "目前沒有可讀取的固定 FRED 匯率序列。")}<p class="tiny-note">FRED 固定序列與 Yahoo-compatible ADR／指數參考各自保留來源。行情時效與彙整範圍未獨立驗證；資料可能延遲，不是即時報價或交易訊號。未回傳的數值保持「—」，不以其他市場資料替代。</p></article>`;
}
