/* Zhuge AI OS canonical Shared App Shell navigation.
 *
 * Every Workspace mounts this component.  The hierarchy is intentionally
 * defined here (rather than copied by a module) so the shell, labels, active
 * state and collapse behaviour remain one product-wide contract.
 */
(function (global) {
  "use strict";

  const COLLAPSED_KEY = "zhuge_shared_nav_collapsed_v1";
  const DEFAULT_REGISTRY = Object.freeze({
    dashboard: { icon: "🪶", label: "Zhuge AI OS", group: "root", enabled: true, hidden: true, root: true },
    worklog: { icon: "✏️", label: "WorkLog", group: "camp", enabled: true },
    tasks: { icon: "✅", label: "工作待辦", group: "camp-child", enabled: true },
    investment: { icon: "📈", label: "Investment", group: "camp", enabled: true, status: "SIT" },
    "ai-board": { icon: "🤖", label: "AI Board", group: "ai-board", enabled: true },
    "ai-board-board": { icon: "📋", label: "工作看板", group: "ai-board-child", enabled: true },
    "ai-board-principles": { icon: "📘", label: "工程準則", group: "ai-board-child", enabled: true },
    "ai-board-system-map": { icon: "🗺️", label: "系統藍圖", group: "ai-board-child", enabled: true },
    procurement: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
    hr: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
    travel: { icon: "🚧", label: "施工中", group: "construction", comingSoon: true },
    library: { icon: "📚", label: "Knowledge", group: "system", enabled: true },
    sync: { icon: "🔗", label: "控制台", group: "system", enabled: true },
    settings: { icon: "⚙️", label: "設定", group: "system", enabled: true }
  });
  const DEFAULT_AGENTS = Object.freeze([
    ["🪶", "工時 Agent", "🟢 在線"],
    ["📈", "投資 Agent", "🟡 SIT"]
  ]);

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function destination(id, root = "") {
    const base = String(root || "").replace(/\/?$/, "/");
    const paths = {
      dashboard: "app/dashboard/",
      worklog: "modules/worklog/?app=1&workspace=worklog",
      tasks: "modules/worklog/?app=1&workspace=tasks",
      investment: "modules/investment/",
      "ai-board": "app/Board/ai/",
      "ai-board-board": "app/Board/ai/?view=board",
      "ai-board-principles": "app/Board/ai/?view=principles",
      "ai-board-system-map": "app/Board/ai/?view=system-map",
      library: "modules/worklog/?app=1&workspace=library",
      sync: "modules/worklog/?app=1&workspace=sync",
      settings: "modules/worklog/?app=1&workspace=settings"
    };
    return paths[id] ? `${base}${paths[id]}` : "#";
  }

  function registryFor(options) {
    return Object.keys(DEFAULT_REGISTRY).reduce((result, id) => {
      result[id] = { ...DEFAULT_REGISTRY[id], ...(options.workspaceRegistry?.[id] || {}) };
      return result;
    }, {});
  }

  function agentPanel(agents, esc) {
    return `<div class="agent-panel"><h3><span class="nav-section-icon" aria-hidden="true">🤖</span><span class="nav-section-label">Agent</span></h3>${agents.map(([icon, name, status]) => `<div class="agent-row"><span class="agent-name"><span class="agent-icon" aria-hidden="true">${esc(icon)}</span><span class="agent-label">${esc(name)}</span></span><b>${esc(status)}</b></div>`).join("")}</div>`;
  }

  function itemMarkup(id, item, options, esc, depth = 0) {
    const active = options.activeWorkspace === id || (id === "ai-board" && String(options.activeWorkspace || "").startsWith("ai-board"));
    const label = `<span class="side-item-icon" aria-hidden="true">${esc(item.icon || "□")}</span><span class="side-item-label">${esc(item.label)}</span>`;
    const attrs = `data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}" title="${esc(item.label)}"`;
    const cls = `side-item ${active ? "on" : ""} ${depth ? "side-item-child" : ""}`;
    if (!item.enabled || item.comingSoon) {
      return `<div class="${cls} disabled" ${attrs} aria-disabled="true">${label}${item.comingSoon ? "<small>施工中</small>" : ""}</div>`;
    }
    const href = options.externalRoot ? destination(id, options.externalRoot) : (item.externalHref || "#");
    if (options.externalRoot || item.externalHref) {
      return `<a class="${cls}" ${attrs} href="${esc(href)}">${label}${item.status ? `<small>${esc(item.status)}</small>` : ""}</a>`;
    }
    return `<button type="button" class="${cls}" ${attrs}>${label}${item.status ? `<small>${esc(item.status)}</small>` : ""}</button>`;
  }

  function sectionHeadingMarkup(title, icon, id, registry, options, esc) {
    const item = registry[id];
    if (!item) return `<h3><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></h3>`;
    const active = options.activeWorkspace === id || String(options.activeWorkspace || "").startsWith(`${id}-`);
    const href = options.externalRoot ? destination(id, options.externalRoot) : (item.externalHref || "#");
    return `<a class="side-section-heading ${active ? "on" : ""}" data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}" href="${esc(href)}" title="${esc(title)}"><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></a>`;
  }

  function sectionMarkup(title, icon, ids, registry, options, esc, group, childIndexes = [], headingId = null) {
    const items = ids.map((id, index) => registry[id] ? itemMarkup(id, registry[id], options, esc, childIndexes.includes(index) ? 1 : 0) : "").join("");
    const heading = headingId ? sectionHeadingMarkup(title, icon, headingId, registry, options, esc) : `<h3><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></h3>`;
    return `<div class="side-section" data-nav-group="${esc(group)}">${heading}${items}</div>`;
  }

  function render(options = {}) {
    const esc = options.escapeHtml || escape;
    const foundation = global.ZhugeFoundationConfig || {};
    const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
    const registry = registryFor(options);
    const agents = options.agentStatuses || DEFAULT_AGENTS;
    const syncLabel = typeof options.sidebarSyncStatusLabel === "function" ? options.sidebarSyncStatusLabel() : (options.sidebarSyncStatusLabel || "🟢 已同步");
    const syncTime = options.syncTime || "尚未同步";
    const version = options.version || release.version || "";
    const build = options.build || release.build || "";
    const root = options.externalRoot || "";
    const collapsed = (() => { try { return global.localStorage?.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } })();
    const brand = root
      ? `<a class="brand-stack" href="${destination("dashboard", root)}" data-shared-nav-item="dashboard" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span><span class="brand-name"> Zhuge AI OS</span></h1><span class="brand-companion">by Mr. KM</span></a>`
      : `<div class="brand-stack" data-open-workspace="dashboard" role="button" tabindex="0" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span><span class="brand-name"> Zhuge AI OS</span></h1><span class="brand-companion">by Mr. KM</span></div>`;
    const camp = sectionMarkup("營帳", "⛺", ["worklog", "tasks", "investment"], registry, { ...options, externalRoot: root }, esc, "camp", [1]);
    const board = sectionMarkup("AI Board", "🤖", ["ai-board-board", "ai-board-principles", "ai-board-system-map"], registry, { ...options, externalRoot: root }, esc, "ai-board", [0, 1, 2], "ai-board");
    const construction = ["procurement", "hr", "travel"].map(id => sectionMarkup("施工中", "🚧", [], registry, { ...options, externalRoot: root }, esc, `construction-${id}`)).join("");
    const system = sectionMarkup("系統", "⚙️", ["library", "sync", "settings"], registry, { ...options, externalRoot: root }, esc, "system", [0, 1, 2]);
    return `<aside class="os-sidebar ${collapsed ? "zhuge-nav-is-collapsed" : ""}" data-zhuge-shared-navigation="true"><div class="sidebar-brand"><div class="brand-row">${brand}</div><button class="mini sidebar-close" data-close-sidebar="1" aria-label="關閉選單">×</button><button class="mini sidebar-menu-mark" type="button" data-toggle-sidebar="1" aria-label="營帳選單">☰</button><button class="mini shared-nav-collapse" type="button" data-shared-nav-collapse="1" aria-label="收合導覽" title="收合導覽">‹</button></div>${agentPanel(agents, esc)}${camp}${board}${construction}${system}<div class="developer-build-info"><div class="sidebar-sync-summary" id="developerCloudSyncStatus" data-retry-cloud-sync="1"><strong>${esc(syncLabel)}</strong><span>最後同步</span><time>${esc(syncTime)}</time></div><div class="sidebar-version-summary"><span>Version</span><strong>v${esc(version)}</strong></div><div class="sidebar-build-summary"><span>Build</span><strong>${esc(build)}</strong></div></div></aside>`;
  }

  function shellFor(node) { return node?.closest(".os-shell,.zhuge-module-shell") || document.querySelector(".os-shell,.zhuge-module-shell"); }
  function setCollapsed(shell, collapsed) {
    if (!shell) return;
    shell.classList.toggle("zhuge-nav-collapsed", collapsed);
    shell.querySelector("[data-shared-nav-collapse]")?.setAttribute("aria-label", collapsed ? "展開導覽" : "收合導覽");
    shell.querySelector("[data-shared-nav-collapse]")?.setAttribute("title", collapsed ? "展開導覽" : "收合導覽");
    shell.querySelector("[data-shared-nav-collapse]").textContent = collapsed ? "›" : "‹";
    try { global.localStorage?.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* cache preference is optional */ }
  }
  function wireCollapse() {
    if (document.documentElement.dataset.zhugeSharedNavWired) return;
    document.documentElement.dataset.zhugeSharedNavWired = "1";
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-shared-nav-collapse]");
      if (!button) return;
      event.preventDefault();
      const shell = shellFor(button);
      setCollapsed(shell, !shell?.classList.contains("zhuge-nav-collapsed"));
    });
  }
  function mount(target, options = {}) {
    if (!target) return null;
    const targetVersion = target.dataset.version || "";
    const targetBuild = target.dataset.build || "";
    target.outerHTML = render({ ...options, version: options.version || targetVersion, build: options.build || targetBuild, activeWorkspace: options.activeWorkspace || target.dataset.activeWorkspace || "", externalRoot: target.dataset.externalRoot || options.externalRoot || "" });
    const node = document.querySelector("[data-zhuge-shared-navigation='true']");
    const shell = shellFor(node);
    if (shell) setCollapsed(shell, shell.classList.contains("zhuge-nav-collapsed") || (() => { try { return global.localStorage?.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } })());
    wireCollapse();
    return node;
  }
  global.ZhugeSharedNavigation = Object.freeze({ DEFAULT_REGISTRY, destination, render, mount, setCollapsed });
  function autoMount() {
    wireCollapse();
    const target = document.getElementById("zhugeSharedNavigation");
    if (target && !target.dataset.worklogManaged) mount(target);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
})(window);
