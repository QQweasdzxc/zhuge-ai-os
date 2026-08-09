/* AI Board operational runtime: Shared Identity, controlled RPC writes,
 * structured Checklist evidence, and authenticated Supabase Realtime. */
(function (root) {
  "use strict";
  const service = root.ZhugeBoardReadService;
  if (!service) return;
  const state = { tasks: [], principles: [], taskById: new Map(), searchQuery: "", stopRealtime: null, refreshPromise: null, realtimeTimer: null };
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
  const stageLabels = Object.freeze({ co: "Co Developer QA", gpt: "GPT Review", qjc: "QJC PM QA" });
  const stateLabels = Object.freeze({ not_verified: "未驗證", pass: "已通過", fail: "FAIL", na: "N/A" });
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
  function actionLabel(task, targetUiKey) {
    if (task.status === "ready" && targetUiKey === "progress") return "開始推進（Co）";
    if (task.status === "inprogress" && targetUiKey === "qa") return "Co 完成 → 交 GPT";
    if (task.status === "qa" && targetUiKey === "progress") return task.assignee === "QJC" ? "PM QA 退回 → Co" : "退回 Co";
    if (task.status === "qa" && targetUiKey === "qa") return "GPT Review 通過 → 交 QJC";
    if (task.status === "qa" && targetUiKey === "done") return "PM QA 通過 → 完成";
    return "執行交接";
  }
  function transitionTargets(task) {
    if (task.status === "ready") return ["progress"];
    if (task.status === "inprogress") return ["qa"];
    if (task.status !== "qa") return [];
    if (task.assignee === "GPT") return ["progress", "qa"];
    if (task.assignee === "QJC") return ["progress", "done"];
    return ["progress", "qa", "done"];
  }
  async function transitionTask(task, targetUiKey) {
    if (task.status === "qa" && task.assignee === "GPT" && targetUiKey === "done") {
      setBanner("目前由 GPT Review 接球；請先完成 GPT Review，再交 QJC 進行 PM QA。", "error");
      return;
    }
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
  function wireNavigation() {
    const handlers = {
      home: () => {
        document.querySelector(".board-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setBanner("AI Board 首頁：顯示正式 Cloud TASK、Checklist 與最高原則。", "info");
      },
      all: () => {
        document.querySelector(".board-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
        setBanner("全部工作：已顯示所有正式 Cloud TASK，依 Status 分布於四個工作區。", "info");
      },
      principles: () => {
        document.querySelector(".principles")?.scrollIntoView({ behavior: "smooth", block: "start", inline: "start" });
        setBanner("Engineering Center：左側固定區顯示已核准最高原則。", "info");
      }
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
    const checked = item.state === "pass" ? " checked" : "";
    const evidence = item.evidenceNote ? "<div class=\"checklist-evidence\">Evidence：" + esc(item.evidenceNote) + "</div>" : "<div class=\"checklist-evidence missing\">尚未提供 Evidence</div>";
    return "<div class=\"checklist-item\" data-checklist-id=\"" + esc(item.id) + "\"><label class=\"checklist-checkline\"><input type=\"checkbox\" class=\"checklist-check\" data-id=\"" + esc(item.id) + "\"" + checked + "><span><b>" + esc(item.label) +
      "</b><small>" + esc(stageLabels[item.stage] || item.stage.toUpperCase()) + " · " + esc(stateLabels[item.state] || item.state) +
      (item.required ? " · 必要" : "") + "</small></span></label><div class=\"checklist-actions\"><button class=\"btn checklist-evidence-btn\" data-id=\"" + esc(item.id) + "\">Evidence</button><button class=\"btn checklist-fail-btn\" data-id=\"" + esc(item.id) + "\">標記 FAIL</button>" + evidence + "</div></div>";
  }
  function checklistSummary(items) {
    const required = items.filter(item => item.required);
    const passed = required.filter(item => item.state === "pass").length;
    const failed = required.filter(item => item.state === "fail").length;
    return "必要項目 " + passed + "/" + required.length + " 已通過" + (failed ? " · " + failed + " 項 FAIL" : "");
  }
  async function openTaskDetail(task) {
    ensureTaskDetailModal();
    const modal = document.getElementById("taskDetailModal");
    const body = document.getElementById("taskDetailBody");
    document.getElementById("taskDetailTitle").textContent = (task.workCode || "TASK") + "｜" + task.title;
    body.innerHTML = "<div class=\"task-detail-meta\"><span>" + esc(statusLabel(task.status)) + "</span><span>" +
      esc(assigneeLabel(task.assignee)) + "</span></div><section class=\"task-detail-section\"><h3>需求內容</h3><p>" + esc(task.summary || "尚未補充需求內容") +
      "</p></section><section class=\"task-detail-section\"><h3>使用情境</h3><p>" + esc(task.usageScenario || "尚未補充使用情境") +
      "</p></section><div class=\"checklist-section\"><div class=\"checklist-heading\"><h3>Development Contract／PM QA Checklist · Checklist／Evidence</h3><span id=\"checklistSummary\">讀取中…</span></div>" +
      "<p class=\"checklist-contract-note\">Checklist 由 TASK Development Contract 預先定義；QJC 逐項確認狀態與必要 Evidence。</p><div id=\"checklistRows\"><div class=\"board-empty\">讀取 Checklist…</div></div></div>" +
      "<div class=\"transition-actions\" id=\"taskTransitionActions\"></div>";
    modal.style.display = "grid";
    const actions = document.getElementById("taskTransitionActions");
    transitionTargets(task).forEach(target => {
      const transition = transitionFor(task.status, target);
      if (!transition) return;
      const button = document.createElement("button");
      button.className = "btn primary";
      button.textContent = actionLabel(task, target);
      button.title = "目前狀態：" + statusLabel(task.status) + "；目前接球者：" + (task.assignee || "未指派");
      button.onclick = async () => { await transitionTask(task, target); modal.style.display = "none"; };
      actions.appendChild(button);
    });
    try {
      const items = await service.loadChecklist(task.id);
      const rows = document.getElementById("checklistRows");
      const summary = document.getElementById("checklistSummary");
      if (summary) summary.textContent = items.length ? checklistSummary(items) : "缺少正式 Checklist";
      rows.innerHTML = items.length ? items.map(checklistMarkup).join("") : "<div class=\"board-empty\">此 TASK 缺少正式 Development Contract Checklist，暫停驗收並回報 GPT／Co。</div>";
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
      if (!note || !note.trim()) { setBanner("PASS／FAIL 必須附 Evidence。", "error"); await openTaskDetail(task); return; }
    }
    try {
      await service.updateChecklistItem({ id: item.id, state: nextState, evidenceNote: note || "" });
      await openTaskDetail(task);
      setBanner("Checklist 狀態與 Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function updateChecklistEvidence(task, item) {
    if (!item) return;
    const note = window.prompt("Evidence／Note", item.evidenceNote || "");
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
    modal.style.display = "grid";
    if (workspace && workspace !== "todo") setBanner("新 TASK 一律從待辦開始，完成後依正式流程交接。", "info");
  }
  async function createCard() {
    const modal = document.getElementById("addCardModal");
    const summary = modal?.querySelector("#taskSummary")?.value?.trim() || "";
    const usageScenario = modal?.querySelector("#taskUsageScenario")?.value?.trim() || "";
    const title = modal?.querySelector("#taskTitle")?.value?.trim() || summary.slice(0, 80);
    if (!title) { setBanner("請輸入 Task 標題或內容。", "error"); return; }
    try {
      await service.createTask({ title: title, summary: summary, usageScenario: usageScenario });
      modal.style.display = "none";
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
      state.taskById = new Map(result.tasks.map(task => [task.id, task]));
      renderPrinciples(result.principles);
      renderTasks(visibleTasks());
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
    document.querySelectorAll(".add").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
  function init() {
    enableBoardActions();
    ensureTaskDetailModal();
    wireNavigation();
    wireSearch();
    renderPrinciples([]);
    renderTasks([]);
    const note = document.querySelector(".note");
    if (note) note.innerHTML = "正式 Board 以 Supabase 為唯一 TASK 來源。QJC 使用 authenticated Shared Identity；GPT／Co 使用受控 Engineering Service。Status、Assignee、Checklist 變更均留下 Activity Audit。";
    root.openQuickAdd = openQuickAdd;
    root.createCard = createCard;
    refreshBoard().then(initRealtime).catch(() => {});
  }
  root.ZhugeBoardRuntime = Object.freeze({ refresh: refreshBoard, openTaskDetail: openTaskDetail });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
