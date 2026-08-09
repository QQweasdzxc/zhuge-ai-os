/* AI Board operational runtime: Shared Identity, controlled RPC writes,
 * structured Checklist evidence, and authenticated Supabase Realtime. */
(function (root) {
  "use strict";
  const service = root.ZhugeBoardReadService;
  if (!service) return;
  const state = { tasks: [], principles: [], taskById: new Map(), stopRealtime: null, refreshPromise: null, realtimeTimer: null };
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
    return (service.STATUS_WORKSPACES.find(item => item.key === status) || {}).label || "待辦";
  }
  function assigneeLabel(value) {
    const raw = String(value || "").trim();
    return raw ? "目前：" + raw : "尚未指派";
  }
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
    return "<article class=\"card taskcard board-cloud-card\" data-task-id=\"" + esc(task.id) + "\" data-work-code=\"" + esc(task.workCode) + "\" tabindex=\"0\" draggable=\"true\">" +
      "<div class=\"code\">" + esc(task.workCode || task.id || "TASK") + "</div>" +
      "<h3>" + esc(task.title) + "</h3>" +
      (task.summary ? "<p>" + esc(task.summary) + "</p>" : "") +
      "<div class=\"meta\"><span class=\"tag status-tag\">" + esc(statusLabel(task.status)) + "</span>" +
      (task.assignee ? "<span class=\"tag qjc\">" + esc(assigneeLabel(task.assignee)) + "</span>" : "<span class=\"tag\">尚未指派</span>") +
      (priority ? "<span class=\"tag " + priorityClass + "\">" + esc(priority) + "</span>" : "") +
      (timestamp ? "<span class=\"tag\">" + esc(timestamp) + "</span>" : "") +
      "</div><div class=\"card-action-hint\">點擊查看 Checklist／Evidence · 拖曳交接流程</div></article>";
  }
  function principleMarkup(principle) {
    return "<div class=\"card rule board-cloud-card\" data-knowledge-code=\"" + esc(principle.code) + "\">" +
      "<div class=\"code\">" + esc(principle.code || "PRINCIPLE") + "</div><h3>" + esc(principle.title) + "</h3>" +
      (principle.summary ? "<p>" + esc(principle.summary) + "</p>" : "") +
      "<div class=\"meta\"><span class=\"tag rule-tag\">最高原則</span>" +
      (principle.version ? "<span class=\"tag\">v" + esc(principle.version) + "</span>" : "") + "</div></div>";
  }
  function renderPrinciples(principles) {
    const zone = document.querySelector(".principles .cards");
    const count = document.querySelector(".principles .count");
    if (!zone) return;
    zone.replaceChildren();
    zone.innerHTML = principles.length ? principles.map(principleMarkup).join("") : "<div class=\"board-empty\">目前沒有可讀取的已核准最高原則。</div>";
    if (count) count.textContent = String(principles.length);
  }
  function renderTasks(tasks) {
    const groups = Object.fromEntries(service.STATUS_WORKSPACES.map(workspace => [workspace.uiKey, []]));
    tasks.forEach(task => {
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
    wireTaskCards();
  }
  function setConnection(taskCount, principleCount, realtime) {
    const foot = document.querySelector(".sidefoot");
    if (foot) foot.innerHTML = "● Supabase 已連線<br><br>正式 Cloud Read／Write<br>" +
      taskCount + " 筆 TASK · " + principleCount + " 條原則<br>" +
      (realtime ? "Realtime 已訂閱" : "Realtime 連線中");
  }
  function transitionFor(status, targetUiKey) {
    const map = {
      ready: { progress: ["inprogress", "Co"] },
      inprogress: { qa: ["qa", "GPT"], progress: ["inprogress", "Co"] },
      qa: { done: ["done", "QJC"], progress: ["inprogress", "Co"], qa: ["qa", "QJC"] },
      done: {}
    };
    const row = map[status] && map[status][targetUiKey];
    return row ? { status: row[0], assignee: row[1] } : null;
  }
  async function transitionTask(task, targetUiKey) {
    const transition = transitionFor(task.status, targetUiKey);
    if (!transition) {
      setBanner("此狀態不允許直接跳轉，請依目前接球流程逐步交接。", "error");
      return;
    }
    setBanner("正在將 " + esc(task.workCode || task.title) + " 交接至 " + esc(transition.assignee) + "…", "loading");
    try {
      await service.transitionTask(task.id, transition.status, transition.assignee, "AI Board drag handoff");
      await refreshBoard({ quiet: true });
      setBanner("已完成交接：" + esc(task.workCode || task.title) + " → " + esc(transition.assignee) + "。", "success");
    } catch (error) {
      setBanner("交接失敗：" + esc(error && error.message || "未知錯誤") + "。資料未變更。", "error");
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
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
        card.classList.add("dragging");
      };
      card.ondragend = () => card.classList.remove("dragging");
    });
    document.querySelectorAll(".process .cards").forEach(zone => {
      zone.ondragover = event => { event.preventDefault(); zone.classList.add("dropzone"); };
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
  function checklistMarkup(item) {
    const labels = { not_verified: "未驗證", pass: "PASS", fail: "FAIL", na: "N/A" };
    return "<div class=\"checklist-item\" data-checklist-id=\"" + esc(item.id) + "\"><div><b>" + esc(item.label) +
      "</b><small>" + esc(item.stage.toUpperCase()) + " · " + esc(labels[item.state] || item.state) +
      (item.required ? " · 必要" : "") + "</small></div><button class=\"btn checklist-edit\" data-id=\"" + esc(item.id) + "\">更新</button></div>";
  }
  async function openTaskDetail(task) {
    ensureTaskDetailModal();
    const modal = document.getElementById("taskDetailModal");
    const body = document.getElementById("taskDetailBody");
    document.getElementById("taskDetailTitle").textContent = (task.workCode || "TASK") + "｜" + task.title;
    body.innerHTML = "<div class=\"task-detail-meta\"><span>" + esc(statusLabel(task.status)) + "</span><span>" +
      esc(assigneeLabel(task.assignee)) + "</span></div><p>" + esc(task.summary || "尚無摘要") +
      "</p><div class=\"checklist-section\"><div class=\"checklist-heading\"><h3>Development Contract／QA Evidence</h3>" +
      "<button class=\"btn\" id=\"addChecklistBtn\">＋ 新增項目</button></div><div id=\"checklistRows\"><div class=\"board-empty\">讀取 Checklist…</div></div></div>" +
      "<div class=\"transition-actions\" id=\"taskTransitionActions\"></div>";
    modal.style.display = "grid";
    document.getElementById("addChecklistBtn").onclick = () => addChecklistItem(task);
    const actions = document.getElementById("taskTransitionActions");
    const actionMap = { ready: ["progress"], inprogress: ["qa"], qa: ["progress", "qa", "done"] };
    (actionMap[task.status] || []).forEach(target => {
      const transition = transitionFor(task.status, target);
      if (!transition) return;
      const button = document.createElement("button");
      button.className = "btn primary";
      button.textContent = "交接至 " + transition.assignee;
      button.onclick = async () => { await transitionTask(task, target); modal.style.display = "none"; };
      actions.appendChild(button);
    });
    try {
      const items = await service.loadChecklist(task.id);
      const rows = document.getElementById("checklistRows");
      rows.innerHTML = items.length ? items.map(checklistMarkup).join("") : "<div class=\"board-empty\">尚無 Checklist。可由 QJC 建立驗收項目。</div>";
      rows.querySelectorAll(".checklist-edit").forEach(button => {
        button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.id));
      });
    } catch (error) {
      document.getElementById("checklistRows").innerHTML = "<div class=\"board-empty\">Checklist 讀取失敗：" + esc(error && error.message || "未知錯誤") + "</div>";
    }
  }
  async function addChecklistItem(task) {
    const label = window.prompt("Checklist 項目內容");
    if (!label || !label.trim()) return;
    const stage = (window.prompt("Stage：co / gpt / qjc", "qjc") || "").trim().toLowerCase();
    if (["co", "gpt", "qjc"].indexOf(stage) < 0) { setBanner("Stage 必須是 co、gpt 或 qjc。", "error"); return; }
    try {
      await service.createChecklistItem({ taskId: task.id, checklistType: "task_acceptance", stage: stage, itemKey: "item-" + Date.now(), label: label.trim() });
      await openTaskDetail(task);
      setBanner("Checklist 項目已建立。", "success");
    } catch (error) { setBanner("Checklist 建立失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function updateChecklistItem(task, item) {
    if (!item) return;
    const nextState = (window.prompt("狀態：not_verified / pass / fail / na", item.state) || "").trim();
    if (["not_verified", "pass", "fail", "na"].indexOf(nextState) < 0) { setBanner("Checklist 狀態不合法。", "error"); return; }
    const note = window.prompt("Evidence／Note（可留空）", item.evidenceNote || "");
    try {
      await service.updateChecklistItem({ id: item.id, state: nextState, evidenceNote: note || "" });
      await openTaskDetail(task);
      setBanner("Checklist Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  function openQuickAdd(workspace) {
    const modal = document.getElementById("addCardModal");
    if (!modal) return;
    if (workspace === "principles") { setBanner("最高原則需透過 Engineering Knowledge 管理，不可由 TASK 新增。", "error"); return; }
    modal.style.display = "grid";
    const select = document.getElementById("workspaceSelect");
    if (select) select.value = workspace === "progress" ? "progress" : workspace === "qa" ? "qa" : workspace === "done" ? "done" : "todo";
  }
  async function createCard() {
    const modal = document.getElementById("addCardModal");
    const fields = modal ? Array.from(modal.querySelectorAll("input, textarea")) : [];
    const summary = fields[0]?.value?.trim() || "";
    const title = fields[1]?.value?.trim() || summary.slice(0, 80);
    if (!title) { setBanner("請輸入 Task 標題或內容。", "error"); return; }
    try {
      await service.createTask({ title: title, summary: summary });
      modal.style.display = "none";
      fields.forEach(field => { field.value = ""; });
      await refreshBoard({ quiet: true });
      setBanner("TASK 已建立並進入待辦，由 Co 接球。", "success");
    } catch (error) { setBanner("TASK 建立失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  function addWorkspace() {
    setBanner("固定四階段工作區已啟用；自訂工作區管理尚未納入本次 Batch。", "info");
  }
  async function refreshBoard(options) {
    options = options || {};
    if (state.refreshPromise) return state.refreshPromise;
    if (!options.quiet) setBanner("正在透過 Shared Supabase Gateway 讀取正式 TASK 與最高原則…", "loading");
    state.refreshPromise = service.load().then(result => {
      state.tasks = result.tasks;
      state.principles = result.principles;
      state.taskById = new Map(result.tasks.map(task => [task.id, task]));
      renderPrinciples(result.principles);
      renderTasks(result.tasks);
      setConnection(result.tasks.length, result.principles.length, !!state.stopRealtime);
      if (!options.quiet) setBanner("已讀取 " + result.tasks.length + " 筆正式 Cloud TASK、" + result.principles.length + " 條已核准原則。<strong>QJC 可操作；GPT／Co 由受控工程服務交接。</strong>", "success");
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
    const refresh = document.querySelector(".actions .btn:not(.primary)");
    if (refresh) { refresh.id = "refreshBoardBtn"; refresh.onclick = () => refreshBoard(); }
    const topAction = document.querySelector(".actions .btn.primary");
    if (topAction) {
      topAction.textContent = "QJC 可操作模式";
      topAction.disabled = false;
      topAction.removeAttribute("aria-disabled");
      topAction.title = "QJC 使用受控 Transition／Checklist RPC；GPT／Co 由服務路徑交接。";
    }
    document.querySelectorAll(".add").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
    document.querySelectorAll(".addcol").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
  function init() {
    enableBoardActions();
    ensureTaskDetailModal();
    renderPrinciples([]);
    renderTasks([]);
    const note = document.querySelector(".note");
    if (note) note.innerHTML = "正式 Board 以 Supabase 為唯一 TASK 來源。QJC 使用 authenticated Shared Identity；GPT／Co 使用受控 Engineering Service。Status、Assignee、Checklist 變更均留下 Activity Audit。";
    root.openQuickAdd = openQuickAdd;
    root.createCard = createCard;
    root.addWorkspace = addWorkspace;
    refreshBoard().then(initRealtime).catch(() => {});
  }
  root.ZhugeBoardRuntime = Object.freeze({ refresh: refreshBoard, openTaskDetail: openTaskDetail });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
