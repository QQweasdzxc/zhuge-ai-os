/* Shared Attachment -> AI reader orchestration.
 *
 * The attachment-context module owns controlled fetching/parsing. This module
 * owns only the handoff into an already protected AI executor. It deliberately
 * has no provider SDK, credential lookup, persistence, or browser upload path.
 * A missing executor is an explicit unavailable state, never a fake answer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeAttachmentAIReader = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-attachment-ai-reader-v1";
  const INPUT_CONTRACT = "zhuge-attachment-ai-input-v1";
  const FUNCTION_NAME = "task-attachment-ai-read";
  const MAX_OUTPUT_CHARS = 12_000;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const DEFAULT_TIMEOUT_MS = 35_000;

  function text(value, max = 500) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function errorCode(error, fallback = "AI_ATTACHMENT_READ_FAILED") {
    const code = text(error?.code, 80).toUpperCase();
    return /^[A-Z0-9_]{3,80}$/.test(code) ? code : fallback;
  }

  function evidenceOf(input, extra = {}) {
    const source = input?.evidence?.source || {};
    return Object.freeze({
      attachmentId: text(input?.attachmentId, 160),
      filename: text(input?.filename, 240),
      inputStatus: text(input?.status, 40) || "unknown",
      source: Object.freeze({
        provider: text(source.provider, 120) || "controlled-attachment-source",
        asOf: text(source.asOf, 80),
        freshness: text(source.freshness, 40) || "unknown",
        dataQuality: text(source.dataQuality, 80) || "unknown",
        parser: text(source.parser, 120)
      }),
      ...extra
    });
  }

  function envelope(input, status, extra = {}) {
    return Object.freeze({
      contract: CONTRACT,
      status,
      attachmentId: text(input?.attachmentId, 160),
      filename: text(input?.filename, 240) || "未命名附件",
      mimeType: text(input?.mimeType, 120) || "application/octet-stream",
      mutation: "none",
      evidence: evidenceOf(input),
      ...extra
    });
  }

  function boundedOutput(value) {
    if (value == null) return null;
    if (typeof value === "string") return text(value, MAX_OUTPUT_CHARS);
    if (typeof value !== "object") return text(value, MAX_OUTPUT_CHARS);
    try {
      return JSON.parse(JSON.stringify(value, (_key, item) => {
        if (item instanceof Blob) return { type: "binary-redacted" };
        if (item instanceof ArrayBuffer) return { type: "binary-redacted" };
        if (typeof item === "string") return text(item, 4_000);
        return item;
      }));
    } catch {
      return null;
    }
  }

  function binaryToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    if (typeof btoa === "function") return btoa(binary);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    throw Object.assign(new Error("AI 附件影像編碼器不可用。"), { code: "AI_READER_IMAGE_ENCODER_UNAVAILABLE" });
  }

  async function blobToDataUrl(blob, mimeType = "application/octet-stream") {
    if (!blob || typeof blob.arrayBuffer !== "function") {
      throw Object.assign(new Error("AI 附件影像內容不可讀取。"), { code: "AI_READER_IMAGE_UNREADABLE" });
    }
    const size = Number(blob.size || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error("AI 附件影像超過受控上限。"), { code: "AI_READER_IMAGE_TOO_LARGE" });
    }
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw Object.assign(new Error("AI 附件影像超過受控上限。"), { code: "AI_READER_IMAGE_TOO_LARGE" });
    }
    return `data:${text(mimeType, 120)};base64,${binaryToBase64(bytes)}`;
  }

  async function serializeInput(aiInput) {
    const parts = [];
    for (const part of Array.isArray(aiInput?.parts) ? aiInput.parts : []) {
      if (part?.type === "input_text") {
        const value = text(part.text, 30_000);
        if (value) parts.push({ type: "input_text", text: value });
      } else if (part?.type === "input_image") {
        parts.push({
          type: "input_image",
          mime_type: text(part.mimeType, 120) || "image/*",
          data_url: await blobToDataUrl(part.blob, part.mimeType)
        });
      }
    }
    return {
      contract: INPUT_CONTRACT,
      attachment_id: text(aiInput?.attachmentId, 160),
      filename: text(aiInput?.filename, 240),
      mime_type: text(aiInput?.mimeType, 120),
      evidence: aiInput?.evidence || {},
      parts
    };
  }

  function signalWithTimeout(options = {}) {
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    if (controller) timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: options.signal || controller?.signal,
      clear: () => { if (timer) clearTimeout(timer); }
    };
  }

  function createFunctionExecutor(options = {}) {
    const invokeFunction = options.invokeFunction;
    return async (aiInput, requestOptions = {}) => {
      if (typeof invokeFunction !== "function") {
        throw Object.assign(new Error("受控 AI Reader 尚未連線。"), { code: "AI_READER_EXECUTOR_UNAVAILABLE" });
      }
      const payload = await serializeInput(aiInput);
      const response = await invokeFunction(FUNCTION_NAME, payload, { signal: requestOptions.signal });
      return response?.result || response;
    };
  }

  async function analyzeInput(aiInput, options = {}) {
    if (!aiInput || aiInput.contract !== INPUT_CONTRACT || aiInput.status !== "ready" || !aiInput.parts?.length) {
      return envelope(aiInput, aiInput?.status || "insufficient_evidence", {
        reason: "ATTACHMENT_CONTEXT_NOT_READY",
        evidenceStatus: "INSUFFICIENT_EVIDENCE"
      });
    }
    if (typeof options.executor !== "function") {
      return envelope(aiInput, "unavailable", {
        reason: "AI_READER_EXECUTOR_UNAVAILABLE",
        nextStep: "目前尚未連接受控 AI Reader；附件證據已讀取，但沒有產生未經驗證的結論。",
        evidenceStatus: "UNAVAILABLE"
      });
    }
    const timeout = signalWithTimeout(options);
    try {
      const response = await options.executor(aiInput, { signal: timeout.signal });
      const output = boundedOutput(response?.output ?? response?.result ?? response);
      if (output == null || (typeof output === "string" && !output)) {
        return envelope(aiInput, "insufficient_evidence", {
          reason: "AI_READER_EMPTY_RESULT",
          evidenceStatus: "INSUFFICIENT_EVIDENCE"
        });
      }
      return envelope(aiInput, "ready", {
        output,
        provider: text(response?.provider, 120) || "protected-ai-reader",
        model: text(response?.model, 120) || null,
        generatedAt: text(response?.generatedAt || response?.generated_at, 80) || new Date().toISOString(),
        evidenceStatus: "AVAILABLE",
        source: Object.freeze({
          ...evidenceOf(aiInput).source,
          provider: text(response?.provider, 120) || "protected-ai-reader",
          dataQuality: text(response?.dataQuality || response?.data_quality, 80) || "ai-reader-output"
        })
      });
    } catch (error) {
      const aborted = error?.name === "AbortError" || error?.code === "ABORT_ERR";
      return envelope(aiInput, "unavailable", {
        reason: aborted ? "AI_READER_TIMEOUT" : errorCode(error),
        nextStep: aborted ? "AI 讀取逾時，請稍後再試。" : "AI 讀取目前無法完成，請稍後再試。",
        evidenceStatus: "UNAVAILABLE"
      });
    } finally {
      timeout.clear();
    }
  }

  async function readAttachment(input = {}, options = {}) {
    const attachmentContext = options.attachmentContext;
    const executor = options.executor;
    if (!attachmentContext?.read || !attachmentContext?.toAIInput) {
      return envelope(input, "unavailable", {
        reason: "ATTACHMENT_CONTEXT_MODULE_UNAVAILABLE",
        evidenceStatus: "UNAVAILABLE"
      });
    }

    let loaded;
    try {
      loaded = await attachmentContext.read(input, options.readOptions || {});
    } catch (error) {
      return envelope(input, "error", {
        reason: errorCode(error),
        evidenceStatus: "ERROR"
      });
    }
    const aiInput = attachmentContext.toAIInput(loaded);
    if (!aiInput || aiInput.contract !== INPUT_CONTRACT || aiInput.status !== "ready" || !aiInput.parts?.length) {
      return envelope(aiInput || loaded, loaded?.status || "insufficient_evidence", {
        reason: loaded?.reason || "ATTACHMENT_CONTEXT_NOT_READY",
        evidenceStatus: loaded?.evidenceStatus || "INSUFFICIENT_EVIDENCE"
      });
    }
    // The executor is injected by the protected runtime. It receives the
    // bounded AI envelope, never the original signed URL or storage path.
    return analyzeInput(aiInput, { ...options, executor });
  }

  return Object.freeze({ CONTRACT, INPUT_CONTRACT, FUNCTION_NAME, MAX_OUTPUT_CHARS, MAX_IMAGE_BYTES, readAttachment, analyzeInput, createFunctionExecutor, serializeInput });
});
