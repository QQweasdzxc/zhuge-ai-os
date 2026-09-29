(function (root, factory) {
  const engine = root?.InvestmentScreenshotImportEngine || (typeof require === "function" ? require("./screenshot-import-engine.js") : null);
  const api = factory(engine);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentRecognitionProvider = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Engine) {
  "use strict";

  if (!Engine || typeof Engine.validateFile !== "function") {
    throw new TypeError("Investment Recognition Provider requires the screenshot import engine.");
  }

  const PROVIDER = "openai";
  const MODEL = "gpt-5.6-luna";
  const DEFAULT_ENDPOINT = "investment-screenshot-recognition";
  const DEFAULT_TIMEOUT_MS = 45000;
  const MAX_RETRIES = 1;
  const POSITION_FIELDS = Object.freeze([
    "symbol",
    "name",
    "quantity",
    "unit",
    "average_cost",
    "total_cost",
    "current_price",
    "market_value",
    "unrealized_pnl",
    "return_rate",
    "currency",
    "confidence",
    "confidence_level",
    "source_fields"
  ]);

  function boundedText(value, maxLength = 240) {
    const normalized = String(value ?? "").trim();
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").replace(/%$/, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function safeList(value, maxItems = 40, maxLength = 120) {
    const result = [];
    for (const item of Array.isArray(value) ? value : []) {
      const normalized = boundedText(item, maxLength);
      if (normalized && !result.includes(normalized)) result.push(normalized);
      if (result.length >= maxItems) break;
    }
    return result;
  }

  function dataUrlFromBytes(mime, bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    const encoded = typeof btoa === "function"
      ? btoa(binary)
      : typeof Buffer !== "undefined"
        ? Buffer.from(bytes).toString("base64")
        : "";
    if (!encoded) throw Object.assign(new Error("Browser image encoder is unavailable."), { code: "IMAGE_READ_FAILED" });
    return `data:${mime};base64,${encoded}`;
  }

  async function readArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === "function") return file.arrayBuffer();
    if (typeof FileReader === "undefined") throw Object.assign(new Error("Browser image reader is unavailable."), { code: "IMAGE_READ_FAILED" });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(Object.assign(new Error("Browser image reader failed."), { code: "IMAGE_READ_FAILED" }));
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(file);
    });
  }

  async function toDataUrl(file, mime) {
    const buffer = await readArrayBuffer(file);
    if (!(buffer instanceof ArrayBuffer) && !(typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(buffer))) {
      throw Object.assign(new Error("Browser image reader returned an invalid result."), { code: "IMAGE_READ_FAILED" });
    }
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return dataUrlFromBytes(mime, bytes);
  }

  function safeError(error) {
    const next = new Error(boundedText(error?.message, 240) || "Recognition service request failed.");
    if (error?.code) next.code = boundedText(error.code, 80);
    if (error?.status) next.status = Number(error.status);
    return next;
  }

  function isRetryable(error) {
    const status = Number(error?.status || 0);
    return status === 408 || status === 429 || status >= 500 || (!status && error?.code !== "PROVIDER_TIMEOUT");
  }

  function sanitizePosition(position = {}) {
    const source = position && typeof position === "object" ? position : {};
    const read = aliases => aliases.reduce((value, key) => value !== null && value !== undefined && value !== "" ? value : source[key], null);
    const safe = {
      symbol: boundedText(read(["symbol", "code", "ticker"]), 240),
      name: boundedText(read(["name", "assetName", "asset_name"]), 240),
      quantity: finiteNumber(read(["quantity", "shares", "units"])),
      unit: boundedText(read(["unit"]), 240),
      average_cost: finiteNumber(read(["average_cost", "averageCost", "avg_cost", "avgCost"])),
      total_cost: finiteNumber(read(["total_cost", "totalCost", "invested_cost", "investedCost"])),
      current_price: finiteNumber(read(["current_price", "currentPrice", "last_price", "lastPrice"])),
      market_value: finiteNumber(read(["market_value", "marketValue"])),
      unrealized_pnl: finiteNumber(read(["unrealized_pnl", "unrealizedPnl"])),
      return_rate: finiteNumber(read(["return_rate", "returnRate", "unrealized_pct", "unrealizedPercent"])),
      currency: boundedText(read(["currency"]), 20)?.toUpperCase() || null,
      confidence: finiteNumber(read(["confidence", "recognitionConfidence", "confidenceScore"])),
      confidence_level: boundedText(read(["confidence_level", "confidenceLevel"]), 20)?.toUpperCase() || null,
      source_fields: safeList(read(["source_fields", "sourceFields"]) || [], 40, 100)
    };
    if (!["HIGH", "MEDIUM", "LOW"].includes(safe.confidence_level)) safe.confidence_level = null;
    return safe;
  }

  function sanitizeResult(result = {}) {
    const source = result && typeof result === "object" ? result : {};
    return {
      screenshot_type: boundedText(source.screenshot_type || source.screenshotType, 80),
      broker_or_app: boundedText(source.broker_or_app || source.brokerOrApp, 120),
      market: boundedText(source.market, 40)?.toUpperCase() || null,
      positions: (Array.isArray(source.positions) ? source.positions : []).slice(0, 100).map(sanitizePosition),
      completeness: ["full", "partial", "unknown"].includes(String(source.completeness || "").toLowerCase()) ? String(source.completeness).toLowerCase() : "unknown",
      warnings: safeList(source.warnings, 20, 240)
    };
  }

  function sanitizeResponse(raw, sessionId) {
    if (!raw || typeof raw !== "object") {
      throw Object.assign(new Error("Recognition service returned an invalid response."), { code: "INVALID_RECOGNITION_RESULT" });
    }
    const rawImages = Array.isArray(raw.images) && raw.images.length
      ? raw.images
      : [{ image_id: "image-1", status: raw.status || "ready", result: raw }];
    const images = rawImages.slice(0, Engine.IMPORT_LIMITS.maxFiles).map((image, index) => {
      const source = image && typeof image === "object" ? image : {};
      const imageId = boundedText(source.image_id || source.imageId, 120) || `image-${index + 1}`;
      const status = ["ready", "partial", "error"].includes(String(source.status || "").toLowerCase()) ? String(source.status).toLowerCase() : "ready";
      if (status === "error") {
        return { image_id: imageId, status: "error", code: boundedText(source.code, 80) || "RECOGNITION_FAILED", message: "此圖片未產生可驗證結果。" };
      }
      return { image_id: imageId, status, result: sanitizeResult(source.result && typeof source.result === "object" ? source.result : source) };
    });
    const status = String(raw.status || "").toLowerCase();
    return {
      session_id: sessionId,
      provider: PROVIDER,
      model: MODEL,
      status: status === "error" ? "error" : status === "partial" || images.some(image => image.status === "error") ? "partial" : "ready",
      images,
      warnings: safeList(raw.warnings, 40, 240)
    };
  }

  function create(options = {}) {
    const invokeFunction = options.invokeFunction;
    const endpoint = boundedText(options.endpoint, 80) || DEFAULT_ENDPOINT;
    const timeoutMs = Math.min(60000, Math.max(100, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)));
    const maxRetries = Math.min(MAX_RETRIES, Math.max(0, Number(options.maxRetries ?? MAX_RETRIES)));

    async function invokeWithTimeout(payload) {
      if (typeof invokeFunction !== "function") {
        throw Object.assign(new Error("Recognition service is not configured."), { code: "PROVIDER_NOT_CONFIGURED" });
      }
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller?.abort();
      }, timeoutMs);
      try {
        const result = await invokeFunction(endpoint, payload, controller ? { signal: controller.signal } : {});
        return result;
      } catch (error) {
        if (timedOut || error?.name === "AbortError") {
          throw Object.assign(new Error("Recognition service timed out."), { code: "PROVIDER_TIMEOUT" });
        }
        throw safeError(error);
      } finally {
        clearTimeout(timer);
      }
    }

    async function recognize(fileDescriptors = [], metadata = {}) {
      if (!Array.isArray(fileDescriptors) || !fileDescriptors.length) {
        throw Object.assign(new Error("No screenshot selected."), { code: "NO_FILES_SELECTED" });
      }
      let totalBytes = 0;
      const images = [];
      for (let index = 0; index < fileDescriptors.length; index += 1) {
        const descriptor = fileDescriptors[index] || {};
        const file = descriptor.sourceFile || descriptor;
        const validation = Engine.validateFile(file, totalBytes, images.length);
        if (!validation.ok) throw Object.assign(new Error(validation.message), { code: validation.code });
        const imageId = boundedText(descriptor.id, 120) || `image-${index + 1}`;
        images.push({
          image_id: imageId,
          mime_type: validation.mime,
          size_bytes: validation.size,
          data_url: await toDataUrl(file, validation.mime)
        });
        totalBytes += validation.size;
      }
      let payload = {
        session_id: boundedText(metadata.sessionId, 120) || "investment-import-session",
        images
      };
      try {
        let attempt = 0;
        while (true) {
          try {
            return sanitizeResponse(await invokeWithTimeout(payload), payload.session_id);
          } catch (error) {
            const safe = safeError(error);
            if (attempt >= maxRetries || !isRetryable(safe)) throw safe;
            attempt += 1;
          }
        }
      } finally {
        // Release all data URLs as soon as the controlled request resolves or
        // fails. No image payload is kept in the session snapshot.
        payload.images = [];
        payload = null;
      }
    }

    return Object.freeze({ recognize });
  }

  return Object.freeze({
    PROVIDER,
    MODEL,
    DEFAULT_ENDPOINT,
    DEFAULT_TIMEOUT_MS,
    MAX_RETRIES,
    toDataUrl,
    sanitizeResponse,
    isRetryable,
    create
  });
});
