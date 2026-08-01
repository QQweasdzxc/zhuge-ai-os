(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentModuleShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const labels = Object.freeze({
    overview: ["戰情首頁", "⌂"],
    portfolio: ["Portfolio", "▦"],
    watchlist: ["Watchlist", "◎"],
    strategy: ["Strategy", "◇"],
    settings: ["Settings", "⚙"]
  });

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const identity = state.identity || {};
    const suffix = String(identity.userId || "").slice(-8);
    const nav = Object.entries(labels).map(([id, [label, icon]]) => `<button type="button" class="investment-nav-item ${state.activePage === id ? "active" : ""}" data-investment-route="${id}"><span aria-hidden="true">${icon}</span>${label}</button>`).join("");
    return `<div class="investment-app" data-investment-module>
      <header class="investment-topbar">
        <a class="investment-brand" href="../../app/dashboard/" aria-label="返回 Zhuge AI OS 首頁"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt=""><span><small>Zhuge AI OS ›</small><strong>Investment</strong></span></a>
        <div class="investment-identity"><span class="investment-status-dot"></span><span><strong>${escape(identity.displayName || identity.email || "Shared User")}</strong><small>Shared UUID · ••••${escape(suffix)}</small></span></div>
      </header>
      <div class="investment-layout">
        <aside class="investment-sidebar"><div class="investment-module-title"><span>📈</span><div><strong>Investment</strong><small>Decision Intelligence</small></div></div><nav aria-label="Investment 頁面">${nav}</nav><div class="investment-sidebar-meta"><span>資料來源</span><strong>Mock Repository</strong><small>Production Database 未連線</small></div><a class="investment-back-link" href="../worklog/?app=1">← 返回 WorkLog</a></aside>
        <main class="investment-main"><div class="investment-sit-banner"><span>🟢 Shared Session</span><span>🟢 Security Gate Level 3</span><span>🟡 Mock Data</span><span>Module v${escape(dependencies.version)}</span></div><div id="investmentPage" class="investment-page" aria-live="polite"></div></main>
      </div>
    </div>`;
  }

  return Object.freeze({ labels, render });
});
