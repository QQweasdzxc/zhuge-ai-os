function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function renderUsTreasuryContext(evidence) {
  const provider = escapeHtml(evidence?.provider || "U.S. Treasury");
  const date = escapeHtml(evidence?.dataTimestamp || evidence?.data?.date || "日期未提供");
  const freshness = escapeHtml(evidence?.freshness || "unavailable");
  const rawYield = evidence?.data?.tenYearPct;
  const tenYearPct = rawYield === null || rawYield === undefined || rawYield === "" ? null : Number(rawYield);
  if (evidence?.available !== true || tenYearPct === null || !Number.isFinite(tenYearPct)) {
    return `<article class="surface us-treasury-context" data-treasury-context="unavailable"><div class="section-title"><h2>美國 10 年期公債殖利率</h2><span>無可用資料</span></div><p>目前沒有可驗證的官方數值；不以股票行情或其他來源代填。</p>${evidence?.errorCode ? `<small>${escapeHtml(evidence.errorCode)}</small>` : ""}</article>`;
  }
  const display = (value, suffix = "%") => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(2)}${suffix}`;
  const safeSource = (Array.isArray(evidence.source) ? evidence.source : []).find(url => {
    try { return new URL(url).origin === "https://home.treasury.gov"; } catch { return false; }
  });
  const data = evidence.data || {};
  const curve = `<div class="treasury-yield-grid"><div><span>2 年</span><strong>${display(data.twoYearPct)}</strong></div><div><span>10 年</span><strong>${display(tenYearPct)}</strong></div><div><span>30 年</span><strong>${display(data.thirtyYearPct)}</strong></div><div><span>10Y − 2Y</span><strong>${display(data.tenYearMinusTwoYearPct, " 個百分點")}</strong></div></div>`;
  return `<article class="surface us-treasury-context" data-treasury-context="${freshness}"><div class="section-title"><h2>美國公債殖利率曲線</h2><span>${date} · ${freshness === "stale" ? "較舊" : "日頻"}</span></div>${curve}<small>${provider} · 官方每日殖利率，不是股票行情或即時利率；缺少的期別保持未提供</small>${safeSource ? `<p><a href="${escapeHtml(safeSource)}" target="_blank" rel="noopener noreferrer">查看來源</a></p>` : ""}<p class="tiny-note">${escapeHtml(evidence.note || "僅作宏觀背景參考，不構成買賣訊號。")}</p></article>`;
}
