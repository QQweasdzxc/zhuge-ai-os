/*
 * Shared Task Board / Column presentation and drag contract.
 *
 * Consumers provide normalized columns/cards and keep domain persistence,
 * authorization, and lifecycle rules outside this component.  The same
 * board markup and drag/drop interaction is used by AI Board and WorkTodo.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSharedTaskBoard = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const CARD_DRAG_TYPE = "application/x-zhuge-shared-task-card";
  const COLUMN_DRAG_TYPE = "application/x-zhuge-shared-task-column";

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

  function columnMarkup(column = {}) {
    const id = escapeHtml(column.id || column.key || "column");
    const key = escapeHtml(column.key || column.id || "column");
    const name = escapeHtml(column.name || column.label || "工作區");
    const icon = column.icon ? `<span class="shared-task-board-column-icon" aria-hidden="true">${escapeHtml(column.icon)}</span>` : "";
    const count = Number.isFinite(Number(column.count)) ? Number(column.count) : (Array.isArray(column.cards) ? column.cards.length : 0);
    const controls = markup(column.controlsHtml);
    const add = markup(column.addHtml);
    const cards = column.cardsHtml != null
      ? markup(column.cardsHtml)
      : (Array.isArray(column.cards) && column.renderCard
        ? column.cards.map(card => markup(column.renderCard(card, column))).join("")
        : "");
    const empty = column.emptyHtml != null
      ? markup(column.emptyHtml)
      : `<div class="board-empty shared-task-board-empty">${escapeHtml(column.emptyText || "目前沒有工作")}</div>`;
    const cardContent = cards || empty;
    const className = ["shared-task-board-column", "column", "process", column.className || ""].filter(Boolean).join(" ");
    const headerClass = ["shared-task-board-column-header", "colhead", column.completion ? "workspace-completion-column" : ""].filter(Boolean).join(" ");
    const readOnly = column.readOnly === true ? ' data-read-only="true"' : "";
    const handle = column.reorderable === false
      ? ""
      : `<span class="shared-task-board-column-handle workspace-drag-handle" data-shared-task-board-column-handle draggable="true" title="拖曳重新排序" aria-label="拖曳重新排序">⠿</span>`;
    return `<section class="${escapeHtml(className)}" data-shared-task-board-column="${id}" data-workspace-id="${id}" data-workspace-key="${key}"${readOnly}>
      <header class="${escapeHtml(headerClass)}" data-workspace-header="${id}"><span class="shared-task-board-column-title workspace-title">${icon}${name}</span><span class="count shared-task-board-column-count">${count}</span>${controls}${handle}</header>
      ${add}<div class="shared-task-board-cards cards" data-shared-task-board-cards="${id}">${cardContent}</div>
    </section>`;
  }

  function renderColumns(columns = []) {
    return (Array.isArray(columns) ? columns : []).map(columnMarkup).join("");
  }

  function render(options = {}) {
    const className = ["shared-task-board", "board", options.className || ""].filter(Boolean).join(" ");
    const id = options.id ? ` id="${escapeHtml(options.id)}"` : "";
    const columns = renderColumns(options.columns || []);
    return `<div class="${escapeHtml(className)}"${id} data-shared-task-board="${escapeHtml(options.boardKey || options.id || "task-board")}" aria-label="${escapeHtml(options.ariaLabel || "工作看板")}">${columns || `<div class="board-empty">尚未讀取可用工作區。</div>`}</div>`;
  }

  function hasDragType(event, type) {
    return Array.from(event?.dataTransfer?.types || []).includes(type);
  }

  function bind(target, handlers = {}) {
    const board = typeof target === "string" ? document.querySelector(target) : target;
    if (!board) return false;
    const cards = board.querySelectorAll("[data-shared-task-board-card-id], [data-task-id], [data-worktodo-open-task]");
    cards.forEach(card => {
      card.ondragstart = event => {
        const id = card.dataset.sharedTaskBoardCardId || card.dataset.taskId || card.dataset.worktodoOpenTask || card.dataset.taskCard || "";
        if (typeof handlers.canDragCard === "function" && handlers.canDragCard(id, card) === false) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(CARD_DRAG_TYPE, id);
        event.dataTransfer.setData("text/plain", id);
        card.classList.add("dragging");
        handlers.onCardDragStart?.({ id, card, event });
      };
      card.ondragend = event => {
        card.classList.remove("dragging");
        handlers.onCardDragEnd?.({ card, event });
      };
    });
    board.querySelectorAll("[data-shared-task-board-column-handle], .workspace-drag-handle").forEach(handle => {
      handle.ondragstart = event => {
        event.stopPropagation();
        const column = handle.closest("[data-shared-task-board-column]");
        const id = column?.dataset.sharedTaskBoardColumn || column?.dataset.workspaceId || "";
        if (typeof handlers.canReorderColumn === "function" && handlers.canReorderColumn(id, column) === false) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(COLUMN_DRAG_TYPE, id);
        column?.classList.add("workspace-dragging");
        handlers.onColumnDragStart?.({ id, column, event });
      };
      handle.ondragend = event => {
        handle.closest("[data-shared-task-board-column]")?.classList.remove("workspace-dragging");
        handlers.onColumnDragEnd?.({ handle, event });
      };
    });
    board.querySelectorAll("[data-shared-task-board-column]").forEach(column => {
      const id = column.dataset.sharedTaskBoardColumn || column.dataset.workspaceId || "";
      column.ondragover = event => {
        if (!hasDragType(event, CARD_DRAG_TYPE) && !hasDragType(event, COLUMN_DRAG_TYPE)) return;
        event.preventDefault();
        column.classList.add(hasDragType(event, COLUMN_DRAG_TYPE) ? "workspace-dropzone" : "dropzone");
        handlers.onDragOver?.({ id, column, event });
      };
      column.ondragleave = event => {
        if (event.relatedTarget && column.contains(event.relatedTarget)) return;
        column.classList.remove("workspace-dropzone", "dropzone");
        handlers.onDragLeave?.({ id, column, event });
      };
      column.ondrop = async event => {
        const isCard = hasDragType(event, CARD_DRAG_TYPE);
        const isColumn = hasDragType(event, COLUMN_DRAG_TYPE);
        if (!isCard && !isColumn) return;
        event.preventDefault();
        column.classList.remove("workspace-dropzone", "dropzone");
        if (isColumn) {
          await handlers.onColumnDrop?.({ id, sourceId: event.dataTransfer.getData(COLUMN_DRAG_TYPE), column, event });
          return;
        }
        const cardId = event.dataTransfer.getData(CARD_DRAG_TYPE) || event.dataTransfer.getData("text/plain");
        await handlers.onCardDrop?.({ id, cardId, column, event });
      };
    });
    return true;
  }

  return Object.freeze({ CARD_DRAG_TYPE, COLUMN_DRAG_TYPE, escapeHtml, columnMarkup, renderColumns, render, bind });
});
