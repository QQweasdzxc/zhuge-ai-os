/*
 * Shared Golden Master Preview Renderer.
 *
 * It renders one Template-only Fixture through the existing shared Shell,
 * Task Board, Task Card, and Task Drawer. It owns no domain data, persistence,
 * authorization, Cloud access, or lifecycle writes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(globalThis);
  else root.ZhugeGoldenMasterPreview = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const DEFAULT_FIXTURE_ID = "ai-board-golden-master-fixture-v1";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function textMarkup(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function dependencies(options = {}) {
    const supplied = options.components || {};
    return {
      shell: supplied.shell || options.shell || root.ZhugeSharedShell,
      board: supplied.board || options.board || root.ZhugeSharedTaskBoard,
      card: supplied.card || options.card || root.ZhugeSharedTaskCard,
      drawer: supplied.drawer || options.drawer || root.ZhugeSharedTaskDrawer,
      fixtureProvider: supplied.fixtureProvider || options.fixtureProvider || root.ZhugeGoldenMasterFixture
    };
  }

  function resolveFixture(options, deps) {
    if (options.fixture) return options.fixture;
    return deps.fixtureProvider?.get?.(options.fixtureKey || DEFAULT_FIXTURE_ID) || null;
  }

  function headerMarkup(fixture, shell) {
    const actions = (fixture.toolbar?.headerActions || fixture.toolbar?.actions || []).map(label => `<button class="btn2 golden-master-preview-header-action" type="button" disabled aria-disabled="true">${escapeHtml(label)}</button>`).join("");
    if (shell?.renderHeader) {
      return shell.renderHeader({
        id: "goldenMasterPreviewHeader",
        title: fixture.header?.title || "AI Board",
        description: fixture.header?.description || "Shared Golden Master Preview",
        identityHint: fixture.header?.identityHint || "Template-only Fixture",
        actionMarkup: actions
      }).replace(/^<header\b/, '<header data-mounted="true"');
    }
    return `<header class="workspace-shell-header golden-master-preview-fallback-header"><div><p>Zhuge AI OS</p><h2>${escapeHtml(fixture.header?.title || "AI Board")}</h2><span>${escapeHtml(fixture.header?.description || "Shared Golden Master Preview")}</span></div><div>${actions}</div></header>`;
  }

  function toolbarMarkup(fixture) {
    const filters = (fixture.toolbar?.filters || []).map(label => `<button class="chip golden-master-preview-toolbar-control" type="button" disabled aria-disabled="true">${escapeHtml(label)}</button>`).join("");
    const actions = (fixture.toolbar?.actions || []).map(label => `<button class="btn2 golden-master-preview-toolbar-control" type="button" disabled aria-disabled="true">${escapeHtml(label)}</button>`).join("");
    return `<div class="toolbar board-toolbar golden-master-preview-toolbar" data-shared-golden-master-toolbar="true" aria-label="Golden Master Toolbar"><label class="search golden-master-preview-search"><span class="golden-master-preview-visually-hidden">搜尋目前工作中的 TASK、使用情境或工作區</span><input type="search" disabled aria-disabled="true" placeholder="${escapeHtml(fixture.toolbar?.searchPlaceholder || "搜尋目前工作中的 TASK、使用情境或工作區")}"></label><div class="golden-master-preview-toolbar-filters">${filters}</div><div class="golden-master-preview-toolbar-actions">${actions}</div><span class="board-search-count golden-master-preview-readonly-status">Template-only Fixture · Read-only</span></div>`;
  }

  function cardMarkup(card, fixture, cardComponent) {
    if (!cardComponent?.render) return `<div class="board-empty">Shared Task Card foundation 尚未載入。</div>`;
    return cardComponent.render({
      className: "golden-master-preview-card shared-task-board-card",
      code: card.code || card.id,
      title: card.title,
      summary: card.summary,
      footerHtml: `<div class="golden-master-preview-card-meta"><span>Template-only Fixture</span><span>Read-only</span></div>`,
      attributes: {
        "data-shared-task-board-card-id": card.id,
        "data-golden-master-preview-card": card.id,
        "data-golden-master-preview-open-task": fixture.selectedTaskId,
        tabindex: "0",
        role: "button",
        draggable: "false",
        "aria-label": `${card.code || card.id} ${card.title || "Fixture Task"}，開啟 Shared Task Drawer Preview`
      }
    });
  }

  function boardMarkup(fixture, boardComponent, cardComponent) {
    if (!boardComponent?.render) return `<div class="empty">Shared Task Board foundation 尚未載入。</div>`;
    const columns = (fixture.columns || []).map(column => ({
      ...column,
      readOnly: true,
      reorderable: false,
      controlsHtml: `<span class="golden-master-preview-column-mode" title="Template-only Workspace Surface">⋮</span>`,
      addHtml: column.key === "todo"
        ? `<button class="shared-task-board-add-card golden-master-preview-add-action" type="button" disabled aria-disabled="true">＋ 新增 TASK</button>`
        : "",
      renderCard: card => cardMarkup(card, fixture, cardComponent)
    }));
    return `<div class="shared-task-board-shell golden-master-preview-board-shell">${boardComponent.render({
      id: "goldenMasterPreviewBoard",
      boardKey: fixture.boardKey || "ai-board-golden-master-preview",
      className: "golden-master-preview-board",
      ariaLabel: "AI Board Golden Master Board Preview",
      columns
    })}</div>`;
  }

  function checklistMarkup(items = []) {
    const completed = items.filter(item => item.completed === true).length;
    const rows = items.map(item => `<li class="shared-task-checklist-item${item.completed ? " is-complete" : ""}"><span aria-hidden="true">${item.completed ? "✓" : "○"}</span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note || "Template-only Fixture")}</small></li>`).join("");
    return `<details class="shared-task-drawer-checklist-panel" open><summary><span>☑ Checklist</span><span class="shared-task-drawer-checklist-count">${completed} / ${items.length}</span></summary><div class="shared-task-drawer-checklist-body"><ul class="shared-task-checklist-list">${rows}</ul><small class="shared-task-checklist-note">Fixture-only 狀態；此 Preview 不提供正式資料寫入。</small></div></details>`;
  }

  function attachmentsMarkup(items = []) {
    const rows = items.map(item => `<article class="shared-task-attachment"><span class="shared-task-attachment-icon" aria-hidden="true">${escapeHtml(item.icon || "📎")}</span><span class="shared-task-attachment-copy"><strong>${escapeHtml(item.filename)}</strong><span class="shared-task-attachment-meta">${escapeHtml(item.meta || "Template-only Fixture")}</span></span><span class="shared-task-attachment-meta">只讀</span></article>`).join("");
    return `<div class="shared-task-attachment-list">${rows || `<div class="shared-task-attachment-empty">目前沒有 Fixture Attachment。</div>`}</div>`;
  }

  function analysisMarkup(items = []) {
    const blocks = items.map(item => `<article class="shared-task-analysis-card"><h3>${escapeHtml(item.title)}</h3><p>${textMarkup(item.content)}</p></article>`).join("");
    return `<div class="shared-task-analysis-grid" data-golden-master-preview-analysis>${blocks}</div>`;
  }

  function timelineMarkup(items = []) {
    const rows = items.map(item => `<article class="shared-task-drawer-activity-row" data-activity-kind="${escapeHtml(item.kind || "system")}" data-activity-type="${escapeHtml(item.type || "progress")}"><div class="task-activity-dot" aria-hidden="true"></div><div><span class="shared-task-progress-note-title">${escapeHtml(item.title || "Activity")}</span><div class="shared-task-progress-content">${textMarkup(item.content)}</div><small class="shared-task-progress-note-meta">${escapeHtml(item.meta || "Template-only Fixture")}</small></div></article>`).join("");
    return rows || `<div class="shared-task-drawer-empty">目前沒有 Fixture Timeline。</div>`;
  }

  function drawerMarkup(fixture, drawerComponent) {
    const task = fixture.task || {};
    if (!drawerComponent?.render) return `<div class="empty">Shared Task Drawer foundation 尚未載入。</div>`;
    const sections = (task.sections || []).map(section => ({
      id: section.id,
      title: section.title,
      hint: section.hint,
      className: "golden-master-preview-drawer-section",
      html: `<p class="golden-master-preview-copy">${textMarkup(section.content)}</p>`
    }));
    sections.push({
      id: "attachments",
      title: "📎 Attachment",
      hint: "Template-only Fixture · Read-only",
      className: "golden-master-preview-drawer-section",
      html: attachmentsMarkup(task.attachments)
    });
    sections.push({
      id: "gpt-analysis",
      title: "🤖 GPT 分析與建議",
      hint: "Shared Analysis Presentation",
      className: "golden-master-preview-drawer-section",
      html: analysisMarkup(task.analysis)
    });
    return drawerComponent.render({
      title: task.title || "Golden Master Fixture Task",
      titleCode: task.code || "GM-FIXTURE",
      subtitle: task.subtitle || "AI Board · Shared Golden Master Fixture",
      readOnly: true,
      titleEditable: false,
      properties: task.properties,
      sections,
      activity: {
        title: "💬 Progress Timeline",
        hint: "Template-only Fixture · Read-only",
        topHtml: checklistMarkup(task.checklist),
        bottomHtml: `<div class="golden-master-preview-drawer-note">此 Drawer 只供 Presentation／Interaction QA，不讀取或寫入正式 Domain Data。</div>`,
        html: timelineMarkup(task.timeline)
      },
      footerHtml: `<div class="golden-master-preview-footer">Template-only Fixture · 不連線 Cloud · 不污染 AI Board／WorkTodo</div>`
    });
  }

  function render(options = {}) {
    const deps = dependencies(options);
    const fixture = resolveFixture(options, deps);
    if (!fixture) return `<section class="golden-master-preview" data-golden-master-preview><div class="empty">Golden Master Fixture 尚未載入。</div></section>`;
    const drawer = drawerMarkup(fixture, deps.drawer);
    return `<section class="golden-master-preview" data-golden-master-preview data-golden-master-preview-fixture="${escapeHtml(fixture.id)}" data-golden-master-preview-read-only="true">
      ${headerMarkup(fixture, deps.shell)}
      ${toolbarMarkup(fixture)}
      ${boardMarkup(fixture, deps.board, deps.card)}
      <p class="golden-master-preview-interaction-note">點選任一 Fixture Card 開啟 Shared Task Drawer。所有操作均為 read-only Preview，不會寫入正式資料。</p>
      <div class="golden-master-preview-drawer-host" data-golden-master-preview-drawer-host hidden>${drawer}</div>
    </section>`;
  }

  function findSurface(target) {
    if (target?.matches?.("[data-golden-master-preview]")) return target;
    return target?.querySelector?.("[data-golden-master-preview]") || null;
  }

  function bind(target) {
    const scope = target || (typeof document !== "undefined" ? document : null);
    const surface = findSurface(scope);
    if (!surface) return false;
    if (surface.dataset.goldenMasterPreviewBound === "true") return true;
    surface.dataset.goldenMasterPreviewBound = "true";
    const host = surface.querySelector("[data-golden-master-preview-drawer-host]");
    const firstCard = surface.querySelector("[data-golden-master-preview-card]");
    const close = () => {
      if (host) host.hidden = true;
      firstCard?.focus?.();
    };
    const open = event => {
      event?.preventDefault?.();
      if (host) host.hidden = false;
      host?.querySelector("[data-shared-task-drawer-close]")?.focus?.();
    };
    surface.querySelectorAll("[data-golden-master-preview-open-task]").forEach(card => {
      card.addEventListener("click", open);
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") open(event);
      });
    });
    host?.querySelectorAll("[data-shared-task-drawer-close]").forEach(button => button.addEventListener("click", close));
    return true;
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render(options);
    bind(target);
    return target.querySelector?.("[data-golden-master-preview]") || null;
  }

  return Object.freeze({ DEFAULT_FIXTURE_ID, escapeHtml, render, bind, mount });
});
