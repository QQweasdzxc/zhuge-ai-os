/*
 * Zhuge AI OS Empty Golden Master
 *
 * This is the extracted AI Board presentation contract. It owns only the
 * empty Shell/Header/Toolbar/Board/Card/Drawer composition and shared
 * interaction wiring. Consumers provide normalized domain data and callbacks;
 * this module never creates fixture data, reads Cloud, or owns business rules.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(globalThis);
  else root.ZhugeGoldenMaster = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const EMPTY_MODEL = Object.freeze({
    header: Object.freeze({}),
    toolbar: Object.freeze({}),
    columns: Object.freeze([])
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function markup(value) {
    return value == null ? "" : String(value);
  }

  function dependencies(options = {}) {
    const supplied = options.components || {};
    return {
      shell: supplied.shell || options.shell || root.ZhugeSharedShell,
      board: supplied.board || options.board || root.ZhugeSharedTaskBoard,
      card: supplied.card || options.card || root.ZhugeSharedTaskCard,
      drawer: supplied.drawer || options.drawer || root.ZhugeSharedTaskDrawer
    };
  }

  function normalizeFilter(item) {
    if (typeof item === "string") return { label: item, disabled: false };
    return {
      label: item?.label || item?.name || "",
      disabled: item?.disabled === true
    };
  }

  function normalizeAction(item) {
    if (typeof item === "string") return { label: item, disabled: false };
    return {
      label: item?.label || item?.name || "",
      id: item?.id || "",
      className: item?.className || "",
      disabled: item?.disabled === true
    };
  }

  function renderHeader(options = {}, deps = dependencies(options)) {
    const shell = deps.shell;
    const headerOptions = {
      id: options.id || "goldenMasterHeader",
      title: options.title || "",
      description: options.description || "",
      identityHint: options.identityHint || "",
      actionMarkup: markup(options.actionMarkup || options.headerActionMarkup)
    };
    if (shell?.renderHeader) {
      return shell.renderHeader(headerOptions).replace(/^<header\b/, '<header data-golden-master-header="true"');
    }
    return `<header class="zhuge-shared-header" data-golden-master-header="true"><div><h1>${escapeHtml(headerOptions.title)}</h1><p>${escapeHtml(headerOptions.description)}</p></div>${headerOptions.actionMarkup}</header>`;
  }

  function renderToolbar(options = {}) {
    const toolbar = options.toolbar || options;
    const className = ["toolbar", "board-toolbar", "golden-master-toolbar", toolbar.className || ""].filter(Boolean).join(" ");
    const toolbarId = toolbar.id ? ` id="${escapeHtml(toolbar.id)}"` : "";
    const searchId = escapeHtml(toolbar.searchId || "goldenMasterSearch");
    const searchLabel = escapeHtml(toolbar.searchLabel || "搜尋");
    const placeholder = escapeHtml(toolbar.searchPlaceholder || "");
    const searchValue = escapeHtml(toolbar.searchValue || "");
    const disabled = toolbar.disabled === true ? " disabled aria-disabled=\"true\"" : "";
    const filters = (Array.isArray(toolbar.filters) ? toolbar.filters : [])
      .map(normalizeFilter)
      .filter(item => item.label)
      .map(item => `<button class="chip golden-master-toolbar-control" type="button"${item.disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(item.label)}</button>`)
      .join("");
    const actions = (Array.isArray(toolbar.actions) ? toolbar.actions : [])
      .map(normalizeAction)
      .filter(item => item.label)
      .map(item => `<button class="btn golden-master-toolbar-control ${escapeHtml(item.className)}" type="button"${item.id ? ` id="${escapeHtml(item.id)}"` : ""}${item.disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(item.label)}</button>`)
      .join("");
    const customActions = markup(toolbar.actionsHtml);
    const status = markup(toolbar.statusHtml || (toolbar.status ? `<span class="golden-master-toolbar-status">${escapeHtml(toolbar.status)}</span>` : ""));
    const legend = markup(toolbar.legendHtml || (toolbar.legend ? `<span class="golden-master-toolbar-legend">${escapeHtml(toolbar.legend)}</span>` : ""));
    return `<div${toolbarId} class="${escapeHtml(className)}" data-golden-master-toolbar="true" aria-label="${escapeHtml(toolbar.ariaLabel || "Toolbar")}"><label class="search golden-master-toolbar-search" for="${searchId}"><span class="golden-master-visually-hidden">${searchLabel}</span><input id="${searchId}" type="search" value="${searchValue}" placeholder="${placeholder}" aria-label="${searchLabel}"${disabled}></label><div class="golden-master-toolbar-filters">${filters}</div><div class="golden-master-toolbar-actions">${actions}${customActions}</div>${status}${legend}</div>`;
  }

  function renderHeaderActions(options = {}) {
    const scope = escapeHtml(options.applicationScope || "");
    const refreshId = escapeHtml(options.refreshId || "refreshBoardBtn");
    return `<button class="btn primary board-header-action" type="button" data-golden-master-action="create-card" data-board-create-card>＋ 卡片</button><button class="btn board-header-action" type="button" data-golden-master-action="create-workspace" data-board-create-workspace>＋ 工作區</button><button class="btn board-header-action" type="button" data-golden-master-action="open-archive" data-board-open-archive>📦 封存</button><button class="btn board-header-refresh" id="${refreshId}" type="button" data-golden-master-action="refresh" aria-label="重新整理" title="重新整理"${scope ? ` data-application-scope="${scope}"` : ""}>↻</button>`;
  }

  function renderOperations(options = {}) {
    const scope = escapeHtml(options.applicationScope || "");
    const itemLabel = options.applicationScope === "worktodo" ? "WLTK" : "TASK";
    return `<div class="golden-master-operations" data-golden-master-operations="true"${scope ? ` data-application-scope="${scope}"` : ""}>
<div id="addCardModal" class="modalback" aria-hidden="true">
 <div class="modal board-create-drawer">
  <div class="modalhead"><h2>新增 ${itemLabel}</h2><button class="x" type="button" data-golden-master-close="add-card" aria-label="關閉新增 ${itemLabel}">×</button></div>
  <div class="modalbody">
   <div class="field"><label for="taskSummary">需求內容</label><textarea id="taskSummary" placeholder="要完成什麼？"></textarea></div>
   <div class="field"><label for="taskUsageScenario">使用情境</label><textarea id="taskUsageScenario" placeholder="使用者為什麼需要？實際會怎麼使用？"></textarea><div class="hint">使用情境是正式內容；沒有資料時不自行猜測。</div></div>
   <div class="field"><label for="taskTitle">${itemLabel} 標題</label><input id="taskTitle" placeholder="例如：AI Board Checklist 驗收"></div>
  </div>
  <div class="modalfoot"><button class="btn" type="button" data-golden-master-close="add-card">取消</button><button class="btn primary" type="button" data-golden-master-create-card>建立卡片</button></div>
 </div>
</div>

<div id="workspaceCreateDrawerBackdrop" class="board-create-drawer-backdrop" data-workspace-drawer-close aria-hidden="true"></div>
<aside id="workspaceCreateDrawer" class="board-create-drawer board-workspace-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="新增工作區">
 <div class="modalhead"><h2>＋ 新增工作區</h2><button class="x" type="button" data-workspace-drawer-close aria-label="關閉新增工作區">×</button></div>
 <div class="modalbody"><div class="field"><label for="workspaceName">工作區名稱</label><input id="workspaceName" type="text" maxlength="80" placeholder="例如：測試區" autocomplete="off"><div class="hint">建立後會依目前排序出現在 Board 最右側。</div></div></div>
 <div class="drawer-actions"><button class="btn" type="button" data-workspace-drawer-close>取消</button><button class="btn primary" type="button" data-workspace-create>建立</button></div>
</aside>

<div id="archiveDrawerBackdrop" class="board-create-drawer-backdrop" data-archive-close aria-hidden="true"></div>
<aside id="archiveDrawer" class="board-create-drawer board-archive-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="封存">
 <div class="modalhead"><h2>📦 封存</h2><button class="x" type="button" data-archive-close aria-label="關閉封存">×</button></div>
 <div class="modalbody">
  <div class="board-archive-toolbar"><input id="archiveSearch" type="search" placeholder="搜尋封存 ${itemLabel}、治理原因或工作區" aria-label="搜尋封存 ${itemLabel}"><select id="archiveFilter" aria-label="封存狀態篩選"><option value="all">全部狀態</option><option value="done">已完成</option><option value="merged">已合併</option><option value="cancelled">已取消</option></select></div>
  <div id="archiveCount" class="board-archive-count" aria-live="polite"></div>
  <div id="archiveTaskList" class="board-archive-list"><div class="board-empty">目前沒有封存 ${itemLabel}。</div></div>
 </div>
</aside>

<div id="healthCheckModal" class="modalback" aria-hidden="true">
 <div class="modal board-task-modal" role="dialog" aria-modal="true"><div class="modalhead"><h2>資料健康度檢查（唯讀）</h2><button class="x" id="closeHealthCheck" type="button" aria-label="關閉">×</button></div><div class="modalbody" id="healthCheckBody"><div class="board-empty">尚未執行檢查。</div></div></div>
</div>
<div id="taskDetailModal" class="task-detail-modal-host" aria-hidden="true"><div id="taskDetailBody"></div></div>
</div>`;
  }

  function mountOperations(target, options = {}) {
    if (!target || typeof document === "undefined") return null;
    // Keep the shared operation surfaces inside the Golden Master shell. The
    // presentation CSS is intentionally scoped to that shell so the same
    // hidden modal/drawer behavior is used by every Board consumer.
    const mountTarget = target.closest?.(".zhuge-module-shell")
      || target.querySelector?.(".zhuge-module-shell")
      || document.querySelector?.(".zhuge-module-shell")
      || target;
    const existing = mountTarget.querySelector?.("[data-golden-master-operations]") || document.querySelector("[data-golden-master-operations]");
    if (existing) return existing;
    const template = document.createElement("template");
    template.innerHTML = renderOperations(options).trim();
    const operations = template.content.firstElementChild;
    if (!operations) return null;
    mountTarget.appendChild(operations);
    return operations;
  }

  function renderCard(cardOptions = {}, options = {}, deps = dependencies(options)) {
    const card = deps.card;
    if (card?.render) return card.render(cardOptions);
    return `<div class="board-empty">Shared Task Card 尚未載入。</div>`;
  }

  function goldenMasterColumn(column = {}, options = {}, deps = dependencies(options)) {
    return {
      ...column,
      className: ["golden-master-column", column.className || ""].filter(Boolean).join(" "),
      renderCard: column.renderCard || (card => renderCard(card, options, deps))
    };
  }

  function renderColumns(columns = [], options = {}, deps = dependencies(options)) {
    const board = deps.board;
    if (!board?.renderColumns) return `<div class="board-empty">Shared Task Board 尚未載入。</div>`;
    return board.renderColumns((Array.isArray(columns) ? columns : []).map(column => goldenMasterColumn(column, options, deps)));
  }

  function renderBoard(options = {}, deps = dependencies(options)) {
    const board = deps.board;
    if (!board?.render) return `<div class="board-empty">Shared Task Board 尚未載入。</div>`;
    const columns = Array.isArray(options.columns) ? options.columns : [];
    return `<section class="golden-master-board-shell" data-golden-master-board-shell="true">${board.render({
      id: options.id || "goldenMasterBoard",
      boardKey: options.boardKey || "golden-master",
      className: options.className || "golden-master-board",
      ariaLabel: options.ariaLabel || "Empty Golden Master Board",
      emptyText: options.emptyText || "目前沒有套用的 Workspace Data。",
      columns: columns.map(column => ({
        ...column,
        renderCard: column.renderCard || (card => renderCard(card, options, deps))
      }))
    })}</section>`;
  }

  function renderDrawer(options = {}, deps = dependencies(options)) {
    const drawerOptions = options.drawer || options;
    const properties = Array.isArray(drawerOptions.properties)
      // Priority is not part of the canonical Shared Drawer contract.  A
      // consumer's agreed-date property is presentation data, however, and
      // must remain available to the shared interaction binder.
      ? drawerOptions.properties.filter(item => !["priority"].includes(item?.key))
      : drawerOptions.properties;
    const presentationOptions = properties === drawerOptions.properties
      ? drawerOptions
      : { ...drawerOptions, properties };
    if (deps.drawer?.render) return deps.drawer.render(presentationOptions);
    return `<div class="shared-task-drawer-empty">Shared Task Drawer 尚未載入。</div>`;
  }

  function render(options = {}) {
    const deps = dependencies(options);
    const model = options.model || EMPTY_MODEL;
    const header = options.header || model.header || {};
    const toolbar = options.toolbar || model.toolbar || {};
    const columns = Array.isArray(options.columns) ? options.columns : (Array.isArray(model.columns) ? model.columns : []);
    const drawer = options.drawer ? renderDrawer({ drawer: options.drawer, components: options.components }, deps) : "";
    return `<section class="empty-golden-master" data-golden-master="empty" data-golden-master-data="none">${renderHeader({ ...header, components: options.components }, deps)}${renderToolbar({ ...toolbar, components: options.components })}${renderBoard({ ...options, columns, components: options.components }, deps)}${drawer ? `<div class="golden-master-drawer-host" data-golden-master-drawer-host>${drawer}</div>` : ""}</section>`;
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render(options);
    return target.querySelector("[data-golden-master]");
  }

  function bindBoard(target, handlers = {}, options = {}) {
    const deps = dependencies(options);
    return deps.board?.bind?.(target, handlers) || false;
  }

  /*
   * Runtime conformance guard for the single Drawer contract.  A Consumer
   * adapter may expose domain capability helpers, but it must explicitly
   * declare that it does not own Drawer presentation.  This keeps a future
   * WorkTodo bootstrap from silently reintroducing a second detail renderer.
   */
  function assertSharedDrawerContract({ consumer = "", adapter = null, drawer = null } = {}) {
    if (typeof renderDrawer !== "function" || typeof drawer?.render !== "function") {
      return { ok: false, code: "SHARED_DRAWER_UNAVAILABLE" };
    }
    if (String(consumer).toLowerCase() === "worktodo") {
      const contract = adapter?.sharedDrawerContract;
      if (!contract || contract.ownsDrawer !== false || contract.viewModel !== "toSharedViewModel") {
        return { ok: false, code: "WORKTODO_DRAWER_CONTRACT_INVALID" };
      }
    }
    return { ok: true, code: "SHARED_DRAWER_CONTRACT_OK" };
  }

  return Object.freeze({
    EMPTY_MODEL,
    escapeHtml,
    renderHeader,
    renderHeaderActions,
    renderToolbar,
    renderOperations,
    mountOperations,
    renderCard,
    renderColumns,
    renderBoard,
    renderDrawer,
    render,
    mount,
    bindBoard,
    assertSharedDrawerContract
  });
});
