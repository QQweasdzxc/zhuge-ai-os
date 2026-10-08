const escapeHtml = value => String(value ?? "").replace(/[&<>\"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

const formatShares = value => value == null || !Number.isFinite(Number(value))
  ? "—"
  : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 0 })} 股`;

const FLOWS = Object.freeze([
  ["外資", "foreignNetShares"],
  ["投信", "trustNetShares"],
  ["自營商", "dealerNetShares"],
  ["三類法人加總", "allThreeNetShares"],
]);

function windowTable(label, window) {
  if (!window) return "";
  const values = FLOWS.map(([name, key]) => `<tr><th>${name}</th><td>${formatShares(window[key])}</td></tr>`).join("");
  const completeness = window.complete ? "完整來源交易日" : `資料不足：${window.sessions}/${window.requiredSessions} 個來源交易日`;
  return `<section class="institutional-flow-window"><h4>${label} · ${window.from || "日期未齊"} 至 ${window.through || "日期未齊"}</h4><p class="tiny-note">${completeness}</p><div class="data-table-wrap"><table class="data-table"><tbody>${values}</tbody></table></div></section>`;
}

function streakLabel(streak) {
  if (!streak || streak.direction === "UNAVAILABLE") return "資料不足";
  if (streak.direction === "NEUTRAL") return "最新日中性";
  return `${streak.direction === "BUY" ? "連買" : "連賣"} ${streak.sessions} 個交易日 · ${formatShares(streak.netShares)}`;
}

/** Render only derived values from the source-dated institutional flow projection. */
export function renderInstitutionalFlowSummary(summary) {
  if (!summary) return "";
  const recent = Array.isArray(summary.points) ? summary.points.at(-1)?.date : null;
  const streaks = FLOWS.map(([name, key]) => `<tr><th>${name}</th><td>${escapeHtml(streakLabel(summary.streaks?.[key]))}</td></tr>`).join("");
  return `<div class="institutional-flow-summary" data-institutional-flow-summary="true"><div class="institutional-flow-windows">${windowTable("近 5 個來源交易日", summary.fiveSessions)}${windowTable("近 10 個來源交易日", summary.tenSessions)}</div><section><h4>連續買賣</h4><p class="tiny-note">最近來源交易日：${escapeHtml(recent || "未提供")}</p><div class="data-table-wrap"><table class="data-table"><tbody>${streaks}</tbody></table></div></section>${summary.sourceFailures ? `<p class="tiny-note">有 ${Number(summary.sourceFailures)} 個來源日期讀取失敗；摘要保留缺值。</p>` : ""}</div>`;
}
