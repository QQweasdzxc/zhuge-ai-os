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
  const MAX_OUTPUT_CHARS = 12_000;
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
    if (typeof executor !== "function") {
      return envelope(aiInput, "unavailable", {
        reason: "AI_READER_EXECUTOR_UNAVAILABLE",
        nextStep: "目前尚未連接受控 AI Reader；附件證據已讀取，但沒有產生未經驗證的結論。",
        evidenceStatus: "UNAVAILABLE"
      });
    }

    const timeout = signalWithTimeout(options);
    try {
      // The executor is injected by the protected runtime. It receives the
      // bounded AI envelope, never the original signed URL or storage path.
      const response = await executor(aiInput, { signal: timeout.signal });
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

  return Object.freeze({ CONTRACT, INPUT_CONTRACT, MAX_OUTPUT_CHARS, readAttachment });
});
