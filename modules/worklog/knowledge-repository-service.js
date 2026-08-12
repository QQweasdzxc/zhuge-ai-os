// P6.2 Knowledge Repository: source-independent read, search, and reference boundary.
// This module intentionally contains no GPT, embeddings, vector search, RAG, or suggestions.
(function initializeKnowledgeRepositoryService(global) {
  "use strict";

  const SERVICE_VERSION = "p6.2-foundation-v1";
  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 100;

  function defaultRepositoryAdapter() {
    if (global.KnowledgeRepository) return global.KnowledgeRepository;
    if (typeof KnowledgeRepository !== "undefined") return KnowledgeRepository;
    return null;
  }

  function normalizeText(value = "") {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-TW")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeJson(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); }
    catch { return String(value); }
  }

  function textArray(value) {
    if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
    if (value == null || value === "") return [];
    return [String(value).trim()].filter(Boolean);
  }

  function firstValue(record = {}, ...keys) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
  }

  function sourceIdOf(record = {}) {
    return String(firstValue(record, "cloudId", "knowledge_source_id", "knowledgeSourceId", "id") || "");
  }

  function unitIdOf(record = {}) {
    return String(firstValue(record, "cloudId", "id") || "");
  }

  function isSourceVisible(record = {}) {
    const deletedAt = firstValue(record, "deletedAt", "deleted_at");
    const status = normalizeText(firstValue(record, "processingStatus", "processing_status", "status") || "");
    return !deletedAt && status !== "archived";
  }

  function isUnitVisible(record = {}) {
    return normalizeText(firstValue(record, "status") || "active") !== "archived";
  }

  function queryTerms(query = "") {
    const normalized = normalizeText(query);
    if (!normalized) return [];
    const terms = new Set([normalized]);
    normalized.split(/[\s,，、。；;:：/\\|()[\]{}]+/u).filter(Boolean).forEach(term => terms.add(term));
    for (const term of [...terms]) {
      if (/^[\p{Script=Han}]+$/u.test(term) && term.length >= 3) {
        for (let index = 0; index < term.length - 1; index += 1) terms.add(term.slice(index, index + 2));
      }
    }
    return [...terms].filter(Boolean);
  }

  function fieldScore(value, terms, weight) {
    const haystack = normalizeText(value);
    if (!haystack) return 0;
    return terms.reduce((score, term, index) => {
      if (!haystack.includes(term)) return score;
      return score + weight * (index === 0 ? 2 : 1);
    }, 0);
  }

  function excerpt(value = "", query = "", maxLength = 180) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= maxLength) return text;
    const normalized = normalizeText(text);
    const target = normalizeText(query);
    const index = target ? normalized.indexOf(target) : -1;
    const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maxLength / 3));
    const prefix = start > 0 ? "…" : "";
    const suffix = start + maxLength < text.length ? "…" : "";
    return `${prefix}${text.slice(start, start + maxLength)}${suffix}`;
  }

  function sourceReference(source = {}) {
    const id = sourceIdOf(source);
    return Object.freeze({
      referenceId: `knowledge-source:${id}`,
      type: "knowledge-source",
      sourceId: id,
      unitId: "",
      knowledgeId: String(firstValue(source, "knowledgeId", "knowledge_id") || ""),
      title: String(firstValue(source, "title") || "未命名工作知識"),
      sourceTitle: String(firstValue(source, "title") || "未命名工作知識"),
      sourceProvider: String(firstValue(source, "sourceProvider", "source_provider") || "upload"),
      externalFileId: String(firstValue(source, "externalFileId", "external_file_id") || ""),
      sourceType: String(firstValue(source, "sourceType", "source_type") || ""),
      sourceUrl: String(firstValue(source, "sourceUrl", "source_url") || ""),
      version: String(firstValue(source, "sourceVersion", "source_version", "version") || ""),
      sectionReference: "",
      pageReference: "",
      updatedAt: String(firstValue(source, "updatedAt", "updated_at", "processedAt", "processed_at") || "")
    });
  }

  function unitReference(unit = {}, source = {}) {
    const unitId = unitIdOf(unit);
    const sourceId = String(firstValue(unit, "knowledgeSourceId", "knowledge_source_id") || sourceIdOf(source));
    return Object.freeze({
      referenceId: `knowledge-unit:${unitId}`,
      type: "knowledge-unit",
      sourceId,
      unitId,
      knowledgeId: String(firstValue(source, "knowledgeId", "knowledge_id") || ""),
      title: String(firstValue(unit, "title") || "工作知識"),
      sourceTitle: String(firstValue(source, "title") || "工作知識來源"),
      sourceProvider: String(firstValue(source, "sourceProvider", "source_provider") || "upload"),
      externalFileId: String(firstValue(source, "externalFileId", "external_file_id") || ""),
      sourceType: String(firstValue(source, "sourceType", "source_type") || ""),
      sourceUrl: String(firstValue(source, "sourceUrl", "source_url") || ""),
      version: String(firstValue(unit, "version") || firstValue(source, "sourceVersion", "source_version", "version") || ""),
      sectionReference: String(firstValue(unit, "sectionReference", "section_reference") || ""),
      pageReference: String(firstValue(unit, "pageReference", "page_reference") || ""),
      updatedAt: String(firstValue(unit, "updatedAt", "updated_at", "createdAt", "created_at") || "")
    });
  }

  function sourceSearchRecord(source = {}, terms = [], query = "") {
    const title = String(firstValue(source, "title") || "");
    const description = String(firstValue(source, "description") || "");
    const tags = textArray(firstValue(source, "tags"));
    const triggers = textArray(firstValue(source, "triggers"));
    const summary = safeJson(firstValue(source, "intelligenceSummary", "intelligence_summary"));
    const content = String(firstValue(source, "extractedText", "extracted_text") || "");
    const score = fieldScore(title, terms, 10)
      + fieldScore(tags.join(" "), terms, 6)
      + fieldScore(triggers.join(" "), terms, 6)
      + fieldScore(description, terms, 4)
      + fieldScore(summary, terms, 3)
      + fieldScore(content, terms, 1);
    return {
      type: "knowledge-source",
      id: sourceIdOf(source),
      title: title || "未命名工作知識",
      summary: excerpt(description || summary || content, query),
      score,
      reference: sourceReference(source),
      source
    };
  }

  function unitSearchRecord(unit = {}, source = {}, terms = [], query = "") {
    const title = String(firstValue(unit, "title") || "");
    const summary = String(firstValue(unit, "summary") || "");
    const content = String(firstValue(unit, "content") || "");
    const triggers = textArray(firstValue(unit, "triggers"));
    const relatedWork = textArray(firstValue(unit, "relatedWorkModels", "related_work_models"));
    const score = fieldScore(title, terms, 10)
      + fieldScore(triggers.join(" "), terms, 6)
      + fieldScore(relatedWork.join(" "), terms, 6)
      + fieldScore(summary, terms, 4)
      + fieldScore(content, terms, 1);
    return {
      type: "knowledge-unit",
      id: unitIdOf(unit),
      title: title || "工作知識",
      summary: excerpt(summary || content, query),
      score,
      reference: unitReference(unit, source),
      unit,
      source
    };
  }

  class KnowledgeRepositoryService {
    constructor(options = {}) {
      this.repository = options.repository || null;
    }

    adapter() {
      const adapter = this.repository || defaultRepositoryAdapter();
      if (!adapter) throw new Error("Knowledge Repository 尚未載入");
      return adapter;
    }

    async listSources(options = {}) {
      const rows = await this.adapter().loadSources();
      const activeOnly = options.activeOnly !== false;
      return (Array.isArray(rows) ? rows : []).filter(source => !activeOnly || isSourceVisible(source));
    }

    async listUnits(options = {}) {
      const sourceId = String(options.sourceId || "");
      const rows = await this.adapter().loadUnits(sourceId);
      const activeOnly = options.activeOnly !== false;
      return (Array.isArray(rows) ? rows : []).filter(unit => !activeOnly || isUnitVisible(unit));
    }

    createReference(record = {}, source = {}) {
      const type = String(record.type || record.referenceType || "");
      const looksLikeUnit = type === "knowledge-unit"
        || firstValue(record, "knowledgeSourceId", "knowledge_source_id") !== undefined;
      return looksLikeUnit ? unitReference(record, source) : sourceReference(record);
    }

    async resolveReference(reference) {
      const referenceId = typeof reference === "string" ? reference : reference?.referenceId;
      const [type, id] = String(referenceId || "").split(":");
      if (!id || !["knowledge-source", "knowledge-unit"].includes(type)) return null;
      if (type === "knowledge-source") {
        const source = (await this.listSources({ activeOnly: false })).find(item => sourceIdOf(item) === id);
        return source ? { type, record: source, reference: sourceReference(source) } : null;
      }
      const [units, sources] = await Promise.all([
        this.listUnits({ activeOnly: false }),
        this.listSources({ activeOnly: false })
      ]);
      const unit = units.find(item => unitIdOf(item) === id);
      if (!unit) return null;
      const sourceId = String(firstValue(unit, "knowledgeSourceId", "knowledge_source_id") || "");
      const source = sources.find(item => sourceIdOf(item) === sourceId) || {};
      return { type, record: unit, source, reference: unitReference(unit, source) };
    }

    async search(query = "", options = {}) {
      const terms = queryTerms(query);
      const scope = ["all", "sources", "units"].includes(options.scope) ? options.scope : "all";
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(options.limit || DEFAULT_LIMIT)));
      if (!terms.length) return { query: "", total: 0, items: [] };
      const [sources, units] = await Promise.all([
        scope === "units" ? Promise.resolve([]) : this.listSources(),
        scope === "sources" ? Promise.resolve([]) : this.listUnits({ sourceId: options.sourceId || "" })
      ]);
      const sourceRows = scope === "units" ? await this.listSources() : sources;
      const sourceMap = new Map(sourceRows.map(source => [sourceIdOf(source), source]));
      const sourceResults = sources.map(source => sourceSearchRecord(source, terms, query));
      const unitResults = units.map(unit => {
        const sourceId = String(firstValue(unit, "knowledgeSourceId", "knowledge_source_id") || "");
        return unitSearchRecord(unit, sourceMap.get(sourceId) || {}, terms, query);
      });
      const typeFilter = textArray(options.types).map(normalizeText);
      const items = [...sourceResults, ...unitResults]
        .filter(item => item.score > 0)
        .filter(item => !typeFilter.length || typeFilter.includes(normalizeText(item.type)))
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-TW"));
      return {
        query: String(query || "").trim(),
        total: items.length,
        items: items.slice(0, limit).map(item => ({
          type: item.type,
          id: item.id,
          title: item.title,
          summary: item.summary,
          score: item.score,
          reference: item.reference
        }))
      };
    }

    async health() {
      const adapter = this.adapter();
      const missing = ["loadSources", "loadUnits"].filter(method => typeof adapter[method] !== "function");
      return {
        status: missing.length ? "degraded" : "ready",
        version: SERVICE_VERSION,
        missing,
        capabilities: ["repository", "lexical-search", "knowledge-reference", "knowledge-api"]
      };
    }
  }

  const service = new KnowledgeRepositoryService();
  global.KnowledgeRepositoryServiceClass = KnowledgeRepositoryService;
  global.KnowledgeRepositoryService = service;
})(globalThis);
