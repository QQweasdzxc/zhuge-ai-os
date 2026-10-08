const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function renderCrossMarketCorrelation(result = null, targetSymbol = "", referenceSymbol = "") {
  const status = result?.status || "NOT_RUN";
  const value = result?.correlation;
  const detail = status === "AVAILABLE"
    ? `<strong>${(Number(value) * 100).toFixed(1)}%</strong><span>${Number(result.pairedReturns)} 組共同交易日報酬 · ${esc(result.startDate)} 至 ${esc(result.endDate)}</span>`
    : `<p class="tiny-note">${esc(result?.note || "選擇一檔美股，使用共同來源日期計算歷史日收報酬相關性。")}</p>`;
  return `<section class="surface cross-market-correlation" data-cross-market-status="${esc(status)}"><div class="section-title"><h3>跨市場歷史相關性</h3><span>TW ↔ US · 描述性資料</span></div><form class="scanner-filter-form" data-cross-market-form><label>台股標的<input name="targetSymbol" value="${esc(targetSymbol)}" readonly></label><label>美股代號<input name="referenceSymbol" value="${esc(referenceSymbol)}" maxlength="20" pattern="[A-Za-z0-9.-]{1,20}" placeholder="輸入美股代號" required></label><button type="submit" class="secondary-button">計算共同日期相關性</button></form>${detail}<p class="tiny-note">台股來源：${esc(result?.targetProvider || "待讀取")} · 美股來源：${esc(result?.referenceProvider || "待讀取")} · 不是因果或交易訊號。</p></section>`;
}
