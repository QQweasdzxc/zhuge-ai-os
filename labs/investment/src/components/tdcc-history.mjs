const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const pct = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : "—";

export function renderTdccHistoricalSeries(series = null, { localObservations = [] } = {}) {
  const published = Array.isArray(series?.observations) ? series.observations : [];
  const local = Array.isArray(localObservations) ? localObservations : [];
  const source = published.length ? published : local.map((item, index) => ({
    date: item.date,
    topThreeSourceLevelsPct: item.topThreeSourceLevelsPct,
    changePercentagePoints: index > 0 && item.topThreeSourceLevelsPct != null && local[index - 1]?.topThreeSourceLevelsPct != null
      ? Number(item.topThreeSourceLevelsPct) - Number(local[index - 1].topThreeSourceLevelsPct) : null,
    status: item.topThreeSourceLevelsPct == null ? "PARTIAL" : "AVAILABLE",
  }));
  const rows = source.slice(-52).reverse().map(item => `<tr><td>${esc(item.date || "日期未提供")}</td><td>${pct(item.levels?.["13"] ?? item.levels?.[13])}</td><td>${pct(item.levels?.["14"] ?? item.levels?.[14])}</td><td>${pct(item.levels?.["15"] ?? item.levels?.[15])}</td><td>${pct(item.topThreeSourceLevelsPct)}</td><td>${item.changePercentagePoints == null ? "—" : `${Number(item.changePercentagePoints) > 0 ? "+" : ""}${Number(item.changePercentagePoints).toFixed(2)} pp`}</td></tr>`).join("");
  const status = published.length ? series.status : local.length > 1 ? "LOCAL_OBSERVATIONS" : "INSUFFICIENT_HISTORY";
  const label = status === "AVAILABLE" ? "歷史序列可用" : status === "LOCAL_OBSERVATIONS" ? "本機觀察序列" : "歷史資料不足";
  const publication = published.length
    ? `發布來源：${esc(series.provider || "TDCC")}${series.fetchedAt ? ` · 擷取 ${esc(series.fetchedAt)}` : ""}${series.sourceSha256 ? ` · CSV SHA-256 ${esc(series.sourceSha256)}` : ""}`
    : "本機觀察只能反映此瀏覽器曾讀取的日期，並非完整官方長期歷史。";
  return `<section class="surface tdcc-history" data-tdcc-history-status="${esc(status)}"><div class="section-title"><h3>TDCC 持股級距歷史</h3><span>${label} · ${source.length} 期</span></div>${rows ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>來源日期</th><th>13 級</th><th>14 級</th><th>15 級</th><th>13–15 級合計</th><th>較前期</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty-state">目前只有最新一筆公開級距，尚無足夠歷史期間比較。排程只累積來源實際提供的日期；不補造歷史值。</p>`}<p class="tiny-note">${esc(series?.note || "")}${esc(publication)}${source.some(item => item.status === "PARTIAL") ? " 缺漏級距保持 —，不補造歷史值。" : ""}</p></section>`;
}
