/* AI Board formal read integration.
 *
 * This runtime keeps the v0.9 prototype layout, replaces its simulated card
 * data with a read-only Supabase Shared Gateway projection, and deliberately
 * disables write affordances until Ownership / RLS approval is complete.
 */
(function (root) {
  "use strict";

  const service = root.ZhugeBoardReadService;
  if (!service) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));

  function dateLabel(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
    } catch { return String(value); }
  }

  function priorityLabel(priority) {
    const value = String(priority || "").toLowerCase();
    if (value === "critical" || value === "p0") return "P0";
    if (value === "high" || value === "p1") return "P1";
    if (value === "medium" || value === "p2") return "P2";
    if (value === "low" || value === "p3") return "P3";
    return "";
  }

  function assigneeLabel(value) {
    const raw = String(value || "").trim();
    return raw ? `目前：${raw}` : "尚未指派";
  }

  function setBanner(message, kind = "info") {
    let banner = document.getElementById("boardReadStatus");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "boardReadStatus";
      banner.className = "board-read-status";
      document.querySelector(".main")?.insertBefore(banner, document.querySelector(".toolbar"));
    }
    banner.dataset.state = kind;
    banner.innerHTML = message;
  }

  function disableWriteAffordances() {
    document.querySelectorAll(".actions .btn.primary, .add, .addcol").forEach(button => {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.title = "AI Board 目前為唯讀模式；正式寫入需先完成 Ownership / RLS 審核。";
      button.onclick = null;
    });
    const refresh = document.querySelector(".actions .btn:not(.primary)");
    if (refresh) {
      refresh.id = "refreshBoardBtn";
      refresh.onclick = () => refreshBoard();
    }
    const topAction = document.querySelector(".actions .btn.primary");
    if (topAction) topAction.textContent = "唯讀模式";
    document.querySelectorAll(".process .cards, .principles .cards").forEach(zone => zone.classList.remove("dropzone"));
    document.querySelectorAll(".taskcard").forEach(card => {
      card.draggable = false;
      card.ondragstart = null;
      card.ondragend = null;
    });
    const modal = document.getElementById("addCardModal");
    if (modal) modal.remove();
  }

  function taskMarkup(task) {
    const priority = priorityLabel(task.priority);
    const priorityClass = priority === "P0" || priority === "P1" ? "high" : priority === "P2" ? "med" : "";
    const timestamp = dateLabel(task.updatedAt || task.createdAt);
    return `<article class="card taskcard board-cloud-card" data-task-id="${esc(task.id)}" data-work-code="${esc(task.workCode)}" tabindex="0">
      <div class="code">${esc(task.workCode || task.id || "TASK")}</div>
      <h3>${esc(task.title)}</h3>
      ${task.summary ? `<p>${esc(task.summary)}</p>` : ""}
      <div class="meta">
        ${task.assignee ? `<span class="tag qjc">${esc(assigneeLabel(task.assignee))}</span>` : "<span class=\"tag\">尚未指派</span>"}
        ${priority ? `<span class="tag ${priorityClass}">${esc(priority)}</span>` : ""}
        ${timestamp ? `<span class="tag">${esc(timestamp)}</span>` : ""}
      </div>
    </article>`;
  }

  function principleMarkup(principle) {
    return `<div class="card rule board-cloud-card" data-knowledge-code="${esc(principle.code)}">
      <div class="code">${esc(principle.code || "PRINCIPLE")}</div>
      <h3>${esc(principle.title)}</h3>
      ${principle.summary ? `<p>${esc(principle.summary)}</p>` : ""}
      <div class="meta"><span class="tag rule-tag">最高原則</span>${principle.version ? `<span class="tag">v${esc(principle.version)}</span>` : ""}</div>
    </div>`;
  }

  function renderPrinciples(principles) {
    const zone = document.querySelector(".principles .cards");
    const count = document.querySelector(".principles .count");
    if (!zone) return;
    zone.replaceChildren();
    if (!principles.length) {
      zone.innerHTML = '<div class="board-empty">目前沒有可讀取的已核准最高原則。</div>';
    } else {
      zone.innerHTML = principles.map(principleMarkup).join("");
    }
    if (count) count.textContent = String(principles.length);
  }

  function renderTasks(tasks) {
    const groups = Object.fromEntries(service.STATUS_WORKSPACES.map(workspace => [workspace.uiKey, []]));
    tasks.forEach(task => {
      const bucket = Object.prototype.hasOwnProperty.call(groups, task.workspace)
        ? task.workspace
        : "todo";
      groups[bucket].push(task);
    });
    service.STATUS_WORKSPACES.forEach(workspace => {
      const column = document.querySelector(`.process[data-status="${workspace.uiKey}"]`);
      if (!column) return;
      const cards = column.querySelector(".cards");
      const count = column.querySelector(".count");
      if (!cards) return;
      cards.replaceChildren();
      const rows = groups[workspace.uiKey] || [];
      cards.innerHTML = rows.length ? rows.map(taskMarkup).join("") : '<div class="board-empty">目前沒有工作</div>';
      if (count) count.textContent = String(rows.length);
    });
  }

  function setConnection(taskCount, principleCount) {
    const foot = document.querySelector(".sidefoot");
    if (foot) foot.innerHTML = `● Supabase 已連線<br><br>正式 Cloud Read<br>${taskCount} 筆 TASK · ${principleCount} 條原則<br>目前為唯讀模式`;
  }

  async function refreshBoard() {
    setBanner("正在透過 Shared Supabase Gateway 讀取正式 TASK 與最高原則…", "loading");
    try {
      const result = await service.load();
      renderPrinciples(result.principles);
      renderTasks(result.tasks);
      setConnection(result.tasks.length, result.principles.length);
      setBanner(`已讀取 ${result.tasks.length} 筆正式 Cloud TASK、${result.principles.length} 條已核准原則。<strong>唯讀模式</strong>：Status／Assignee／拖曳寫入尚未授權。`, "success");
    } catch (error) {
      const loginLink = "../../../?app=1";
      const message = error?.code === "BOARD_SESSION_REQUIRED"
        ? `請先登入 Zhuge AI OS，再開啟 AI Board。<a href="${loginLink}">前往登入</a>`
        : `正式 Cloud Read 失敗：${esc(error?.message || "未知錯誤")}。請重新整理或確認 Shared Session。`;
      setBanner(message, "error");
      const foot = document.querySelector(".sidefoot");
      if (foot) foot.innerHTML = "● Cloud Read 尚未就緒<br><br>未使用本機 TASK 或假資料";
    }
  }

  function init() {
    disableWriteAffordances();
    // Remove prototype fixture cards before the first async Cloud Read so the
    // formal Board never presents static/demo data as current TASK state.
    renderPrinciples([]);
    renderTasks([]);
    const note = document.querySelector(".note");
    if (note) note.innerHTML = "正式 Board 目前以 Supabase 為唯一 TASK 來源。最高原則來自 engineering_knowledge；流程卡片來自 board_tasks。此批次只開放 Shared Identity 下的 Cloud Read，未授權任何寫入。";
    refreshBoard();
  }

  root.ZhugeBoardRuntime = Object.freeze({ refresh: refreshBoard });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
