// P5.2 Knowledge Intelligence v1: document extraction, summary, units, and recommendation candidates.
// This module intentionally does not implement RAG, embeddings, vector search, or automatic homepage suggestions.

function knowledgeUnitFromCloud(row = {}) {
  return {
    id: row.id || uid("ku"),
    cloudId: row.id || "",
    knowledgeSourceId: row.knowledge_source_id || row.knowledgeSourceId || "",
    unitType: row.unit_type || row.unitType || "reference",
    title: row.title || "",
    content: row.content || "",
    summary: row.summary || "",
    sectionReference: row.section_reference || row.sectionReference || "",
    pageReference: row.page_reference || row.pageReference || "",
    triggers: arrayFromInput(row.triggers),
    applicableRoles: arrayFromInput(row.applicable_roles || row.applicableRoles),
    applicableAgents: arrayFromInput(row.applicable_agents || row.applicableAgents),
    relatedWorkModels: arrayFromInput(row.related_work_models || row.relatedWorkModels),
    suggestedSkills: Array.isArray(row.suggested_skills || row.suggestedSkills) ? (row.suggested_skills || row.suggestedSkills) : [],
    priority: row.priority || "medium",
    confidence: row.confidence == null ? null : Number(row.confidence),
    version: row.version || "v1.0",
    status: row.status || "active",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function knowledgeRecommendationCandidateFromCloud(row = {}) {
  return {
    id: row.id || uid("krc"),
    cloudId: row.id || "",
    knowledgeSourceId: row.knowledge_source_id || row.knowledgeSourceId || "",
    knowledgeUnitId: row.knowledge_unit_id || row.knowledgeUnitId || "",
    type: row.type || "recommendation",
    title: row.title || "",
    content: row.content || "",
    sourceKnowledgeId: row.source_knowledge_id || row.sourceKnowledgeId || "",
    sourceUnitId: row.source_unit_id || row.sourceUnitId || "",
    defaultDuration: Number(row.default_duration || row.defaultDuration || 1),
    applicableRole: row.applicable_role || row.applicableRole || "",
    triggers: arrayFromInput(row.triggers),
    relatedWorkModels: arrayFromInput(row.related_work_models || row.relatedWorkModels),
    status: row.status || "candidate",
    priority: row.priority || "medium",
    confidence: row.confidence == null ? null : Number(row.confidence),
    version: row.version || "v1.0",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function knowledgeUnitsForSource(source = {}) {
  const sourceId = source.cloudId || source.id || "";
  return knowledgeUnits.filter(unit => unit.knowledgeSourceId === sourceId && unit.status !== "archived");
}

function knowledgeCandidatesForSource(source = {}) {
  const sourceId = source.cloudId || source.id || "";
  return knowledgeRecommendationCandidates.filter(candidate => candidate.knowledgeSourceId === sourceId && candidate.status !== "archived");
}

function knowledgeRoleLabel(source = {}) {
  const roles = arrayFromInput(source.relatedRoles);
  if (roles.length) return roles.map(code => roleNameMap[code] || code).join("、");
  if (profile?.role) return profile.role;
  return "待確認職務";
}

function knowledgeRoleCodes(source = {}) {
  const roles = arrayFromInput(source.relatedRoles);
  if (roles.length) return roles;
  return profile?.role ? [roleCode(profile.role)] : [];
}

function stripXmlText(text = "") {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function inflateZipData(data, method) {
  if (method === 0) return data;
  if (method !== 8) throw new Error("此 ZIP 壓縮格式尚未支援");
  if (typeof DecompressionStream === "undefined") throw new Error("此瀏覽器尚未支援 Office 文件解壓縮，請改用最新版 Chrome 或上傳 TXT / Markdown");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function parseOfficeZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("找不到 Office ZIP 結尾資料");
  const total = u16(view, eocd + 10);
  let ptr = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (u32(view, ptr) !== 0x02014b50) throw new Error("Office ZIP 中央目錄格式錯誤");
    const method = u16(view, ptr + 10);
    const compressedSize = u32(view, ptr + 20);
    const nameLen = u16(view, ptr + 28);
    const extraLen = u16(view, ptr + 30);
    const commentLen = u16(view, ptr + 32);
    const localOffset = u32(view, ptr + 42);
    const name = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
    const localNameLen = u16(view, localOffset + 26);
    const localExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    entries.push({ name, data: await inflateZipData(compressed, method) });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function officeEntryText(entries = [], pattern) {
  const decoder = new TextDecoder();
  return entries
    .filter(entry => pattern.test(entry.name))
    .map(entry => stripXmlText(decoder.decode(entry.data)))
    .filter(Boolean)
    .join("\n");
}

function excelSharedStrings(entries = []) {
  const entry = entries.find(x => x.name === "xl/sharedStrings.xml");
  if (!entry) return [];
  const xml = new TextDecoder().decode(entry.data);
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map(match => stripXmlText(match[0]));
}

function excelText(entries = []) {
  const shared = excelSharedStrings(entries);
  const decoder = new TextDecoder();
  const values = [];
  for (const entry of entries.filter(x => /^xl\/worksheets\/sheet\d+\.xml$/.test(x.name))) {
    const xml = decoder.decode(entry.data);
    for (const match of xml.matchAll(/<c[^>]*(?:t="s")?[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g)) {
      const raw = stripXmlText(match[1]);
      const index = Number(raw);
      values.push(Number.isInteger(index) && shared[index] ? shared[index] : raw);
    }
    for (const inline of xml.matchAll(/<is[\s\S]*?<\/is>/g)) values.push(stripXmlText(inline[0]));
  }
  return values.filter(Boolean).join("\n");
}

async function loadPdfJs() {
  if (globalThis.pdfjsLib?.getDocument) return globalThis.pdfjsLib;
  try {
    const pdfjsLib = await import(PDFJS_LIB_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    globalThis.pdfjsLib = pdfjsLib;
    return pdfjsLib;
  } catch (error) {
    console.error("PDF.js load failed", { error });
    throw new Error("PDF 文字擷取元件載入失敗，請確認網路連線後再試。");
  }
}

function normalizePdfPageText(text = "") {
  return sanitizeKnowledgeString(text)
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pdfTextFromItems(items = []) {
  let text = "";
  let previousY = null;
  for (const item of items) {
    const str = sanitizeKnowledgeString(item.str || "");
    if (!str.trim()) continue;
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5] || 0) : null;
    if (previousY !== null && y !== null && Math.abs(y - previousY) > 4) {
      text += "\n";
    } else if (text && !/[\n\s]$/.test(text)) {
      text += " ";
    }
    text += str;
    previousY = y;
  }
  return normalizePdfPageText(text);
}

function analyzeKnowledgeTextQuality(text = "") {
  const raw = String(text || "");
  const compact = raw.replace(/\s/g, "");
  const chars = Array.from(compact);
  const total = chars.length;
  const readableCount = chars.filter(char => /[\p{Script=Han}A-Za-z0-9]/u.test(char)).length;
  const commonPunctuationCount = chars.filter(char => /[，。、；：？！「」『』（）()《》〈〉,.!?;:'"、\-–—/\\%+&@#\[\]【】]/u.test(char)).length;
  const replacementCharacterCount = chars.filter(char => char === "�").length;
  const unsafe = countKnowledgeUnsafeCharacters(raw);
  const unreadableSymbolCount = Math.max(0, total - readableCount - commonPunctuationCount - replacementCharacterCount);
  const ratio = count => total ? count / total : 0;
  return {
    totalCharacters: total,
    readableCount,
    readableRatio: ratio(readableCount),
    replacementCharacterCount,
    replacementRatio: ratio(replacementCharacterCount),
    controlCharacterCount: unsafe.controlCharacterCount + unsafe.nullCharacterCount,
    controlRatio: ratio(unsafe.controlCharacterCount + unsafe.nullCharacterCount),
    invalidSurrogateCount: unsafe.invalidSurrogateCount,
    unreadableSymbolCount,
    unreadableSymbolRatio: ratio(unreadableSymbolCount)
  };
}

function assertKnowledgeTextQuality(text = "", context = {}) {
  const quality = analyzeKnowledgeTextQuality(text);
  knowledgeDebugLog("info", "Knowledge Text Quality Debug", { context, quality });
  const hasEnoughText = quality.totalCharacters >= 20;
  const readableEnough = quality.readableRatio >= 0.35;
  const replacementOk = quality.replacementRatio <= 0.02;
  const controlOk = quality.controlRatio <= 0.01 && quality.invalidSurrogateCount === 0;
  const symbolsOk = quality.unreadableSymbolRatio <= 0.45;
  if (!hasEnoughText) {
    const error = new Error("此 PDF 沒有可讀文字層，可能是掃描檔；目前尚未支援 OCR。");
    error.quality = quality;
    throw error;
  }
  if (!readableEnough || !replacementOk || !controlOk || !symbolsOk) {
    const error = new Error("此 PDF 的文字層品質過低，Mr. KM 無法可靠閱讀；可能是掃描檔、特殊字型編碼或加密文字。P5.2 目前尚未支援 OCR。");
    error.quality = quality;
    throw error;
  }
  return quality;
}

async function extractPdfTextWithPdfJs(blob) {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = pdfTextFromItems(content.items || []);
    if (pageText) pages.push({ pageNumber, text: pageText });
  }
  if (!pages.length) throw new Error("此 PDF 沒有可讀文字層，可能是掃描檔；目前尚未支援 OCR。");
  const text = pages.map(page => `第 ${page.pageNumber} 頁\n${page.text}`).join("\n\n");
  const quality = assertKnowledgeTextQuality(text, { sourceType: "pdf", pages: pages.length });
  return { text, pages, quality, supportLevel: "pdfjs-text-layer", sourceType: "pdf" };
}

async function extractKnowledgeText(source = {}, file = null) {
  const item = normalizedLibraryItem(source);
  const name = file?.name || item.filename || item.sourceName || "";
  const type = inferKnowledgeSourceType(name || item.sourceType || item.storagePath);
  let blob = file;
  if (!blob) {
    const storageKey = item.storagePath || "";
    const debugPayload = {
      knowledgeId: item.knowledgeId || "",
      filename: item.filename || item.sourceName || "",
      storage_path: source.storage_path || source.storagePath || "",
      storagePath: item.storagePath || "",
      storageBucket: KNOWLEDGE_BUCKET,
      finalStorageKey: storageKey
    };
    console.info("Knowledge Intelligence storage download debug", debugPayload);
    if (!storageKey) {
      console.error("Knowledge Intelligence missing storage_path", debugPayload);
      throw new Error("我還沒有拿到可閱讀的正式檔案，請重新上傳後再讓我學習");
    }
    if (!storageKey.includes("/")) {
      console.error("Knowledge Intelligence invalid storage_path", debugPayload);
      throw new Error("我找不到這份檔案的雲端路徑，請重新上傳後再讓我學習");
    }
    const signedUrl = await KnowledgeRepository.signedSourceUrl(storageKey, 300);
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`原始檔讀取失敗：HTTP ${res.status}`);
    blob = await res.blob();
  }
  if (type === "markdown" || /\.(txt|md|markdown)$/i.test(name)) {
    return { text: await blob.text(), supportLevel: "full", sourceType: type };
  }
  if (type === "word" || /\.docx$/i.test(name)) {
    const entries = await parseOfficeZip(await blob.arrayBuffer());
    return { text: officeEntryText(entries, /^word\/document\.xml$/), supportLevel: "xml-text", sourceType: "word" };
  }
  if (type === "powerpoint" || /\.pptx$/i.test(name)) {
    const entries = await parseOfficeZip(await blob.arrayBuffer());
    return { text: officeEntryText(entries, /^ppt\/slides\/slide\d+\.xml$/), supportLevel: "xml-text", sourceType: "powerpoint" };
  }
  if (type === "excel" || /\.(xlsx|csv)$/i.test(name)) {
    if (/\.csv$/i.test(name)) return { text: await blob.text(), supportLevel: "full", sourceType: "excel" };
    const entries = await parseOfficeZip(await blob.arrayBuffer());
    return { text: excelText(entries), supportLevel: "xml-text", sourceType: "excel" };
  }
  if (type === "pdf" || /\.pdf$/i.test(name)) {
    return extractPdfTextWithPdfJs(blob);
  }
  throw new Error("此檔案格式尚未支援，請使用 PDF / DOCX / XLSX / PPTX / TXT / Markdown");
}

function splitKnowledgeLines(text = "") {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n|。|；|;/)
    .map(x => x.replace(/^[\s•\-–—\d.、()（）]+/, "").trim())
    .filter(x => x.length >= 4)
    .slice(0, 180);
}

function splitKnowledgeLineObjects(text = "", extracted = {}) {
  if (Array.isArray(extracted.pages) && extracted.pages.length) {
    return extracted.pages.flatMap(page => splitKnowledgeLines(page.text).map((line, index) => ({
      text: line,
      pageReference: `第 ${page.pageNumber} 頁`,
      sectionReference: `第 ${page.pageNumber} 頁｜段落 ${index + 1}`
    }))).slice(0, 180);
  }
  return splitKnowledgeLines(text).map((line, index) => ({
    text: line,
    pageReference: "",
    sectionReference: `自動擷取段落 ${index + 1}`
  }));
}

function keywordHits(text = "", keywords = []) {
  return keywords.filter(keyword => text.includes(keyword));
}

function inferUnitType(line = "") {
  if (/檢查|確認|準備|完成|填寫|提交|通知|追蹤|建立/.test(line)) return "checklist";
  if (/流程|步驟|申請|審核|核准|驗收|請款/.test(line)) return "process";
  if (/不得|必須|應|需|規定|注意|原則/.test(line)) return "rule";
  if (/表單|單據|文件|紀錄|附件/.test(line)) return "form";
  if (/建議|可|通常|每月|定期/.test(line)) return "recommendation";
  return "reference";
}

function titleFromLine(line = "", fallback = "Knowledge Unit") {
  return line.replace(/[：:，,。].*$/, "").slice(0, 28).trim() || fallback;
}

function buildKnowledgeIntelligence(source = {}, extracted = {}) {
  const rawText = String(extracted.text || "").replace(/\s+\n/g, "\n").trim();
  const text = sanitizeKnowledgeString(rawText);
  knowledgeDebugLog("info", "Knowledge Intelligence Text Sanitize Debug", knowledgeSanitizationStats(rawText, text));
  if (!text) throw new Error("文件內容為空，無法建立工作知識");
  const item = normalizedLibraryItem(source);
  const roleLabel = knowledgeRoleLabel(item);
  const roleCodes = knowledgeRoleCodes(item);
  const agents = item.applicableAgents?.length ? item.applicableAgents : [`${roleLabel} Agent`];
  const lineObjects = splitKnowledgeLineObjects(text, extracted);
  const topics = [...new Set([
    ...keywordHits(text, ["採購", "請購", "詢價", "比價", "議價", "驗收", "請款", "供應商", "評鑑", "合約", "發票"]),
    ...keywordHits(text, ["新人", "報到", "教育訓練", "帳號", "主管", "制度"]),
    ...keywordHits(text, ["ISO", "稽核", "改善", "缺失", "追蹤", "SOP"])
  ])].slice(0, 12);
  const unitLines = lineObjects.filter(line => /採購|請購|詢價|比價|議價|驗收|請款|供應商|評鑑|合約|發票|新人|報到|教育訓練|ISO|稽核|改善|缺失|追蹤|流程|檢查|確認|準備|通知|建立|每月|定期/.test(line.text));
  const selectedLines = (unitLines.length ? unitLines : lineObjects).slice(0, 16);
  const units = selectedLines.map((lineItem, index) => {
    const line = lineItem.text;
    const unitType = inferUnitType(line);
    const triggers = keywordHits(line, ["採購", "請購", "詢價", "比價", "議價", "驗收", "請款", "供應商", "評鑑", "發票", "新人", "報到", "教育訓練", "ISO", "稽核", "改善", "追蹤"]).slice(0, 6);
    return {
      localId: `unit-${index + 1}`,
      unitType,
      title: titleFromLine(line, `${item.title} ${index + 1}`),
      content: line,
      summary: line.slice(0, 120),
      sectionReference: lineItem.sectionReference || `自動擷取段落 ${index + 1}`,
      pageReference: lineItem.pageReference || "",
      triggers,
      applicableRoles: roleCodes,
      applicableAgents: agents,
      relatedWorkModels: item.relatedWorkModels || [],
      suggestedSkills: [],
      priority: unitType === "recommendation" || unitType === "checklist" ? "high" : "medium",
      confidence: extracted.supportLevel === "full" ? 0.78 : 0.62,
      version: item.version || "v1.0",
      status: "active"
    };
  });
  const discovery = WorkIntelligence.discover({ source: item, text, lines: lineObjects, units });
  const rawWorkCandidates = discovery.works.map(work => ({
    title: work.name,
    content: work.purpose,
    triggers: work.triggers,
    source: item.title || item.filename || item.knowledgeId || "藏書閣",
    defaultDuration: 1,
    confidence: work.confidence,
    workDna: work
  }));
  const preparedSuggestions = SuggestionIntelligence.prepareCandidates(rawWorkCandidates, workModels());
  const candidates = preparedSuggestions.items.map(prepared => {
    const workDna = prepared.rawCandidates[0]?.workDna || {};
    return {
      type: "recommendation",
      title: prepared.title,
      content: workDna.purpose || prepared.content,
      sourceKnowledgeId: item.knowledgeId || "",
      defaultDuration: Number(prepared.defaultDuration || 1),
      applicableRole: roleLabel === "待確認職務" ? "" : roleLabel,
      triggers: workDna.triggers || [],
      relatedWorkModels: [],
      status: "candidate",
      priority: workDna.confidence >= 0.8 ? "high" : "medium",
      confidence: workDna.confidence || prepared.confidence || 0.6,
      version: item.version || "v1.0"
    };
  });
  const workItems = discovery.works.map(work => work.name).slice(0, 10);
  return sanitizeKnowledgeValue({
    extractedText: text.slice(0, 60000),
    summary: {
      documentName: item.title,
      role: roleLabel,
      sourceType: extracted.sourceType || item.sourceType,
      supportLevel: extracted.supportLevel || "basic",
      topics,
      works: discovery.works,
      workDiscovery: discovery.diagnostics,
      workMemoryReferences: preparedSuggestions.diagnostics.references,
      newWorks: candidates.map(candidate => candidate.title),
      importantWorkItems: workItems,
      processes: [...new Set(discovery.works.flatMap(work => work.processes || []))].slice(0, 12),
      cautions: units.filter(x => x.unitType === "rule").map(x => x.title).slice(0, 8),
      recommendationCandidates: candidates.map(candidate => candidate.title),
      generatedAt: new Date().toISOString()
    },
    units,
    candidates
  });
}

const KnowledgeIntelligence = {
  async processSource(source = {}, options = {}) {
    const item = normalizedLibraryItem(source);
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
    knowledgeDebugLog("warn", "Knowledge Process Call Stack Debug", {
      functionName: "KnowledgeIntelligence.processSource",
      knowledgeId: item.knowledgeId,
      id: item.id,
      cloudId: item.cloudId,
      hasFile: !!options.file,
      callStack: new Error("KnowledgeIntelligence.processSource stack").stack
    });
    try {
      onProgress("queued");
      toast("我準備開始閱讀這份文件");
      await DataService.updateKnowledgeProcessing(item, { processingStatus: "queued", intelligenceError: null });
      onProgress("reading");
      toast("我正在理解你的工作");
      await DataService.updateKnowledgeProcessing(item, { processingStatus: "processing", intelligenceError: null });
      const extracted = await extractKnowledgeText(item, options.file || null);
      onProgress("analyzing");
      const result = buildKnowledgeIntelligence(item, extracted);
      onProgress("understanding");
      // Work understanding is intentionally a separate observable phase.  The
      // discovery/DNA work above is the point at which Mr. KM turns extracted
      // text into named work, purpose, process, and candidate relationships.
      await Promise.resolve();
      onProgress("organizing");
      const saved = await DataService.saveKnowledgeIntelligenceResult(item, result);
      onProgress("complete");
      const workCount = Array.isArray(result.summary?.works) ? result.summary.works.length : 0;
      toast(workCount ? `我理解出 ${workCount} 項工作，請確認我的理解` : "我沒有辨識出足夠完整的工作，請協助我確認");
      return saved;
    } catch (error) {
      onProgress("error", error);
      console.error("Knowledge Intelligence processing failed", { error, source: item });
      await DataService.updateKnowledgeProcessing(item, {
        processingStatus: "failed",
        intelligenceError: error.message || "文件處理失敗"
      }).catch(syncError => console.error("Knowledge failure status sync failed", { syncError, source: item }));
      toast(error.message || "我這次沒有可靠讀懂這份文件");
      throw error;
    }
  },
  async verifySource(source = {}) {
    const saved = await DataService.verifyKnowledgeSource(source);
    toast("Knowledge 內容已確認");
    return saved;
  }
};
