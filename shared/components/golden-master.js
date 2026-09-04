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
      dataAction: item?.dataAction || "",
      disabled: item?.disabled === true
    };
  }

  // Template-level comparison is a Golden Master capability.  Keeping this
  // action here makes the entry available to every C Consumer without asking
  // AI Board, WorkTodo, or QAT to grow a private toolbar implementation.
  const TEMPLATE_PARITY_ACTION = Object.freeze({
    id: "templateParityBtn",
    label: "與母版比對",
    dataAction: "template-parity",
    className: "golden-master-parity-action"
  });

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
    const suppliedActions = (Array.isArray(toolbar.actions) ? toolbar.actions : [])
      .map(normalizeAction)
      .filter(item => item.label)
      // Parity is a shared Header capability, never a Consumer toolbar copy.
      .filter(item => item.id !== TEMPLATE_PARITY_ACTION.id);
    const actions = suppliedActions
      .map(item => `<button class="btn golden-master-toolbar-control ${escapeHtml(item.className)}" type="button"${item.id ? ` id="${escapeHtml(item.id)}"` : ""}${item.dataAction ? ` data-golden-master-action="${escapeHtml(item.dataAction)}"` : ""}${item.disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(item.label)}</button>`)
      .join("");
    const customActions = markup(toolbar.actionsHtml);
    const status = markup(toolbar.statusHtml || (toolbar.status ? `<span class="golden-master-toolbar-status">${escapeHtml(toolbar.status)}</span>` : ""));
    const legend = markup(toolbar.legendHtml || (toolbar.legend ? `<span class="golden-master-toolbar-legend">${escapeHtml(toolbar.legend)}</span>` : ""));
    const search = toolbar.includeSearch === false ? "" : `<label class="search golden-master-toolbar-search" for="${searchId}"><span class="golden-master-visually-hidden">${searchLabel}</span><input id="${searchId}" type="search" value="${searchValue}" placeholder="${placeholder}" aria-label="${searchLabel}"${disabled}></label>`;
    return `<div${toolbarId} class="${escapeHtml(className)}" data-golden-master-toolbar="true" aria-label="${escapeHtml(toolbar.ariaLabel || "Toolbar")}"><div class="golden-master-toolbar-filters">${filters}</div><div class="golden-master-toolbar-actions">${actions}${customActions}</div>${status}${legend}${search}</div>`;
  }

  function renderHeaderActions(options = {}) {
    const scope = escapeHtml(options.applicationScope || "");
    const refreshId = escapeHtml(options.refreshId || "refreshBoardBtn");
    const readOnly = options.readOnly === true;
    const scopeAttribute = scope ? ` data-application-scope="${scope}"` : "";
    const createConsumer = !readOnly && options.canCreateConsumer === true
      ? `<button class="btn board-header-action" type="button" data-golden-master-action="create-consumer" data-board-create-consumer>＋ 建立看板</button>`
      : "";
    const statusHelp = "狀態顯示目前採用版本與 Published C；「與母版比對」只 Compare／Detect／Report；低頻的「封存」收在此工具選單。";
    const statusMenu = `<details class="board-header-status-menu" data-golden-master-status-menu data-template-release-menu${scopeAttribute}><summary class="btn board-header-refresh board-header-status-trigger" aria-label="開啟同步狀態與工具" title="同步狀態與工具"><span class="board-header-status-indicator is-unknown" data-template-release-indicator aria-hidden="true">●</span><span aria-hidden="true">↻</span><span class="board-header-status-chevron" aria-hidden="true">▾</span></summary><div class="board-header-status-popover" data-template-release-popover><div class="board-header-status-heading"><strong>同步狀態與工具</strong><span data-template-release-summary>尚未讀取</span></div><div data-module-release-notice-host hidden></div><div class="board-header-status-actions"><button class="btn board-header-status-action" id="${refreshId}" type="button" data-golden-master-action="refresh" aria-label="重新整理" title="重新整理"${scopeAttribute}>↻ 重新整理</button><button class="btn board-header-status-action ${escapeHtml(TEMPLATE_PARITY_ACTION.className)}" id="${escapeHtml(TEMPLATE_PARITY_ACTION.id)}" type="button" data-golden-master-action="${escapeHtml(TEMPLATE_PARITY_ACTION.dataAction)}"${scopeAttribute}>⇄ ${escapeHtml(TEMPLATE_PARITY_ACTION.label)}</button>${readOnly ? "" : `<button class="btn board-header-status-action" type="button" data-golden-master-action="open-archive" data-board-open-archive${scopeAttribute}>📦 封存</button>`}</div><p class="board-header-status-help">${statusHelp}</p><div data-template-parity-result-host hidden></div></div></details>`;
    const operations = readOnly ? "" : `<button class="btn primary board-header-action" type="button" data-golden-master-action="create-card" data-board-create-card>＋ 卡片</button><button class="btn board-header-action" type="button" data-golden-master-action="create-workspace" data-board-create-workspace>＋ 工作區</button>`;
    return `${createConsumer}${operations}${statusMenu}`;
  }

  function renderOperations(options = {}) {
    const scope = escapeHtml(options.applicationScope || "");
    const itemLabel = escapeHtml(options.itemLabel || (options.applicationScope === "worktodo" ? "WLTK" : options.applicationScope === "c" ? "MDTK" : "TASK"));
    const consumerCreate = options.canCreateConsumer === true ? `
<div id="consumerCreateModal" class="modalback" aria-hidden="true">
 <div class="modal board-create-drawer" role="dialog" aria-modal="true" aria-labelledby="consumerCreateTitle">
  <div class="modalhead"><h2 id="consumerCreateTitle">＋ 建立套用 C 的看板</h2><button class="x" type="button" data-consumer-create-close aria-label="關閉建立看板">×</button></div>
  <div class="modalbody">
   <p class="board-create-description">先選擇看板歸屬，再設定名稱與代號。新看板會直接使用標準 A + C 組合，並擁有自己的 Board UUID／資料範圍。</p>
   <div class="field"><label for="consumerBoardProject">歸屬專案</label><select id="consumerBoardProject"><option value="">暫不歸屬</option><option value="worklog">WorkLog</option><option value="investment">Investment</option></select><div class="hint">歸屬只決定此看板屬於哪個專案；A、C 仍使用同一份共用模組。</div></div>
   <div class="field"><label for="consumerBoardName">看板名稱</label><input id="consumerBoardName" type="text" maxlength="80" placeholder="例如：庶務行政" autocomplete="off"></div>
   <div class="field"><label for="consumerBoardPrefix">看板代號</label><input id="consumerBoardPrefix" type="text" maxlength="16" placeholder="例如：HR" autocomplete="off" autocapitalize="characters"><div class="hint">請使用 2–16 碼英文字母／數字，第一碼必須是英文字母。</div></div>
   <div id="consumerCreateStatus" class="board-create-status" role="status" aria-live="polite"></div>
  </div>
  <div class="modalfoot"><button class="btn" type="button" data-consumer-create-close>取消</button><button class="btn primary" type="button" data-consumer-create>建立並套用 C 母版</button><a class="btn primary" data-consumer-create-open hidden href="#">前往新看板</a></div>
 </div>
</div>` : "";
    return `<div class="golden-master-operations" data-golden-master-operations="true"${scope ? ` data-application-scope="${scope}"` : ""}>
${consumerCreate}
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
    const masterMode = options.mode || "empty";
    const masterData = options.data || "none";
    const masterClass = ["empty-golden-master", options.className || ""].filter(Boolean).join(" ");
    return `<section class="${escapeHtml(masterClass)}" data-golden-master="${escapeHtml(masterMode)}" data-golden-master-data="${escapeHtml(masterData)}">${renderHeader({ ...header, components: options.components }, deps)}${renderToolbar({ ...toolbar, components: options.components })}${renderBoard({ ...options, columns, components: options.components }, deps)}${drawer ? `<div class="golden-master-drawer-host" data-golden-master-drawer-host>${drawer}</div>` : ""}</section>`;
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
    if (["worktodo", "c_mdtk", "investment-ivtk"].includes(String(consumer).toLowerCase())) {
      const contract = adapter?.sharedDrawerContract;
      if (!contract || contract.ownsDrawer !== false || contract.viewModel !== "toSharedViewModel") {
        const normalizedConsumer = String(consumer).toLowerCase();
        return { ok: false, code: normalizedConsumer === "worktodo" ? "WORKTODO_DRAWER_CONTRACT_INVALID" : normalizedConsumer === "investment-ivtk" ? "INVESTMENT_IVTK_DRAWER_CONTRACT_INVALID" : "C_TEMPLATE_DRAWER_CONTRACT_INVALID" };
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
