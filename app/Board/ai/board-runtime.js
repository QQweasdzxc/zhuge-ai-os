/* AI Board operational runtime: Shared Identity, controlled RPC writes,
 * structured Checklist evidence, and authenticated Supabase Realtime. */
(function (root) {
  "use strict";
  const service = root.ZhugeBoardReadService;
  if (!service) return;
  const state = { workspaces: [], tasks: [], principles: [], systemMaps: [], taskById: new Map(), workspaceById: new Map(), searchQuery: "", archiveSearch: "", archiveFilter: "all", stopRealtime: null, refreshPromise: null, realtimeTimer: null, boardView: "board", activeTaskId: "" };
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
    return service.statusDescriptorFor?.(status)?.label || "未知工程狀態";
  }
  function readableWorkStatus(task) {
    const status = service.normalizeStatus ? service.normalizeStatus(task?.status) : String(task?.status || "").trim().toLowerCase();
    const assignee = String(task?.assignee || "").trim().toUpperCase();
    if (status === "ready") return "待開始";
    if (status === "inprogress") return "進行中";
    if (status === "qa" && assignee === "GPT") return "等待工程審查";
    if (status === "qa" && assignee === "QJC") return "等待 PM 驗收";
    if (status === "qa") return "等待驗證";
    if (status === "done") return "已完成";
    if (status === "merged") return "已合併（封存）";
    if (status === "cancelled") return "已取消（封存）";
    return statusLabel(status);
  }
  function workspaceLabel(task) {
    return String(task?.workspaceName || task?.workspaceKey || "未分類工作區");
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
      const toolbar = document.querySelector(".workspace-canvas .toolbar, .toolbar");
      const parent = toolbar?.parentElement || document.querySelector(".main");
      if (parent) parent.insertBefore(banner, toolbar || parent.firstChild);
    }
    banner.dataset.state = kind || "info";
    banner.innerHTML = message;
  }
  function clearBanner() {
    document.getElementById("boardReadStatus")?.remove();
  }
  function isArchiveTask(task) {
    if (typeof service.isArchiveTask === "function") return service.isArchiveTask(task);
    const status = service.normalizeStatus ? service.normalizeStatus(task?.status) : String(task?.status || "").toLowerCase();
    return status === "done" || service.isGovernanceTerminal?.(task) === true;
  }
  function isMainBoardWorkspace(workspace) {
    return workspace?.active === true && String(workspace.key || "").toLowerCase() !== "done";
  }
  function taskMarkup(task, options = {}) {
    const priority = priorityLabel(task.priority);
    const priorityClass = priority === "P0" || priority === "P1" ? "high" : priority === "P2" ? "med" : "";
    const timestamp = dateLabel(task.updatedAt || task.createdAt);
    const terminal = service.isGovernanceTerminal?.(task) || false;
    const archiveOnly = options.readOnly === true || isArchiveTask(task);
    const governance = terminal
      ? `<div class="governance-history-note"><strong>${esc(statusLabel(task.status))}</strong>${task.resolutionReason ? `：${esc(task.resolutionReason)}` : ""}${task.mergedInto ? ` · 目標：${esc(task.mergedInto)}` : task.linkedTo ? ` · 關聯：${esc(task.linkedTo)}` : ""}</div>`
      : "";
    const draggable = !archiveOnly && !terminal;
    const archiveClass = archiveOnly ? " archive-taskcard" : "";
    const actionHint = archiveOnly
      ? "點擊查看歷史驗收清單、Evidence 與 Activity Log · 封存內容僅供查閱，不可恢復、移動或修改"
      : "點擊查看驗收清單與證據 · 可拖曳至任意工作區（不改變工程狀態／負責人）";
    return "<article class=\"card taskcard board-cloud-card" + archiveClass + "\" data-task-id=\"" + esc(task.id) + "\" data-work-code=\"" + esc(task.workCode) + "\" data-status=\"" + esc(task.status) + "\" data-workspace=\"" + esc(task.workspace) + "\" tabindex=\"0\" draggable=\"" + draggable + "\">" +
      "<div class=\"code\">" + esc(task.workCode || task.id || "TASK") + "</div>" +
      "<h3>" + esc(task.title) + "</h3>" +
      (task.summary ? "<p>" + esc(task.summary) + "</p>" : "") +
      governance +
      "<div class=\"meta\"><span class=\"tag workspace-tag\">工作區：" + esc(workspaceLabel(task)) + "</span><span class=\"tag status-tag\">工程狀態：" + esc(statusLabel(task.status)) + "</span>" +
      (task.assignee ? "<span class=\"tag qjc\">" + esc(assigneeLabel(task.assignee)) + "</span>" : "<span class=\"tag\">尚未指派</span>") +
      (priority ? "<span class=\"tag " + priorityClass + "\">" + esc(priority) + "</span>" : "") +
      (timestamp ? "<span class=\"tag\">" + esc(timestamp) + "</span>" : "") +
      "</div><div class=\"card-action-hint\">" + actionHint + "</div></article>";
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
  function renderWorkspaceColumns() {
    const board = document.getElementById("boardColumns") || document.querySelector(".board");
    if (!board) return;
    const workspaces = state.workspaces.filter(isMainBoardWorkspace).sort((a, b) => a.sortOrder - b.sortOrder);
    board.style.setProperty("--board-workspace-count", String(Math.max(workspaces.length, 1)));
    const columns = workspaces.length
      ? workspaces.map(workspace => {
        const addTask = workspace.key === "todo"
          ? "<button class=\"add\" data-workspace-add=\"" + esc(workspace.id) + "\">＋ 新增 TASK</button>"
          : "";
        return "<div class=\"column process\" data-workspace-id=\"" + esc(workspace.id) + "\" data-workspace-key=\"" + esc(workspace.key) + "\">" +
          "<div class=\"colhead\" data-workspace-header=\"" + esc(workspace.id) + "\"><span class=\"workspace-title\">" + esc(workspace.name) + "</span><span class=\"count\">0</span><button class=\"workspace-rename\" type=\"button\" data-workspace-rename=\"" + esc(workspace.id) + "\" title=\"重新命名工作區\" aria-label=\"重新命名工作區\">✎</button><span class=\"drag workspace-drag-handle\" draggable=\"true\" title=\"拖曳重新排序\" aria-label=\"拖曳重新排序\">⠿</span></div>" +
          addTask + "<div class=\"cards\"></div></div>";
      }).join("")
      : "<div class=\"board-empty\">尚未讀取可用工作區。</div>";
    board.innerHTML = columns;
  }
  function renderTasks(tasks) {
    renderWorkspaceColumns();
    const groups = Object.fromEntries(state.workspaces.filter(isMainBoardWorkspace).map(workspace => [workspace.id, []]));
    const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(task => !isArchiveTask(task));
    sortTasksByCode(activeTasks).forEach(task => {
      const fallback = state.workspaces.find(workspace => workspace.key === "todo");
      const bucket = Object.prototype.hasOwnProperty.call(groups, task.workspaceId) ? task.workspaceId : fallback?.id;
      if (bucket && groups[bucket]) groups[bucket].push(task);
    });
    state.workspaces.filter(isMainBoardWorkspace).sort((a, b) => a.sortOrder - b.sortOrder).forEach(workspace => {
      const column = document.querySelector(".process[data-workspace-id=\"" + workspace.id + "\"]");
      if (!column) return;
      const cards = column.querySelector(".cards");
      const count = column.querySelector(".count");
      if (!cards) return;
      cards.replaceChildren();
      const rows = groups[workspace.id] || [];
      cards.innerHTML = rows.length ? rows.map(taskMarkup).join("") : "<div class=\"board-empty\">目前沒有工作</div>";
      if (count) count.textContent = String(rows.length);
    });
    wireTaskCards();
  }
  function visibleTasks() {
    const query = state.searchQuery.trim().toLocaleLowerCase("zh-TW");
    const activeTasks = state.tasks.filter(task => !isArchiveTask(task));
    if (!query) return activeTasks;
    return activeTasks.filter(task => [task.workCode, task.title, task.summary, task.usageScenario, task.assignee]
      .some(value => String(value || "").toLocaleLowerCase("zh-TW").includes(query)));
  }
  function applySearch(query) {
    state.searchQuery = String(query || "");
    renderTasks(visibleTasks());
    const count = visibleTasks().length;
    const result = document.getElementById("boardSearchCount");
    if (result) result.textContent = state.searchQuery.trim() ? "搜尋「" + state.searchQuery.trim() + "」：找到 " + count + " 筆 TASK" : "顯示目前工作中的正式 TASK";
  }
  function wireSearch() {
    const input = document.getElementById("boardSearch");
    if (!input) return;
    input.oninput = event => applySearch(event.target.value);
    input.onkeydown = event => {
      if (event.key === "Escape") { input.value = ""; applySearch(""); }
    };
  }
  function archiveTasks() {
    const filter = String(state.archiveFilter || "all").toLowerCase();
    const query = state.archiveSearch.trim().toLocaleLowerCase("zh-TW");
    return sortTasksByCode(state.tasks.filter(task => {
      if (!isArchiveTask(task)) return false;
      const status = service.normalizeStatus ? service.normalizeStatus(task.status) : String(task.status || "").toLowerCase();
      if (filter !== "all" && status !== filter) return false;
      if (!query) return true;
      return [task.workCode, task.title, task.summary, task.usageScenario, task.assignee, task.status, task.resolutionReason, task.mergedInto, task.linkedTo]
        .some(value => String(value || "").toLocaleLowerCase("zh-TW").includes(query));
    }));
  }
  function renderArchive() {
    const list = document.getElementById("archiveTaskList");
    const count = document.getElementById("archiveCount");
    if (!list) return;
    const all = state.tasks.filter(task => isArchiveTask(task));
    const rows = archiveTasks();
    if (count) count.textContent = `顯示 ${rows.length} / ${all.length} 筆封存 TASK（唯讀）`;
    list.innerHTML = rows.length
      ? rows.map(task => taskMarkup(task, { readOnly: true })).join("")
      : `<div class="board-empty">${all.length ? "找不到符合條件的封存 TASK。" : "目前沒有封存 TASK。"}</div>`;
    wireTaskCards();
  }
  function openArchiveDrawer() {
    const backdrop = document.getElementById("archiveDrawerBackdrop");
    const drawer = document.getElementById("archiveDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    renderArchive();
    window.setTimeout(() => document.getElementById("archiveSearch")?.focus(), 0);
  }
  function closeArchiveDrawer() {
    const backdrop = document.getElementById("archiveDrawerBackdrop");
    const drawer = document.getElementById("archiveDrawer");
    backdrop?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
  }
  function wireArchiveControls() {
    document.querySelectorAll("[data-archive-close]").forEach(button => {
      button.onclick = closeArchiveDrawer;
    });
    const input = document.getElementById("archiveSearch");
    if (input) {
      input.oninput = event => { state.archiveSearch = String(event.target.value || ""); renderArchive(); };
      input.onkeydown = event => {
        if (event.key === "Escape") { input.value = ""; state.archiveSearch = ""; renderArchive(); }
      };
    }
    const filter = document.getElementById("archiveFilter");
    if (filter) filter.onchange = event => { state.archiveFilter = String(event.target.value || "all"); renderArchive(); };
  }
  function setConnection(taskCount, principleCount, realtime) {
    const label = realtime ? "🟢 已同步" : "🟡 同步中";
    const time = realtime ? dateLabel(new Date()) : "Cloud Read 完成，等待 Realtime";
    const updated = root.ZhugeSharedNavigation?.setSyncStatus?.({
      label,
      time,
      state: realtime ? "synced" : "syncing"
    });
    if (updated) return;
    // Compatibility fallback for older preview shells; the canonical shell
    // above is the only production path.
    const summary = document.getElementById("developerCloudSyncStatus");
    if (summary) {
      const status = summary.querySelector("strong");
      const syncTime = summary.querySelector("time");
      if (status) status.textContent = label;
      if (syncTime) syncTime.textContent = time;
    }
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
  async function moveTaskToWorkspace(task, targetWorkspaceId) {
    const target = state.workspaceById.get(String(targetWorkspaceId || ""));
    if (!task || !target || service.isGovernanceTerminal?.(task)) return;
    if (String(task.workspaceId) === String(target.id)) {
      setBanner("這張卡片已在「" + esc(target.name) + "」，沒有需要保存的變更。", "info");
      return;
    }
    const current = state.workspaceById.get(String(task.workspaceId || ""));
    if (target.key === "done" && current?.key !== "done") {
      const confirmed = typeof window.confirm === "function"
        ? window.confirm("確定將此工作標記為已完工？工作區位置不等於 PM Accepted Product Baseline。")
        : true;
      if (!confirmed) return;
    }
    setBanner("正在將 " + esc(task.workCode || task.title) + " 移動至「" + esc(target.name) + "」…", "loading");
    try {
      await service.moveTaskWorkspace(task.id, target.id, "QJC workspace movement");
      await refreshBoard({ quiet: true });
      setBanner("已移動「" + esc(task.workCode || task.title) + "」至「" + esc(target.name) + "」。工程狀態、負責人與治理紀錄未變更。", "success");
    } catch (error) {
      setBanner("工作區移動失敗：" + esc(error?.message || "正式 Cloud 未接受這次移動；原資料未變更。"), "error");
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
  function hasDragType(event, type) {
    return Array.from(event?.dataTransfer?.types || []).includes(type);
  }
  async function reorderWorkspace(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ordered = state.workspaces.filter(workspace => workspace.active).sort((a, b) => a.sortOrder - b.sortOrder);
    const visible = ordered.filter(isMainBoardWorkspace);
    const draggedIndex = visible.findIndex(workspace => workspace.id === draggedId);
    const targetIndex = visible.findIndex(workspace => workspace.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    const [dragged] = visible.splice(draggedIndex, 1);
    visible.splice(visible.findIndex(workspace => workspace.id === targetId), 0, dragged);
    let visibleIndex = 0;
    const fullOrder = ordered.map(workspace => isMainBoardWorkspace(workspace) ? visible[visibleIndex++] : workspace);
    try {
      setBanner("正在保存工作區排序…", "loading");
      await service.reorderWorkspaces(fullOrder.map(workspace => workspace.id));
      await refreshBoard({ quiet: true });
      setBanner("工作區排序已保存至 Cloud。", "success");
    } catch (error) {
      setBanner("工作區排序失敗：" + esc(error?.message || "正式 Cloud 未接受這次排序；原順序未變更。"), "error");
    }
  }
  function wireWorkspaceControls() {
    document.querySelectorAll("[data-workspace-add]").forEach(button => {
      button.onclick = () => openQuickAdd(button.dataset.workspaceAdd);
    });
    document.querySelectorAll("[data-workspace-rename]").forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        const workspace = state.workspaceById.get(button.dataset.workspaceRename);
        if (!workspace) return;
        const nextName = window.prompt("請輸入新的工作區名稱", workspace.name);
        if (nextName === null || !nextName.trim() || nextName.trim() === workspace.name) return;
        service.renameWorkspace(workspace.id, nextName.trim())
          .then(() => refreshBoard({ quiet: true }))
          .then(() => setBanner("工作區已重新命名並保存至 Cloud。", "success"))
          .catch(error => setBanner("工作區重新命名失敗：" + esc(error?.message || "正式 Cloud 未接受這次命名。"), "error"));
      };
    });
    document.querySelectorAll(".workspace-drag-handle").forEach(handle => {
      handle.ondragstart = event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-zhuge-workspace-id", handle.closest(".process")?.dataset.workspaceId || "");
        handle.closest(".process")?.classList.add("workspace-dragging");
      };
      handle.ondragend = () => handle.closest(".process")?.classList.remove("workspace-dragging");
    });
    document.querySelectorAll(".process").forEach(column => {
      column.ondragover = event => {
        if (!hasDragType(event, "application/x-zhuge-workspace-id")) return;
        event.preventDefault();
        column.classList.add("workspace-dropzone");
      };
      column.ondragleave = () => column.classList.remove("workspace-dropzone");
      column.ondrop = async event => {
        if (!hasDragType(event, "application/x-zhuge-workspace-id")) return;
        event.preventDefault();
        column.classList.remove("workspace-dropzone");
        await reorderWorkspace(event.dataTransfer.getData("application/x-zhuge-workspace-id"), column.dataset.workspaceId);
      };
    });
  }
  function wireTaskCards() {
    wireWorkspaceControls();
    document.querySelectorAll(".taskcard").forEach(card => {
      const task = state.taskById.get(card.dataset.taskId);
      if (!task) return;
      const archiveOnly = isArchiveTask(task);
      card.onclick = () => openTaskDetail(task, { readOnly: archiveOnly });
      card.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTaskDetail(task, { readOnly: archiveOnly }); }
      };
      card.ondragstart = event => {
        if (archiveOnly || service.isGovernanceTerminal?.(task)) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-zhuge-task-id", task.id);
        event.dataTransfer.setData("text/plain", task.id);
        card.classList.add("dragging");
      };
      card.ondragend = () => card.classList.remove("dragging");
    });
    document.querySelectorAll(".process .cards").forEach(zone => {
      zone.ondragover = event => {
        if (!hasDragType(event, "application/x-zhuge-task-id")) return;
        const targetWorkspace = state.workspaceById.get(zone.closest(".process")?.dataset.workspaceId || "");
        if (!targetWorkspace) return;
        event.preventDefault();
        zone.classList.add("dropzone");
      };
      zone.ondragleave = () => zone.classList.remove("dropzone");
      zone.ondrop = async event => {
        if (!hasDragType(event, "application/x-zhuge-task-id")) return;
        event.preventDefault();
        zone.classList.remove("dropzone");
        const task = state.taskById.get(event.dataTransfer.getData("application/x-zhuge-task-id") || event.dataTransfer.getData("text/plain"));
        const targetWorkspaceId = zone.closest(".process")?.dataset.workspaceId;
        if (task && targetWorkspaceId) await moveTaskToWorkspace(task, targetWorkspaceId);
      };
    });
  }

  function wireNavigation() {
    const handlers = {
      board: () => showBoardView("board"),
      principles: () => showBoardView("principles"),
      "system-map": () => showBoardView("system-map"),
      security: () => showBoardView("security")
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
    const canvas = document.querySelector(".workspace-canvas");
    const boardMain = document.querySelector("[data-board-main-view]");
    if (boardMain) boardMain.hidden = view !== "board";
    else if (canvas) canvas.hidden = view !== "board";
    else {
      const boardShell = document.querySelector(".board-shell");
      if (boardShell) boardShell.hidden = view !== "board";
      const toolbar = document.querySelector(".toolbar");
      if (toolbar) toolbar.hidden = view !== "board";
    }
    clearBanner();
  }

  function mountCreatorMfaSettings(context) {
    if (!context?.creator?.getSnapshot?.().is_creator) return;
    const tabs = document.querySelector(".workspace-subnav");
    const main = document.querySelector(".main");
    const content = document.querySelector(".workspace-canvas") || main;
    if (!tabs || !content || document.querySelector('[data-board-nav="security"]')) return;

    const tab = document.createElement("button");
    tab.className = "workspace-tab";
    tab.type = "button";
    tab.title = "敏感模組二次驗證";
    tab.dataset.boardNav = "security";
    tab.textContent = "🔐 安全設定";
    tabs.appendChild(tab);

    const section = document.createElement("section");
    section.className = "board-subview creator-mfa-settings-view";
    section.dataset.boardView = "security";
    section.hidden = true;
    section.innerHTML = `<header class="subview-header"><div><span class="subview-kicker">AI Board／Creator Control</span><h2>🔐 敏感模組二次驗證</h2><p>Google Login、Supabase Session、User UUID、RLS 與 Cloud Data 維持開啟；以下只控制指定模組是否略過 TOTP Challenge。</p></div><span class="subview-source">來源：Supabase Cloud Settings</span></header><div class="creator-mfa-settings-card"><div class="creator-mfa-settings-list" data-creator-mfa-list></div><p class="creator-mfa-settings-note" data-creator-mfa-note>設定只會保存於 Supabase Cloud。</p></div>`;
    content.appendChild(section);

    const moduleLabels = Object.freeze({
      investment: "Investment",
      "ai-board": "AI Board"
    });
    const requiredKey = moduleId => moduleId === "investment" ? "investment_mfa_required" : "ai_board_mfa_required";
    const render = () => {
      const policy = context.security.getMfaPolicy?.() || {};
      const list = section.querySelector("[data-creator-mfa-list]");
      const note = section.querySelector("[data-creator-mfa-note]");
      if (!list) return;
      list.innerHTML = ["investment", "ai-board"].map(moduleId => {
        const required = policy[requiredKey(moduleId)] !== false;
        const label = moduleLabels[moduleId];
        return `<div class="creator-mfa-row" data-mfa-row="${moduleId}"><div><strong>${label}｜Google Authenticator</strong><span class="creator-mfa-status ${required ? "is-on" : "is-off"}" data-mfa-status>${required ? "🟢 二次驗證 ON" : "🟡 二次驗證暫停"}</span></div><label class="creator-mfa-switch"><span class="sr-only">${label} Google Authenticator 二次驗證</span><input type="checkbox" data-mfa-module="${moduleId}" ${required ? "checked" : ""}><span class="creator-mfa-switch-track" aria-hidden="true"></span></label></div>`;
      }).join("");
      if (note) {
        note.textContent = policy.status === "error"
          ? "設定讀取失敗，已依安全預設保持兩個模組 ON。"
          : "設定只會保存於 Supabase Cloud。兩個開關互不連動。";
      }
      list.querySelectorAll("[data-mfa-module]").forEach(input => {
        input.addEventListener("change", async event => {
          const control = event.currentTarget;
          const moduleId = control.dataset.mfaModule;
          const required = control.checked;
          control.disabled = true;
          try {
            await context.security.setMfaRequired({ moduleId, required });
            await context.security.loadMfaPolicy({ force: true });
            render();
          } catch (error) {
            control.checked = !required;
            control.disabled = false;
            if (note) note.textContent = error?.message || "設定寫入失敗，已維持原本狀態。";
          }
        });
      });
    };
    render();
    tab.addEventListener("click", () => showBoardView("security"));
  }
  function ensureTaskDetailModal() {
    if (document.getElementById("taskDetailModal")) return;
    const modal = document.createElement("div");
    modal.id = "taskDetailModal";
    modal.className = "task-detail-modal-host";
    modal.innerHTML = "<div id=\"taskDetailBody\"></div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", event => {
      if (event.target.matches?.("[data-shared-task-drawer-close]")) {
        modal.style.display = "none";
        state.activeTaskId = "";
      }
    });
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
  function isPmAcceptanceItem(item) {
    const identity = `${item?.itemKey || ""} ${item?.label || ""}`.toLowerCase();
    return String(item?.stage || "").toLowerCase() === "qjc" && (item?.itemKey === "pm-acceptance" || /pm[-_ ]?acceptance|pm[-_ ]?qa|驗收/.test(identity));
  }
  function checklistMarkup(item, options = {}) {
    const readOnly = options.readOnly === true;
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
    const pmAcceptanceCanAct = options.allowAcceptanceAction === true && isPmAcceptanceItem(item);
    const controls = readOnly
      ? `<div class="checklist-readonly-note">${esc(options.readOnlyMessage || "封存資料僅供查閱；不可修改 Checklist 或 Evidence。")} </div>`
      : pmAcceptanceCanAct
      ? `<label class="checklist-checkline checklist-qjc-control"><input type="checkbox" class="checklist-check" data-id="${esc(item.id)}"${checked}><span>${item.state === "pass" ? "☑" : "☐"} PM 驗收通過</span></label><button class="btn checklist-evidence-btn" data-id="${esc(item.id)}">補充驗收說明</button><button class="btn checklist-fail-btn" data-id="${esc(item.id)}">退回修正</button>`
      : `<div class="checklist-readonly-note">${isPmAcceptanceItem(item) ? "PM Acceptance 只可透過正式控制路徑操作；" : "Engineering Evidence／系統狀態；"}目前唯讀呈現。</div>`;
    const isActionable = pmAcceptanceCanAct;
    const requirementLabel = isEngineeringReview ? " · 工程紀錄（不列入 QJC 完成 Gate）" : item.required ? " · 必要" : "";
    return `<div class="checklist-item ${isActionable ? "checklist-qjc-item" : "checklist-readonly-item"}" data-checklist-id="${esc(item.id)}"><div class="checklist-main"><div class="checklist-checkline"><span class="checklist-stage-mark" aria-hidden="true">${item.state === "pass" ? "✅" : item.state === "fail" ? "⚠️" : "○"}</span><span><b>${esc(item.label || "未命名驗收項目")}</b><small>負責階段：${esc(stage)} · 目前狀態：${esc(stateLabel)}${requirementLabel}</small></span></div><div class="checklist-question"><strong>我要驗證什麼：</strong>${esc(item.label || "請確認此項目符合需求")}</div><div class="checklist-question"><strong>需要什麼證據：</strong>${esc(expectedEvidence)}</div>${evidence}<div class="checklist-next"><strong>下一步：</strong>${next}</div></div><div class="checklist-actions">${controls}<div class="checklist-state ${item.state === "not_verified" ? "missing" : ""}">${esc(stateLabel)}</div></div></div>`;
  }
  function checklistSummary(items) {
    const gate = completionGateStatus(items);
    if (!gate.hasRequired) return items.some(item => String(item.stage || "").toLowerCase() === "gpt") ? "目前只有 GPT 工程審查紀錄，不列入 QJC 完成 Gate" : "尚未提供正式驗收清單";
    const remaining = gate.required.length - gate.passed.length;
    return "QJC 完成條件 " + gate.passed.length + "/" + gate.required.length + " 已通過" + (gate.failed.length ? " · " + gate.failed.length + " 項需要修正" : remaining ? " · 尚有 " + remaining + " 項待驗證" : "") + " · GPT 工程審查為獨立紀錄";
  }
  function checklistRowsBy(items, predicate) {
    return (Array.isArray(items) ? items : []).filter(item => predicate(item));
  }
  function checklistStatus(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { tone: "missing", label: "未建立正式紀錄", detail: "目前沒有可讀取的 Canonical checklist item。" };
    if (list.some(item => item.state === "fail")) return { tone: "fail", label: "需要修正", detail: "正式紀錄中有未通過項目。" };
    if (list.every(item => item.state === "pass" && (item.evidenceNote || item.evidenceRef))) return { tone: "pass", label: "已完成", detail: `${list.length} 項均已通過並附 Evidence。` };
    if (list.some(item => item.state === "pass")) return { tone: "partial", label: "部分完成", detail: "仍有待驗證項目或 Evidence 尚未補齊。" };
    return { tone: "pending", label: "待驗證", detail: "尚未完成正式驗證。" };
  }
  function isTaskChecklistItem(item) {
    const type = String(item?.checklistType || "").toLowerCase().replace(/_/g, "-");
    return type === "task-checklist" || type === "shared-task-checklist";
  }
  function taskChecklistMarkup(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return "";
    return `<div class="shared-task-checklist-list">${rows.map(item => {
      const mark = item.state === "pass" ? "☑" : item.state === "fail" ? "⚠" : "☐";
      return `<div class="shared-task-checklist-item"><span aria-hidden="true">${mark}</span><strong>${esc(item.label || "未命名項目")}</strong><small>${esc(stateLabels[item.state] || item.state || "待驗")}</small></div>`;
    }).join("")}<small class="shared-task-checklist-note">Task Checklist 是獨立的共用 UX；目前只呈現正式標示為 Task Checklist 的資料。</small></div>`;
  }
  function isRegressionEvidence(item) {
    const identity = `${item?.checklistType || ""} ${item?.itemKey || ""} ${item?.label || ""} ${item?.evidenceNote || ""} ${item?.evidenceRef || ""}`.toLowerCase();
    return String(item?.checklistType || "").toLowerCase() === "batch_regression"
      || /regression|回歸|回归/.test(identity);
  }

  function engineeringVerificationState(items) {
    const all = (Array.isArray(items) ? items : []).filter(item => !isTaskChecklistItem(item) && !isPmAcceptanceItem(item));
    const groups = [
      { label: "Co QA", rows: all.filter(item => String(item.stage || "").toLowerCase() === "co" && !isRegressionEvidence(item)), hint: "Developer QA" },
      { label: "GPT Review", rows: all.filter(item => String(item.stage || "").toLowerCase() === "gpt" && !isRegressionEvidence(item)), hint: "工程審查" },
      { label: "Regression", rows: all.filter(isRegressionEvidence), hint: "回歸驗證" }
    ].map(entry => ({ ...entry, status: checklistStatus(entry.rows) }));
    const completed = groups.filter(entry => entry.status.tone === "pass");
    const failed = groups.filter(entry => entry.status.tone === "fail");
    const incomplete = groups.filter(entry => entry.status.tone !== "pass");
    return Object.freeze({
      groups,
      completed,
      failed,
      incomplete,
      ready: groups.length === 3 && completed.length === 3
    });
  }

  function acceptanceCriteriaItems(task) {
    const raw = String(task?.acceptanceCriteria || "").trim();
    if (!raw) return [];
    return raw.split(/\r?\n+/).map(line => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);
  }

  function acceptanceCriteriaMarkup(task) {
    const criteria = acceptanceCriteriaItems(task);
    if (!criteria.length) return `<div class="pm-acceptance-criteria-missing"><strong>尚未提供正式 Acceptance Criteria</strong><span>目前没有可供 PM 逐项操作驗證的 Canonical 驗收項目；因此不可盲勾 PM Acceptance。</span></div>`;
    return `<div class="pm-acceptance-criteria"><strong>PM Acceptance Criteria（PM 實際要驗證）</strong><ol>${criteria.map(item => `<li>${esc(item)}</li>`).join("")}</ol></div>`;
  }

  function isPmTurn(task) {
    const status = service.normalizeStatus ? service.normalizeStatus(task?.status) : String(task?.status || "").trim().toLowerCase();
    return status === "qa" && String(task?.assignee || "").trim().toUpperCase() === "QJC";
  }

  function pmAttentionMarkup(item, task, verification, reason) {
    const failed = verification?.failed || [];
    const failureSummary = failed.map(entry => entry.label).join("、");
    const action = item
      ? `<div class="pm-acceptance-support"><button class="btn checklist-fail-btn" data-pm-reject="${esc(item.id)}">退回修改</button></div>`
      : "";
    return `<div class="pm-attention-panel" data-pm-attention="true"><strong>⚠️ 需要你的確認</strong><ul><li>發生什麼事：${esc(reason || (failureSummary ? `${failureSummary} 有未通過的正式紀錄。` : "PM 驗收資料尚未完整。"))}</li><li>為什麼需要 PM：目前工程工作已經交到 QJC，需要決定是否退回修正或補正正式驗收資料。</li><li>PM 要決定什麼：${item ? "確認退回修改；完成修正後再重新驗收。" : "先補正正式 Acceptance Criteria／Acceptance Record，暫不進行盲目驗收。"}</li></ul>${action}</div>`;
  }

  function pmAcceptanceMarkup(item, archiveOnly, task, verification) {
    if (archiveOnly || !isPmTurn(task)) return "";
    const criteria = acceptanceCriteriaItems(task);
    if (verification?.failed?.length) return pmAttentionMarkup(item, task, verification);
    if (!verification?.ready) return "";
    if (!item || !criteria.length) {
      return pmAttentionMarkup(item, task, verification, !item
        ? "正式 PM Acceptance Record 尚未建立。"
        : "這張 TASK 尚未提供正式 Acceptance Criteria。"
      );
    }
    if (item.state === "pass") return "";
    const state = stateLabels[item.state] || item.state || "尚未驗證";
    return `<div class="pm-acceptance-panel" data-pm-action="acceptance"><div class="pm-acceptance-context"><strong>現在需要你操作 PM QA</strong><span>工程驗證已完成；請依下列項目完成實機驗證，再做最後決定。</span></div>${acceptanceCriteriaMarkup(task)}<div class="pm-acceptance-action" data-pm-acceptance-id="${esc(item.id)}"><span class="pm-acceptance-state">目前 Acceptance 狀態：${esc(state)}</span><div class="pm-acceptance-support"><button class="btn primary" type="button" data-pm-accept="${esc(item.id)}">驗收通過</button><button class="btn" type="button" data-pm-reject="${esc(item.id)}">退回修改</button></div></div></div>`;
  }
  function activityActionLabel(item) {
    if (item?.activityType === "human_progress_note" || item?.action === "progress_note_created") return "工作進度紀錄";
    const labels = {
      task_created: "建立 TASK",
      workflow_transition: "工程狀態交接",
      workspace_moved: "工作區移動",
      governance_action: "治理決策",
      checklist_item_created: "建立驗收項目",
      checklist_item_updated: "更新驗收項目",
      pm_authorized_artifact_registered: "登記 Artifact",
      pm_authorization_issued: "發出 PM Authorization"
    };
    return labels[item.action] || item.action || "系統活動";
  }
  function activityDetail(item) {
    if (item?.activityType === "human_progress_note" || item?.action === "progress_note_created") {
      return item.note || "（未提供進度內容）";
    }
    if (item.action === "workspace_moved") {
      const from = item.beforeData?.workspace_name || item.beforeData?.workspace_id || "未知工作區";
      const to = item.afterData?.workspace_name || item.afterData?.workspace_id || "未知工作區";
      return `${from} → ${to}`;
    }
    if (item.action === "workflow_transition") {
      const from = item.beforeData?.status || "未知";
      const to = item.afterData?.status || "未知";
      return `工程狀態：${from} → ${to}`;
    }
    return item.note || "保留於正式 Audit Trail。";
  }
  function activityKind(item) {
    if (item?.activityType === "human_progress_note" || item?.action === "progress_note_created") return "human";
    const identity = `${item?.action || ""} ${item?.note || ""}`.toLowerCase();
    if (/acceptance|accepted|驗收/.test(identity)) return "acceptance";
    if (item?.action === "workflow_transition") return "status";
    if (item?.action === "workspace_moved") return "workspace";
    if (item?.entityType === "engineering_checklist_item" || /checklist|evidence|回歸|regression/.test(identity)) return "evidence";
    return "system";
  }
  function activityKindLabel(kind) {
    return ({ status: "Status", workspace: "Workspace Move", evidence: "Evidence", acceptance: "PM Acceptance", system: "System Activity" })[kind] || "System Activity";
  }
  function activityMarkup(activity) {
    const rows = (Array.isArray(activity) ? activity : []).slice().sort((left, right) => (Date.parse(right.timestamp || "") || 0) - (Date.parse(left.timestamp || "") || 0));
    // The adapter still reads the complete canonical activity stream so that
    // Audit / Governance data is never discarded.  The general Task Drawer,
    // however, is a human work-progress surface: System Activity and
    // Workspace Move remain in the canonical source but are not rendered here.
    const humanRows = rows.filter(item => activityKind(item) === "human");
    if (!humanRows.length) return "<div class=\"board-empty\" data-human-progress-empty=\"true\">目前沒有人工工作進度紀錄。</div>";
    return humanRows.map(item => `<article class="task-activity-row shared-task-drawer-activity-row" data-activity-kind="human" data-activity-type="human_progress_note"><div class="task-activity-dot" aria-hidden="true"></div><div><span class="shared-task-drawer-activity-badge">人工工作進度 · Human Progress Note</span><strong>${esc(activityActionLabel(item))}</strong><p>${esc(activityDetail(item)).replace(/\n/g, "<br>")}</p><small>${esc(dateLabel(item.timestamp) || "時間未提供")} · Actor: ${esc(item.actorLabel || "QJC")}</small></div></article>`).join("");
  }
  function humanNotesMarkup(task) {
    // Legacy developer notes remain canonical data, but their engineering
    // wording is not part of the general Task UX. Only an explicit PM-facing
    // note is shown with neutral copy; an empty note has no presentation.
    const developerNote = String(task.developerNotes || "").trim();
    const note = String(task.pmNotes || "").trim();
    void developerNote;
    if (!note) return "";
    return `<section class="task-legacy-notes"><article class="task-human-note shared-task-drawer-activity-row" data-activity-kind="legacy-note"><strong>工作補充</strong><p>${esc(note).replace(/\n/g, "<br>")}</p><small>來源：工作資料</small></article></section>`;
  }
  function progressNoteComposerMarkup(archiveOnly) {
    if (archiveOnly) {
      return `<section class="shared-task-drawer-progress-composer" data-progress-note-write="readonly"><label for="taskProgressNote">新增工作進度...</label><textarea id="taskProgressNote" disabled placeholder="封存資料僅供查閱"></textarea><div><small>封存資料僅供查閱；不可新增、修改或刪除工作進度紀錄。</small><button class="btn" type="button" disabled>新增工作進度</button></div></section>`;
    }
    return `<section class="shared-task-drawer-progress-composer" data-progress-note-write="available"><label for="taskProgressNote">新增工作進度...</label><textarea id="taskProgressNote" placeholder="輸入本次工作進度..."></textarea><div><small>由目前登入的 QJC／owner 身分保存至正式 Cloud；不接受空白內容。</small><button class="btn2 shared-task-progress-submit" id="addTaskProgressNote" type="button">新增工作進度</button></div></section>`;
  }
  function attachmentMarkup(artifacts, error) {
    if (error) return `<div class="task-read-warning">工作附件讀取失敗：${esc(error.message || "未知錯誤")}。</div>`;
    const rows = Array.isArray(artifacts) ? artifacts : [];
    if (!rows.length) return "";
    return `<div class="shared-task-attachment-list" aria-label="附件">${rows.map(item => `<article class="shared-task-attachment"><span class="shared-task-attachment-icon" aria-hidden="true">📎</span><span class="shared-task-attachment-copy"><strong>${esc(item.filename || item.artifactId || "未命名附件")}</strong><small>${esc(item.artifactType || "交付物")} · ${esc(item.productVersion || "版本未提供")} · Build ${esc(item.runtimeBuild || "未提供")}</small></span></article>`).join("")}</div>`;
  }
  function requirementContent(task) {
    const parts = [task.summary, task.problem && task.problem !== task.summary ? task.problem : "", task.objective && task.objective !== task.summary ? task.objective : ""]
      .map(value => String(value || "").trim()).filter(Boolean);
    return [...new Set(parts)].join("\n\n") || "尚未補充需求內容";
  }
  function editableTaskFieldValue(task, field) {
    if (field === "summary") return String(task?.summary || task?.problem || task?.objective || "");
    if (field === "usage_scenario") return String(task?.usageScenario || "");
    return "";
  }
  function editableTaskFieldMarkup(task, field, options = {}) {
    const archiveOnly = options.readOnly === true;
    const label = field === "summary" ? "工作內容" : "使用情境";
    const value = editableTaskFieldValue(task, field);
    const placeholder = field === "summary" ? "尚未補充工作內容" : "尚未補充使用情境";
    const editButton = archiveOnly ? "" : `<button class="btn2 task-inline-edit-button" type="button" data-task-inline-edit="${field}" aria-label="編輯${label}">✏️ 編輯</button>`;
    // Read mode owns the initial markup. The editor is created only after the
    // user explicitly enters edit mode, so a normal Task never renders both
    // display text and a textarea at the same time.
    return `<div class="task-inline-field" data-task-inline-field="${field}" data-task-inline-mode="read"><div class="task-inline-field-toolbar"><span class="task-inline-field-value" data-task-inline-value="${field}">${esc(value || placeholder).replace(/\n/g, "<br>")}</span>${editButton}</div></div>`;
  }
  async function waitForTaskContractUpdate(task, requestId) {
    const deadline = Date.now() + 5 * 60 * 1000;
    const check = async () => {
      if (Date.now() > deadline) {
        setBanner("PM Governance Approval 尚未完成；TASK 尚未更新。請稍後從正式 Cloud 重新讀取。", "info");
        return;
      }
      try {
        const result = await service.taskContractUpdateStatus(requestId);
        if (result.phase === "success") {
          await refreshBoard({ quiet: true });
          const freshTask = state.taskById.get(String(task.id)) || task;
          await openTaskDetail(freshTask, { readOnly: isArchiveTask(freshTask) });
          setBanner("工作內容已經 PM 核准並由正式 board_tasks read-back 確認。", "success");
          return;
        }
        if (["failed", "rejected"].includes(result.phase)) {
          setBanner(result.phase === "rejected" ? "PM 已拒絕這次工作內容更新；原資料未變更。" : "工作內容更新未完成；原資料未變更。", "error");
          return;
        }
        window.setTimeout(check, 1200);
      } catch {
        window.setTimeout(check, 1600);
      }
    };
    window.setTimeout(check, 600);
  }
  function wireTaskInlineEditors(task, archiveOnly) {
    if (archiveOnly) return;
    const body = document.getElementById("taskDetailBody");
    if (!body) return;
    body.querySelectorAll("[data-task-inline-edit]").forEach(button => {
      button.onclick = () => {
        const field = button.dataset.taskInlineEdit;
        const fieldContainer = button.closest("[data-task-inline-field]");
        const value = fieldContainer?.querySelector(`[data-task-inline-value="${field}"]`);
        if (!fieldContainer || !value || fieldContainer.querySelector("[data-task-inline-editor]")) return;
        const label = field === "summary" ? "工作內容" : "使用情境";
        const editor = document.createElement("div");
        editor.className = "task-inline-editor";
        editor.dataset.taskInlineEditor = field;
        editor.innerHTML = `<textarea data-task-inline-input="${field}" aria-label="${label}"></textarea><div class="task-inline-editor-actions"><button class="btn2" type="button" data-task-inline-cancel="${field}">取消</button><button class="btn2 primary" type="button" data-task-inline-save="${field}">送出 PM 核准</button></div><small>儲存會送至既有 PM Governance Approval Runner；未經 PM 核准不會寫入 Cloud。</small>`;
        editor.querySelector("textarea").value = editableTaskFieldValue(task, field);
        fieldContainer.appendChild(editor);
        fieldContainer.dataset.taskInlineMode = "edit";
        value.hidden = true;
        button.hidden = true;
        editor.querySelector("textarea")?.focus();
        wireTaskInlineEditorActions(task, fieldContainer, field);
      };
    });
  }
  function leaveTaskInlineEdit(fieldContainer) {
    if (!fieldContainer) return;
    const editor = fieldContainer.querySelector("[data-task-inline-editor]");
    const value = fieldContainer.querySelector("[data-task-inline-value]");
    const edit = fieldContainer.querySelector("[data-task-inline-edit]");
    editor?.remove();
    if (value) value.hidden = false;
    if (edit) {
      edit.hidden = false;
      edit.disabled = false;
    }
    fieldContainer.dataset.taskInlineMode = "read";
  }
  function wireTaskInlineEditorActions(task, fieldContainer, field) {
    const editor = fieldContainer?.querySelector(`[data-task-inline-editor="${field}"]`);
    if (!editor) return;
    editor.querySelector("[data-task-inline-cancel]")?.addEventListener("click", () => leaveTaskInlineEdit(fieldContainer));
    editor.querySelector("[data-task-inline-save]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const input = editor.querySelector(`[data-task-inline-input="${field}"]`);
      if (!input) return;
      const runnerUrl = root.ZhugeGovernanceApprovalRunnerUrl || "http://127.0.0.1:8765";
      window.open?.(`${runnerUrl}/`, "zhuge-ai-os-governance-approval");
      button.disabled = true;
      try {
        const request = await service.requestTaskContractUpdate({ taskId: task.id, [field]: input.value });
        leaveTaskInlineEdit(fieldContainer);
        setBanner("工作內容更新已送至 PM Governance Approval；PM 核准前原資料維持不變。", "info");
        waitForTaskContractUpdate(task, request.requestId);
      } catch (error) {
        button.disabled = false;
        setBanner("工作內容更新未送出：" + esc(error?.message || "PM Governance Runner 未啟動產品更新模式。"), "error");
      }
    });
  }
  function wireProgressNoteComposer(task, archiveOnly) {
    if (archiveOnly) return;
    const textarea = document.getElementById("taskProgressNote");
    const button = document.getElementById("addTaskProgressNote");
    if (!textarea || !button) return;
    const submit = async () => {
      const note = textarea.value.trim();
      if (!note) {
        setBanner("請輸入工作進度內容。", "error");
        textarea.focus();
        return;
      }
      button.disabled = true;
      try {
        await service.addTaskProgressNote(task.id, note);
        await openTaskDetail(task, { readOnly: archiveOnly });
        setBanner("工作進度已保存至正式 Cloud。", "success");
      } catch (error) {
        setBanner("工作進度保存失敗：" + esc(error?.message || "正式 Cloud 未接受這次寫入。"), "error");
        button.disabled = false;
      }
    };
    button.onclick = submit;
    textarea.onkeydown = event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
  }
  async function openTaskDetail(task, options = {}) {
    ensureTaskDetailModal();
    const modal = document.getElementById("taskDetailModal");
    const body = document.getElementById("taskDetailBody");
    const archiveOnly = options.readOnly === true || isArchiveTask(task);
    state.activeTaskId = String(task?.id || "");
    const drawer = root.ZhugeSharedTaskDrawer;
    const title = `${task.workCode || "TASK"}｜${task.title || "未命名 TASK"}`;
    const properties = [
      { key: "workspace", icon: "📍", label: "工作區", value: workspaceLabel(task) },
      { key: "status", icon: "◉", label: "目前狀態", value: readableWorkStatus(task) },
      { key: "assignee", icon: "👤", label: "負責人", value: String(task.assignee || "").trim() || "尚未指派" },
      priorityLabel(task.priority) ? { key: "priority", icon: "⚑", label: "優先度", value: priorityLabel(task.priority) } : null,
      archiveOnly ? { key: "mode", icon: "📦", label: "模式", value: "封存（唯讀）" } : null
    ].filter(Boolean);
    const sections = [
      { id: "requirements", title: "工作內容", className: "task-detail-section task-detail-requirement", html: editableTaskFieldMarkup(task, "summary", { readOnly: archiveOnly }) },
      { id: "usage", title: "使用情境", className: "task-detail-section", html: editableTaskFieldMarkup(task, "usage_scenario", { readOnly: archiveOnly }) },
      { id: "task-checklist", title: "☑️ Task Checklist", hint: "Shared Checklist（有正式資料時顯示）", className: "task-checklist-section", hidden: true, html: `<div id="taskChecklistRows"></div>` },
      { id: "pm-acceptance", title: "🙋 需要你的操作", hint: "只在真正輪到 PM 時顯示", className: "pm-acceptance-section", hidden: true, html: `<div id="pmAcceptanceAction"></div>` },
      { id: "attachments", title: "📎 附件", hint: "有正式附件／交付物時顯示", className: "task-attachments-section", hidden: true, html: `<div id="taskAttachments"></div>` }
    ];
    if (drawer?.render) {
      body.innerHTML = drawer.render({
        title,
        subtitle: archiveOnly ? "AI Board · 📦 Archive Read-only" : "AI Board · Shared Task Drawer",
        properties,
        sections,
        readOnly: archiveOnly,
        activity: {
          title: "💬 工作進度紀錄",
          hint: "只顯示人工工作進度；System Activity 與 Workspace Audit 保留於正式紀錄",
          composerHtml: progressNoteComposerMarkup(archiveOnly),
          notesHtml: `<div id="taskHumanNotes"><div class="board-empty">讀取中…</div></div>`,
          html: "<div id=\"taskActivityList\"><div class=\"board-empty\">讀取中…</div></div>"
        },
        footerHtml: ""
      });
    } else {
      body.innerHTML = "<div class=\"board-empty\">Shared Task Drawer foundation 尚未載入；未執行任何 Cloud 寫入。</div>";
    }
    modal.style.display = "block";
    body.querySelectorAll("[data-governance]").forEach(button => { button.onclick = () => applyGovernanceAction(task, button.dataset.governance); });
    try {
      const items = await service.loadChecklist(task.id);
      const taskChecklistItems = items.filter(isTaskChecklistItem);
      const taskChecklistSection = body.querySelector('[data-shared-task-drawer-section="task-checklist"]');
      if (taskChecklistSection) taskChecklistSection.hidden = taskChecklistItems.length === 0;
      const taskChecklistRows = document.getElementById("taskChecklistRows");
      if (taskChecklistRows) taskChecklistRows.innerHTML = taskChecklistMarkup(taskChecklistItems);
      const verification = engineeringVerificationState(items);
      const pmAcceptanceItem = items.find(isPmAcceptanceItem);
      const pmAcceptanceAction = document.getElementById("pmAcceptanceAction");
      const pmMarkup = pmAcceptanceMarkup(pmAcceptanceItem, archiveOnly, task, verification);
      const pmAcceptanceSection = body.querySelector('[data-shared-task-drawer-section="pm-acceptance"]');
      if (pmAcceptanceSection) pmAcceptanceSection.hidden = !pmMarkup;
      if (pmAcceptanceAction) pmAcceptanceAction.innerHTML = pmMarkup;
      const [activityResult, artifactResult] = await Promise.allSettled([
        typeof service.loadActivity === "function" ? service.loadActivity(task.id, { checklistItems: items }) : Promise.resolve([]),
        typeof service.loadArtifacts === "function" ? service.loadArtifacts(task) : Promise.resolve([])
      ]);
      const activity = activityResult.status === "fulfilled" ? activityResult.value : [];
      const artifacts = artifactResult.status === "fulfilled" ? artifactResult.value : [];
      const attachmentSection = body.querySelector('[data-shared-task-drawer-section="attachments"]');
      const attachmentZone = document.getElementById("taskAttachments");
      const attachmentHtml = attachmentMarkup(artifacts, artifactResult.status === "rejected" ? artifactResult.reason : null);
      if (attachmentZone) attachmentZone.innerHTML = attachmentHtml;
      if (attachmentSection) attachmentSection.hidden = !attachmentHtml;
      const humanNotes = humanNotesMarkup(task);
      const humanNotesZone = document.getElementById("taskHumanNotes");
      if (humanNotesZone) {
        humanNotesZone.innerHTML = humanNotes;
        humanNotesZone.hidden = !humanNotes;
      }
      document.getElementById("taskActivityList").innerHTML = activityMarkup(activity);
      wireTaskInlineEditors(task, archiveOnly);
      wireProgressNoteComposer(task, archiveOnly);
      const acceptance = document.getElementById("pmAcceptanceAction");
      if (!archiveOnly && acceptance) {
        acceptance.querySelectorAll("[data-pm-accept]").forEach(button => {
          button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.pmAccept), "pass");
        });
        acceptance.querySelectorAll("[data-pm-reject]").forEach(button => {
          button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.pmReject), "fail");
        });
      }
    } catch (error) {
      const pmAcceptanceSection = body.querySelector('[data-shared-task-drawer-section="pm-acceptance"]');
      if (pmAcceptanceSection) pmAcceptanceSection.hidden = true;
      document.getElementById("taskActivityList").innerHTML = "<div class=\"task-read-warning\">進度與治理讀取未完成；沒有寫入任何資料。</div>";
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
    const input = document.getElementById("workspaceName");
    if (input) {
      input.value = "";
      window.setTimeout(() => input.focus(), 0);
    }
  }
  function closeWorkspaceDrawer() {
    const backdrop = document.getElementById("workspaceCreateDrawerBackdrop");
    const drawer = document.getElementById("workspaceCreateDrawer");
    backdrop?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
  }
  async function createWorkspace() {
    const input = document.getElementById("workspaceName");
    const name = input?.value?.trim() || "";
    if (!name) {
      setBanner("請輸入工作區名稱。", "error");
      input?.focus();
      return;
    }
    const button = document.querySelector("[data-workspace-create]");
    if (button) button.disabled = true;
    try {
      await service.createWorkspace(name);
      closeWorkspaceDrawer();
      await refreshBoard({ quiet: true });
      setBanner("工作區「" + esc(name) + "」已建立並保存至 Cloud。", "success");
    } catch (error) {
      setBanner("工作區建立失敗：" + esc(error?.message || "正式 Cloud 未接受這次建立。"), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }
  function renderBoardHeaderActions() {
    const actions = document.querySelector("[data-zhuge-shared-header='true'] .zhuge-shared-header-actions");
    if (!actions) return;
    actions.innerHTML = `<button class="btn primary board-header-action" type="button" data-board-create-card>＋ 卡片</button><button class="btn board-header-action" type="button" data-board-create-workspace>＋ 工作區</button><button class="btn board-header-action" type="button" data-board-open-archive>📦 封存</button><button class="btn board-header-refresh" id="refreshBoardBtn" type="button" aria-label="重新整理" title="重新整理">↻</button>`;
    actions.querySelector("[data-board-create-card]")?.addEventListener("click", () => openQuickAdd("todo"));
    actions.querySelector("[data-board-create-workspace]")?.addEventListener("click", openWorkspaceDrawer);
    actions.querySelector("[data-board-open-archive]")?.addEventListener("click", openArchiveDrawer);
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
    if (!options.quiet) clearBanner();
    state.refreshPromise = service.load().then(result => {
      state.workspaces = result.workspaces || [];
      state.tasks = result.tasks;
      state.principles = result.principles;
      state.systemMaps = result.systemMaps || [];
      state.taskById = new Map(result.tasks.map(task => [task.id, task]));
      state.workspaceById = new Map(state.workspaces.map(workspace => [workspace.id, workspace]));
      renderPrinciples(result.principles);
      renderSystemMaps(state.systemMaps);
      renderTasks(visibleTasks());
      if (document.getElementById("archiveDrawer")?.classList.contains("is-open")) renderArchive();
      setConnection(result.tasks.length, result.principles.length, !!state.stopRealtime);
      if (result.engineeringMemoryFailures?.length) {
        const failures = result.engineeringMemoryFailures.map(item => `${esc(item.knowledgeCode || "Engineering Principle")} | ${esc(item.reason)}`).join("；");
        setBanner("Canonical Retrieval Failed：" + failures + "。未使用舊文件或舊 Context fallback。", "error");
      } else if (document.getElementById("boardReadStatus")?.dataset.state === "loading") {
        clearBanner();
      }
      return result;
    }).catch(error => {
      const loginLink = "../../../?app=1";
      const message = error && error.code === "BOARD_SESSION_REQUIRED" ? "請先登入 Zhuge AI OS，再開啟 AI Board。<a href=\"" + loginLink + "\">前往登入</a>" : "正式 Cloud Read 失敗：" + esc(error && error.message || "未知錯誤") + "。請重新整理或確認 Shared Session。";
      setBanner(message, "error");
      root.ZhugeSharedNavigation?.setSyncStatus?.({ label: "🔴 同步失敗", time: "請重新整理", state: "error" });
      throw error;
    }).finally(() => { state.refreshPromise = null; });
    return state.refreshPromise;
  }
  function initRealtime() {
    service.subscribe(() => {
      if (state.realtimeTimer) clearTimeout(state.realtimeTimer);
      state.realtimeTimer = setTimeout(() => {
        refreshBoard({ quiet: true }).then(() => {
          const modal = document.getElementById("taskDetailModal");
          const activeTask = state.activeTaskId ? state.taskById.get(state.activeTaskId) : null;
          if (modal?.style.display === "block" && activeTask) {
            return openTaskDetail(activeTask, { readOnly: isArchiveTask(activeTask) });
          }
          return null;
        }).catch(() => {});
      }, 160);
    }).then(stop => {
      state.stopRealtime = stop;
      setConnection(state.tasks.length, state.principles.length, true);
    }).catch(error => setBanner("Realtime 尚未連線：" + esc(error && error.message || "未知錯誤") + "。Refresh 可作為暫時 Recovery。", "error"));
  }
  function enableBoardActions() {
    renderBoardHeaderActions();
    wireArchiveControls();
    document.querySelectorAll("[data-workspace-drawer-close]").forEach(button => button.addEventListener("click", closeWorkspaceDrawer));
    document.querySelector("[data-workspace-create]")?.addEventListener("click", createWorkspace);
    document.getElementById("workspaceName")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); createWorkspace(); }
    });
    document.querySelector("#addCardModal .x")?.addEventListener("click", closeQuickAdd);
    document.querySelector("#addCardModal .modalfoot .btn:not(.primary)")?.addEventListener("click", closeQuickAdd);
    document.querySelectorAll(".add").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
  function startBoardRuntime() {
    const shell = document.querySelector(".zhuge-module-shell");
    document.querySelectorAll("[data-toggle-sidebar]").forEach(button => {
      button.onclick = () => shell?.classList.toggle("sidebar-open");
    });
    document.querySelectorAll("[data-close-sidebar]").forEach(button => {
      button.onclick = () => shell?.classList.remove("sidebar-open");
    });
    mountCreatorMfaSettings(accessContext);
    enableBoardActions();
    ensureHealthModal();
    document.getElementById("healthCheckBtn")?.addEventListener("click", runHealthCheck);
    ensureTaskDetailModal();
    wireNavigation();
    wireSearch();
    renderPrinciples([]);
    renderSystemMaps([]);
    renderTasks([]);
    root.openQuickAdd = openQuickAdd;
    root.createCard = createCard;
    root.createWorkspace = createWorkspace;
    root.openArchiveDrawer = openArchiveDrawer;
    const initialView = new URLSearchParams(root.location.search).get("view");
    if (["principles", "system-map"].includes(initialView)) {
      const nav = document.querySelector(`[data-board-nav="${initialView}"]`);
      nav?.click();
    } else showBoardView("board");
    refreshBoard().then(initRealtime).catch(() => {});
  }

  let originalMainMarkup = null;
  let accessContext = null;

  function captureBoardMarkup() {
    const main = document.querySelector(".main");
    if (main && originalMainMarkup === null) {
      // The shared shell may already have rendered the header by the time the
      // board gate runs. Mark it as mounted so restoring the board does not
      // remount it with the generic fallback title.
      main.querySelector("[data-zhuge-shared-header]")?.setAttribute("data-mounted", "true");
      originalMainMarkup = main.innerHTML;
    }
  }

  function sharedHeaderMarkup() {
    const header = document.querySelector(".main [data-zhuge-shared-header]");
    if (!header) return "";
    const clone = header.cloneNode(true);
    clone.setAttribute("data-mounted", "true");
    clone.querySelector(".zhuge-shared-header-actions")?.remove();
    return clone.outerHTML;
  }

  function renderAccessState({ title, message, kind = "info", body = "", panelClass = "" } = {}) {
    const main = document.querySelector(".main");
    if (!main) return;
    main.innerHTML = `${sharedHeaderMarkup()}<section class="board-access-state" data-state="${esc(kind)}">
      <div class="board-access-panel ${esc(panelClass)}">
        <div class="board-access-eyebrow">AI BOARD · 工程治理工作區</div>
        <h2>${esc(title || "AI Board")}</h2>
        <p class="board-access-message">${esc(message || "")}</p>
        ${body}
      </div>
    </section>`;
  }

  function renderLoginState() {
    renderAccessState({
      title: "請先登入 AI Board",
      message: "AI Board 包含工程治理、GPT 審查與 Co 協作資料，請先登入 Zhuge AI OS。",
      kind: "login",
      body: `<div class="board-access-actions"><a class="btn primary" href="../../../?app=1">前往登入</a><a class="btn" href="../../../app/dashboard/">回到 Dashboard</a></div>`
    });
  }

  function renderAccessError(message) {
    renderAccessState({
      title: "目前無法開啟 AI Board",
      message,
      kind: "error",
      body: `<div class="board-access-actions"><a class="btn" href="../../../app/dashboard/">回到 Dashboard</a><button class="btn" type="button" id="boardAccessRetry">重新檢查</button></div>`
    });
    document.getElementById("boardAccessRetry")?.addEventListener("click", () => init());
  }

  function restoreBoardMarkup() {
    const main = document.querySelector(".main");
    if (!main || originalMainMarkup === null) return;
    main.innerHTML = originalMainMarkup;
    startBoardRuntime();
  }

  function renderMfaUnlock(context, access) {
    const state = { mode: "loading", factorId: "", qrCode: "", secret: "", error: "", busy: false };
    const paint = () => {
      const error = state.error ? `<div class="board-access-error" role="alert">${esc(state.error)}</div>` : "";
      let body = `<div class="zhuge-mfa-info"><strong>AI Board 需要額外保護</strong><span>完成安全驗證後即可進入工程治理工作區；驗證只會解鎖目前帳號的 AI Board，不會變更登入身份。</span></div>${error}`;
      if (state.mode === "loading") {
        body += `<div class="board-access-progress" role="status">正在檢查安全驗證…</div>`;
      } else if (state.mode === "enrollment_required") {
        body += `<div class="board-access-actions"><button class="btn primary" type="button" id="boardMfaEnroll" ${state.busy ? "disabled" : ""}>開始設定驗證器</button></div>`;
      } else {
        const qr = state.qrCode ? `<div class="zhuge-mfa-qr"><img src="${esc(state.qrCode)}" alt="Google Authenticator 設定 QR Code"><p>用 Google Authenticator 掃描此 QR Code</p>${state.secret ? `<details class="board-access-secret zhuge-mfa-secret"><summary>無法掃描？查看設定金鑰</summary><code>${esc(state.secret)}</code></details>` : ""}</div>` : "";
        body += `<div class="zhuge-mfa-grid">${qr}<div class="zhuge-mfa-step"><div class="zhuge-mfa-info"><strong>完成安全驗證</strong><span>掃描後，輸入 App 顯示的 6 位數驗證碼。QR Code 只用於設定驗證器，不會取代 Google 登入。</span></div><form class="board-access-form zhuge-mfa-form" id="boardMfaForm">
          <label for="boardMfaCode">驗證碼</label>
          <input class="zhuge-mfa-code" id="boardMfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="輸入 6 位數驗證碼" required>
          <button class="btn primary" type="submit" ${state.busy ? "disabled" : ""}>驗證並進入</button>
        </form></div></div>`;
      }
      renderAccessState({ title: "安全驗證", message: "這是受保護的工程治理工作區。", kind: "mfa", body, panelClass: "zhuge-mfa-panel" });
      document.getElementById("boardMfaEnroll")?.addEventListener("click", async () => {
        state.busy = true; state.error = ""; paint();
        try {
          const result = await context.security.enrollTotp();
          state.mode = "enroll"; state.factorId = result.factorId || ""; state.qrCode = result.qrCode || ""; state.secret = result.secret || "";
        } catch (error) {
          state.error = error?.message || "無法開始設定驗證器，請稍後再試。";
        } finally { state.busy = false; paint(); }
      });
      document.getElementById("boardMfaForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const code = document.getElementById("boardMfaCode")?.value || "";
        state.busy = true; state.error = ""; paint();
        try {
          await context.security.verifyUnlock({ factorId: state.factorId, code });
          restoreBoardMarkup();
        } catch (error) {
          state.error = error?.message || "驗證失敗，請確認驗證碼後再試。";
          state.busy = false; paint();
        }
      });
    };
    paint();
    Promise.resolve().then(async () => {
      try {
        const prepared = await context.security.prepareUnlock();
        state.mode = prepared.mode || "enrollment_required";
        state.factorId = prepared.factorId || "";
        state.qrCode = prepared.qrCode || "";
        state.secret = prepared.secret || "";
      } catch (error) {
        state.mode = "enrollment_required";
        state.error = error?.message || "無法檢查驗證器狀態，請稍後再試。";
      }
      paint();
    });
  }

  async function init() {
    captureBoardMarkup();
    const provider = root.ZhugeRuntimeSessionProvider;
    if (!provider?.createPlatform) {
      renderAccessError("安全服務尚未準備完成，請重新整理後再試。\n");
      return;
    }
    let context;
    try {
      const platform = provider.createPlatform();
      context = platform.forModule("ai-board");
      accessContext = context;
      await context.creator?.resolve?.();
      await context.security.loadMfaPolicy?.();
    } catch (error) {
      renderAccessError(error?.message || "安全服務初始化失敗。\n");
      return;
    }
    const access = context.security.evaluate("view");
    if (access.allowed) {
      startBoardRuntime();
      return;
    }
    const session = context.session.getSnapshot();
    if (!session.isAuthenticated || access.code === "SESSION_REQUIRED" || access.code === "SESSION_EXPIRED") {
      renderLoginState();
      return;
    }
    if (["STEP_UP_REQUIRED", "MODULE_LOCKED"].includes(access.code)) {
      renderMfaUnlock(context, access);
      return;
    }
    renderAccessError(access.code === "CAPABILITY_REQUIRED" ? "目前登入帳號沒有 AI Board 管理權限。" : "目前帳號尚未通過 AI Board 安全檢查。\n");
  }
  root.ZhugeBoardRuntime = Object.freeze({ refresh: refreshBoard, openTaskDetail: openTaskDetail, moveTaskToWorkspace: moveTaskToWorkspace, sortTasksByCode: sortTasksByCode, completionGateStatus: completionGateStatus, completionGateMessage: completionGateMessage });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
