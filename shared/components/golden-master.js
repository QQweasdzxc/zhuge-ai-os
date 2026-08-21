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
    return `<div class="${escapeHtml(className)}" data-golden-master-toolbar="true" aria-label="${escapeHtml(toolbar.ariaLabel || "Toolbar")}"><label class="search golden-master-toolbar-search" for="${searchId}"><span class="golden-master-visually-hidden">${searchLabel}</span><input id="${searchId}" type="search" value="${searchValue}" placeholder="${placeholder}" aria-label="${searchLabel}"${disabled}></label><div class="golden-master-toolbar-filters">${filters}</div><div class="golden-master-toolbar-actions">${actions}${customActions}</div>${status}${legend}</div>`;
  }

  function renderCard(cardOptions = {}, options = {}, deps = dependencies(options)) {
    const card = deps.card;
    if (card?.render) return card.render(cardOptions);
    return `<div class="board-empty">Shared Task Card 尚未載入。</div>`;
  }

  function renderColumns(columns = [], options = {}, deps = dependencies(options)) {
    const board = deps.board;
    if (!board?.renderColumns) return `<div class="board-empty">Shared Task Board 尚未載入。</div>`;
    return board.renderColumns((Array.isArray(columns) ? columns : []).map(column => ({
      ...column,
      renderCard: column.renderCard || (card => renderCard(card, options, deps))
    })));
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
    if (deps.drawer?.render) return deps.drawer.render(options.drawer || options);
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

  return Object.freeze({
    EMPTY_MODEL,
    escapeHtml,
    renderHeader,
    renderToolbar,
    renderCard,
    renderColumns,
    renderBoard,
    renderDrawer,
    render,
    mount,
    bindBoard
  });
});
