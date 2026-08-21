// P5.4 Work Intelligence
// Discovers high-level work and builds Work DNA from document evidence.
// Text fragments remain evidence; they are never emitted directly as work suggestions.

const WorkIntelligence = (() => {
  const VERSION = "work-dna-v1";
  const ACTION_PATTERN = /申請|建立|準備|確認|檢查|追蹤|聯繫|寄送|回收|整理|簽核|上傳|下載|更新|維護|分析|評估|審核|核准|驗收|請款|付款|建檔|彙整/;
  const SYSTEMS = ["ECP", "ERP", "SAP", "Excel", "Word", "PowerPoint", "Outlook", "Gmail", "Google Drive", "Teams"];
  const DEPARTMENTS = ["採購部", "財務部", "會計部", "管理部", "人資部", "資訊部", "業務部", "行政部", "法務部", "使用部門", "需求部門"];
  const ROLE_DEPARTMENT_MAP = { PROCUREMENT: "採購部", FINANCE: "財務部", HR: "人資部", IT: "資訊部", SALES: "業務部", ADMIN: "行政部", MARKETING: "行銷部" };
  const FREQUENCIES = [
    { pattern: /每(個)?日|每天|每日/, label: "每日" },
    { pattern: /每(個)?週|每週|每周/, label: "每週" },
    { pattern: /每(個)?月|每月|月底|月初/, label: "每月" },
    { pattern: /每季|每季度|季度/, label: "每季" },
    { pattern: /每半年|半年一次|半年/, label: "每半年" },
    { pattern: /每年|年度|一年一次/, label: "每年" },
    { pattern: /不定期|依需求|視需要/, label: "依需求" }
  ];

  const WORK_DEFINITIONS = [
    {
      id: "procurement-case-management",
      name: "採購案件管理",
      purpose: "管理請購到交貨、驗收與請款的完整採購案件進度。",
      signals: ["請購", "詢價", "比價", "議價", "採購單", "交貨", "驗收", "請款"],
      minimumSignals: 2,
      defaultOutputs: ["採購案件紀錄", "驗收與請款資料"]
    },
    {
      id: "supplier-performance-evaluation",
      name: "供應商績效評鑑",
      purpose: "定期評估供應商品質、交期與合作表現，作為後續合作依據。",
      requiredGroups: [["供應商"], ["評鑑", "績效", "考核"]],
      signals: ["供應商", "評鑑", "績效", "考核", "回收", "簽核"],
      minimumSignals: 2,
      defaultOutputs: ["供應商評鑑報告"]
    },
    {
      id: "green-procurement",
      name: "年度綠色採購",
      purpose: "彙整與追蹤年度綠色採購成果，確保符合環保採購要求。",
      requiredGroups: [["綠色採購", "環保採購", "綠色產品"]],
      signals: ["綠色採購", "環保採購", "綠色產品", "年度", "統計", "申報"],
      minimumSignals: 1,
      defaultOutputs: ["綠色採購年度成果"]
    },
    {
      id: "accounts-payable-management",
      name: "應付款管理",
      purpose: "確認請款、發票與付款資料完整，並追蹤應付款處理進度。",
      signals: ["應付款", "請款", "發票", "付款", "核銷", "傳票"],
      minimumSignals: 2,
      defaultOutputs: ["請款文件", "付款紀錄"]
    },
    {
      id: "erp-data-maintenance",
      name: "ERP 資料維護",
      purpose: "維護 ERP 中的採購、供應商或案件主檔資料正確性。",
      requiredGroups: [["ERP", "SAP"], ["維護", "更新", "建檔", "主檔", "資料"]],
      signals: ["ERP", "SAP", "維護", "更新", "建檔", "主檔", "資料"],
      minimumSignals: 2,
      defaultOutputs: ["ERP 更新紀錄"]
    },
    {
      id: "procurement-analysis",
      name: "採購分析",
      purpose: "分析採購資料、金額與績效，提供管理與決策參考。",
      requiredGroups: [["採購"], ["分析", "報表", "統計", "KPI", "指標"]],
      signals: ["採購", "分析", "報表", "統計", "KPI", "指標"],
      minimumSignals: 2,
      defaultOutputs: ["採購分析報表"]
    },
    {
      id: "supplier-management",
      name: "供應商管理",
      purpose: "維護供應商資料與合作關係，確保供應來源穩定可用。",
      requiredGroups: [["供應商"], ["聯繫", "開發", "名單", "資格", "合作", "管理"]],
      signals: ["供應商", "聯繫", "開發", "名單", "資格", "合作", "管理"],
      minimumSignals: 2,
      defaultOutputs: ["供應商名單", "供應商聯繫紀錄"]
    },
    {
      id: "contract-management",
      name: "合約管理",
      purpose: "管理合約審閱、簽署、履約、到期與歸檔。",
      requiredGroups: [["合約"], ["審閱", "簽署", "用印", "到期", "歸檔", "履約"]],
      signals: ["合約", "審閱", "簽署", "用印", "到期", "歸檔", "履約"],
      minimumSignals: 2,
      defaultOutputs: ["合約文件", "合約追蹤紀錄"]
    },
    {
      id: "employee-onboarding",
      name: "新人報到管理",
      purpose: "協調新人報到所需帳號、設備、識別與教育訓練事項。",
      requiredGroups: [["新人", "新進人員"], ["報到", "帳號", "識別證", "教育訓練"]],
      signals: ["新人", "新進人員", "報到", "帳號", "識別證", "教育訓練", "主管"],
      minimumSignals: 2,
      defaultOutputs: ["新人報到清單"]
    },
    {
      id: "training-management",
      name: "教育訓練管理",
      purpose: "規劃、執行並追蹤教育訓練與完成紀錄。",
      requiredGroups: [["教育訓練", "課程", "研習"], ["安排", "規劃", "執行", "紀錄", "完成"]],
      signals: ["教育訓練", "課程", "研習", "安排", "規劃", "執行", "紀錄", "完成"],
      minimumSignals: 2,
      defaultOutputs: ["教育訓練紀錄"]
    },
    {
      id: "project-progress-management",
      name: "專案進度管理",
      purpose: "追蹤專案進度、里程碑、風險與待辦事項。",
      requiredGroups: [["專案"], ["進度", "里程碑", "風險", "待辦"]],
      signals: ["專案", "進度", "里程碑", "風險", "待辦", "追蹤"],
      minimumSignals: 2,
      defaultOutputs: ["專案進度紀錄"]
    }
  ];

  function unique(values = []) {
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
  }

  function signalHits(text = "", signals = []) {
    return signals.filter(signal => String(text).toLowerCase().includes(String(signal).toLowerCase()));
  }

  function passesRequiredGroups(text = "", groups = []) {
    return groups.every(group => group.some(signal => String(text).toLowerCase().includes(String(signal).toLowerCase())));
  }

  function relevantEvidence(lines = [], hits = []) {
    return lines.filter(line => hits.some(signal => String(line.text || "").toLowerCase().includes(String(signal).toLowerCase()))).slice(0, 12);
  }

  function processSteps(evidence = []) {
    return unique(evidence.filter(item => ACTION_PATTERN.test(item.text || "")).map(item => item.text)).slice(0, 6);
  }

  function systemsFrom(text = "") {
    return SYSTEMS.filter(system => String(text).toLowerCase().includes(system.toLowerCase()));
  }

  function departmentsFrom(text = "") {
    return DEPARTMENTS.filter(department => String(text).includes(department));
  }

  function frequencyFrom(text = "") {
    return FREQUENCIES.find(item => item.pattern.test(text))?.label || "依需求";
  }

  function triggersFrom(text = "", frequency = "", keywords = []) {
    const dateTriggers = String(text).match(/(?:每年)?[一二三四五六七八九十\d]{1,2}月|月初|月底|季初|季末|年度|每半年/g) || [];
    return unique([frequency, ...dateTriggers, ...keywords.slice(0, 4)]).slice(0, 8);
  }

  function outputsFrom(text = "", defaults = []) {
    const outputs = [];
    const patterns = [
      [/(評鑑|考核).{0,8}(報告|表)/, "供應商評鑑報告"],
      [/(分析|統計).{0,8}(報表|報告)/, "分析報表"],
      [/(請款|付款).{0,8}(文件|資料|單據)/, "請款文件"],
      [/驗收.{0,8}(單|紀錄|報告)/, "驗收紀錄"],
      [/合約.{0,8}(文件|紀錄)/, "合約文件"],
      [/(清單|Checklist)/i, "工作清單"]
    ];
    for (const [pattern, label] of patterns) if (pattern.test(text)) outputs.push(label);
    return unique([...outputs, ...defaults]).slice(0, 5);
  }

  function workDna(definition, documentText = "", lines = [], source = {}) {
    const hits = signalHits(documentText, definition.signals || []);
    const evidence = relevantEvidence(lines, hits);
    const processes = processSteps(evidence);
    const frequency = frequencyFrom(documentText);
    const systems = systemsFrom(documentText);
    const departments = unique([
      ...departmentsFrom(documentText),
      ...(source.relatedRoles || []).map(role => ROLE_DEPARTMENT_MAP[role] || role)
    ]);
    const outputs = outputsFrom(documentText, definition.defaultOutputs);
    const confidence = Math.min(0.96, 0.58 + hits.length * 0.045 + Math.min(evidence.length, 6) * 0.025);
    return {
      id: definition.id,
      name: definition.name,
      purpose: definition.purpose,
      description: processes.length ? `主要包含：${processes.slice(0, 3).join("；")}` : definition.purpose,
      processes,
      systems,
      departments,
      outputs,
      frequency,
      triggers: triggersFrom(documentText, frequency, hits),
      keywords: unique(hits).slice(0, 10),
      evidence: evidence.map(item => ({
        text: item.text,
        pageReference: item.pageReference || "",
        sectionReference: item.sectionReference || ""
      })).slice(0, 8),
      confidence: Number(confidence.toFixed(2)),
      sourceKnowledgeId: source.knowledgeId || "",
      version: VERSION
    };
  }

  function discover(input = {}) {
    const text = String(input.text || "");
    const lines = Array.isArray(input.lines) ? input.lines : [];
    const source = input.source || {};
    const works = [];
    for (const definition of WORK_DEFINITIONS) {
      if (!passesRequiredGroups(text, definition.requiredGroups || [])) continue;
      const hits = signalHits(text, definition.signals || []);
      if (hits.length < Number(definition.minimumSignals || 1)) continue;
      works.push(workDna(definition, text, lines, source));
    }
    return {
      works: works.sort((left, right) => right.confidence - left.confidence),
      diagnostics: {
        engineVersion: VERSION,
        definitionCount: WORK_DEFINITIONS.length,
        discoveredWorkCount: works.length,
        evidenceLineCount: lines.length
      }
    };
  }

  return Object.freeze({
    discover,
    definitions: Object.freeze(WORK_DEFINITIONS.map(item => Object.freeze({ ...item }))),
    version: VERSION
  });
})();
