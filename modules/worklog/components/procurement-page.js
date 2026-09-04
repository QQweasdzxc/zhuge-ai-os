/* 庶務行政 page shell.
 * The GAS tab is a thin consumer surface around the canonical C runtime;
 * vendor records remain a separate GAS-owned data area and are not borrowed
 * from WorkLog or Investment.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GasProcurementPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function activate(view, documentRef = document) {
    const next = view === "vendors" ? "vendors" : "board";
    documentRef.querySelectorAll("[data-procurement-nav]").forEach(button => {
      const active = button.dataset.procurementNav === next;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    documentRef.querySelectorAll("[data-procurement-view]").forEach(section => {
      section.hidden = section.dataset.procurementView !== next;
    });
    const board = documentRef.querySelector("[data-board-main-view]");
    if (board) board.hidden = next !== "board";
    return next;
  }

  function init(documentRef = document) {
    if (!documentRef?.querySelector) return;
    documentRef.querySelectorAll("[data-procurement-nav]").forEach(button => {
      button.addEventListener("click", () => activate(button.dataset.procurementNav, documentRef));
    });
    activate("board", documentRef);
  }

  return Object.freeze({ activate, init });
});

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.GasProcurementPage.init(), { once: true });
  else window.GasProcurementPage.init();
}
