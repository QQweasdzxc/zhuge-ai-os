(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentModuleShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const labels = Object.freeze({
    overview: ["投資首頁", "⌂"],
    portfolio: ["投資組合", "▦"],
    watchlist: ["觀察清單", "◎"],
    strategy: ["投資策略", "◇"],
    settings: ["偏好設定", "⚙"]
  });

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const identity = state.identity || {};
    const nav = Object.entries(labels).map(([id, [label, icon]]) => `<button type="button" class="investment-nav-item ${state.activePage === id ? "active" : ""}" data-investment-route="${id}"><span aria-hidden="true">${icon}</span>${label}</button>`).join("");
    return `<div class="zhuge-module-shell workspace-shell investment-module-shell" data-investment-module-shell data-shared-navigation-mode="template-only"><div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="investment" data-shared-navigation-disabled="true"></div><div class="app workspace-app investment-app">
      <div id="zhugeSharedHeader" class="workspace-shell-header" data-zhuge-shared-header></div>
      <div class="investment-layout">
        <nav class="investment-local-nav workspace-subnav" aria-label="投資子功能導覽">${nav}</nav>
        <main class="investment-main"><div id="investmentPage" class="investment-page" aria-live="polite"></div></main>
      </div>
    </div></div>`;
  }

  return Object.freeze({ labels, render });
});
