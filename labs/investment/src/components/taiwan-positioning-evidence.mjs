const esc = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value, digits = 0) => finite(value) ? Number(value).toLocaleString("zh-TW", { maximumFractionDigits: digits }) : "—";
const signed = value => finite(value) ? `${Number(value) > 0 ? "+" : ""}${number(value)}` : "—";

/** Render source-provided TDCC tiers and an optional browser-local observation delta. */
export function renderTdccOwnership(ev, localObservation = null) {
  const rows = Array.isArray(ev?.data) ? ev.data : [];
  if (!rows.length) return "";
  const local = finite(localObservation?.currentTopThreeSourceLevelsPct)
    ? `<section class="tdcc-local-observation" data-tdcc-local-status="${esc(localObservation.status || "INSUFFICIENT_HISTORY")}"><strong>最高三個來源級距合計</strong><span>${number(localObservation.currentTopThreeSourceLevelsPct, 2)}%</span><p class="tiny-note">第 13–15 級 · ${esc(localObservation.currentDate || ev.dataTimestamp || "日期未提供")}${finite(localObservation.changePercentagePoints) ? ` · 較前次本機觀測 ${Number(localObservation.changePercentagePoints) > 0 ? "+" : ""}${number(localObservation.changePercentagePoints, 2)} 個百分點` : " · 尚無前次觀測可比較"}</p><p class="tiny-note">${esc(localObservation.note || "本機讀取紀錄，不是官方完整歷史。")}</p></section>`
    : "";
  return `<div class="tdcc-ownership-view"><p class="tiny-note">TDCC 週資料 · ${esc(ev.dataTimestamp || "日期未提供")} · 原始級距；第 16 級為差異數、第 17 級為合計。</p>${local}<div class="data-table-wrap"><table class="data-table"><thead><tr><th>持股級距</th><th>戶數</th><th>股數</th><th>占比</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.band || "級距未提供")}</td><td>${number(row.holders)}</td><td>${number(row.shares)}</td><td>${number(row.percent, 2)}${finite(row.percent) ? "%" : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
}

/** Show source balances and source-derived one-day changes without treating missing values as zero. */
export function renderTaiwanMarginBalance(ev) {
  const data = ev?.data;
  if (!data) return "";
  const marginChange = finite(data.marginBalance) && finite(data.marginBalancePrevious)
    ? Number(data.marginBalance) - Number(data.marginBalancePrevious) : null;
  const shortChange = finite(data.shortBalance) && finite(data.shortBalancePrevious)
    ? Number(data.shortBalance) - Number(data.shortBalancePrevious) : null;
  const metric = (label, value, suffix = "") => `<div class="metric"><label>${label}</label><strong>${value == null ? "—" : `${value}${suffix}`}</strong></div>`;
  return `<div class="taiwan-margin-view"><p class="tiny-note">官方個股餘額 · ${esc(ev.dataTimestamp || "日期未提供")} · ${esc(data.unit || "單位未提供")}</p><div class="metric-row">${metric("融資餘額", number(data.marginBalance))}${metric("融資日變化", signed(marginChange))}${metric("融券餘額", number(data.shortBalance))}${metric("融券日變化", signed(shortChange))}</div></div>`;
}
