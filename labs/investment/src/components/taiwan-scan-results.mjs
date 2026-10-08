const esc = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const fmt = (value, digits = 2) => finite(value) ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";
const signed = (value, digits = 2) => finite(value) ? `${Number(value) > 0 ? "+" : ""}${fmt(value, digits)}` : "—";

function scoreReason(item) {
  const parts = item?.scoreComponents || {};
  return item?.score == null
    ? "缺少排名欄位"
    : `漲跌百分位 ${fmt(parts.dailyChangePercentile, 0)} × 60% + 成交額百分位 ${fmt(parts.tradeValuePercentile, 0)} × 40%`;
}

function table(items) {
  const rows = items.map(item => {
    const changeClass = item.changePercent > 0 ? "positive" : item.changePercent < 0 ? "negative" : "neutral";
    const reason = scoreReason(item);
    return `<tr><td>${fmt(item.rank, 0)}<small>${esc(item.venue)} · ${esc(item.date)}</small></td><td><button class="text-link" data-action="open-research" data-market="TW" data-venue="${esc(item.venue)}" data-symbol="${esc(item.symbol)}" data-name="${esc(item.name)}"><strong>${esc(item.symbol)} ${esc(item.name)}</strong></button><small>${esc(item.industry || "產業未提供")}</small></td><td>${fmt(item.close)}<small>官方日收 · 非即時</small></td><td class="${changeClass}">${signed(item.changePercent)}%<small>${signed(item.change)}</small></td><td>${fmt(item.volume, 0)}</td><td>${fmt(item.tradeValue, 0)}</td><td title="${esc(reason)}"><strong>${item.score == null ? "—" : fmt(item.score, 0)}</strong><small>${esc(reason)}</small></td></tr>`;
  }).join("");
  return `<div class="data-table-wrap scanner-table-wrap"><table class="data-table scanner-table"><thead><tr><th>排名</th><th>標的 / 產業</th><th>收盤</th><th>漲跌</th><th>成交股數</th><th>成交金額 (NT$)</th><th>參考分數 / 組成</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function cards(items) {
  return `<div class="scanner-grid">${items.map(item => {
    const reason = scoreReason(item);
    const changeClass = item.changePercent > 0 ? "positive" : item.changePercent < 0 ? "negative" : "neutral";
    return `<article class="evidence-card scanner-card"><div class="evidence-head"><h3>#${fmt(item.rank, 0)} · ${esc(item.symbol)}</h3><span class="ticker">${esc(item.venue)} · ${esc(item.date)}</span></div><button class="text-link" data-action="open-research" data-market="TW" data-venue="${esc(item.venue)}" data-symbol="${esc(item.symbol)}" data-name="${esc(item.name)}"><strong>${esc(item.name)}</strong></button><p class="tiny-note">${esc(item.industry || "產業未提供")}</p><p class="evidence-value">${fmt(item.close)} <small>官方日收 · 非即時</small></p><p class="${changeClass}">${signed(item.changePercent)}% · ${signed(item.change)}</p><dl class="scanner-card-metrics"><div><dt>成交股數</dt><dd>${fmt(item.volume, 0)}</dd></div><div><dt>成交金額</dt><dd>NT$ ${fmt(item.tradeValue, 0)}</dd></div><div><dt>參考分數</dt><dd>${item.score == null ? "—" : fmt(item.score, 0)}</dd></div></dl><p class="tiny-note">${esc(reason)}</p><button class="secondary-button" data-action="open-research" data-market="TW" data-venue="${esc(item.venue)}" data-symbol="${esc(item.symbol)}" data-name="${esc(item.name)}">開啟研究</button></article>`;
  }).join("")}</div>`;
}

/** Render the same canonical scan rows as a table or dense card set. */
export function renderTaiwanScanResults(items, presentation = "table") {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return '<div class="empty-state">目前篩選條件沒有符合的標的。</div>';
  return presentation === "cards" ? cards(safeItems) : table(safeItems);
}
