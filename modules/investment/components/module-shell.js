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
    return `<div class="investment-app" data-investment-module>
      <header class="investment-topbar">
        <a class="investment-brand" href="../../app/dashboard/" aria-label="返回 Zhuge AI OS 首頁"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt=""><span><small>Zhuge AI OS ›</small><strong>投資</strong></span></a>
        <div class="investment-identity"><span class="investment-status-dot"></span><span><strong>${escape(identity.displayName || identity.email || "Google 使用者")}</strong><small>${escape(identity.email || "已登入")}</small></span></div>
      </header>
      <div class="investment-layout">
        <aside class="investment-sidebar"><div class="investment-module-title"><span>📈</span><div><strong>投資</strong><small>投資決策與資產管理</small></div></div><nav aria-label="投資頁面">${nav}</nav><div class="investment-sidebar-meta"><span>資料狀態</span><strong>雲端資料已連線</strong><small>僅顯示目前帳號的投資資料</small></div><a class="investment-back-link" href="../../app/dashboard/">← 返回 AI OS 首頁</a></aside>
        <main class="investment-main"><div id="investmentPage" class="investment-page" aria-live="polite"></div></main>
      </div>
    </div>`;
  }

  return Object.freeze({ labels, render });
});
