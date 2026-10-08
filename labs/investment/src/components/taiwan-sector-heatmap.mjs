const esc = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const fmt = (value, digits = 0) => finite(value) ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";

function tile(item) {
  const change = finite(item.averageChangePercent) ? Number(item.averageChangePercent) : null;
  const direction = change == null ? "neutral" : change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
  const changeLabel = change == null ? "資料不足" : `${change > 0 ? "+" : ""}${fmt(change, 2)}%`;
  const label = `${item.venue || "市場"} ${item.industry || "未分類產業"}，${changeLabel}，${item.date || "日期未提供"}`;
  return `<button class="sector-heat-tile ${direction}" type="button" data-action="sector-scan" data-venue="${esc(item.venue)}" data-industry="${esc(item.industry)}" aria-label="${esc(label)}" title="${esc(label)}"><span class="sector-heat-heading"><strong>${esc(item.industry || "產業未分類")}</strong><small>${esc(item.venue || "市場")} · ${esc(item.date || "日期未提供")}</small></span><span class="sector-heat-change">${changeLabel}</span><span class="sector-heat-breadth">漲 ${fmt(item.up)} · 跌 ${fmt(item.down)} · 平 ${fmt(item.flat)}</span><span class="sector-heat-coverage">${fmt(item.symbols)} 檔 · 漲跌資料 ${fmt(item.changeCoverage)}</span></button>`;
}

/** Render source-backed, venue/date-scoped industry breadth. Missing changes remain unavailable. */
export function renderTaiwanSectorHeatmap(items) {
  const sectors = Array.isArray(items) ? items : [];
  if (!sectors.length) return '<p class="empty-state">目前沒有可驗證的產業分類日收資料。</p>';
  const groups = new Map();
  for (const item of sectors) {
    const key = `${item.venue || ""}:${item.date || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].map(group => {
    const first = group[0];
    const sorted = group.slice().sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
    return `<section class="sector-heat-group" aria-label="${esc(first.venue || "市場")} ${esc(first.date || "日期未提供")} 產業廣度"><h3>${esc(first.venue || "市場")} <span>${esc(first.date || "日期未提供")}</span></h3><div class="sector-heat-grid">${sorted.map(tile).join("")}</div></section>`;
  }).join("");
}
