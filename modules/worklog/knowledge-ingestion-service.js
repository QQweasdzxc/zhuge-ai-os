// Sprint 2 Knowledge Integration: explicit source ingestion boundary.
// This module does not scan Drive, copy Drive binaries, or implement a new AI engine.
(function initializeKnowledgeIngestionService(global) {
  "use strict";

  const DRIVE_PROVIDER = "google_drive";
  const UPLOAD_PROVIDER = "upload";

  function sourceTypeFromFile(file = {}, payload = {}) {
    const name = String(file.name || payload.name || "").toLowerCase();
    const mime = String(file.mimeType || payload.mimeType || file.type || "").toLowerCase();
    if (mime === "application/pdf" || /\.pdf$/.test(name)) return "pdf";
    if (mime.includes("word") || /\.(doc|docx)$/.test(name)) return "word";
    if (mime.includes("sheet") || mime.includes("excel") || /\.(xls|xlsx|csv)$/.test(name)) return "excel";
    if (mime.includes("presentation") || /\.(ppt|pptx)$/.test(name)) return "powerpoint";
    if (mime.startsWith("text/") || /\.(txt|md|markdown)$/.test(name)) return "markdown";
    return "file";
  }

  function namedBlob(data, name, mimeType) {
    const blob = new Blob([data], { type: mimeType || "application/octet-stream" });
    try { Object.defineProperty(blob, "name", { value: name || "knowledge-source", configurable: true }); }
    catch { /* Blob remains usable without a name in older browsers. */ }
    return blob;
  }

  // The core services are classic-script `const` bindings, not properties on
  // window/globalThis.  Resolve both forms so the service works in the real
  // browser runtime as well as isolated test/extension contexts.
  function runtimeServices() {
    return {
      dataService: global.DataService || (typeof DataService !== "undefined" ? DataService : null),
      knowledgeIntelligence: global.KnowledgeIntelligence || (typeof KnowledgeIntelligence !== "undefined" ? KnowledgeIntelligence : null),
      knowledgeRepository: global.KnowledgeRepository || (typeof KnowledgeRepository !== "undefined" ? KnowledgeRepository : null)
    };
  }

  function requireRuntime() {
    const services = runtimeServices();
    if (!services.dataService || !services.knowledgeIntelligence || !services.knowledgeRepository) {
      throw new Error("Knowledge ingestion 尚未完成初始化");
    }
    return services;
  }

  function sourceItemFromDrive(file = {}, payload = {}, existing = {}) {
    const name = payload.name || file.name || file.id || "Google Drive 文件";
    const mimeType = payload.mimeType || file.mimeType || "";
    return {
      ...existing,
      title: existing.title || file.name || name,
      description: existing.description || "",
      sourceProvider: DRIVE_PROVIDER,
      externalFileId: file.id,
      sourceModifiedAt: file.modifiedTime || null,
      sourceMetadata: {
        ...(existing.sourceMetadata || {}),
        driveId: file.driveId || "",
        parents: Array.isArray(file.parents) ? file.parents : [],
        md5Checksum: file.md5Checksum || "",
        webViewLink: file.webViewLink || ""
      },
      sourceType: sourceTypeFromFile(file, payload),
      sourceName: name,
      filename: name,
      sourceUrl: file.webViewLink || existing.sourceUrl || "",
      mimeType,
      fileSize: file.size == null ? (payload.data?.byteLength || 0) : Number(file.size),
      processingStatus: "queued",
      indexedAt: null
    };
  }

  async function persistAndProcess(item, file = null, options = {}) {
    const { dataService, knowledgeIntelligence } = requireRuntime();
    // Drive files are read into memory for parsing but their binary must never
    // be copied into the Knowledge Storage bucket. Uploads are the only source
    // that persists an original binary for the existing preview flow.
    const persistFile = options.persistFile !== false ? file : null;
    const saved = await dataService.saveKnowledgeSource(item, { file: persistFile, requireCloud: true });
    if (typeof options.onSourceSaved === "function") await options.onSourceSaved(saved);
    return knowledgeIntelligence.processSource(saved, file ? { file, onProgress: options.onProgress } : { onProgress: options.onProgress });
  }

  async function addUpload(options = {}) {
    requireRuntime();
    const file = options.file;
    if (!file) throw new Error("請選擇要加入藏書閣的文件");
    const title = String(options.title || file.name || "").trim();
    if (!title) throw new Error("請提供文件標題");
    const item = {
      title,
      description: String(options.description || "").trim(),
      sourceProvider: UPLOAD_PROVIDER,
      sourceType: sourceTypeFromFile(file),
      sourceName: file.name || title,
      filename: file.name || title,
      mimeType: file.type || "",
      fileSize: Number(file.size || 0),
      processingStatus: "queued",
      indexedAt: null
    };
    return persistAndProcess(item, file, options);
  }

  async function selectDriveFile(options = {}) {
    if (!global.GoogleDriveService?.pickFile) throw new Error("Google Drive Picker 尚未載入");
    return global.GoogleDriveService.pickFile(options);
  }

  async function addDriveFile(options = {}) {
    const { knowledgeRepository } = requireRuntime();
    const fileId = String(options.fileId || options.file?.id || "").trim();
    if (!fileId) throw new Error("請先從 Google Drive 選取一個檔案");
    const service = global.GoogleDriveService;
    const file = options.file?.id ? options.file : await service.getFile(fileId);
    if (!service.isSupported(file)) throw new Error("這個 Google Drive 檔案格式目前尚未支援");
    const existingRow = await knowledgeRepository.findSourceByExternalFile(DRIVE_PROVIDER, file.id);
    const existing = existingRow ? {
      cloudId: existingRow.id,
      knowledgeId: existingRow.knowledge_id || "",
      title: existingRow.title || "",
      description: existingRow.description || "",
      category: existingRow.category || "其他",
      scope: existingRow.scope || "personal",
      sourceProvider: existingRow.source_provider || DRIVE_PROVIDER,
      externalFileId: existingRow.external_file_id || file.id,
      sourceModifiedAt: existingRow.source_modified_at || null,
      sourceMetadata: existingRow.source_metadata || {},
      sourceType: existingRow.source_type || sourceTypeFromFile(file),
      sourceName: existingRow.source_name || existingRow.filename || file.name,
      filename: existingRow.filename || file.name,
      sourceUrl: existingRow.source_url || file.webViewLink || "",
      mimeType: existingRow.mime_type || file.mimeType || "",
      fileSize: Number(existingRow.file_size || file.size || 0),
      processingStatus: existingRow.processing_status || "uploaded",
      version: existingRow.version || "v1.0",
      sourceVersion: existingRow.source_version || existingRow.version || "v1.0",
      knowledgeVersion: existingRow.knowledge_version || "v1.0",
      indexedAt: existingRow.indexed_at || null,
      storagePath: existingRow.storage_path || ""
    } : null;
    if (existing && !options.refreshExisting) {
      const error = new Error("這份文件已經在藏書閣；請使用重新整理取得最新版本");
      error.code = "DUPLICATE_SOURCE";
      error.source = existing;
      throw error;
    }
    const payload = await service.readFile(file);
    const blob = namedBlob(payload.data, payload.name || file.name, payload.mimeType || file.mimeType);
    const item = sourceItemFromDrive(file, payload, existing || {});
    if (existing?.cloudId) item.cloudId = existing.cloudId;
    return persistAndProcess(item, blob, { ...options, persistFile: false });
  }

  async function refreshSource(source = {}, options = {}) {
    const { knowledgeIntelligence } = requireRuntime();
    const provider = source.sourceProvider || source.source_provider || UPLOAD_PROVIDER;
    if (provider === DRIVE_PROVIDER) {
      return addDriveFile({ fileId: source.externalFileId || source.external_file_id, refreshExisting: true, onProgress: options.onProgress });
    }
    return knowledgeIntelligence.processSource(source, { onProgress: options.onProgress });
  }

  async function updateSource(source = {}, patch = {}) {
    const { dataService } = requireRuntime();
    const updated = await dataService.saveKnowledgeSource({ ...source, ...patch }, { requireCloud: true });
    return updated;
  }

  async function archiveSource(source = {}) {
    const { dataService } = requireRuntime();
    return dataService.saveKnowledgeSource({ ...source, processingStatus: "archived" }, { requireCloud: true });
  }

  const api = Object.freeze({
    version: "sprint-2-ingestion-v1",
    addUpload,
    selectDriveFile,
    addDriveFile,
    refreshSource,
    updateSource,
    archiveSource
  });

  global.KnowledgeIngestionAPI = api;
})(globalThis);
