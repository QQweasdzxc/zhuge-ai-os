/* Shared Attachment -> AI Context reader.
 *
 * This is a read-only, in-memory capability. It never resolves Storage paths
 * on its own, never writes Product Data, and never returns the short-lived
 * signed URL used by the caller. Consumers provide the existing controlled
 * attachmentUrl reader, while this module owns bounded fetching, parsing,
 * evidence metadata, and fail-closed states.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeAttachmentContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const CONTRACT = "zhuge-shared-attachment-context-v1";
  const MAX_BYTES = 8 * 1024 * 1024;
  const MAX_CHARS = 30_000;
  const DEFAULT_TIMEOUT_MS = 15_000;
  const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);
  const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "pptx"]);

  function extensionOf(name = "") {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function normalizeAttachment(input = {}) {
    const attachment = input.attachment || input;
    const id = String(attachment.id || attachment.attachmentId || "").trim();
    const filename = String(attachment.filename || attachment.name || "未命名附件").trim() || "未命名附件";
    const mimeType = String(attachment.mimeType || attachment.mime_type || "application/octet-stream").trim().toLowerCase();
    return Object.freeze({
      id,
      attachmentId: id,
      filename,
      mimeType,
      byteSize: Number(attachment.byteSize ?? attachment.byte_size ?? 0) || 0,
      storagePath: String(attachment.storagePath || attachment.storage_path || ""),
      storageBucket: String(attachment.storageBucket || attachment.storage_bucket || ""),
      createdAt: String(attachment.createdAt || attachment.created_at || ""),
      updatedAt: String(attachment.updatedAt || attachment.updated_at || ""),
      signedUrl: String(attachment.signedUrl || "")
    });
  }

  function cleanText(value = "") {
    const raw = String(value ?? "").replace(/\u0000/g, "");
    const sanitized = typeof root?.sanitizeKnowledgeString === "function"
      ? root.sanitizeKnowledgeString(raw)
      : raw.replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    return sanitized.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  }

  function safeErrorCode(error, fallback = "ATTACHMENT_CONTEXT_FAILED") {
    const code = String(error?.code || "").trim().toUpperCase();
    return /^[A-Z0-9_]{3,64}$/.test(code) ? code : fallback;
  }

  function evidenceFor(attachment, parser = "") {
    return Object.freeze({
      source: "controlled-signed-attachment",
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      provider: "supabase-storage",
      asOf: attachment.updatedAt || attachment.createdAt || "",
      freshness: attachment.updatedAt || attachment.createdAt ? "point-in-time" : "unknown",
      dataQuality: parser ? "parsed" : "loaded",
      parser
    });
  }

  function baseResult(attachment, status, extra = {}) {
    return Object.freeze({
      contract: CONTRACT,
      status,
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      source: evidenceFor(attachment, extra.parser || ""),
      mutation: "none",
      ...extra
    });
  }

  function unsupported(attachment, reason, nextStep = "請改用支援的文字或文件格式。") {
    return baseResult(attachment, "unsupported", {
      modality: "document",
      reason,
      nextStep,
      evidenceStatus: "INSUFFICIENT_EVIDENCE"
    });
  }

  function insufficient(attachment, reason, nextStep = "目前沒有足夠內容可交給 AI 閱讀。") {
    return baseResult(attachment, "insufficient_evidence", {
      modality: "document",
      reason,
      nextStep,
      evidenceStatus: "INSUFFICIENT_EVIDENCE"
    });
  }

  function unavailable(attachment, reason, nextStep = "請確認附件仍可讀取後再試。") {
    return baseResult(attachment, "unavailable", {
      modality: "document",
      reason,
      nextStep,
      evidenceStatus: "UNAVAILABLE"
    });
  }

  async function loadWithTimeout(load, url, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const signal = options.signal || controller?.signal;
    const request = Promise.resolve().then(() => load(url, { signal }));
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error("附件讀取逾時");
        error.code = "ATTACHMENT_CONTEXT_TIMEOUT";
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
      controller?.abort();
    }
  }

  async function responseBlob(response) {
    if (response && typeof response.blob === "function") return response.blob();
    if (response && typeof response.arrayBuffer === "function") {
      return new Blob([await response.arrayBuffer()]);
    }
    throw new Error("附件回應不是可讀取的檔案內容");
  }

  function contentLengthOf(response) {
    try { return Number(response?.headers?.get?.("content-length") || 0) || 0; }
    catch { return 0; }
  }

  async function parseDocument(attachment, blob) {
    const engine = root?.KnowledgeEngine;
    const input = { name: attachment.filename, mimeType: attachment.mimeType };
    if (!engine?.supports?.(input)) {
      return unsupported(attachment, "ATTACHMENT_PARSER_UNAVAILABLE", "此頁尚未載入正式文件解析器，請回到 WorkLog／Shared Drawer 後再試。");
    }
    const parsed = await engine.ingest({
      id: attachment.id,
      name: attachment.filename,
      mimeType: attachment.mimeType,
      modifiedTime: attachment.updatedAt || attachment.createdAt,
      source: "Board Task Attachment",
      sourceProvider: "supabase-storage"
    }, { data: blob, name: attachment.filename, mimeType: attachment.mimeType });
    const content = cleanText(parsed?.content || "");
    if (!content) return insufficient(attachment, "ATTACHMENT_CONTENT_EMPTY");
    const boundedContent = content.slice(0, MAX_CHARS);
    return baseResult(attachment, "ready", {
      modality: "document",
      readMode: "text-extraction",
      parser: String(parsed?.parser || "knowledge-engine"),
      content: boundedContent,
      contentPreview: boundedContent.slice(0, 1200),
      truncated: content.length > MAX_CHARS,
      evidenceStatus: "AVAILABLE",
      quality: parsed?.metadata?.supportLevel || parsed?.supportLevel || "parsed"
    });
  }

  async function read(attachmentInput = {}, options = {}) {
    const attachment = normalizeAttachment(attachmentInput);
    if (!attachment.id) return unavailable(attachment, "ATTACHMENT_ID_MISSING", "請重新整理附件清單後再試。");
    const declaredBytes = attachment.byteSize;
    if (declaredBytes > MAX_BYTES) return unsupported(attachment, "ATTACHMENT_TOO_LARGE", "此附件超過 8 MB 的 AI 讀取上限。");

    const resolveUrl = typeof options.resolveUrl === "function" ? options.resolveUrl : null;
    let url = attachment.signedUrl;
    if (!url && resolveUrl) {
      try { url = String(await resolveUrl(attachment) || ""); }
      catch (error) { return unavailable(attachment, safeErrorCode(error, "ATTACHMENT_URL_UNAVAILABLE")); }
    }
    if (!url) return unavailable(attachment, "ATTACHMENT_SIGNED_URL_MISSING", "附件連結尚未準備完成，請稍後再試。");

    const load = typeof options.load === "function"
      ? options.load
      : (target, init) => root.fetch(target, init);
    if (typeof load !== "function") return unavailable(attachment, "ATTACHMENT_FETCH_UNAVAILABLE", "目前環境無法讀取附件。");

    let response;
    try { response = await loadWithTimeout(load, url, options); }
    catch (error) {
      const code = safeErrorCode(error, "ATTACHMENT_FETCH_FAILED");
      return unavailable(attachment, code, code === "ATTACHMENT_CONTEXT_TIMEOUT" ? "附件讀取逾時，請稍後再試。" : "附件目前無法讀取，請稍後再試。");
    }
    if (!response?.ok) return unavailable(attachment, `ATTACHMENT_HTTP_${Number(response?.status || 0) || 0}`);
    const responseBytes = contentLengthOf(response);
    if (responseBytes > MAX_BYTES) return unsupported(attachment, "ATTACHMENT_TOO_LARGE", "此附件超過 8 MB 的 AI 讀取上限。");

    let blob;
    try { blob = await responseBlob(response); }
    catch (error) { return unavailable(attachment, safeErrorCode(error, "ATTACHMENT_BODY_UNREADABLE")); }
    const actualBytes = Number(blob?.size || 0);
    if (actualBytes > MAX_BYTES) return unsupported(attachment, "ATTACHMENT_TOO_LARGE", "此附件超過 8 MB 的 AI 讀取上限。");
    const mime = attachment.mimeType;
    const extension = extensionOf(attachment.filename);
    if (mime.startsWith("image/")) {
      return baseResult(attachment, "ready", {
        modality: "image",
        readMode: "multimodal-reference",
        media: { blob, mimeType: mime, byteSize: actualBytes || declaredBytes },
        contentPreview: "圖片已載入，可交給支援視覺輸入的 AI Reader 解讀。",
        evidenceStatus: "AVAILABLE",
        quality: "binary-loaded"
      });
    }
    if (TEXT_MIMES.has(mime) || mime.startsWith("text/") || extension === "txt" || extension === "md" || extension === "markdown" || extension === "csv") {
      let content;
      try { content = cleanText(await blob.text()); }
      catch (error) { return unavailable(attachment, safeErrorCode(error, "ATTACHMENT_TEXT_UNREADABLE")); }
      if (!content) return insufficient(attachment, "ATTACHMENT_CONTENT_EMPTY");
      const boundedContent = content.slice(0, MAX_CHARS);
      return baseResult(attachment, "ready", {
        modality: "text",
        readMode: "text-extraction",
        parser: "plain-text",
        content: boundedContent,
        contentPreview: boundedContent.slice(0, 1200),
        truncated: content.length > MAX_CHARS,
        evidenceStatus: "AVAILABLE",
        quality: "text-loaded"
      });
    }
    if (DOCUMENT_EXTENSIONS.has(extension) || mime === "application/pdf" || mime.includes("officedocument")) {
      try { return await parseDocument(attachment, blob); }
      catch (error) {
        return baseResult(attachment, "error", {
          modality: "document",
          reason: safeErrorCode(error, "ATTACHMENT_PARSE_FAILED"),
          nextStep: "文件已取得，但目前無法可靠解析；請改用可讀文字檔或稍後再試。",
          evidenceStatus: "ERROR",
          quality: error?.quality || null
        });
      }
    }
    return unsupported(attachment, "ATTACHMENT_FORMAT_UNSUPPORTED");
  }

  function toAIInput(result = {}) {
    const status = String(result.status || "error").toLowerCase();
    const source = result.source && typeof result.source === "object" ? result.source : {};
    const evidence = Object.freeze({
      contract: CONTRACT,
      status,
      evidenceStatus: String(result.evidenceStatus || "UNKNOWN"),
      source: Object.freeze({
        provider: String(source.provider || "controlled-signed-attachment"),
        asOf: String(source.asOf || ""),
        freshness: String(source.freshness || "unknown"),
        dataQuality: String(source.dataQuality || "unknown"),
        parser: String(source.parser || "")
      })
    });
    if (status !== "ready") return Object.freeze({ contract: "zhuge-attachment-ai-input-v1", status, evidence, parts: [] });
    const parts = [];
    if (result.modality === "image" && result.media?.blob) {
      parts.push(Object.freeze({ type: "input_image", mimeType: String(result.media.mimeType || result.mimeType || "image/*"), blob: result.media.blob }));
    } else if (result.content) {
      parts.push(Object.freeze({ type: "input_text", text: String(result.content) }));
    }
    return Object.freeze({
      contract: "zhuge-attachment-ai-input-v1",
      status: parts.length ? "ready" : "insufficient_evidence",
      attachmentId: String(result.attachmentId || ""),
      filename: String(result.filename || "未命名附件"),
      mimeType: String(result.mimeType || "application/octet-stream"),
      evidence,
      parts: Object.freeze(parts)
    });
  }

  function emitAIContext(result = {}, target = root) {
    const input = toAIInput(result);
    if (typeof target?.dispatchEvent === "function") {
      let event = null;
      if (typeof target.CustomEvent === "function") {
        event = new target.CustomEvent("zhuge:attachment-context-ready", { detail: input });
      } else if (target.document?.createEvent) {
        event = target.document.createEvent("CustomEvent");
        event.initCustomEvent("zhuge:attachment-context-ready", false, false, input);
      }
      if (event) target.dispatchEvent(event);
    }
    return input;
  }

  return Object.freeze({
    CONTRACT,
    MAX_BYTES,
    MAX_CHARS,
    normalizeAttachment,
    cleanText,
    read,
    toAIInput,
    emitAIContext,
    statuses: Object.freeze(["ready", "insufficient_evidence", "unsupported", "unavailable", "error"])
  });
});
