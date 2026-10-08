const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const amount = value => value == null ? "—" : Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

export function renderBrokerBranchEvidence(evidence = null) {
  const status = evidence?.status || "UNAVAILABLE";
  const rows = Array.isArray(evidence?.rows) ? evidence.rows : [];
  const content = rows.length
    ? `<p>${evidence.summary ? `最新來源日合計：買進 ${amount(evidence.summary.buy)} · 賣出 ${amount(evidence.summary.sell)} · 淨額 ${amount(evidence.summary.net)} ${esc(evidence.summary.unit || "")}` : status === "PARTIAL" ? "來源列未完整，僅展示可用資料；不計算全分點合計。" : "資料列有缺值，未計算總額。"}</p><div class="data-table-wrap"><table class="data-table"><thead><tr><th>來源日期</th><th>券商分點</th><th>買進</th><th>賣出</th><th>淨額</th></tr></thead><tbody>${rows.slice(0, 50).map(row => `<tr><td>${esc(row.date || evidence.dataTimestamp || "日期未提供")}</td><th>${esc(row.branch)}</th><td>${amount(row.buy)}</td><td>${amount(row.sell)}</td><td>${amount(row.net)} ${esc(row.unit || "")}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="${status === "SECRET_REQUIRED" ? "callout" : "empty-state"}">${esc(evidence?.note || (status === "NOT_APPLICABLE" ? "台灣券商分點資料不適用此市場。" : "尚無來源可核實的券商分點資料。"))}</p>`;
  return `<section class="surface broker-branch-evidence" data-broker-branch-status="${esc(status)}"><div class="section-title"><h3>券商分點摘要</h3><span>${esc(status)}</span></div>${content}<p class="tiny-note">${esc(evidence?.symbol || "")} · ${esc(evidence?.dataTimestamp || "來源日期未提供")} · ${esc(evidence?.provider || "Provider 未設定")} · ${esc(evidence?.source || "來源未提供")} · 讀取 ${esc(evidence?.fetchedAt || "時間未提供")}</p></section>`;
}
