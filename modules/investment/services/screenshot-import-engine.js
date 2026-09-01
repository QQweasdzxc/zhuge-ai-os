(function (root, factory) {
  const positionModel = root?.InvestmentPosition || (typeof require === "function" ? require("../models/position.js") : null);
  const api = factory(positionModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentScreenshotImportEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Position) {
  "use strict";

  if (!Position || typeof Position.normalize !== "function") {
    throw new TypeError("Screenshot import engine requires the canonical Investment Position model.");
  }

  const RECOGNITION_FIELDS = Object.freeze([
    "market",
    "symbol",
    "name",
    "quantity",
    "unit",
    "averageCost",
    "investedCost",
    "currentPrice",
    "marketValue",
    "unrealizedPnl",
    "returnRate",
    "currency"
  ]);

  const REQUIRED_FIELDS = RECOGNITION_FIELDS;
  const COMPARE_FIELDS = Object.freeze([
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

  const STATUS = Object.freeze({
    UNCHANGED: "UNCHANGED",
    NEW: "NEW",
    CHANGED: "CHANGED",
    MISSING_FROM_SCREENSHOT: "MISSING_FROM_SCREENSHOT",
    UNKNOWN: "UNKNOWN"
  });

  const CONFIDENCE_LEVELS = Object.freeze({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" });
  const COMPLETENESS = Object.freeze({ FULL: "full", PARTIAL: "partial", UNKNOWN: "unknown" });
  const IMPORT_LIMITS = Object.freeze({
    maxFiles: 5,
    maxBytesPerFile: 8 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024,
    acceptedMimeTypes: Object.freeze(["image/png", "image/jpeg", "image/webp"])
  });

  const EDITABLE_FIELDS = Object.freeze([
    "market",
    "symbol",
    "name",
    "quantity",
    "unit",
    "averageCost",
    "investedCost",
    "currentPrice",
    "marketValue",
    "unrealizedPnl",
    "returnRate",
    "currency"
  ]);

  function text(value, maxLength = 240) {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const normalized = String(value).trim().replace(/,/g, "").replace(/%$/, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function integer(value, fallback = 0) {
    const parsed = number(value);
    return parsed === null ? fallback : Math.max(0, Math.floor(parsed));
  }

  function firstValue(value, aliases) {
    for (const key of aliases) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    }
    return null;
  }

  function uniqueTexts(values, maxItems = 40, maxLength = 240) {
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = text(value, maxLength);
      if (normalized && !result.includes(normalized)) result.push(normalized);
      if (result.length >= maxItems) break;
    }
    return Object.freeze(result);
  }

  function normalizeMime(file = {}) {
    const declared = String(file.type || "").trim().toLowerCase();
    if (IMPORT_LIMITS.acceptedMimeTypes.includes(declared)) return declared;
    if (declared) return declared;
    const name = String(file.name || "").toLowerCase();
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".webp")) return "image/webp";
    return "";
  }

  function validateFile(file, currentBytes = 0, currentCount = 0) {
    const mime = normalizeMime(file);
    if (!IMPORT_LIMITS.acceptedMimeTypes.includes(mime)) {
      return Object.freeze({ ok: false, code: "UNSUPPORTED_IMAGE_TYPE", message: "僅支援 PNG、JPG、WebP 圖片。" });
    }
    const size = number(file?.size);
    if (size === null || size < 0) {
      return Object.freeze({ ok: false, code: "INVALID_IMAGE_SIZE", message: "圖片大小無法確認，已略過。" });
    }
    if (size > IMPORT_LIMITS.maxBytesPerFile) {
      return Object.freeze({ ok: false, code: "IMAGE_TOO_LARGE", message: "單張圖片不可超過 8 MB。" });
    }
    if (currentCount >= IMPORT_LIMITS.maxFiles) {
      return Object.freeze({ ok: false, code: "IMAGE_COUNT_LIMIT", message: "一次最多辨識 5 張圖片。" });
    }
    if (currentBytes + size > IMPORT_LIMITS.maxTotalBytes) {
      return Object.freeze({ ok: false, code: "IMAGE_TOTAL_SIZE_LIMIT", message: "本次圖片總大小不可超過 20 MB。" });
    }
    return Object.freeze({ ok: true, mime, size });
  }

  function fileKey(file = {}) {
    return [file.name || "", file.size || 0, normalizeMime(file), file.lastModified || 0].join("::");
  }

  function sourceValues(value = {}) {
    value = value && typeof value === "object" ? value : {};
    const values = {
      market: text(firstValue(value, ["market"])),
      symbol: text(firstValue(value, ["symbol", "code", "ticker"])),
      name: text(firstValue(value, ["name", "assetName", "asset_name"])),
      quantity: number(firstValue(value, ["quantity", "shares", "units"])),
      unit: text(firstValue(value, ["unit"])),
      averageCost: number(firstValue(value, ["averageCost", "average_cost", "avg_cost", "avgCost"])),
      investedCost: number(firstValue(value, ["investedCost", "invested_cost", "total_cost", "totalCost"])),
      currentPrice: number(firstValue(value, ["currentPrice", "current_price", "lastPrice", "last_price"])),
      marketValue: number(firstValue(value, ["marketValue", "market_value"])),
      unrealizedPnl: number(firstValue(value, ["unrealizedPnl", "unrealized_pnl"])),
      returnRate: number(firstValue(value, ["returnRate", "return_rate", "unrealizedPercent", "unrealized_pct"])),
      currency: text(firstValue(value, ["currency"]))
    };
    if (values.market) values.market = values.market.toUpperCase();
    if (values.currency) values.currency = values.currency.toUpperCase();
    return Object.freeze(values);
  }

  function confidenceLevel(value, explicit = null) {
    const declared = text(explicit, 20)?.toUpperCase();
    if (Object.values(CONFIDENCE_LEVELS).includes(declared)) return declared;
    const score = number(value);
    if (score === null || score < 0 || score > 1) return null;
    if (score >= 0.9) return CONFIDENCE_LEVELS.HIGH;
    if (score >= 0.7) return CONFIDENCE_LEVELS.MEDIUM;
    return CONFIDENCE_LEVELS.LOW;
  }

  function sourceFields(input = {}) {
    return uniqueTexts(firstValue(input, ["sourceFields", "source_fields"]) || [], 40, 100);
  }

  function canonicalPosition(values, input) {
    return Position.normalize({
      id: input.id || values.symbol || "",
      userId: input.userId || "",
      portfolioId: input.portfolioId || "",
      symbol: values.symbol || "",
      name: values.name || "",
      market: values.market || "TW",
      currency: values.currency || "TWD",
      quantity: values.quantity ?? 0,
      averageCost: values.averageCost ?? 0,
      investedCost: values.investedCost ?? 0,
      lastPrice: values.currentPrice ?? 0,
      marketValue: values.marketValue ?? 0,
      unrealizedPnl: values.unrealizedPnl ?? 0
    });
  }

  function normalizeRecognitionRow(input = {}, metadata = {}) {
    input = input && typeof input === "object" ? input : {};
    const source = input.values && typeof input.values === "object" ? { ...input.values, ...input } : input;
    const values = sourceValues(source);
    const known = Object.freeze(Object.fromEntries(RECOGNITION_FIELDS.map(field => [field, values[field] !== null])));
    const missingFields = Object.freeze(REQUIRED_FIELDS.filter(field => !known[field]));
    const recognitionConfidence = number(firstValue(source, ["recognitionConfidence", "confidence", "confidenceScore"]));
    const level = confidenceLevel(recognitionConfidence, firstValue(source, ["confidenceLevel", "confidence_level"]));
    const imageId = text(metadata.imageId || firstValue(source, ["imageId", "image_id"]), 120);
    const sourceImages = uniqueTexts(
      (Array.isArray(metadata.sourceImages) ? metadata.sourceImages : null)
      || (Array.isArray(source.sourceImages) ? source.sourceImages : null)
      || (Array.isArray(source.source_images) ? source.source_images : null)
      || (imageId ? [imageId] : []),
      20,
      120
    );
    const conflicts = uniqueTexts(
      metadata.conflicts || firstValue(source, ["conflicts", "conflictFields", "conflict_fields"]) || [],
      RECOGNITION_FIELDS.length,
      100
    );
    const id = String(
      metadata.id
      || input.id
      || [values.market, values.symbol].filter(Boolean).join(":")
      || ["recognition-row", imageId || "unknown", metadata.index ?? source.index ?? 0].join(":")
    );
    const duplicateCount = Math.max(1, integer(metadata.duplicateCount ?? source.duplicateCount ?? source.duplicate_count, 1));
    const editedFields = uniqueTexts(
      metadata.editedFields || firstValue(source, ["editedFields", "edited_fields"]) || [],
      RECOGNITION_FIELDS.length,
      100
    );
    const position = canonicalPosition(values, { ...input, id });
    const isValidConfidence = recognitionConfidence !== null && recognitionConfidence >= 0 && recognitionConfidence <= 1;
    return Object.freeze({
      id,
      position,
      values,
      known,
      missingFields,
      recognitionConfidence,
      confidenceLevel: level,
      sourceType: "screenshot",
      sourceFields: sourceFields(source),
      sourceImages,
      imageId,
      duplicateCount,
      conflicts,
      editedFields,
      ignored: source.ignored === true || metadata.ignored === true,
      hasIdentity: Boolean(values.market && values.symbol),
      isComplete: missingFields.length === 0 && isValidConfidence && level !== CONFIDENCE_LEVELS.LOW && conflicts.length === 0
    });
  }

  function ensureRecognitionRow(value, metadata = {}) {
    if (value?.values && value?.known && Array.isArray(value?.missingFields)) return value;
    return normalizeRecognitionRow(value, metadata);
  }

  function identityKey(value) {
    const row = value?.values ? value : normalizeRecognitionRow(value);
    if (!row.values.market || !row.values.symbol) return null;
    return row.values.market + "::" + row.values.symbol;
  }

  function cloudValues(input = {}) {
    const position = input?.position || input;
    const averageCost = number(position.averageCost ?? position.avg_cost);
    const investedCost = number(position.investedCost ?? position.invested_cost);
    const unrealizedPnl = number(position.unrealizedPnl ?? position.unrealized_pnl);
    return Object.freeze({
      market: text(position.market)?.toUpperCase(),
      symbol: text(position.symbol),
      name: text(position.name),
      quantity: number(position.quantity),
      averageCost,
      investedCost,
      currentPrice: number(position.lastPrice ?? position.last_price),
      marketValue: number(position.marketValue ?? position.market_value),
      unrealizedPnl,
      returnRate: investedCost ? unrealizedPnl / investedCost * 100 : null,
      currency: text(position.currency)?.toUpperCase()
    });
  }

  function equal(field, left, right) {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    if (["market", "symbol", "currency"].includes(field)) return String(left).toUpperCase() === String(right).toUpperCase();
    if (field === "name" || field === "unit") return String(left).trim() === String(right).trim();
    if (typeof left === "number" && typeof right === "number") {
      return Math.abs(left - right) <= Math.max(0.01, Math.abs(left) * 0.000001, Math.abs(right) * 0.000001);
    }
    return String(left) === String(right);
  }

  function readinessReason(row) {
    if (row.ignored) return "此辨識列已由使用者忽略。";
    if (!row.hasIdentity) return "缺少可辨識的市場或代號，不能安全歸屬。";
    if (row.missingFields.length) return "辨識結果缺少欄位：" + row.missingFields.join("、") + "。";
    if (row.conflicts.length) return "多張圖片對同一標的的欄位互相衝突：" + row.conflicts.join("、") + "。";
    if (row.recognitionConfidence === null || row.recognitionConfidence < 0 || row.recognitionConfidence > 1) return "缺少有效的辨識信心度。";
    if (row.confidenceLevel === CONFIDENCE_LEVELS.LOW) return "辨識信心度偏低，必須由使用者確認，不能成為未來寫入候選。";
    return "";
  }

  function compareExisting(existing, recognized) {
    const row = ensureRecognitionRow(recognized);
    const reason = readinessReason(row);
    if (reason) {
      return Object.freeze({ status: STATUS.UNKNOWN, comparison: "UNKNOWN", reason, differences: Object.freeze([]), row });
    }
    const current = cloudValues(existing);
    const differences = [];
    const unavailable = [];
    for (const field of COMPARE_FIELDS) {
      if (current[field] === null || current[field] === undefined) {
        unavailable.push(field);
      } else if (!equal(field, row.values[field], current[field])) {
        differences.push(Object.freeze({ field, screenshot: row.values[field], cloud: current[field] }));
      }
    }
    if (unavailable.length) {
      return Object.freeze({
        status: STATUS.UNKNOWN,
        comparison: "UNKNOWN",
        reason: "Cloud 缺少可比較欄位：" + unavailable.join("、") + "。",
        differences: Object.freeze(differences),
        row
      });
    }
    if (differences.length) {
      return Object.freeze({
        status: STATUS.CHANGED,
        comparison: "DIFFERENT",
        reason: "截圖資料與目前 Cloud 持倉內容不同。",
        differences: Object.freeze(differences),
        row
      });
    }
    return Object.freeze({ status: STATUS.UNCHANGED, comparison: "MATCH", reason: "截圖資料與目前 Cloud 持倉一致。", differences: Object.freeze([]), row });
  }

  function item(status, row, reason, differences = [], cloud = null) {
    return Object.freeze({
      status,
      comparison: status === STATUS.UNCHANGED ? "MATCH" : status === STATUS.CHANGED ? "DIFFERENT" : status,
      identity: identityKey(row || cloud),
      reason,
      differences: Object.freeze(differences),
      screenshot: row || null,
      cloud: cloud || null,
      confidenceLevel: row?.confidenceLevel || null,
      suggestedAction: status === STATUS.NEW
        ? "待使用者確認後新增"
        : status === STATUS.CHANGED
          ? "待使用者確認後更新"
          : status === STATUS.MISSING_FROM_SCREENSHOT
            ? "保留 Cloud，不自動刪除"
            : status === STATUS.UNKNOWN
              ? "需要人工補正或重新辨識"
              : "不需變更"
    });
  }

  function summary(items, phase = "ready") {
    const counts = Object.fromEntries(Object.values(STATUS).map(status => [status, 0]));
    items.forEach(entry => { counts[entry.status] = (counts[entry.status] || 0) + 1; });
    return Object.freeze({
      phase,
      total: items.length,
      counts: Object.freeze(counts),
      hasGap: counts.NEW + counts.CHANGED + counts.MISSING_FROM_SCREENSHOT + counts.UNKNOWN > 0
    });
  }

  function mergeRows(rows = []) {
    const groups = new Map();
    let anonymous = 0;
    for (const raw of rows) {
      const row = ensureRecognitionRow(raw);
      const key = identityKey(row) || `__anonymous__${anonymous++}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const merged = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }
      const first = group[0];
      const conflicts = new Set(group.flatMap(row => row.conflicts || []));
      const values = {};
      for (const field of RECOGNITION_FIELDS) {
        const knownValues = group.map(row => row.values[field]).filter(value => value !== null && value !== undefined);
        if (!knownValues.length) {
          values[field] = null;
          continue;
        }
        const candidate = knownValues[0];
        if (knownValues.some(value => !equal(field, candidate, value))) {
          values[field] = null;
          conflicts.add(field);
        } else {
          values[field] = candidate;
        }
      }
      const confidenceValues = group.map(row => row.recognitionConfidence).filter(value => value !== null && value >= 0 && value <= 1);
      const confidence = confidenceValues.length === group.length ? Math.min(...confidenceValues) : null;
      const explicitLevels = group.map(row => row.confidenceLevel).filter(Boolean);
      const level = explicitLevels.includes(CONFIDENCE_LEVELS.LOW)
        ? CONFIDENCE_LEVELS.LOW
        : confidenceLevel(confidence, explicitLevels.includes(CONFIDENCE_LEVELS.MEDIUM) ? CONFIDENCE_LEVELS.MEDIUM : null);
      const sourceImages = [...new Set(group.flatMap(row => row.sourceImages || []))];
      const sourceFieldList = [...new Set(group.flatMap(row => row.sourceFields || []))];
      const duplicateCount = group.reduce((total, row) => total + Math.max(1, row.duplicateCount || 1), 0);
      merged.push(normalizeRecognitionRow({
        ...values,
        id: first.id,
        confidence,
        confidenceLevel: level,
        sourceFields: sourceFieldList,
        sourceImages,
        duplicateCount,
        conflicts: [...conflicts],
        editedFields: [...new Set(group.flatMap(row => row.editedFields || []))],
        ignored: group.some(row => row.ignored === true)
      }, {
        id: first.id,
        imageId: first.imageId,
        sourceImages,
        sourceFields: sourceFieldList,
        duplicateCount,
        conflicts: [...conflicts],
        editedFields: [...new Set(group.flatMap(row => row.editedFields || []))]
      }));
    }
    return Object.freeze(merged);
  }

  function normalizeCompleteness(value) {
    const normalized = text(value, 20)?.toLowerCase();
    return Object.values(COMPLETENESS).includes(normalized) ? normalized : null;
  }

  function normalizeRecognitionResult(providerResult = {}) {
    const input = providerResult && typeof providerResult === "object" ? providerResult : {};
    const rawImages = Array.isArray(input.images) && input.images.length
      ? input.images
      : [{ image_id: "image-1", status: "ready", result: input }];
    const imageResults = [];
    const rows = [];
    const warnings = [...(Array.isArray(input.warnings) ? input.warnings : [])];
    for (let index = 0; index < rawImages.length; index += 1) {
      const image = rawImages[index] && typeof rawImages[index] === "object" ? rawImages[index] : {};
      const imageId = text(image.image_id || image.imageId, 120) || `image-${index + 1}`;
      const imageStatus = text(image.status, 40)?.toLowerCase() || "ready";
      const result = image.result && typeof image.result === "object" ? image.result : image;
      const imageWarnings = Array.isArray(result.warnings) ? result.warnings : [];
      warnings.push(...imageWarnings);
      if (["error", "failed", "timeout"].includes(imageStatus)) {
        imageResults.push(Object.freeze({ imageId, status: "error", rowCount: 0, completeness: COMPLETENESS.UNKNOWN }));
        continue;
      }
      const positions = Array.isArray(result.positions) ? result.positions : [];
      positions.forEach((position, rowIndex) => {
        const rowInput = position && typeof position === "object" ? { ...position } : {};
        // The formal recognition contract carries market at screenshot level.
        // Inherit it only when the row omitted the field; never infer a market
        // when the screenshot itself did not state one.
        if ((rowInput.market === null || rowInput.market === undefined || rowInput.market === "") && result.market) {
          rowInput.market = result.market;
        }
        rows.push(normalizeRecognitionRow(rowInput, { imageId, index: rowIndex, id: `${imageId}:${rowIndex + 1}` }));
      });
      imageResults.push(Object.freeze({
        imageId,
        status: "ready",
        rowCount: positions.length,
        completeness: normalizeCompleteness(result.completeness) || COMPLETENESS.UNKNOWN,
        screenshotType: text(result.screenshot_type || result.screenshotType, 80),
        brokerOrApp: text(result.broker_or_app || result.brokerOrApp, 120),
        market: text(result.market, 40)?.toUpperCase() || null
      }));
    }
    const declaredCompleteness = normalizeCompleteness(input.completeness);
    const imageCompleteness = imageResults.map(image => image.completeness);
    const completeness = declaredCompleteness
      || (imageCompleteness.some(value => value === COMPLETENESS.UNKNOWN)
        ? COMPLETENESS.UNKNOWN
        : imageCompleteness.some(value => value === COMPLETENESS.PARTIAL)
          ? COMPLETENESS.PARTIAL
          : imageCompleteness.length && imageCompleteness.every(value => value === COMPLETENESS.FULL)
            ? COMPLETENESS.FULL
            : COMPLETENESS.UNKNOWN);
    const normalizedRows = mergeRows(rows);
    const hasError = imageResults.some(image => image.status === "error");
    const rawStatus = text(input.status, 40)?.toLowerCase();
    const status = rawStatus === "error" || (hasError && !normalizedRows.length)
      ? "error"
      : rawStatus === "partial" || hasError
        ? "partial"
        : "ready";
    return Object.freeze({
      sessionId: text(input.session_id || input.sessionId, 120),
      provider: text(input.provider, 60),
      model: text(input.model, 120),
      status,
      completeness,
      rows: normalizedRows,
      images: Object.freeze(imageResults),
      warnings: uniqueTexts(warnings, 40, 240)
    });
  }

  function reconcile(existingPositions = [], recognizedRows, options = {}) {
    if (!Array.isArray(recognizedRows)) {
      return Object.freeze({ ...summary([], "awaiting-recognition"), scope: options.scope || COMPLETENESS.UNKNOWN, items: Object.freeze([]) });
    }
    const existing = Array.isArray(existingPositions) ? existingPositions : [];
    const normalizedRows = recognizedRows.map(ensureRecognitionRow);
    const existingByKey = new Map();
    const duplicateExisting = new Set();
    existing.forEach(position => {
      const key = identityKey(position);
      if (!key) return;
      if (existingByKey.has(key)) duplicateExisting.add(key);
      else existingByKey.set(key, position);
    });
    const seenRows = new Map();
    const items = [];
    normalizedRows.forEach(row => {
      const key = identityKey(row);
      if (!key || seenRows.has(key) || duplicateExisting.has(key)) {
        items.push(item(STATUS.UNKNOWN, row, "同一市場與代號存在重複資料，不能安全決定更新對象。"));
        return;
      }
      seenRows.set(key, row);
      const current = existingByKey.get(key);
      if (current) {
        const result = compareExisting(current, row);
        items.push(item(result.status, result.row, result.reason, result.differences, current));
      } else {
        const reason = readinessReason(row);
        items.push(item(reason ? STATUS.UNKNOWN : STATUS.NEW, row, reason || "截圖出現 Cloud 尚未有的持倉標的。"));
      }
    });
    existing.forEach(position => {
      const key = identityKey(position);
      if (!key) {
        items.push(item(STATUS.UNKNOWN, null, "Cloud 持倉缺少市場或代號，不能安全比對。", [], position));
        return;
      }
      if (seenRows.has(key)) return;
      if (duplicateExisting.has(key)) {
        items.push(item(STATUS.UNKNOWN, null, "Cloud 存在重複的市場與代號，不能安全決定更新對象。", [], position));
        return;
      }
      if (options.scope === COMPLETENESS.FULL) {
        items.push(item(STATUS.MISSING_FROM_SCREENSHOT, null, "完整持倉截圖未出現此 Cloud 持倉；此結果不代表已賣出。", [], position));
      } else {
        items.push(item(STATUS.UNKNOWN, null, "截圖範圍未確認為完整持倉，不能把未出現視為已賣出或刪除。", [], position));
      }
    });
    return Object.freeze({
      ...summary(items, "ready"),
      scope: options.scope || COMPLETENESS.UNKNOWN,
      items: Object.freeze(items)
    });
  }

  function emptyRecognition(status, message, detail = {}) {
    return Object.freeze({
      status,
      code: detail.code || "",
      message,
      provider: detail.provider || "",
      model: detail.model || "",
      sessionId: detail.sessionId || "",
      imageCount: Number(detail.imageCount || 0),
      startedAt: detail.startedAt || "",
      completedAt: detail.completedAt || "",
      resultStatus: detail.resultStatus || status,
      completeness: detail.completeness || COMPLETENESS.UNKNOWN,
      rows: Object.freeze(detail.rows || []),
      images: Object.freeze(detail.images || []),
      warnings: uniqueTexts(detail.warnings || [], 40, 240)
    });
  }

  function safeError(error) {
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? String(error.code) : "RECOGNITION_FAILED";
    const allowedMessages = {
      PROVIDER_NOT_CONFIGURED: "辨識服務尚未完成安全設定。",
      PROVIDER_TIMEOUT: "辨識服務逾時，請稍後重新嘗試。",
      RECOGNITION_FAILED: "辨識服務目前無法完成，請稍後再試。",
      INVALID_RECOGNITION_RESULT: "辨識服務回傳格式無法驗證。",
      AAL2_REQUIRED: "請完成 Investment 安全驗證後再辨識截圖。",
      AUTH_SESSION_EXPIRED: "登入工作階段已過期，請重新登入。"
    };
    return Object.freeze({ code, message: allowedMessages[code] || "辨識服務目前無法完成，請稍後再試。" });
  }

  function createSession(options = {}) {
    const createPreviewUrl = typeof options.createPreviewUrl === "function" ? options.createPreviewUrl : () => "";
    const revokePreviewUrl = typeof options.revokePreviewUrl === "function" ? options.revokePreviewUrl : () => {};
    const sessionId = text(options.sessionId, 120) || `investment-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let files = [];
    let recognition = emptyRecognition("idle", "尚未開始辨識。", { sessionId });
    let originalRows = Object.freeze([]);
    let preview = Object.freeze({ status: "draft", confirmedAt: null });
    let sequence = 0;
    let runToken = 0;
    let notice = "";

    function publicRecognition() {
      const { originalRows: _originalRows, ...safe } = recognition;
      return Object.freeze({ ...safe, rows: Object.freeze((recognition.rows || []).map(row => row)) });
    }

    function snapshot() {
      return Object.freeze({
        sessionId,
        files: Object.freeze(files.map(file => Object.freeze({
          id: file.id,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          previewUrl: file.previewUrl
        }))),
        recognition: publicRecognition(),
        preview,
        notice
      });
    }

    function resetRecognition(message = "尚未開始辨識。") {
      recognition = emptyRecognition(files.length ? "ready" : "idle", message, { sessionId, imageCount: files.length });
      originalRows = Object.freeze([]);
      preview = Object.freeze({ status: "draft", confirmedAt: null });
    }

    function addFiles(fileList) {
      const incoming = Array.from(fileList || []);
      let rejected = 0;
      let duplicates = 0;
      const rejectionMessages = new Map();
      let totalBytes = files.reduce((total, file) => total + Number(file.size || 0), 0);
      incoming.forEach(file => {
        const key = fileKey(file);
        if (files.some(existing => existing.key === key)) {
          duplicates += 1;
          return;
        }
        const validation = validateFile(file, totalBytes, files.length);
        if (!validation.ok) {
          rejected += 1;
          rejectionMessages.set(validation.code, validation.message);
          return;
        }
        sequence += 1;
        let previewUrl = "";
        try { previewUrl = String(createPreviewUrl(file) || ""); } catch { previewUrl = ""; }
        const record = {
          id: "screenshot-" + sequence,
          key,
          sourceFile: file,
          name: String(file.name || "未命名圖片"),
          type: validation.mime,
          size: validation.size,
          lastModified: Number(file.lastModified || 0),
          previewUrl
        };
        files = files.concat(record);
        totalBytes += validation.size;
      });
      runToken += 1;
      resetRecognition(files.length ? "圖片已加入目前瀏覽器記憶體，尚未送出辨識。" : "尚未開始辨識。");
      notice = [
        ...rejectionMessages.values(),
        duplicates ? `已略過 ${duplicates} 個重複圖片。` : ""
      ].filter(Boolean).join(" ");
      if (!rejected && rejectionMessages.size === 0 && !duplicates) notice = "";
      return snapshot();
    }

    function removeFile(id) {
      const removed = files.find(file => file.id === id);
      if (removed?.previewUrl) {
        try { revokePreviewUrl(removed.previewUrl); } catch { /* release is best effort */ }
      }
      files = files.filter(file => file.id !== id);
      runToken += 1;
      resetRecognition(files.length ? "已更新圖片清單，尚未送出辨識。" : "尚未開始辨識。");
      notice = "";
      return snapshot();
    }

    function clear() {
      runToken += 1;
      files.forEach(file => {
        if (!file.previewUrl) return;
        try { revokePreviewUrl(file.previewUrl); } catch { /* release is best effort */ }
      });
      files = [];
      resetRecognition();
      notice = "";
      return snapshot();
    }

    function dispose() {
      clear();
    }

    function startRecognition(recognize) {
      if (!files.length) {
        recognition = emptyRecognition("blocked", "請先選擇至少一張持股截圖。", { sessionId, code: "NO_FILES_SELECTED" });
        return Promise.resolve(snapshot());
      }
      if (typeof recognize !== "function") {
        recognition = emptyRecognition("blocked", "辨識服務尚未完成安全設定；圖片仍只留在瀏覽器記憶體。", { sessionId, code: "PROVIDER_NOT_CONFIGURED", imageCount: files.length });
        return Promise.resolve(snapshot());
      }
      const token = ++runToken;
      const startedAt = new Date().toISOString();
      const requestFiles = files.map(file => Object.freeze({
        id: file.id,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        sourceFile: file.sourceFile
      }));
      const metadata = Object.freeze({ sessionId, imageCount: requestFiles.length, startedAt });
      recognition = emptyRecognition("recognizing", "正在以受控服務辨識圖片；原圖不會寫入 Cloud。", { ...metadata, code: "" });
      preview = Object.freeze({ status: "draft", confirmedAt: null });
      return Promise.resolve().then(() => recognize(requestFiles, metadata)).then(result => {
        if (token !== runToken) return snapshot();
        const normalized = normalizeRecognitionResult(result);
        const completedAt = new Date().toISOString();
        if (normalized.status === "error") {
          recognition = emptyRecognition("error", "辨識服務未能產生可驗證結果。", {
            sessionId,
            imageCount: requestFiles.length,
            startedAt,
            completedAt,
            provider: normalized.provider,
            model: normalized.model,
            resultStatus: normalized.status,
            warnings: normalized.warnings,
            images: normalized.images,
            code: "RECOGNITION_FAILED"
          });
          return snapshot();
        }
        originalRows = normalized.rows;
        recognition = emptyRecognition("recognized", normalized.rows.length ? "辨識完成，請逐筆檢查截圖資料與 Cloud 差異。" : "辨識完成，但沒有讀到可用持股列。", {
          sessionId: normalized.sessionId || sessionId,
          imageCount: requestFiles.length,
          startedAt,
          completedAt,
          provider: normalized.provider,
          model: normalized.model,
          resultStatus: normalized.status,
          completeness: normalized.completeness,
          rows: normalized.rows,
          images: normalized.images,
          warnings: normalized.warnings
        });
        preview = Object.freeze({ status: "draft", confirmedAt: null });
        return snapshot();
      }).catch(error => {
        if (token !== runToken) return snapshot();
        const safe = safeError(error);
        recognition = emptyRecognition("error", safe.message, {
          sessionId,
          imageCount: requestFiles.length,
          startedAt,
          completedAt: new Date().toISOString(),
          code: safe.code
        });
        return snapshot();
      });
    }

    function updateRecognitionRow(id, patch = {}) {
      if (recognition.status !== "recognized") return snapshot();
      const target = recognition.rows.find(row => row.id === id);
      if (!target) return snapshot();
      const nextValues = { ...target.values };
      const changedFields = new Set(target.editedFields || []);
      for (const field of EDITABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
        nextValues[field] = patch[field] === "" ? null : patch[field];
        changedFields.add(field);
      }
      const next = normalizeRecognitionRow({
        ...nextValues,
        id: target.id,
        confidence: target.recognitionConfidence,
        confidenceLevel: target.confidenceLevel,
        sourceFields: target.sourceFields,
        sourceImages: target.sourceImages,
        duplicateCount: target.duplicateCount,
        conflicts: (target.conflicts || []).filter(field => !changedFields.has(field)),
        editedFields: [...changedFields],
        ignored: false
      }, {
        id: target.id,
        imageId: target.imageId,
        sourceFields: target.sourceFields,
        sourceImages: target.sourceImages,
        duplicateCount: target.duplicateCount,
        editedFields: [...changedFields]
      });
      recognition = Object.freeze({ ...recognition, rows: Object.freeze(recognition.rows.map(row => row.id === id ? next : row)) });
      preview = Object.freeze({ status: "draft", confirmedAt: null });
      notice = "已更新預覽中的辨識列；尚未寫入 Cloud。";
      return snapshot();
    }

    function ignoreRecognitionRow(id) {
      if (recognition.status !== "recognized") return snapshot();
      const target = recognition.rows.find(row => row.id === id);
      if (!target) return snapshot();
      const ignored = Object.freeze({ ...target, ignored: true });
      recognition = Object.freeze({ ...recognition, rows: Object.freeze(recognition.rows.map(row => row.id === id ? ignored : row)) });
      preview = Object.freeze({ status: "draft", confirmedAt: null });
      notice = "已忽略此辨識列；尚未寫入 Cloud。";
      return snapshot();
    }

    function restoreRecognitionResult() {
      if (recognition.status !== "recognized") return snapshot();
      recognition = Object.freeze({ ...recognition, rows: Object.freeze(originalRows.map(row => row)) });
      preview = Object.freeze({ status: "draft", confirmedAt: null });
      notice = "已還原原始辨識結果；尚未寫入 Cloud。";
      return snapshot();
    }

    function confirmPreview() {
      if (recognition.status !== "recognized") {
        notice = "尚未取得可驗證的辨識結果，不能確認預覽。";
        return snapshot();
      }
      preview = Object.freeze({ status: "confirmed", confirmedAt: new Date().toISOString() });
      notice = "Preview Confirmed／Ready for Import；本階段不會寫入 Investment Cloud。";
      return snapshot();
    }

    return Object.freeze({
      addFiles,
      removeFile,
      clear,
      startRecognition,
      updateRecognitionRow,
      ignoreRecognitionRow,
      restoreRecognitionResult,
      confirmPreview,
      dispose,
      getSnapshot: snapshot
    });
  }

  return Object.freeze({
    RECOGNITION_FIELDS,
    REQUIRED_FIELDS,
    COMPARE_FIELDS,
    STATUS,
    CONFIDENCE_LEVELS,
    COMPLETENESS,
    IMPORT_LIMITS,
    EDITABLE_FIELDS,
    normalizeRecognitionRow,
    normalizeRecognitionResult,
    mergeRecognitionRows: mergeRows,
    readinessReason,
    validateFile,
    identityKey,
    compareExisting,
    reconcile,
    fileKey,
    createSession
  });
});
