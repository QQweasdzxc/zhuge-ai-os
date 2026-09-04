/* Sprint 5.0: root Zhuge AI OS dashboard presentation only.
 * Authentication and module state remain owned by the existing WorkLog shell.
 */
function zhugeRootInitials(identity = {}) {
  const name = String(identity.name || identity.email || "Z").trim();
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "Z";
}

function zhugeRootIdentityMarkup(identity = null) {
  if (!identity) return "";
  const avatar = String(identity.avatarUrl || identity.avatar || "").trim();
  const avatarMarkup = avatar
    ? `<img class="zhuge-root-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(identity.name || "Google 使用者")}">`
    : `<span class="zhuge-root-avatar zhuge-root-avatar-fallback" aria-hidden="true">${escapeHtml(zhugeRootInitials(identity))}</span>`;
  return `<div class="zhuge-root-identity" data-root-identity>
    <button class="zhuge-root-account-button" type="button" data-root-account-toggle aria-haspopup="menu" aria-expanded="false">
      ${avatarMarkup}
      <span class="zhuge-root-identity-copy">
        <strong>${escapeHtml(identity.name || "Google 使用者")}</strong>
        <span>${escapeHtml(identity.email || "")}</span>
      </span>
      <span class="zhuge-root-account-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="zhuge-root-account-menu" data-root-account-menu role="menu" hidden>
      <div class="zhuge-root-account-summary"><strong>${escapeHtml(identity.name || "Google 使用者")}</strong><span>${escapeHtml(identity.email || "")}</span></div>
      <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" role="menuitem">Google 帳號</a>
      <button type="button" data-open-workspace="settings" role="menuitem">設定</button>
      <button type="button" data-logout="1" role="menuitem">登出</button>
    </div>
  </div>`;
}

function zhugeRootModuleCard({ id, icon, title, description, enabled = false, note = "", metaMarkup = "" } = {}) {
  const content = `<span class="zhuge-module-icon" aria-hidden="true">${icon}</span><span class="zhuge-module-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small>${metaMarkup}</span>${note ? `<span class="zhuge-module-note">${escapeHtml(note)}</span>` : ""}`;
  if (!enabled) return `<article class="zhuge-module-card is-disabled" aria-disabled="true"><div class="zhuge-module-card-main">${content}</div></article>`;
  return `<article class="zhuge-module-card" data-root-module-card="${escapeHtml(id)}"><button class="zhuge-module-card-main" type="button" data-open-workspace="${escapeHtml(id)}">${content}<span class="zhuge-module-arrow" aria-hidden="true">→</span></button></article>`;
}

