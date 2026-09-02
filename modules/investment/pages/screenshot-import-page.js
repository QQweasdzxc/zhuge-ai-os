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
    return '<div class="investment-import-value-table"><div class="investment-import-value-row is-heading"><span>欄位</span><span>目前 Cloud</span><span>本次確認輸入</span></div>' + fields.map(field => '<div class="investment-import-value-row"><span>' + escapeText(fieldLabels[field] || field, escape) + '</span><span>' + escapeText(valueText(cloudValue(cloud, field)), escape) + '</span><span>' + escapeText(valueText(screenshotValue(row, field)), escape) + '</span></div>').join("") + '</div>';
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

  function snapshotWriteEligibility(session, comparison) {
    const recognition = session?.recognition || {};
    const rows = Array.isArray(recognition.rows) ? recognition.rows.filter(row => !row.ignored) : [];
    if (session?.preview?.status !== "confirmed") return Object.freeze({ ok: false, reason: "請先確認完整的辨識預覽。", rows });
    if (recognition.status !== "recognized") return Object.freeze({ ok: false, reason: "尚未取得可驗證的辨識結果。", rows });
    if (recognition.completeness !== "full" || comparison?.scope !== "full") return Object.freeze({ ok: false, reason: "只有已證明為完整持倉範圍的結果才能寫入 Snapshot。", rows });
    if (!rows.length) return Object.freeze({ ok: false, reason: "目前沒有可寫入的持倉列。", rows });
    if (rows.some(row => !row.hasIdentity || !row.isComplete)) return Object.freeze({ ok: false, reason: "仍有缺少欄位、低信心度或衝突的辨識列。", rows });
    const comparisonItems = Array.isArray(comparison?.items) ? comparison.items : [];
    if (comparisonItems.length !== rows.length || comparisonItems.some(item => !item.screenshot || item.status === "UNKNOWN")) {
      return Object.freeze({ ok: false, reason: "比較結果尚未形成完整且無歧義的 Snapshot 清單。", rows });
    }
    return Object.freeze({ ok: true, reason: "已完成完整範圍與逐筆可驗證檢查。", rows });
  }

  function inferredBroker(session) {
    const images = Array.isArray(session?.recognition?.images) ? session.recognition.images : [];
    return images.find(image => image?.brokerOrApp)?.brokerOrApp || "";
  }

  function renderConfirmedInput(session, escape) {
    if (!session?.confirmedInputOpen) return "";
    return '<article class="investment-import-panel investment-import-confirmed-input" data-investment-confirmed-input><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">PM Confirmed Input</p><h2>載入已確認的結構化持倉</h2><p>只接受已完成 GPT Assisted Recognition 且已由 PM 逐筆確認的既有結果；本操作不重新辨識、不建立圖片，也不會直接寫入 Cloud。</p></div><span class="investment-import-badge">瀏覽器記憶體</span></header><form data-investment-confirmed-input-form><label class="investment-import-confirmed-input-label"><span>PM Confirmed Snapshot JSON</span><textarea name="positionsJson" rows="12" required placeholder="{\"broker\":\"…\",\"snapshotAt\":\"YYYY-MM-DDTHH:MM\",\"source\":\"…\",\"idempotencyKey\":\"…\",\"positions\":[…]}"></textarea></label><div class="investment-import-write-actions"><button type="submit" class="investment-primary-link">載入並產生 Reconciliation</button><span class="investment-import-write-hint">載入後仍須逐筆確認 Preview，最後只能透過 AAL2 受控 Snapshot RPC 寫入。</span></div></form></article>';
  }

  function renderSnapshotWrite(session, comparison, dependencies, escape) {
    if (session?.preview?.status !== "confirmed" || typeof dependencies.onSnapshotWrite !== "function") return "";
    const write = dependencies.snapshotWrite || {};
    const eligibility = snapshotWriteEligibility(session, comparison);
    const form = write.form || {};
    const status = write.status || "idle";
    const busy = status === "submitting";
    const confirmedMetadata = session.confirmedInputMetadata || {};
    const broker = form.broker || inferredBroker(session) || confirmedMetadata.broker || "";
    const source = form.source || confirmedMetadata.source || "fubon_ai_pro_position_screenshot";
    const idempotencyKey = form.idempotencyKey || confirmedMetadata.idempotencyKey || (session.sessionId ? `broker-snapshot-${session.sessionId}` : "");
    const result = write.result || {};
    const readBack = result.readBack || {};
    const statusMessage = status === "error"
      ? '<div class="investment-import-write-message is-error" role="alert"><strong>Snapshot 尚未寫入</strong><span>' + escapeText(write.error || "受控寫入失敗。", escape) + '</span></div>'
      : status === "success"
        ? '<div class="investment-import-write-message is-success" role="status"><strong>Snapshot 已寫入並完成 Read-back</strong><span>Header 1 · Items ' + Number(readBack.positionCount || result.position_count || 0) + ' · Reconciliation ' + Number(readBack.reconciliationItemCount || 0) + ' 筆。</span></div>'
        : "";
    const blocked = !eligibility.ok;
    const disabled = busy || blocked;
    return '<article class="investment-import-panel investment-import-write-panel" data-investment-snapshot-write><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">04 · Controlled Snapshot Write</p><h2>寫入 Broker Position Snapshot</h2><p>只有 Preview Confirmed、完整範圍且每筆欄位可驗證時，才會透過 AAL2、Owner／Portfolio scoped RPC 寫入；不會改寫 Transaction 或 Legacy Opening Position。</p></div><span class="investment-import-badge ' + (blocked ? 'is-pending' : '') + '">' + (blocked ? "等待完整資料" : busy ? "寫入中…" : "AAL2 受控") + '</span></header><div class="investment-import-write-contract"><span>Snapshot：append-only evidence</span><span>Transaction mutation：0</span><span>Legacy data：保留</span></div><form class="investment-import-write-form" data-investment-snapshot-write-form><div class="investment-import-write-grid"><label><span>Broker</span><input name="broker" value="' + escapeText(broker, escape) + '" maxlength="120" required ' + (busy ? 'disabled' : '') + '></label><label><span>Snapshot 時間（Asia/Taipei）</span><input type="datetime-local" name="snapshotAt" value="' + escapeText(form.snapshotAt || "", escape) + '" required ' + (busy ? 'disabled' : '') + '></label><label><span>Source</span><input name="source" value="' + escapeText(source, escape) + '" maxlength="160" required ' + (busy ? 'disabled' : '') + '></label><label><span>Idempotency Key</span><input name="idempotencyKey" value="' + escapeText(idempotencyKey, escape) + '" minlength="8" maxlength="240" required ' + (busy ? 'disabled' : '') + '></label></div><div class="investment-import-write-actions"><button type="submit" class="investment-import-write-button" ' + (disabled ? 'disabled' : '') + '>確認並寫入 ' + eligibility.rows.length + ' 筆 Snapshot</button><span class="investment-import-write-hint">' + escapeText(blocked ? eligibility.reason : "時間會以 Asia/Taipei 轉換後送交受控 RPC。", escape) + '</span></div></form>' + statusMessage + '</article>';
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
    const confirmed = session.preview?.status === "confirmed" ? '<div class="investment-import-confirmed" role="status"><strong>Preview Confirmed／Ready for Controlled Write</strong><span>預覽已確認；正式資料只會由下方 AAL2 受控 Snapshot RPC 寫入，不會直接修改 Transaction 或 Legacy Opening Position。</span></div>' : "";
    return '<article class="investment-import-panel investment-import-reconciliation" data-investment-import-reconciliation><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">03 · Reconciliation Preview</p><h2>Cloud 持倉與截圖差異</h2><p>以目前已通過 Investment 安全驗證的 Cloud 持倉作唯讀比較；截圖範圍未證明完整前，不把未出現視為已賣出。</p></div><span class="investment-import-badge is-pending">' + escapeText(phaseLabel, escape) + '</span></header><div class="investment-import-counts"><span><b>' + positions.length + '</b><small>目前 Cloud 持倉</small></span><span><b>' + (Array.isArray(comparison.items) ? comparison.items.filter(item => item.screenshot).length : 0) + '</b><small>截圖辨識列</small></span><span><b>' + Number(counts.CHANGED || 0) + '</b><small>內容變更</small></span><span><b>' + Number(counts.UNKNOWN || 0) + '</b><small>待確認</small></span></div><div class="investment-import-scope"><span>比較範圍：' + escapeText(scopeLabel, escape) + '</span><span>Cloud：唯讀</span></div><div class="investment-import-status-legend"><span class="is-unchanged">未變更</span><span class="is-new">截圖新增</span><span class="is-changed">內容變更</span><span class="is-missing">Cloud 未出現</span><span class="is-unknown">待確認</span></div>' + renderComparisonItems(comparison, escape) + '<div class="investment-import-preview-actions">' + restore + confirm + '</div>' + confirmed + renderSnapshotWrite(session, comparison, dependencies, escape) + '</article>';
  }

  function render(state, dependencies = {}) {
    const escape = dependencies.escape || (value => String(value ?? ""));
    const session = dependencies.importSession || { files: [], recognition: { status: "idle", message: "尚未開始辨識。" }, preview: { status: "draft" }, notice: "" };
    const files = Array.isArray(session.files) ? session.files : [];
    const canStart = files.length > 0 && session.recognition?.status !== "recognizing";
    const notice = session.notice ? '<div class="investment-import-notice" role="status">' + escapeText(session.notice, escape) + '</div>' : "";
    const recognition = session.recognition || {};
    const startLabel = recognition.status === "recognizing" ? "辨識中…" : "開始辨識";
    return '<section class="investment-screenshot-import" data-investment-import-page><div class="investment-page-heading"><div><p class="investment-eyebrow">Screenshot Investment Import · Recognition + Snapshot</p><h1>持股截圖匯入</h1><p>把最新持股畫面帶進可追溯的辨識、Reconciliation 與 AAL2 受控 Snapshot 流程；不會用截圖差異偽造交易。</p></div><span class="investment-pill">PNG · JPG · WebP</span></div>' +
      '<div class="investment-import-contract" data-investment-import-contract><div><strong>安全邊界</strong><p>原圖只在目前瀏覽器記憶體與受控辨識請求中存在；不建立 Storage、不把原圖寫入 Cloud、不在瀏覽器保存 API Key。只有確認後的結構化 Position Evidence 才能經 AAL2 受控 RPC 寫入 Snapshot。</p></div><span>Cloud：受控 Snapshot</span></div>' +
      '<div class="investment-import-layout"><article class="investment-import-panel investment-import-upload-panel" data-investment-import-upload><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">01 · Upload</p><h2>加入持股截圖</h2><p>可一次選取多張圖片；每張最多 8 MB，本次最多 5 張／總計 20 MB。</p></div><span class="investment-import-badge">瀏覽器記憶體</span></header><input class="investment-import-file-input" id="investmentScreenshotFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple data-investment-import-files aria-label="選擇持股截圖"><button type="button" class="investment-import-dropzone" data-investment-import-dropzone data-investment-import-action="choose"><span class="investment-import-drop-icon" aria-hidden="true">▧</span><strong>拖放圖片到這裡，或選擇圖片</strong><small>支援 PNG、JPG、WebP；不會建立永久檔案。</small></button><div class="investment-import-upload-rule"><span>目前工作階段</span><b>' + files.length + '／5 張圖片</b></div><button type="button" class="investment-import-confirmed-input-trigger" data-investment-import-action="open-confirmed-input">載入已完成的 PM Confirmed 結構化結果</button>' + notice + '</article>' + renderConfirmedInput(session, escape) +
      '<article class="investment-import-panel investment-import-session-panel" data-investment-import-session><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">02 · Import Session</p><h2>本次圖片清單</h2><p>移除圖片會立即釋放本地預覽；重新整理或關閉頁面會清除本次工作階段。</p></div><button type="button" class="investment-import-clear" data-investment-import-action="clear" ' + (files.length ? "" : "disabled") + '>清除本次</button></header>' + renderFiles(files, escape) + '<div class="investment-import-session-actions"><button type="button" class="investment-primary-link investment-import-start" data-investment-import-action="start-recognition" ' + (canStart ? "" : "disabled") + '>' + startLabel + '</button><small>辨識結果會先停在唯讀 Preview，不會直接匯入。</small></div>' + renderRecognitionState(session, escape) + '</article></div>' +
      renderReconciliation(state, dependencies) +
      '<article class="investment-import-panel investment-import-next-gate"><header class="investment-import-panel-heading"><div><p class="investment-eyebrow">05 · Safety Contract</p><h2>受控寫入邊界</h2><p>Preview Confirmed 後仍只能透過 AAL2、Owner／Portfolio scoped、atomic、idempotent RPC；瀏覽器沒有直接 Table 寫入權限。</p></div><span class="investment-import-badge is-pending">Controlled Write</span></header><ol><li><strong>Recognition</strong><span>固定 OpenAI GPT-5.6 Luna；每張圖片產生結構化持股結果。</span></li><li><strong>Review</strong><span>逐筆查看 Cloud／本次確認輸入值、差異與 confidence，可修正、忽略或還原。</span></li><li><strong>Snapshot</strong><span>只保存 Broker Position State；不從 Quantity Delta 推導交易，不改寫 Legacy Evidence。</span></li></ol><p class="investment-import-warning">任何 Missing、Extra、Different、LOW confidence 或多圖衝突，都會留在待確認狀態；不會用假資料補齊。</p></article></section>';
  }

  return Object.freeze({ render, statusLabels, fieldLabels, snapshotWriteEligibility });
});
