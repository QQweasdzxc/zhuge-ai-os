const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function renderAiResearchPanel({ status = "IDLE", pack = null, result = null } = {}) {
  const missing = Array.isArray(pack?.missing) ? pack.missing : [];
  const observations = Array.isArray(result?.observations) ? result.observations : [];
  const content = status === "READY" && result
    ? `<p>${esc(result.summary)}</p>${observations.length ? `<ul>${observations.map(item => `<li>${esc(item.text)} <small>${esc(item.evidenceIds.join(", "))}</small></li>`).join("")}</ul>` : ""}`
    : status === "SECRET_REQUIRED"
      ? `<p>AI 分析服務尚未設定。研究 Evidence 契約與摘要格式已準備；沒有設定 AIOS 核准的伺服器端 Provider Secret，因此不會產生模擬分析。</p>`
      : status === "ACCESS_REQUIRED"
        ? `<p>AIOS Investment Access 無法確認；研究摘要維持關閉。</p>`
        : status === "PARTIAL"
          ? `<p>資料不足：${esc(missing.join("、") || "尚無足夠來源 Evidence")}。可以檢視 Evidence 契約，但不產生假摘要。</p>`
          : `<p>摘要只使用本頁研究行情、OHLCV 與具來源的公開 Evidence；不傳入持股資料，也不產生交易指示。</p>`;
  return `<section class="surface ai-research-panel" data-ai-analysis-status="${esc(status)}"><div class="section-title"><h2>AI 研究摘要</h2><span>${status === "SECRET_REQUIRED" ? "尚未設定" : status}</span></div>${content}<p class="tiny-note">Evidence ${Number(pack?.evidence?.length || 0)} 項 · 歷史 ${Number(pack?.history?.bars?.length || 0)} 根 · 缺少 ${missing.length} 項。結果必須引用 Evidence ID；不提供買賣、目標價或下單建議。</p><button type="button" class="secondary-button" data-action="analyze-ai">建立來源 Evidence 摘要</button></section>`;
}
