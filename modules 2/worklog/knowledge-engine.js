// P6.1 AI Core: source-independent parsing and standard Knowledge Object creation.
// This module intentionally contains no AI reasoning, recommendation, persistence, or UI logic.
(function initializeKnowledgeEngine(global) {
  "use strict";

  const MIME = Object.freeze({
    GOOGLE_DOC: "application/vnd.google-apps.document",
    GOOGLE_SHEET: "application/vnd.google-apps.spreadsheet",
    GOOGLE_SLIDE: "application/vnd.google-apps.presentation",
    PDF: "application/pdf",
    DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    TEXT: "text/plain",
    MARKDOWN: "text/markdown",
    CSV: "text/csv"
  });

  function cleanText(value = "") {
    const text = String(value ?? "");
    const sanitized = typeof global.sanitizeKnowledgeString === "function"
      ? global.sanitizeKnowledgeString(text)
      : text.replace(/\u0000/g, "").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    return sanitized.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  }

  function extensionOf(name = "") {
    const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function knowledgeType(document = {}) {
    const mimeType = document.mimeType || document.originalMimeType || "";
    const extension = extensionOf(document.name || document.title);
    if (mimeType === MIME.GOOGLE_DOC) return "google-doc";
    if (mimeType === MIME.GOOGLE_SHEET) return "google-sheet";
    if (mimeType === MIME.GOOGLE_SLIDE) return "google-slide";
    if (mimeType === MIME.PDF || extension === "pdf") return "pdf";
    if (mimeType === MIME.DOCX || extension === "docx") return "word";
    if (mimeType === MIME.XLSX || extension === "xlsx") return "excel";
    if (mimeType === MIME.PPTX || extension === "pptx") return "powerpoint";
    if (mimeType === MIME.MARKDOWN || ["md", "markdown"].includes(extension)) return "markdown";
    if (mimeType === MIME.CSV || extension === "csv") return "csv";
    if (String(mimeType).startsWith("text/") || extension === "txt") return "text";
    return extension || "file";
  }

  async function asArrayBuffer(data) {
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (data && typeof data.arrayBuffer === "function") return data.arrayBuffer();
    throw new Error("Parser 需要 ArrayBuffer 或 Blob 內容");
  }

  async function asBlob(data, mimeType = "application/octet-stream") {
    if (typeof Blob !== "undefined" && data instanceof Blob) return data;
    return new Blob([await asArrayBuffer(data)], { type: mimeType });
  }

  async function asText(data) {
    if (typeof data === "string") return data;
    if (data && typeof data.text === "function") return data.text();
    return new TextDecoder().decode(await asArrayBuffer(data));
  }

  class KnowledgeParserRegistry {
    constructor() {
      this.parsers = [];
    }

    register(parser) {
      if (!parser?.id || typeof parser.canParse !== "function" || typeof parser.parse !== "function") {
        throw new Error("Knowledge Parser 必須提供 id、canParse() 與 parse()");
      }
      this.parsers = this.parsers.filter(item => item.id !== parser.id);
      this.parsers.push(parser);
      return this;
    }

    resolve(input = {}) {
      return this.parsers.find(parser => parser.canParse(input)) || null;
    }

    supports(input = {}) {
      return Boolean(this.resolve(input));
    }

    async parse(input = {}) {
      const parser = this.resolve(input);
      if (!parser) {
        const name = input.name || input.document?.name || "此檔案";
        throw new Error(`${name} 的格式目前尚未支援`);
      }
      const result = await parser.parse(input);
      const content = cleanText(result?.content ?? result?.text ?? "");
      if (!content) throw new Error(`${input.name || "文件"} 沒有可讀取的文字內容`);
      return {
        ...result,
        content,
        parser: parser.id,
        pages: Array.isArray(result?.pages) ? result.pages : []
      };
    }
  }

  const registry = new KnowledgeParserRegistry();

  registry.register({
    id: "plain-text",
    canParse: input => {
      const mime = input.mimeType || "";
      const extension = extensionOf(input.name);
      return mime === MIME.TEXT || mime === MIME.MARKDOWN || mime === MIME.CSV
        || String(mime).startsWith("text/") || ["txt", "md", "markdown", "csv"].includes(extension);
    },
    parse: async input => ({ content: await asText(input.data), supportLevel: "full-text" })
  });

  registry.register({
    id: "pdfjs-text-layer",
    canParse: input => input.mimeType === MIME.PDF || extensionOf(input.name) === "pdf",
    parse: async input => {
      if (typeof global.extractPdfTextWithPdfJs !== "function") throw new Error("PDF Parser 尚未載入");
      const result = await global.extractPdfTextWithPdfJs(await asBlob(input.data, MIME.PDF));
      return { content: result.text, pages: result.pages, quality: result.quality, supportLevel: result.supportLevel };
    }
  });

  registry.register({
    id: "office-docx-xml",
    canParse: input => input.mimeType === MIME.DOCX || extensionOf(input.name) === "docx",
    parse: async input => {
      if (typeof global.parseOfficeZip !== "function" || typeof global.officeEntryText !== "function") {
        throw new Error("Word Parser 尚未載入");
      }
      const entries = await global.parseOfficeZip(await asArrayBuffer(input.data));
      return {
        content: global.officeEntryText(entries, /^word\/document\.xml$/),
        supportLevel: "office-xml"
      };
    }
  });

  registry.register({
    id: "office-xlsx-xml",
    canParse: input => input.mimeType === MIME.XLSX || extensionOf(input.name) === "xlsx",
    parse: async input => {
      if (typeof global.parseOfficeZip !== "function" || typeof global.excelText !== "function") {
        throw new Error("Excel Parser 尚未載入");
      }
      const entries = await global.parseOfficeZip(await asArrayBuffer(input.data));
      return { content: global.excelText(entries), supportLevel: "office-xml" };
    }
  });

  registry.register({
    id: "office-pptx-xml",
    canParse: input => input.mimeType === MIME.PPTX || extensionOf(input.name) === "pptx",
    parse: async input => {
      if (typeof global.parseOfficeZip !== "function" || typeof global.officeEntryText !== "function") {
        throw new Error("PowerPoint Parser 尚未載入");
      }
      const entries = await global.parseOfficeZip(await asArrayBuffer(input.data));
      return {
        content: global.officeEntryText(entries, /^ppt\/slides\/slide\d+\.xml$/),
        supportLevel: "office-xml"
      };
    }
  });

  function createKnowledgeObject(document = {}, parsed = {}, folder = {}) {
    const sourceFolder = document.folder || folder || {};
    return {
      id: String(document.id || ""),
      title: document.name || document.title || "未命名文件",
      type: knowledgeType(document),
      folder: sourceFolder.id || document.folderId || "",
      folderName: sourceFolder.name || document.folderName || "",
      folderPath: sourceFolder.path || document.folderPath || "",
      modifiedTime: document.modifiedTime || "",
      content: cleanText(parsed.content),
      source: document.source || "Google Drive",
      mimeType: document.mimeType || "",
      parser: parsed.parser || "",
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      sourceReference: {
        provider: document.sourceProvider || "google-drive",
        fileId: String(document.id || ""),
        webViewLink: document.webViewLink || ""
      },
      metadata: {
        size: document.size == null ? null : Number(document.size),
        md5Checksum: document.md5Checksum || "",
        parents: Array.isArray(document.parents) ? document.parents : [],
        supportLevel: parsed.supportLevel || "",
        indexedAt: new Date().toISOString()
      }
    };
  }

  const KnowledgeEngine = Object.freeze({
    MIME,
    parserRegistry: registry,
    registerParser(parser) {
      registry.register(parser);
      return this;
    },
    supports(document = {}, downloadMimeType = "") {
      return registry.supports({
        document,
        name: document.downloadName || document.name || "",
        mimeType: downloadMimeType || document.downloadMimeType || document.mimeType || ""
      });
    },
    async ingest(document = {}, payload = {}) {
      const parsed = await registry.parse({
        document,
        data: payload.data,
        name: payload.name || document.downloadName || document.name || "",
        mimeType: payload.mimeType || document.downloadMimeType || document.mimeType || ""
      });
      return createKnowledgeObject(document, parsed, payload.folder || document.folder);
    },
    createKnowledgeObject,
    cleanText,
    knowledgeType
  });

  global.KnowledgeParserRegistry = KnowledgeParserRegistry;
  global.KnowledgeEngine = KnowledgeEngine;
})(globalThis);
