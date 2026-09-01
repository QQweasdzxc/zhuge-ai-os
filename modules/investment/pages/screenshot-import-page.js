(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentScreenshotImportPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const statusLabels = Object.freeze({
    UNCHANGED: "未變更",
    NEW: "截圖新增",
    CHANGED: "內容變更",
    MISSING_FROM_SCREENSHOT: "Cloud 持倉未出現",
    UNKNOWN: "待確認"
  });

  const fieldLabels = Object.freeze({
    market: "市場",
    symbol: "代號",
    name: "名稱",
    quantity: "數量",
    unit: "單位",
    averageCost: "平均成本",
    investedCost: "投入成本",
    currentPrice: "目前價格",
    marketValue: "目前市值",
    unrealizedPnl: "未實現損益",
    returnRate: "報酬率",
    currency: "幣別"
  });

  const compareFields = Object.freeze([
    "market",
    "symbol",
    "name",
    "quantity",
    "averageCost",
    "investedCost",
    "currentPrice",
    "marketValue",
    "unrealizedPnl",
    "returnRate",
    "currency"
  ]);

  const editableFields = Object.freeze(["symbol", "name", "quantity", "averageCost", "investedCost", "currency"]);

  function escapeText(value, escape) {
    return escape(String(value ?? ""));
  }

  function fileSize(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function valueText(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
    return String(value);
  }

  function cloudValue(cloud, field) {
    const source = cloud?.position || cloud || {};
    const values = {
      market: source.market,
      symbol: source.symbol,
      name: source.name,
      quantity: source.quantity,
      averageCost: source.averageCost ?? source.avg_cost,
      investedCost: source.investedCost ?? source.invested_cost,
      currentPrice: source.lastPrice ?? source.last_price,
      marketValue: source.marketValue ?? source.market_value,
      unrealizedPnl: source.unrealizedPnl ?? source.unrealized_pnl,
      returnRate: source.unrealizedPercent ?? source.unrealized_pct,
      currency: source.currency
    };
    return values[field];
  }

  function screenshotValue(row, field) {
    return row?.values?.[field];
  }

  function renderFiles(files, escape) {
    if (!files.length) {
      return '<div class="investment-import-empty"><strong>尚未加入圖片</strong><small>圖片只會暫留在目前瀏覽器記憶體；關閉或清除本次工作階段後不保留。</small></div>';
    }
    return '<ul class="investment-import-file-list">' + files.map(file => {
      const preview = file.previewUrl
        ? '<img src="' + escapeText(file.previewUrl, escape) + '" alt="' + escapeText(file.name, escape) + '">'
        : '<span class="investment-import-file-placeholder" aria-hidden="true">▧</span>';
      return '<li><div class="investment-import-file-preview">' + preview + '</div><div class="investment-import-file-copy"><strong>' + escapeText(file.name, escape) + '</strong><small>' + escapeText(file.type, escape) + ' · ' + fileSize(file.size) + '</small></div><button type="button" class="investment-import-remove" data-investment-import-action="remove" data-investment-import-file-id="' + escapeText(file.id, escape) + '">移除</button></li>';
    }).join("") + '</ul>';
  }

  function renderRecognitionState(session, escape) {
    const recognition = session.recognition || {};
    const state = recognition.status || "idle";
    const titles = {
      idle: "尚未開始辨識",
      ready: "圖片已準備好",
      recognizing: "正在辨識",
      recognized: "辨識完成",
      error: "辨識未完成",
      blocked: "辨識服務已阻擋"
    };
    const meta = recognition.provider
      ? '<small class="investment-import-recognition-meta">Provider：' + escapeText(recognition.provider, escape) + ' · Model：' + escapeText(recognition.model || "—", escape) + ' · ' + Number(recognition.imageCount || 0) + ' 張圖片</small>'
      : "";
    return '<div class="investment-import-recognition-state is-' + escapeText(state, escape) + '" data-investment-import-recognition-state="' + escapeText(state, escape) + '"><span class="investment-import-state-dot" aria-hidden="true"></span><div><strong>' + escapeText(titles[state] || titles.idle, escape) + '</strong><p>' + escapeText(recognition.message || "尚未開始辨識。", escape) + '</p>' + meta + '</div></div>';
  }

  function inputValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function renderRowEditor(entry, escape) {
    const row = entry.screenshot;
    if (!row || row.ignored) return row?.ignored ? '<small class="investment-import-row-note">此辨識列已忽略；可用「還原辨識結果」恢復。</small>' : "";
    const inputs = editableFields.map(field => {
      const type = ["quantity", "averageCost", "investedCost"].includes(field) ? "number" : "text";
      const step = type === "number" ? ' step="any"' : "";
      return '<label><span>' + fieldLabels[field] + '</span><input type="' + type + '" name="' + field + '" value="' + escapeText(inputValue(row.values[field]), escape) + '"' + step + '></label>';
    }).join("");
    return '<form class="investment-import-edit-form" data-investment-import-edit data-investment-import-row-id="' + escapeText(row.id, escape) + '"><div class="investment-import-edit-grid">' + inputs + '</div><div class="investment-import-row-actions"><button type="submit" class="investment-import-save" data-investment-import-action="save-row">保存預覽</button><button type="button" class="investment-import-ignore" data-investment-import-action="ignore-row" data-investment-import-row-id="' + escapeText(row.id, escape) + '">忽略此列</button></div></form>';
  }

  function renderFieldComparison(entry, escape) {
    const row = entry.screenshot;
    const cloud = entry.cloud;
    const fields = row ? compareFields : ["market", "symbol", "name", "quantity", "averageCost", "investedCost", "currentPrice", "marketValue", "unrealizedPnl", "returnRate", "currency"];
    return '<div class="investment-import-value-table"><div class="investment-import-value-row is-heading"><span>欄位</span><span>目前 Cloud</span><span>截圖辨識</span></div>' + fields.map(field => '<div class="investment-import-value-row"><span>' + escapeText(fieldLabels[field] || field, escape) + '</span><span>' + escapeText(valueText(cloudValue(cloud, field)), escape) + '</span><span>' + escapeText(valueText(screenshotValue(row, field)), escape) + '</span></div>').join("") + '</div>';
  }

  function renderComparisonItems(comparison, escape) {
    const items = Array.isArray(comparison?.items) ? comparison.items : [];
    if (!items.length) {
      return '<div class="investment-import-empty" data-investment-import-preview-empty><strong>等待可信辨識結果</strong><small>目前沒有辨識結果，因此不會把任何 Cloud 持倉誤判為新增、刪除或已賣出。</small></div>';
    }
    return '<div class="investment-import-result-list">' + items.map(entry => {
      const label = statusLabels[entry.status] || entry.status;
      const identity = entry.identity || "無法辨識的市場／代號";
      const confidence = entry.confidenceLevel ? '<span class="investment-import-confidence">信心度 ' + escapeText(entry.confidenceLevel, escape) + '</span>' : '<span class="investment-import-confidence is-unknown">信心度 UNKNOWN</span>';
      const diff = Array.isArray(entry.differences) && entry.differences.length
        ? '<div class="investment-import-diff"><strong>差異欄位</strong><span>' + escapeText(entry.differences.map(difference => (fieldLabels[difference.field] || difference.field) + '：Cloud ' + valueText(difference.cloud) + '／截圖 ' + valueText(difference.screenshot)).join("；"), escape) + '</span></div>'
        : "";
      const sourceImages = entry.screenshot?.sourceImages?.length ? '<small>來源圖片：' + escapeText(entry.screenshot.sourceImages.join("、"), escape) + (entry.screenshot.duplicateCount > 1 ? ' · 已合併 ' + Number(entry.screenshot.duplicateCount) + ' 次辨識' : "") + '</small>' : "";
      return '<article class="investment-import-result is-' + escapeText(String(entry.status || "unknown").toLowerCase(), escape) + '" data-investment-import-result data-investment-import-result-id="' + escapeText(entry.screenshot?.id || entry.identity || "unknown", escape) + '"><header><div><strong>' + escapeText(identity, escape) + '</strong>' + confidence + '</div><span>' + escapeText(label, escape) + '</span></header><p>' + escapeText(entry.reason || "", escape) + '</p>' + renderFieldComparison(entry, escape) + diff + sourceImages + renderRowEditor(entry, escape) + '<small>建議：' + escapeText(entry.suggestedAction || "", escape) + '</small></article>';
    }).join("") + '</div>';
  }

  function renderReconciliation(state, dependencies) {
    const escape = dependencies.escape;
    const engine = dependencies.importEngine;
    const session = dependencies.importSession || {};
    const positions = Array.isArray(state.positions) ? state.positions : [];
    const comparison = dependencies.reconciliation || (engine ? engine.reconcile(positions, null) : { phase: "awaiting-recognition", items: [], counts: {} });
    const counts = comparison.counts || {};
    const ready = comparison.phase === "ready";
    const phaseLabel = ready ? (session.preview?.status === "confirmed" ? "Preview Confirmed" : "已產生預覽") : "等待辨識";
    const scopeLabel = comparison.scope === "full" ? "完整範圍" : comparison.scope === "partial" ? "部分範圍" : "範圍未知";
    const restore = session.recognition?.status === "recognized" ? '<button type="button" class="investment-import-restore" data-investment-import-action="restore-recognition">還原辨識結果</button>' : "";
    const confirm = ready && session.recognition?.status === "recognized" ? '<button type="button" class="investment-primary-link investment-import-confirm" data-investment-import-action="confirm-preview">確認預覽</button>' : "";
    const confirmed = session.preview?.status === "confirmed" ? '<div class="investment-import-confirmed" role="status"><strong>Preview Confirmed／Ready for Import</strong><span>這只代表本次辨識預覽已確認；本階段不會寫入 Investment Cloud。</span></div>' : "";
    return '<article class="investment-import-panel investment-import-reconciliation" data-investment-import-reconciliation><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">03 · Reconciliation Preview</p><h2>Cloud 持倉與截圖差異</h2><p>以目前已通過 Investment 安全驗證的 Cloud 持倉作唯讀比較；截圖範圍未證明完整前，不把未出現視為已賣出。</p></div><span class="investment-import-badge is-pending">' + escapeText(phaseLabel, escape) + '</span></header><div class="investment-import-counts"><span><b>' + positions.length + '</b><small>目前 Cloud 持倉</small></span><span><b>' + (Array.isArray(comparison.items) ? comparison.items.filter(item => item.screenshot).length : 0) + '</b><small>截圖辨識列</small></span><span><b>' + Number(counts.CHANGED || 0) + '</b><small>內容變更</small></span><span><b>' + Number(counts.UNKNOWN || 0) + '</b><small>待確認</small></span></div><div class="investment-import-scope"><span>比較範圍：' + escapeText(scopeLabel, escape) + '</span><span>Cloud：唯讀</span></div><div class="investment-import-status-legend"><span class="is-unchanged">未變更</span><span class="is-new">截圖新增</span><span class="is-changed">內容變更</span><span class="is-missing">Cloud 未出現</span><span class="is-unknown">待確認</span></div>' + renderComparisonItems(comparison, escape) + '<div class="investment-import-preview-actions">' + restore + confirm + '</div>' + confirmed + '</article>';
  }

  function render(state, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value ?? ""));
    const session = dependencies.importSession || { files: [], recognition: { status: "idle", message: "尚未開始辨識。" }, preview: { status: "draft" }, notice: "" };
    const files = Array.isArray(session.files) ? session.files : [];
    const canStart = files.length > 0 && session.recognition?.status !== "recognizing";
    const notice = session.notice ? '<div class="investment-import-notice" role="status">' + escapeText(session.notice, escape) + '</div>' : "";
    const recognition = session.recognition || {};
    const startLabel = recognition.status === "recognizing" ? "辨識中…" : "開始辨識";
    return '<section class="investment-screenshot-import" data-investment-import-page><div class="investment-page-heading"><div><p class="investment-eyebrow">Screenshot Investment Import · Recognition Prototype</p><h1>持股截圖匯入</h1><p>把最新持股畫面帶進可追溯的辨識與唯讀預覽流程；確認前與確認後都不會改動正式 Investment Cloud。</p></div><span class="investment-pill">PNG · JPG · WebP</span></div>' +
      '<div class="investment-import-contract" data-investment-import-contract><div><strong>安全邊界</strong><p>原圖只在目前瀏覽器記憶體與受控辨識請求中存在；不建立 Storage、不把原圖寫入 Cloud、不在瀏覽器保存 API Key。回傳的是可驗證的結構化結果。</p></div><span>Cloud：唯讀</span></div>' +
      '<div class="investment-import-layout"><article class="investment-import-panel investment-import-upload-panel" data-investment-import-upload><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">01 · Upload</p><h2>加入持股截圖</h2><p>可一次選取多張圖片；每張最多 8 MB，本次最多 5 張／總計 20 MB。</p></div><span class="investment-import-badge">瀏覽器記憶體</span></header><input class="investment-import-file-input" id="investmentScreenshotFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple data-investment-import-files aria-label="選擇持股截圖"><button type="button" class="investment-import-dropzone" data-investment-import-dropzone data-investment-import-action="choose"><span class="investment-import-drop-icon" aria-hidden="true">▧</span><strong>拖放圖片到這裡，或選擇圖片</strong><small>支援 PNG、JPG、WebP；不會建立永久檔案。</small></button><div class="investment-import-upload-rule"><span>目前工作階段</span><b>' + files.length + '／5 張圖片</b></div>' + notice + '</article>' +
      '<article class="investment-import-panel investment-import-session-panel" data-investment-import-session><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">02 · Import Session</p><h2>本次圖片清單</h2><p>移除圖片會立即釋放本地預覽；重新整理或關閉頁面會清除本次工作階段。</p></div><button type="button" class="investment-import-clear" data-investment-import-action="clear" ' + (files.length ? "" : "disabled") + '>清除本次</button></header>' + renderFiles(files, escape) + '<div class="investment-import-session-actions"><button type="button" class="investment-primary-link investment-import-start" data-investment-import-action="start-recognition" ' + (canStart ? "" : "disabled") + '>' + startLabel + '</button><small>辨識結果會先停在唯讀 Preview，不會直接匯入。</small></div>' + renderRecognitionState(session, escape) + '</article></div>' +
      renderReconciliation(state, dependencies) +
      '<article class="investment-import-panel investment-import-next-gate"><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">04 · Next Gate</p><h2>預覽後的正式 Gate</h2><p>本 prototype 只做到辨識、Reconciliation、人工修正與 Preview Confirmed；Cloud Write 仍是下一個需另行核准的 Gate。</p></div><span class="investment-import-badge is-pending">Preview Only</span></header><ol><li><strong>OCR／Vision Recognition</strong><span>固定 OpenAI GPT-5.6 Luna；每張圖片產生結構化持股結果。</span></li><li><strong>Review</strong><span>逐筆查看 Cloud／截圖值、差異、confidence，可修正、忽略或還原。</span></li><li><strong>Confirm</strong><span>確認後只進入 Ready for Import，不呼叫 INSERT、UPDATE、RPC 或 Storage。</span></li></ol><p class="investment-import-warning">任何 Missing、Extra、Different、LOW confidence 或多圖衝突，都會留在待確認狀態；不會用假資料補齊。</p></article></section>';
  }

  return Object.freeze({ render, statusLabels, fieldLabels });
});