function zhugeRootWorklogCalendarMarkup() {
  const hasEntries = typeof entries !== "undefined" && Array.isArray(entries);
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthRows = hasEntries ? entries.filter(item => String(item?.date || "").startsWith(monthKey)) : [];
  const total = monthRows.reduce((sum, item) => sum + Number(item?.hours || 0), 0);
  const todayKey = `${monthKey}-${String(today.getDate()).padStart(2, "0")}`;
  const todayTotal = monthRows.filter(item => item.date === todayKey).reduce((sum, item) => sum + Number(item?.hours || 0), 0);
  const days = typeof worklogCalendarCells === "function"
    ? worklogCalendarCells(year, month, monthRows)
    : [];
  const duration = value => typeof formatHumanDuration === "function" ? formatHumanDuration(value) : `${Number(value || 0)}h`;
  const dayMarkup = cell => {
    if (!cell.inCurrentMonth) return `<span class="zhuge-mini-calendar-day is-empty" aria-hidden="true"><b>${cell.day}</b></span>`;
    const classes = ["zhuge-mini-calendar-day", cell.hours > 0 ? "has-hours" : "", cell.dateKey === todayKey ? "is-today" : ""].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-open-worklog-date="${cell.dateKey}" aria-label="${cell.dateKey}，${cell.hours > 0 ? `工時 ${duration(cell.hours)}` : "尚無工時"}"><b>${cell.day}</b><small>${cell.hours > 0 ? escapeHtml(duration(cell.hours)) : ""}</small></button>`;
  };
  return `<div class="zhuge-mini-worklog-calendar" data-mini-worklog-calendar><div class="zhuge-mini-calendar-head"><strong>${year} 年 ${month + 1} 月</strong><span>本月 ${escapeHtml(duration(total))}｜今日 ${escapeHtml(duration(todayTotal))}</span></div><div class="zhuge-mini-calendar-weekdays" aria-hidden="true">${["日", "一", "二", "三", "四", "五", "六"].map(label => `<span>${label}</span>`).join("")}</div><div class="zhuge-mini-calendar-grid" data-mini-calendar-grid>${days.map(dayMarkup).join("")}</div>${hasEntries && monthRows.length ? "" : "<small class=\"zhuge-mini-calendar-note\">登入後同步工時，點擊日期可直接進入 WorkLog。</small>"}</div>`;
}

function zhugeRootWorklogEntryMarkup() {
  return `<div class="zhuge-dashboard-worklog-entry" data-root-worklog-entry>${zhugeRootWorklogCalendarMarkup()}<button class="zhuge-module-card-quick-action" type="button" data-dashboard-add-worklog="1">＋ 新增工時</button></div>`;
}

function zhugeRootWorkspaceEnabled(id) {
  if (typeof workspaceRegistry === "undefined") return true;
  const item = workspaceRegistry[id];
  return Boolean(item && item.enabled !== false && item.hidden !== true && !item.comingSoon);
}

function zhugeRootWorkspaceCards() {
  const worklogEntry = zhugeRootWorkspaceEnabled("worklog") ? zhugeRootWorklogEntryMarkup() : "";
  const definitions = [
    ["tasks-new", "✅", "工作待辦", "AI Board 架構的新版工作待辦"],
    ["investment", "📈", "Investment", "投資組合與觀察清單"]
  ];
  const cards = definitions.filter(([id]) => zhugeRootWorkspaceEnabled(id)).map(([id, icon, title, description, metaMarkup]) => zhugeRootModuleCard({ id, icon, title, description, metaMarkup, enabled: true }));
  return [worklogEntry, ...cards].join("");
}

function zhugeRootFormalWorkSummaryMarkup() {
  const summary = typeof workTodoDashboardSummary !== "undefined"
    ? workTodoDashboardSummary
    : { state: "loading", counts: null, workspaceCounts: [], tasks: [] };
  const state = String(summary?.state || "loading");
  if (state === "idle" || state === "loading") {
    return `<div class="zhuge-formal-work-summary" data-formal-work-summary data-summary-state="loading"><div class="zhuge-dashboard-empty"><strong>正在讀取正式工作摘要</strong><span>從目前登入者可存取的 WorkTodo Cloud 資料整理中…</span></div></div>`;
  }
  if (state === "error") {
    return `<div class="zhuge-formal-work-summary" data-formal-work-summary data-summary-state="error"><div class="zhuge-dashboard-empty is-error"><strong>正式工作摘要暫時無法取得</strong><span>請前往「工作待辦」重新整理；目前不以舊版待辦或假資料補值。</span></div></div>`;
  }

  const counts = summary?.counts || {};
  const statItems = [
    ["not_started", "待開始"],
    ["in_progress", "進行中"],
    ["waiting_reply", "待回覆"],
    ["blocked", "阻塞"]
  ];
  const statsMarkup = statItems.map(([key, label]) => `<div class="zhuge-formal-work-stat"><span>${label}</span><strong>${Number(counts[key] || 0)}</strong></div>`).join("");
  const stageMarkup = (Array.isArray(summary.workspaceCounts) ? summary.workspaceCounts : []).map(item => `<span class="zhuge-formal-work-pill"><b>${escapeHtml(item.name || "未命名工作區")}</b><small>${Number(item.count || 0)} 項</small></span>`).join("");
  const taskMarkup = (Array.isArray(summary.tasks) ? summary.tasks : []).map(task => {
    const detail = [task.statusLabel || task.workspaceName || "待處理", task.dueDate ? `期限 ${String(task.dueDate).slice(0, 10)}` : ""].filter(Boolean).join("｜");
    const progress = String(task.latestProgress || "").replace(/\s+/g, " ").trim().slice(0, 90);
    return `<button type="button" class="zhuge-formal-work-row" data-open-workspace="tasks-new" data-formal-work-task="${escapeHtml(task.id)}" aria-label="前往工作待辦查看：${escapeHtml(task.title)}"><span class="zhuge-formal-work-row-icon" aria-hidden="true">✅</span><span class="zhuge-formal-work-row-copy"><strong>${escapeHtml(task.workCode ? `${task.workCode}｜${task.title}` : task.title)}</strong><small>${escapeHtml(detail)}${progress ? `｜${escapeHtml(progress)}` : ""}</small></span><span class="zhuge-dashboard-task-arrow" aria-hidden="true">→</span></button>`;
  }).join("");
  if (!taskMarkup) {
    return `<div class="zhuge-formal-work-summary" data-formal-work-summary data-summary-state="empty"><div class="zhuge-formal-work-stats">${statsMarkup}</div>${stageMarkup ? `<div class="zhuge-formal-work-pills" aria-label="正式工作區摘要">${stageMarkup}</div>` : ""}<div class="zhuge-dashboard-empty"><strong>目前沒有待處理的正式工作</strong><span>正式工作資料已讀取完成；需要新工作時，可按「新增待辦」。目前完成 ${Number(counts.completed || 0)} 項。</span></div></div>`;
  }
  return `<div class="zhuge-formal-work-summary" data-formal-work-summary data-summary-state="ready"><div class="zhuge-formal-work-stats">${statsMarkup}</div>${stageMarkup ? `<div class="zhuge-formal-work-pills" aria-label="正式工作區摘要">${stageMarkup}</div>` : ""}<div class="zhuge-formal-work-list" aria-label="最近更新的正式工作">${taskMarkup}</div><small class="zhuge-formal-work-source">正式資料唯讀摘要｜目前 ${Number(counts.active || 0)} 項待處理，已完成 ${Number(counts.completed || 0)} 項</small></div>`;
}

function zhugeRootContinueMarkup() {
  const recent = typeof recentWorkspaces !== "undefined" && Array.isArray(recentWorkspaces) ? recentWorkspaces : [];
  let items = [...new Set(recent)]
    .filter(id => id !== "dashboard" && zhugeRootWorkspaceEnabled(id))
    .slice(0, 3)
    .map(id => {
      const item = typeof workspaceRegistry !== "undefined" ? workspaceRegistry[id] : null;
      return item ? { id, icon: item.icon, title: item.label } : null;
    })
    .filter(Boolean);
  if (!items.length) {
    items = [
      ["tasks-new", "✅", "工作待辦", "查看正式工作摘要與工作卡片"],
      ["worklog", "✏️", "WorkLog", "記錄今天的工作與工時"],
      ["investment", "📈", "Investment", "查看投資組合與決策中心"]
    ].map(([id, icon, title, description]) => zhugeRootWorkspaceEnabled(id) ? { id, icon, title, description } : null).filter(Boolean);
    if (!items.length) return `<div class="zhuge-dashboard-empty"><strong>目前尚無可開啟的工作空間</strong><span>可用工作空間準備完成後會顯示在這裡。</span></div>`;
    return `<div class="zhuge-dashboard-continue-list is-fallback" aria-label="工作空間快速入口">${items.map(item => `<button type="button" class="zhuge-dashboard-continue-row" data-open-workspace="${escapeHtml(item.id)}"><span class="zhuge-dashboard-continue-icon" aria-hidden="true">${escapeHtml(item.icon || "□")}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></span><span class="zhuge-dashboard-task-arrow" aria-hidden="true">→</span></button>`).join("")}</div>`;
  }
  return `<div class="zhuge-dashboard-continue-list">${items.map(item => `<button type="button" class="zhuge-dashboard-continue-row" data-open-workspace="${escapeHtml(item.id)}"><span class="zhuge-dashboard-continue-icon" aria-hidden="true">${escapeHtml(item.icon || "□")}</span><span><strong>${escapeHtml(item.title)}</strong><small>繼續使用這個工作空間</small></span><span class="zhuge-dashboard-task-arrow" aria-hidden="true">→</span></button>`).join("")}</div>`;
}

function zhugeRootReleaseMeta() {
  const version = typeof VERSION !== "undefined" ? VERSION : "0.9.0-alpha.9.13";
  const build = typeof BUILD_TIME !== "undefined" ? BUILD_TIME : "20260904-2351";
  return `<div class="zhuge-root-release-meta" aria-label="版本資訊"><div><span>版本</span><strong>v${escapeHtml(version)}</strong></div><div><span>Build</span><strong>${escapeHtml(build)}</strong></div><div><span>環境</span><strong>Production</strong></div><div><span>Repository</span><strong>zhuge-ai-os</strong></div></div>`;
}

function zhugeRootDashboardMarkup(identity = null) {
  return `<section class="panel zhuge-root-dashboard" data-zhuge-root-dashboard>
    <div class="zhuge-dashboard-workspace-layout">
      <section class="zhuge-dashboard-section zhuge-dashboard-workspaces" aria-labelledby="zhuge-workspaces-title"><div class="zhuge-root-section-heading"><p class="zhuge-root-eyebrow">工作空間</p><h3 id="zhuge-workspaces-title">我的工作空間</h3></div><div class="zhuge-dashboard-workspace-list">${zhugeRootWorkspaceCards()}</div></section>
      <div class="zhuge-dashboard-right-column">
        <section class="zhuge-dashboard-section" aria-labelledby="zhuge-todo-title"><div class="zhuge-dashboard-section-heading"><div><p class="zhuge-root-eyebrow">正式資料</p><h3 id="zhuge-todo-title">工作摘要</h3></div><div class="zhuge-dashboard-section-actions"><button type="button" class="btn2" data-dashboard-add-task="1">＋ 新增待辦</button><button type="button" class="btn2" data-open-workspace="tasks-new">前往工作待辦</button></div></div>${zhugeRootFormalWorkSummaryMarkup()}</section>
        <section class="zhuge-dashboard-section" aria-labelledby="zhuge-continue-title"><div class="zhuge-dashboard-section-heading"><div><p class="zhuge-root-eyebrow">最近使用</p><h3 id="zhuge-continue-title">繼續工作</h3></div></div>${zhugeRootContinueMarkup()}</section>
      </div>
    </div>
  </section>`;
}
