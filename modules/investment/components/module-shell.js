(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentModuleShell = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const labels = Object.freeze({
    overview: ["股票總覽", "📈"],
    receivables: ["應收款", "▤"],
    portfolio: ["我的持股", "💼"],
    transactions: ["交易紀錄", "💰"],
    strategy: ["投資策略", "◇"],
    settings: ["偏好設定", "⚙"],
    import: ["截圖匯入", "▧"]
  });

  const primaryNavigation = Object.freeze([
    { route: "overview", focus: "stocks", label: "股票總覽", icon: "📈", description: "在手與已平倉、成本與損益" },
    { route: "receivables", label: "應收款", icon: "▤", description: "代墊後待收回的款項" }
  ]);
  const extraNavigation = Object.freeze([
    { route: "portfolio", label: "我的持股", icon: "💼" },
    { route: "overview", focus: "today-focus", label: "今日軍師", icon: "🏠" },
    { route: "portfolio", focus: "watchlist", label: "觀察股", icon: "👀" },
    { route: "overview", focus: "research", label: "個股研究", icon: "🔬" },
    { route: "overview", focus: "advisor", label: "團軍師", icon: "🧠" },
    { route: "overview", focus: "realtime", label: "市場情報", icon: "📊" }
  ]);

  function navigationIsCurrent(item, state = {}) {
    if (item.focus) return item.route === state.activePage && item.focus === (state.activeFocus || (state.activePage === "overview" ? "stocks" : ""));
    if (item.route === "portfolio") return state.activePage === "portfolio" && state.activeFocus !== "watchlist";
    return item.route === state.activePage;
  }

  function renderPrimaryNavigation(state = {}, options = {}) {
    const asLinks = options.asLinks === true;
    const hrefFor = typeof options.hrefFor === "function" ? options.hrefFor : () => "#";
    const panelId = String(options.panelId || "investmentPage").trim();
    const navigation = `<nav class="investment-primary-nav investment-content-tabs zhuge-functional-tabs" role="${asLinks ? "navigation" : "tablist"}" aria-label="投資主要入口">${primaryNavigation.map(item => {
      const focusAttribute = item.focus ? ` data-investment-focus="${item.focus}"` : "";
      const current = navigationIsCurrent(item, state) ? "true" : "false";
      const controlsAttribute = panelId ? ` aria-controls="${panelId}"` : "";
    const common = `class="investment-tab zhuge-functional-tab ${current === "true" ? "active" : ""}" ${asLinks ? "" : `role="tab" aria-selected="${current}"${controlsAttribute}`} data-investment-route="${item.route}"${focusAttribute} aria-current="${current === "true" ? "page" : "false"}" title="${item.description}"`;
      const action = asLinks
        ? `${common} href="${hrefFor(item)}"`
        : `type="button" ${common}`;
      const tag = asLinks ? "a" : "button";
      return `<${tag} ${action}><span aria-hidden="true">${item.icon}</span>${item.label}</${tag}>`;
    }).join("")}</nav>`;
    return options.actionsMarkup ? `<div class="zhuge-functional-tabs-stack"><div class="investment-navigation-row">${navigation}<div class="zhuge-functional-tabs-actions">${options.actionsMarkup}</div></div></div>` : navigation;
  }

  function renderToolIcon(item) {
    const key = item.focus || item.route;
    const paths = {
      portfolio: "M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3",
      "today-focus": "M3 11l9-8 9 8 M6 9v12h12V9 M10 21v-7h4v7",
      watchlist: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
      research: "M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14 M15 15l6 6",
      advisor: "M4 20v-3a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3 M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
      realtime: "M3 3v18h18 M6 16l5-6 4 3 6-8",
      transactions: "M3 7h16 M15 3l4 4-4 4 M21 17H5 M9 13l-4 4 4 4",
      strategy: "M12 2l10 10-10 10L2 12z M8 12h8 M12 8v8",
      settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
      import: "M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M15 7h2"
    };
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key] || paths.strategy}"></path></svg>`;
  }

  function renderToolNavigation(state = {}, options = {}) {
    const asLinks = options.asLinks === true;
    const hrefFor = typeof options.hrefFor === "function" ? options.hrefFor : () => "#";
    const items = [...extraNavigation, ...Object.entries(labels).filter(([id]) => !["overview", "portfolio", "receivables"].includes(id)).map(([route, [label, icon]]) => ({route, label, icon}))];
    const toolItems = items.map(item => {
      const active = navigationIsCurrent(item, state);
      const action = asLinks ? `href="${hrefFor(item)}"` : `type="button" data-investment-route="${item.route}"${item.focus ? ` data-investment-focus="${item.focus}"` : ""}`;
      const tag = asLinks ? "a" : "button";
      return `<${tag} role="menuitem" class="investment-tool-menu-item ${active ? "is-current" : ""}" ${action}>${renderToolIcon(item)}<span>${item.label}</span></${tag}>`;
    }).join("");
    return `<details class="investment-tool-nav"><summary class="investment-tool-nav-summary" aria-label="更多工具"><span class="investment-tool-nav-label">更多工具</span><span class="investment-tool-nav-chevron" aria-hidden="true">⌄</span></summary><div class="investment-tool-menu" role="menu" aria-label="投資模組工具">${toolItems}</div></details>`;
  }

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const identity = state.identity || {};
    return `<div class="zhuge-module-shell workspace-shell investment-module-shell" data-investment-module-shell data-shared-navigation-mode="template-only" data-template-page-id="investment"><div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="investment" data-template-page-id="investment" data-shared-navigation-disabled="true" data-exclude-board-prefix="IVTK"></div><div class="app workspace-app investment-app">
      <div class="investment-layout">
        <main class="investment-main zhuge-functional-tabs-layout"><div id="zhugeSharedHeader" class="workspace-shell-header zhuge-shared-header" data-zhuge-shared-header></div>${renderPrimaryNavigation(state, { actionsMarkup: renderToolNavigation(state) })}<div id="investmentPage" class="investment-page zhuge-functional-tabs-content" aria-live="polite"></div></main>
      </div>
    </div></div>`;
  }

  return Object.freeze({ labels, primaryNavigation, navigationIsCurrent, renderPrimaryNavigation, renderToolNavigation, render });
});
