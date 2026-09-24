(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentModuleShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const labels = Object.freeze({
    overview: ["今日軍師", "🏠"],
    portfolio: ["我的持股", "💼"],
    transactions: ["交易紀錄", "💰"],
    strategy: ["投資策略", "◇"],
    settings: ["偏好設定", "⚙"],
    import: ["截圖匯入", "▧"]
  });

  const primaryNavigation = Object.freeze([
    { route: "overview", focus: "today-focus", label: "今日軍師", icon: "🏠", description: "今天先看需要注意的事" },
    { route: "portfolio", label: "我的持股", icon: "💼", description: "目前持有、成本與損益" },
    { route: "portfolio", focus: "watchlist", label: "觀察股", icon: "👀", description: "與持股分開追蹤" },
    { route: "overview", focus: "research", label: "個股研究", icon: "🔬", description: "查詢標的與深入 Evidence" },
    { route: "overview", focus: "advisor", label: "問軍師", icon: "🧠", description: "看白話研判與理由" },
    { route: "overview", focus: "realtime", label: "市場情報", icon: "📊", description: "行情、新聞與事件" }
  ]);

  function navigationIsCurrent(item, state = {}) {
    if (item.focus) return item.route === state.activePage && item.focus === (state.activeFocus || (state.activePage === "overview" ? "today-focus" : ""));
    return item.route === state.activePage;
  }

  function renderPrimaryNavigation(state = {}, options = {}) {
    const asLinks = options.asLinks === true;
    const hrefFor = typeof options.hrefFor === "function" ? options.hrefFor : () => "#";
    return `<nav class="investment-primary-nav" aria-label="投資主要入口">${primaryNavigation.map(item => {
      const focusAttribute = item.focus ? ` data-investment-focus="${item.focus}"` : "";
      const current = navigationIsCurrent(item, state) ? "true" : "false";
      const common = `class="investment-primary-nav-item ${current === "true" ? "active" : ""}" data-investment-route="${item.route}"${focusAttribute} aria-current="${current === "true" ? "page" : "false"}" title="${item.description}"`;
      const action = asLinks
        ? `${common} href="${hrefFor(item)}"`
        : `type="button" ${common}`;
      const tag = asLinks ? "a" : "button";
      return `<${tag} ${action}><span aria-hidden="true">${item.icon}</span><span><strong>${item.label}</strong><small>${item.description}</small></span></${tag}>`;
    }).join("")}</nav>`;
  }

  function renderToolNavigation(state = {}, options = {}) {
    const asLinks = options.asLinks === true;
    const hrefFor = typeof options.hrefFor === "function" ? options.hrefFor : () => "#";
    const toolTabs = Object.entries(labels)
      .filter(([id]) => !["overview", "portfolio"].includes(id))
      .map(([id, [label, icon]]) => {
        const active = state.activePage === id ? "true" : "false";
        const common = `class="investment-tab ${active === "true" ? "active" : ""}" aria-selected="${active}"`;
        const action = asLinks
          ? `${common} href="${hrefFor({ route: id })}"`
          : `type="button" role="tab" ${common} data-investment-route="${id}"`;
        const tag = asLinks ? "a" : "button";
        return `<${tag} ${action}><span aria-hidden="true">${icon}</span>${label}</${tag}>`;
      })
      .join("");
    const toolsOpen = ["transactions", "strategy", "settings", "import"].includes(state.activePage);
    return `<details class="investment-tool-nav"${toolsOpen ? " open" : ""}><summary class="investment-tool-nav-summary"><span class="investment-tool-nav-label">更多工具</span><small>交易紀錄、策略、截圖匯入、設定</small><span class="investment-tool-nav-chevron" aria-hidden="true">⌄</span></summary><div class="investment-content-tabs" role="tablist" aria-label="投資模組工具">${toolTabs}</div></details>`;
  }

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const identity = state.identity || {};
    return `<div class="zhuge-module-shell workspace-shell investment-module-shell" data-investment-module-shell data-shared-navigation-mode="template-only" data-template-page-id="investment"><div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="investment" data-template-page-id="investment" data-shared-navigation-disabled="true" data-exclude-board-prefix="IVTK"></div><div class="app workspace-app investment-app">
      <div id="zhugeSharedHeader" class="workspace-shell-header" data-zhuge-shared-header></div>
      <div class="investment-layout">
        <main class="investment-main">${renderPrimaryNavigation(state)}${renderToolNavigation(state)}<div id="investmentPage" class="investment-page" aria-live="polite"></div></main>
      </div>
    </div></div>`;
  }

  return Object.freeze({ labels, primaryNavigation, renderPrimaryNavigation, renderToolNavigation, render });
});
