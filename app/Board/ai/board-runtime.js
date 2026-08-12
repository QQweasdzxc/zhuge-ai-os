/* AI Board operational runtime: Shared Identity, controlled RPC writes,
 * structured Checklist evidence, and authenticated Supabase Realtime. */
(function (root) {
  "use strict";
  const service = root.ZhugeBoardReadService;
  if (!service) return;
  const state = { tasks: [], principles: [], systemMaps: [], taskById: new Map(), searchQuery: "", stopRealtime: null, refreshPromise: null, realtimeTimer: null, boardView: "board" };
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  function dateLabel(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
    } catch (error) { return String(value); }
  }
  function priorityLabel(priority) {
    const value = String(priority || "").toLowerCase();
    if (value === "critical" || value === "p0") return "P0";
    if (value === "high" || value === "p1") return "P1";
    if (value === "medium" || value === "p2") return "P2";
    if (value === "low" || value === "p3") return "P3";
    return "";
  }
  function statusLabel(status) {
    return service.workspaceForStatus?.(status)?.label
      || service.STATUS_WORKSPACES.find(item => item.key === status)?.label
      || "待辦";
  }
  function assigneeLabel(value) {
    const raw = String(value || "").trim();
    return raw ? "目前：" + raw : "尚未指派";
  }
  const stageLabels = Object.freeze({ co: "Co 開發驗證", gpt: "GPT 工程審查", qjc: "QJC PM 驗收" });
  const stageEvidenceLabels = Object.freeze({
    co: "開發測試結果、測試摘要、版本與打包資訊",
    gpt: "工程審查結論、範圍檢查與回歸測試結果",
    qjc: "瀏覽器實際操作結果、截圖／錄影或 PM 驗收說明"
  });
  const stateLabels = Object.freeze({ not_verified: "尚未驗證", pass: "已通過", fail: "需要修正", na: "不適用" });
  function setBanner(message, kind) {
    let banner = document.getElementById("boardReadStatus");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "boardReadStatus";
      banner.className = "board-read-status";
      const toolbar = document.querySelector(".toolbar");
      document.querySelector(".main")?.insertBefore(banner, toolbar);
    }
    banner.dataset.state = kind || "info";
    banner.innerHTML = message;
  }
  function taskMarkup(task) {
    const priority = priorityLabel(task.priority);
    const priorityClass = priority === "P0" || priority === "P1" ? "high" : priority === "P2" ? "med" : "";
    const timestamp = dateLabel(task.updatedAt || task.createdAt);
    const terminal = service.isGovernanceTerminal?.(task) || false;
    const governance = terminal
      ? `<div class="governance-history-note"><strong>${esc(statusLabel(task.status))}</strong>${task.resolutionReason ? `：${esc(task.resolutionReason)}` : ""}${task.mergedInto ? ` · 目標：${esc(task.mergedInto)}` : task.linkedTo ? ` · 關聯：${esc(task.linkedTo)}` : ""}</div>`
      : "";
    const draggable = task.status !== "done" && !terminal;
    return "<article class=\"card taskcard board-cloud-card\" data-task-id=\"" + esc(task.id) + "\" data-work-code=\"" + esc(task.workCode) + "\" data-status=\"" + esc(task.status) + "\" data-workspace=\"" + esc(task.workspace) + "\" tabindex=\"0\" draggable=\"" + draggable + "\">" +
      "<div class=\"code\">" + esc(task.workCode || task.id || "TASK") + "</div>" +
      "<h3>" + esc(task.title) + "</h3>" +
      (task.summary ? "<p>" + esc(task.summary) + "</p>" : "") +
      governance +
      "<div class=\"meta\"><span class=\"tag status-tag\">" + esc(statusLabel(task.status)) + "</span>" +
      (task.assignee ? "<span class=\"tag qjc\">" + esc(assigneeLabel(task.assignee)) + "</span>" : "<span class=\"tag\">尚未指派</span>") +
      (priority ? "<span class=\"tag " + priorityClass + "\">" + esc(priority) + "</span>" : "") +
      (timestamp ? "<span class=\"tag\">" + esc(timestamp) + "</span>" : "") +
      "</div><div class=\"card-action-hint\">" + (draggable ? "點擊查看驗收清單與證據 · 拖曳推進工作" : "點擊查看歷史驗收清單與證據 · 已完成不可再拖曳") + "</div></article>";
  }
  function principleMarkup(principle) {
    return "<article class=\"principle-card board-cloud-card\" data-knowledge-code=\"" + esc(principle.code) + "\">" +
      "<div class=\"code\">" + esc(principle.code || "PRINCIPLE") + "</div><h3>" + esc(principle.title) + "</h3>" +
      (principle.summary ? "<p>" + esc(principle.summary) + "</p>" : "") +
      "<div class=\"meta\"><span class=\"tag rule-tag\">最高原則</span>" +
      (principle.version ? "<span class=\"tag\">v" + esc(principle.version) + "</span>" : "") + "</div></article>";
  }
  function renderPrinciples(principles) {
    const zone = document.getElementById("principlesCards");
    if (!zone) return;
    zone.replaceChildren();
    zone.innerHTML = principles.length ? principles.map(principleMarkup).join("") : "<div class=\"board-empty\">目前沒有可讀取的已核准最高原則。</div>";
  }
  function renderSystemMaps(systemMaps) {
    const zone = document.getElementById("systemMapCards");
    if (!zone) return;
    const fallback = [{ code: "CURRENT-SYSTEM-MAP", title: "Zhuge AI OS Current System Map", summary: "Shared Identity、Shared Navigation、Shared Supabase Gateway，以及 WorkLog、Investment、AI Board 的目前模組關係。", version: "目前資料尚待補充" }];
    zone.replaceChildren();
    const rows = systemMaps.length ? systemMaps : fallback;
    zone.innerHTML = rows.map(item => `<article class="system-map-card"><div class="code">${esc(item.code || "SYSTEM-MAP")}</div><h3>${esc(item.title)}</h3><p>${esc(item.summary || "尚未補充系統藍圖內容")}</p><div class="meta"><span class="tag">Current Architecture</span>${item.version ? `<span class="tag">v${esc(item.version)}</span>` : ""}</div></article>`).join("");
  }
  function taskCodeNumber(task) {
    const code = String(task?.workCode || task?.work_code || "").trim();
    const match = code.match(/^TASK[-_ ]?(\d+)$/i);
    return match ? Number(match[1]) : null;
  }
  function sortTasksByCode(tasks) {
    return (Array.isArray(tasks) ? tasks : []).map((task, index) => ({ task, index, number: taskCodeNumber(task) }))
      .sort((left, right) => {
        const leftValid = left.number !== null;
        const rightValid = right.number !== null;
        if (leftValid && rightValid && left.number !== right.number) return left.number - right.number;
        if (leftValid !== rightValid) return leftValid ? -1 : 1;
        return left.index - right.index;
      })
      .map(item => item.task);
  }
  function renderTasks(tasks) {
    const groups = Object.fromEntries(service.STATUS_WORKSPACES.map(workspace => [workspace.uiKey, []]));
    const history = tasks.filter(task => service.isGovernanceTerminal?.(task));
    sortTasksByCode(tasks).filter(task => !service.isGovernanceTerminal?.(task)).forEach(task => {
      const bucket = Object.prototype.hasOwnProperty.call(groups, task.workspace) ? task.workspace : "todo";
      groups[bucket].push(task);
    });
    service.STATUS_WORKSPACES.forEach(workspace => {
      const column = document.querySelector(".process[data-status=\"" + workspace.uiKey + "\"]");
      if (!column) return;
      const cards = column.querySelector(".cards");
      const count = column.querySelector(".count");
      if (!cards) return;
      cards.replaceChildren();
      const rows = groups[workspace.uiKey] || [];
      cards.innerHTML = rows.length ? rows.map(taskMarkup).join("") : "<div class=\"board-empty\">目前沒有工作</div>";
      if (count) count.textContent = String(rows.length);
    });
    const historyCards = document.getElementById("historyTaskCards");
    if (historyCards) historyCards.innerHTML = history.length
      ? history.map(taskMarkup).join("")
      : "<div class=\"board-empty\">目前沒有已合併或已取消的歷史 TASK。</div>";
    wireTaskCards();
  }
  function visibleTasks() {
    const query = state.searchQuery.trim().toLocaleLowerCase("zh-TW");
    if (!query) return state.tasks;
    return state.tasks.filter(task => [task.workCode, task.title, task.summary, task.usageScenario, task.assignee]
      .some(value => String(value || "").toLocaleLowerCase("zh-TW").includes(query)));
  }
  function applySearch(query) {
    state.searchQuery = String(query || "");
    renderTasks(visibleTasks());
    const count = visibleTasks().length;
    setBanner(state.searchQuery.trim() ? "搜尋「" + esc(state.searchQuery.trim()) + "」：找到 " + count + " 筆 TASK。" : "已清除搜尋，顯示全部正式 Cloud TASK。", "info");
  }
  function wireSearch() {
    const input = document.getElementById("boardSearch");
    if (!input) return;
    input.oninput = event => applySearch(event.target.value);
    input.onkeydown = event => {
      if (event.key === "Escape") { input.value = ""; applySearch(""); }
    };
  }
  function setConnection(taskCount, principleCount, realtime) {
    const foot = document.querySelector(".sidefoot");
    if (foot) foot.innerHTML = "● Supabase 已連線<br><br>正式 Cloud Read／Write<br>" +
      taskCount + " 筆 TASK · " + principleCount + " 條原則<br>" +
      (realtime ? "Realtime 已訂閱" : "Realtime 連線中");
  }
  function transitionFor(task, targetUiKey) {
    return typeof service.planTransition === "function"
      ? service.planTransition(task, targetUiKey)
      : null;
  }
  function actionLabel(task, targetUiKey) {
    return transitionFor(task, targetUiKey)?.action || "執行交接";
  }
  function transitionTargets(task) {
    if (typeof service.availableTransitions === "function") {
      return service.availableTransitions(task).map(item => item.targetWorkspace);
    }
    return [];
  }
  function completionGateStatus(items) {
    if (typeof service.completionGateStatus === "function") return service.completionGateStatus(items);
    const rows = (Array.isArray(items) ? items : []).filter(item => item && item.required && String(item.stage || "").toLowerCase() !== "gpt");
    const coItems = rows.filter(item => String(item.stage || "").toLowerCase() === "co");
    const qjcItems = rows.filter(item => String(item.stage || "").toLowerCase() === "qjc");
    const passed = rows.filter(item => item.state === "pass" && (item.evidenceNote || item.evidenceRef));
    const failed = rows.filter(item => item.state === "fail");
    const missingEvidence = rows.filter(item => item.state === "pass" && !(item.evidenceNote || item.evidenceRef));
    const missing = rows.filter(item => item.state !== "pass");
    return { required: rows, coItems, qjcItems, passed, failed, missingEvidence, missing, missingStages: [...(!coItems.length ? ["Co 開發驗證"] : []), ...(!qjcItems.length ? ["QJC PM 驗收"] : [])], hasRequired: rows.length > 0, allowed: rows.length > 0 && coItems.length > 0 && qjcItems.length > 0 && !missing.length && !missingEvidence.length };
  }
  function completionGateMessage(gate) {
    if (gate.missingStages?.length) return `尚未建立${esc(gate.missingStages.join("、"))}的必要驗收項目；請先補齊正式驗收清單。`;
    if (gate.failed?.length) return `有 ${gate.failed.length} 項驗收未通過；請查看失敗原因，退回負責角色修正。`;
    if (gate.missingEvidence?.length) return `有 ${gate.missingEvidence.length} 項驗收已通過但缺少 Evidence；請補充可追溯的驗收說明。`;
    if (gate.missing?.length) return `尚有 ${gate.missing.length} 項 Co／QJC 必要驗收未完成；請由負責角色完成驗證。`;
    return "目前尚未完成 Co 開發驗證與 QJC PM 驗收。";
  }
  async function transitionTask(task, targetUiKey) {
    const plan = transitionFor(task, targetUiKey);
    if (!plan?.allowed) {
      setBanner(esc(plan?.reason || "目前工作階段不允許這個交接。"), "error");
      return;
    }
    if (targetUiKey === "done") {
      try {
        const items = await service.loadChecklist(task.id);
        const gate = completionGateStatus(items);
        if (!gate.allowed) {
          setBanner(`${completionGateMessage(gate)} GPT 工程審查紀錄會保留，但不列入 QJC 完成 Gate。`, "error");
          return;
        }
      } catch (error) {
        setBanner("無法確認 Checklist；為避免誤標完成，暫停這次交接。", "error");
        return;
      }
    }
    setBanner("正在將 " + esc(task.workCode || task.title) + " 交接至 " + esc(plan.assignee) + "…", "loading");
    try {
      await service.transitionTask(task.id, plan.status, plan.assignee, `QJC 拖曳交接：${task.status}/${task.assignee || "未指派"} → ${plan.status}/${plan.assignee}`);
      await refreshBoard({ quiet: true });
      setBanner(`已完成交接：${esc(task.workCode || task.title)} → ${esc(statusLabel(plan.status))}／${esc(plan.assignee)}。Cloud、Audit 與 Realtime 將以正式資料為準。`, "success");
    } catch (error) {
      const raw = String(error && error.message || "");
      const message = /not permitted|unsupported|transition/i.test(raw)
        ? "這個工作區移動不符合目前流程 Gate；請先完成目前階段的驗收，再交給下一位。"
        : /checklist|evidence/i.test(raw)
          ? "尚未完成必要 Checklist／Evidence；請先補齊驗收證據。"
          : "受控交接失敗，正式資料未變更；請確認登入狀態與 Cloud 連線。";
      setBanner(message, "error");
    }
  }

  function governanceTarget(task, reference) {
    const value = String(reference || "").trim().toLowerCase();
    return state.tasks.find(row => String(row.id).toLowerCase() === value || String(row.workCode).toLowerCase() === value) || null;
  }

  async function applyGovernanceAction(task, action) {
    const labels = { merged: "合併", cancelled: "取消", linked: "關聯", ignored: "忽略" };
    const label = labels[action] || action;
    const needsTarget = action === "merged" || action === "linked";
    const reference = needsTarget ? window.prompt(`請輸入要${label}到哪一張 TASK（TASK 編號或 ID）`, "") : "";
    if (needsTarget && !reference) return;
    const target = needsTarget ? governanceTarget(task, reference) : null;
    if (needsTarget && !target) { setBanner("找不到指定的目標 TASK，治理動作未執行。", "error"); return; }
    const reason = window.prompt(`請說明這次${label}決策的原因（至少 3 個字）`, "") || "";
    if (reason.trim().length < 3) { setBanner("治理決策必須留下清楚原因，未執行。", "error"); return; }
    try {
      await service.governanceAction(task.id, action, target?.id || null, reason.trim());
      document.getElementById("taskDetailModal").style.display = "none";
      await refreshBoard({ quiet: true });
      setBanner(`${esc(task.workCode || task.title)} 已完成「${esc(label)}」治理決策，Cloud 與 Audit 已同步。`, "success");
    } catch (error) {
      setBanner("治理決策未完成：" + esc(error?.message || "請確認 QJC 登入與權限。"), "error");
    }
  }
  function wireTaskCards() {
    document.querySelectorAll(".taskcard").forEach(card => {
      const task = state.taskById.get(card.dataset.taskId);
      if (!task) return;
      card.onclick = () => openTaskDetail(task);
      card.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTaskDetail(task); }
      };
      card.ondragstart = event => {
        if (task.status === "done") { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        card.classList.add("dragging");
      };
      card.ondragend = () => card.classList.remove("dragging");
    });
    document.querySelectorAll(".process .cards").forEach(zone => {
      zone.ondragover = event => {
        const task = state.taskById.get(document.querySelector(".taskcard.dragging")?.dataset.taskId || "");
        const target = zone.closest(".process")?.dataset.status;
        const plan = task && target ? transitionFor(task, target) : null;
        if (!plan?.allowed) { zone.classList.remove("dropzone"); return; }
        event.preventDefault();
        zone.classList.add("dropzone");
      };
      zone.ondragleave = () => zone.classList.remove("dropzone");
      zone.ondrop = async event => {
        event.preventDefault();
        zone.classList.remove("dropzone");
        const task = state.taskById.get(event.dataTransfer.getData("text/plain"));
        const target = zone.closest(".process")?.dataset.status;
        if (task && target) await transitionTask(task, target);
      };
    });
  }
  function wireNavigation() {
    const handlers = {
      board: () => showBoardView("board"),
      principles: () => showBoardView("principles"),
      "system-map": () => showBoardView("system-map")
    };
    document.querySelectorAll("[data-board-nav]").forEach(item => {
      const activate = () => {
        document.querySelectorAll("[data-board-nav]").forEach(node => node.classList.toggle("active", node === item));
        handlers[item.dataset.boardNav]?.();
      };
      item.onclick = activate;
      item.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      };
    });
  }
  function showBoardView(view) {
    state.boardView = view;
    document.querySelectorAll("[data-board-view]").forEach(node => { node.hidden = node.dataset.boardView !== view; });
    const boardShell = document.querySelector(".board-shell");
    if (boardShell) boardShell.hidden = view !== "board";
    const toolbar = document.querySelector(".toolbar");
    if (toolbar) toolbar.hidden = view !== "board";
    const note = document.querySelector(".note");
    if (note) note.hidden = view !== "board";
    if (view === "principles") setBanner("工程準則：📘 最高原則來自正式 engineering_knowledge，不參與 TASK 狀態流轉。", "info");
    else if (view === "system-map") setBanner("系統藍圖：顯示目前正式系統組成與資料來源。", "info");
    else setBanner("工作看板：顯示正式 Cloud TASK、Checklist、Evidence 與交接流程。", "info");
  }
  function ensureTaskDetailModal() {
    if (document.getElementById("taskDetailModal")) return;
    const modal = document.createElement("div");
    modal.id = "taskDetailModal";
    modal.className = "modalback";
    modal.innerHTML = "<div class=\"modal board-task-modal\" role=\"dialog\" aria-modal=\"true\">" +
      "<div class=\"modalhead\"><h2 id=\"taskDetailTitle\">TASK</h2><button class=\"x\" id=\"closeTaskDetail\" aria-label=\"關閉\">×</button></div>" +
      "<div class=\"modalbody\" id=\"taskDetailBody\"><div class=\"board-empty\">讀取中…</div></div></div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", event => { if (event.target === modal) modal.style.display = "none"; });
    document.getElementById("closeTaskDetail").onclick = () => { modal.style.display = "none"; };
  }
  function ensureHealthModal() {
    if (document.getElementById("healthCheckModal")) return;
    const modal = document.createElement("div");
    modal.id = "healthCheckModal";
    modal.className = "modalback";
    modal.innerHTML = "<div class=\"modal board-task-modal\" role=\"dialog\" aria-modal=\"true\"><div class=\"modalhead\"><h2>資料健康度檢查（唯讀）</h2><button class=\"x\" id=\"closeHealthCheck\" aria-label=\"關閉\">×</button></div><div class=\"modalbody\" id=\"healthCheckBody\"><div class=\"board-empty\">尚未執行檢查。</div></div></div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", event => { if (event.target === modal) modal.style.display = "none"; });
    document.getElementById("closeHealthCheck").onclick = () => { modal.style.display = "none"; };
  }
  const healthSeverity = Object.freeze({ error: "需要處理", warning: "請檢查", info: "資訊" });
  function renderHealthReport(report) {
    ensureHealthModal();
    const body = document.getElementById("healthCheckBody");
    const rows = report.findings.map(item => `<article class="health-finding health-${esc(item.severity)}"><div class="meta"><span class="tag">${esc(healthSeverity[item.severity] || item.severity)}</span><span class="tag">${esc(item.type)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p>${item.records.length ? `<small>涉及資料：${esc(item.records.join("、"))}</small>` : ""}</article>`).join("");
    body.innerHTML = `<div class="health-summary"><strong>已掃描 ${report.taskCount} 張正式 Cloud TASK，發現 ${report.findingCount} 項 Finding。</strong><p>本次只讀取資料，不會自動 Merge、Cancel、刪除或修改任何正式紀錄。</p></div>${rows || "<div class=\"board-empty\">目前沒有發現需要提示的資料問題。</div>"}<div class="health-boundary">Merge／Link／Cancel／Ignore 等整理動作需要既有 Schema、權限與 Audit 能力；目前先保留 Finding，交由 PM／GPT 決定。</div>`;
    document.getElementById("healthCheckModal").style.display = "grid";
  }
  async function runHealthCheck() {
    const button = document.getElementById("healthCheckBtn");
    if (button) { button.disabled = true; button.textContent = "檢查中…"; }
    setBanner("正在檢查 TASK、Checklist、Knowledge 與系統藍圖的一致性…", "loading");
    try {
      const report = await service.runHealthCheck();
      renderHealthReport(report);
      setBanner(`資料健康度檢查完成：${report.findingCount} 項 Finding。結果為唯讀，未修改 Cloud。`, "success");
    } catch (error) { setBanner("資料健康度檢查失敗：" + esc(error?.message || "未知錯誤"), "error"); }
    finally { if (button) { button.disabled = false; button.textContent = "檢查資料健康度"; } }
  }
  function checklistMarkup(item) {
    const checked = item.state === "pass" ? " checked" : "";
    const stage = stageLabels[item.stage] || item.stage.toUpperCase();
    const isEngineeringReview = String(item.stage || "").toLowerCase() === "gpt";
    const stateLabel = stateLabels[item.state] || item.state;
    const expectedEvidence = stageEvidenceLabels[item.stage] || "可追溯的操作結果、測試結果或交接說明";
    const evidence = item.evidenceNote || item.evidenceRef
      ? `<div class="checklist-evidence-detail"><strong>證據位置／說明：</strong>${item.evidenceNote ? esc(item.evidenceNote) : ""}${item.evidenceRef ? `${item.evidenceNote ? " · " : ""}參照：${esc(item.evidenceRef)}` : ""}</div><div class="checklist-audit-detail"><strong>驗證紀錄：</strong>${item.checkedBy ? `驗證者 ${esc(item.checkedBy)}` : "尚未記錄驗證者"}${item.checkedAt ? ` · 時間 ${esc(dateLabel(item.checkedAt))}` : " · 尚未記錄時間"}</div>`
      : `<div class="checklist-evidence-detail missing"><strong>證據現在在哪裡：</strong>尚待${esc(stage)}提供；目前沒有可供 QJC 核對的紀錄。</div><div class="checklist-audit-detail missing"><strong>驗證紀錄：</strong>尚未記錄驗證者與驗證時間。</div>`;
    const next = isEngineeringReview
      ? "此為 GPT 工程審查紀錄；QJC 不需在此勾選，請查看工程 Evidence。"
      : item.state === "pass" ? "已完成此驗證項目，可繼續下一個驗收階段。" : item.state === "fail" ? "請查看失敗原因，退回負責角色修正後再驗證。" : `請由${esc(stage)}完成驗證，並提供：${esc(expectedEvidence)}。`;
    const qjcCanAct = item.stage === "qjc";
    const controls = qjcCanAct
      ? `<label class="checklist-checkline checklist-qjc-control"><input type="checkbox" class="checklist-check" data-id="${esc(item.id)}"${checked}><span>QJC 驗收通過</span></label><button class="btn checklist-evidence-btn" data-id="${esc(item.id)}">補充驗收說明</button><button class="btn checklist-fail-btn" data-id="${esc(item.id)}">退回修正</button>`
      : `<div class="checklist-readonly-note">由${esc(stage)}在工程交接中更新，QJC 僅查看結果。</div>`;
    const requirementLabel = isEngineeringReview ? " · 工程紀錄（不列入 QJC 完成 Gate）" : item.required ? " · 必要" : "";
    return `<div class="checklist-item ${qjcCanAct ? "checklist-qjc-item" : "checklist-readonly-item"}" data-checklist-id="${esc(item.id)}"><div class="checklist-main"><div class="checklist-checkline"><span class="checklist-stage-mark" aria-hidden="true">${item.state === "pass" ? "✅" : item.state === "fail" ? "⚠️" : "○"}</span><span><b>${esc(item.label || "未命名驗收項目")}</b><small>負責階段：${esc(stage)} · 目前狀態：${esc(stateLabel)}${requirementLabel}</small></span></div><div class="checklist-question"><strong>我要驗證什麼：</strong>${esc(item.label || "請確認此項目符合需求")}</div><div class="checklist-question"><strong>需要什麼證據：</strong>${esc(expectedEvidence)}</div>${evidence}<div class="checklist-next"><strong>下一步：</strong>${next}</div></div><div class="checklist-actions">${controls}<div class="checklist-state ${item.state === "not_verified" ? "missing" : ""}">${esc(stateLabel)}</div></div></div>`;
  }
  function checklistSummary(items) {
    const gate = completionGateStatus(items);
    if (!gate.hasRequired) return items.some(item => String(item.stage || "").toLowerCase() === "gpt") ? "目前只有 GPT 工程審查紀錄，不列入 QJC 完成 Gate" : "尚未提供正式驗收清單";
    const remaining = gate.required.length - gate.passed.length;
    return "QJC 完成條件 " + gate.passed.length + "/" + gate.required.length + " 已通過" + (gate.failed.length ? " · " + gate.failed.length + " 項需要修正" : remaining ? " · 尚有 " + remaining + " 項待驗證" : "") + " · GPT 工程審查為獨立紀錄";
  }
  function requirementContent(task) {
    const parts = [task.summary, task.problem && task.problem !== task.summary ? task.problem : "", task.objective && task.objective !== task.summary ? task.objective : ""]
      .map(value => String(value || "").trim()).filter(Boolean);
    return [...new Set(parts)].join("\n\n") || "尚未補充需求內容";
  }
  function nextStepLabel(task) {
    const status = service.normalizeStatus ? service.normalizeStatus(task.status) : String(task.status || "ready");
    const assignee = String(task.assignee || "").toUpperCase();
    if (status === "ready") return "由 Co 接球並開始推進。";
    if (status === "inprogress") return "由 Co 完成開發驗證後，交給 GPT Review。";
    if (status === "qa" && assignee === "GPT") return "由 GPT 完成工程審查；通過後交給 QJC PM 驗收，失敗則退回 Co。";
    if (status === "qa" && assignee === "QJC") return "由 QJC 依清單逐項操作驗收；通過後完成，失敗則退回 Co。";
    if (status === "done") return "已完成；可查看歷史驗收與 Evidence。";
    return "請依目前接球者與驗收清單繼續。";
  }
  async function openTaskDetail(task) {
    ensureTaskDetailModal();
    const modal = document.getElementById("taskDetailModal");
    const body = document.getElementById("taskDetailBody");
    document.getElementById("taskDetailTitle").textContent = (task.workCode || "TASK") + "｜" + task.title;
    body.innerHTML = "<div class=\"task-detail-meta\"><span>" + esc(statusLabel(task.status)) + "</span><span>" +
      esc(assigneeLabel(task.assignee)) + "</span></div><section class=\"task-detail-section\"><h3>需求內容</h3><p>" + esc(requirementContent(task)).replace(/\n/g, "<br>") +
      "</p></section><section class=\"task-detail-section\"><h3>使用情境</h3><p>" + esc(task.usageScenario || "尚未補充使用情境") +
      "</p></section><section class=\"task-detail-section task-next-step\"><h3>下一步</h3><p>" + esc(nextStepLabel(task)) +
      "</p></section><div class=\"checklist-section\"><div class=\"checklist-heading\"><h3>開發契約與驗收清單</h3><span id=\"checklistSummary\">讀取中…</span></div>" +
      "<p class=\"checklist-contract-note\">先看 Co 開發驗證，再由 QJC 完成 PM 驗收。GPT 工程審查會保留為獨立 Evidence／Audit，不是 QJC 必須勾選的完成項目。</p><div id=\"checklistConsistency\"></div><div id=\"checklistRows\"><div class=\"board-empty\">正在讀取正式驗收清單…</div></div></div>" +
      "<div class=\"transition-actions\" id=\"taskTransitionActions\"></div>";
    modal.style.display = "grid";
    const actions = document.getElementById("taskTransitionActions");
    transitionTargets(task).forEach(target => {
      const transition = transitionFor(task, target);
      if (!transition) return;
      const button = document.createElement("button");
      button.className = "btn primary";
      button.textContent = actionLabel(task, target);
      button.title = "目前狀態：" + statusLabel(task.status) + "；目前接球者：" + (task.assignee || "未指派");
      button.onclick = async () => { await transitionTask(task, target); modal.style.display = "none"; };
      actions.appendChild(button);
    });
    const governanceActions = task.status !== "done" && !service.isGovernanceTerminal?.(task)
      ? `<section class="task-governance-section"><h3>治理處理</h3><p>只有 QJC 可以做最終治理決策；Co／GPT 只能提出建議。每次決策都會保留 Audit。</p><div class="governance-actions"><button class="btn" data-governance="merged">合併至其他 TASK</button><button class="btn" data-governance="linked">關聯其他 TASK</button><button class="btn" data-governance="cancelled">取消 TASK</button><button class="btn" data-governance="ignored">保留並標記忽略</button></div></section>`
      : "";
    actions.insertAdjacentHTML("beforebegin", governanceActions);
    document.querySelectorAll("[data-governance]").forEach(button => { button.onclick = () => applyGovernanceAction(task, button.dataset.governance); });
    try {
      const items = await service.loadChecklist(task.id);
      const rows = document.getElementById("checklistRows");
      const summary = document.getElementById("checklistSummary");
      if (summary) summary.textContent = items.length ? checklistSummary(items) : "缺少正式 Checklist";
      const gate = completionGateStatus(items);
      const consistency = document.getElementById("checklistConsistency");
      if (task.status === "done" && !items.length) {
        consistency.innerHTML = "<div class=\"history-note\"><strong>歷史完成</strong><br>此 TASK 完成於 Checklist 制度導入前；系統不補造 PASS、驗證者或 Evidence。</div>";
      } else if (task.status === "done" && !gate.allowed) {
        consistency.innerHTML = "<div class=\"consistency-warning\"><strong>完成狀態與 Checklist 不一致</strong><br>目前 TASK 已標記完成，但必要驗收尚未全部通過。請記錄 Finding，勿偽造歷史 Evidence。</div>";
      } else if (gate.hasRequired) {
        consistency.innerHTML = `<div class="checklist-contract-note">QJC 完成條件：${gate.passed.length}/${gate.required.length} 已通過；GPT 工程審查為獨立紀錄，不阻擋 QJC 完成。</div>`;
      } else if (items.length) {
        consistency.innerHTML = "<div class=\"checklist-contract-note\">目前只有工程審查紀錄，尚未建立 Co／QJC 完成驗收項目。</div>";
      }
      rows.innerHTML = items.length ? items.map(checklistMarkup).join("") : "<div class=\"board-empty\">此 TASK 尚未建立正式驗收清單，因此目前不能進行正式驗收。請由 Co／GPT 依 Development Contract 補齊；QJC 不需要自行猜測驗收項目。</div>";
      rows.querySelectorAll(".checklist-check").forEach(input => {
        input.onchange = () => updateChecklistItem(task, items.find(item => item.id === input.dataset.id), input.checked ? "pass" : "not_verified");
      });
      rows.querySelectorAll(".checklist-fail-btn").forEach(button => {
        button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.id), "fail");
      });
      rows.querySelectorAll(".checklist-evidence-btn").forEach(button => {
        button.onclick = () => updateChecklistEvidence(task, items.find(item => item.id === button.dataset.id));
      });
    } catch (error) {
      document.getElementById("checklistRows").innerHTML = "<div class=\"board-empty\">Checklist 讀取失敗：" + esc(error && error.message || "未知錯誤") + "</div>";
    }
  }
  async function updateChecklistItem(task, item, nextState) {
    if (!item) return;
    let note = item.evidenceNote || "";
    if (nextState === "pass" || nextState === "fail") {
      note = window.prompt("請輸入必要 Evidence／Note", note);
      if (!note || !note.trim()) { setBanner("通過或退回前必須填寫驗收說明。", "error"); await openTaskDetail(task); return; }
    }
    try {
      await service.updateChecklistItem({ id: item.id, state: nextState, evidenceNote: note || "" });
      await openTaskDetail(task);
      setBanner("Checklist 狀態與 Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function updateChecklistEvidence(task, item) {
    if (!item) return;
    const note = window.prompt("請補充驗收證據或操作說明", item.evidenceNote || "");
    if (note === null) return;
    try {
      await service.updateChecklistItem({ id: item.id, state: item.state, evidenceNote: note.trim() });
      await openTaskDetail(task);
      setBanner("Checklist Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist Evidence 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  function openQuickAdd(workspace) {
    const modal = document.getElementById("addCardModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.style.display = "grid";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    drawer?.classList.add("is-open");
    if (workspace && workspace !== "todo") setBanner("新 TASK 一律從待辦開始，完成後依正式流程交接。", "info");
  }
  function closeQuickAdd() {
    const modal = document.getElementById("addCardModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    drawer?.classList.remove("is-open");
  }
  function openWorkspaceDrawer() {
    const backdrop = document.getElementById("workspaceCreateDrawerBackdrop");
    const drawer = document.getElementById("workspaceCreateDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function closeWorkspaceDrawer() {
    const backdrop = document.getElementById("workspaceCreateDrawerBackdrop");
    const drawer = document.getElementById("workspaceCreateDrawer");
    backdrop?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
  }
  function renderBoardHeaderActions() {
    const actions = document.querySelector("[data-zhuge-shared-header='true'] .zhuge-shared-header-actions");
    if (!actions) return;
    actions.innerHTML = `<button class="btn primary board-header-action" type="button" data-board-create-card>＋ 卡片</button><button class="btn board-header-action" type="button" data-board-create-workspace>＋ 工作區</button><button class="btn board-header-refresh" id="refreshBoardBtn" type="button" aria-label="重新整理" title="重新整理">↻</button>`;
    actions.querySelector("[data-board-create-card]")?.addEventListener("click", () => openQuickAdd("todo"));
    actions.querySelector("[data-board-create-workspace]")?.addEventListener("click", openWorkspaceDrawer);
    actions.querySelector("#refreshBoardBtn")?.addEventListener("click", () => refreshBoard());
  }
  async function createCard() {
    const modal = document.getElementById("addCardModal");
    const summary = modal?.querySelector("#taskSummary")?.value?.trim() || "";
    const usageScenario = modal?.querySelector("#taskUsageScenario")?.value?.trim() || "";
    const title = modal?.querySelector("#taskTitle")?.value?.trim() || summary.slice(0, 80);
    if (!title) { setBanner("請輸入 Task 標題或內容。", "error"); return; }
    try {
      await service.createTask({ title: title, summary: summary, usageScenario: usageScenario });
      closeQuickAdd();
      modal.querySelectorAll("input, textarea").forEach(field => { field.value = ""; });
      await refreshBoard({ quiet: true });
      setBanner("TASK 已建立並進入待辦，由 Co 接球。", "success");
    } catch (error) { setBanner("TASK 建立失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function refreshBoard(options) {
    options = options || {};
    if (state.refreshPromise) return state.refreshPromise;
    if (!options.quiet) setBanner("正在透過 Shared Supabase Gateway 讀取正式 TASK 與最高原則…", "loading");
    state.refreshPromise = service.load().then(result => {
      state.tasks = result.tasks;
      state.principles = result.principles;
      state.systemMaps = result.systemMaps || [];
      state.taskById = new Map(result.tasks.map(task => [task.id, task]));
      renderPrinciples(result.principles);
      renderSystemMaps(state.systemMaps);
      renderTasks(visibleTasks());
      setConnection(result.tasks.length, result.principles.length, !!state.stopRealtime);
      if (!options.quiet) setBanner("已讀取 " + result.tasks.length + " 張正式工作卡與 " + result.principles.length + " 條已核准原則。<strong>QJC 可直接操作；GPT／Co 會透過受控流程交接。</strong>", "success");
      return result;
    }).catch(error => {
      const loginLink = "../../../?app=1";
      const message = error && error.code === "BOARD_SESSION_REQUIRED" ? "請先登入 Zhuge AI OS，再開啟 AI Board。<a href=\"" + loginLink + "\">前往登入</a>" : "正式 Cloud Read 失敗：" + esc(error && error.message || "未知錯誤") + "。請重新整理或確認 Shared Session。";
      setBanner(message, "error");
      const foot = document.querySelector(".sidefoot");
      if (foot) foot.innerHTML = "● Cloud Read 尚未就緒<br><br>未使用本機 TASK 或假資料";
      throw error;
    }).finally(() => { state.refreshPromise = null; });
    return state.refreshPromise;
  }
  function initRealtime() {
    service.subscribe(() => {
      if (state.realtimeTimer) clearTimeout(state.realtimeTimer);
      state.realtimeTimer = setTimeout(() => refreshBoard({ quiet: true }).catch(() => {}), 160);
    }).then(stop => {
      state.stopRealtime = stop;
      setBanner("Cloud Read 已完成，Realtime 已訂閱。其他工程角色的交接會即時反映。", "success");
      setConnection(state.tasks.length, state.principles.length, true);
    }).catch(error => setBanner("Realtime 尚未連線：" + esc(error && error.message || "未知錯誤") + "。Refresh 可作為暫時 Recovery。", "error"));
  }
  function enableBoardActions() {
    renderBoardHeaderActions();
    document.querySelectorAll("[data-workspace-drawer-close]").forEach(button => button.addEventListener("click", closeWorkspaceDrawer));
    document.querySelector("#addCardModal .x")?.addEventListener("click", closeQuickAdd);
    document.querySelector("#addCardModal .modalfoot .btn:not(.primary)")?.addEventListener("click", closeQuickAdd);
    document.querySelectorAll(".add").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
  function init() {
    const shell = document.querySelector(".zhuge-module-shell");
    document.querySelectorAll("[data-toggle-sidebar]").forEach(button => {
      button.onclick = () => shell?.classList.toggle("sidebar-open");
    });
    document.querySelectorAll("[data-close-sidebar]").forEach(button => {
      button.onclick = () => shell?.classList.remove("sidebar-open");
    });
    enableBoardActions();
    ensureHealthModal();
    document.getElementById("healthCheckBtn")?.addEventListener("click", runHealthCheck);
    ensureTaskDetailModal();
    wireNavigation();
    wireSearch();
    renderPrinciples([]);
    renderSystemMaps([]);
    renderTasks([]);
    document.querySelectorAll(".process .cards").forEach(cards => { cards.innerHTML = "<div class=\"board-empty\">正在讀取正式 Cloud TASK…</div>"; });
    const note = document.querySelector(".note");
    if (note) note.innerHTML = "正式工作卡以 Cloud 資料為唯一來源。QJC 可直接操作；GPT／Co 透過受控流程交接。每次狀態、接球者與驗收紀錄都會保留完整紀錄。";
    root.openQuickAdd = openQuickAdd;
    root.createCard = createCard;
    const initialView = new URLSearchParams(root.location.search).get("view");
    if (["principles", "system-map"].includes(initialView)) {
      const nav = document.querySelector(`[data-board-nav="${initialView}"]`);
      nav?.click();
    } else showBoardView("board");
    refreshBoard().then(initRealtime).catch(() => {});
  }
  root.ZhugeBoardRuntime = Object.freeze({ refresh: refreshBoard, openTaskDetail: openTaskDetail, sortTasksByCode: sortTasksByCode, completionGateStatus: completionGateStatus, completionGateMessage: completionGateMessage });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
