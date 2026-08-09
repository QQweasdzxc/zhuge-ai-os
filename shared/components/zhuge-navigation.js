/* Zhuge AI OS Shared Navigation Shell.
 *
 * WorkLog and every module render this same component. A module can supply
 * its own destination adapter, but it must not create a second global rail.
 */
(function (global) {
  "use strict";

  const DEFAULT_REGISTRY = Object.freeze({
    dashboard: { icon: "🪶", label: "Zhuge AI OS", group: "system", enabled: true, hidden: true, root: true },
    worklog: { icon: "🪶", label: "WorkLog", group: "camp", enabled: true },
    tasks: { icon: "✅", label: "待辦事項", group: "camp", enabled: true },
    investment: { icon: "📈", label: "Investment", group: "camp", enabled: true, status: "SIT" },
    procurement: { icon: "📦", label: "採購營帳", group: "camp", comingSoon: true },
    hr: { icon: "👥", label: "HR", group: "camp", comingSoon: true },
    travel: { icon: "✈️", label: "Travel", group: "camp", comingSoon: true },
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
      library: "modules/worklog/?app=1&workspace=library",
      sync: "modules/worklog/?app=1&workspace=sync",
      settings: "modules/worklog/?app=1&workspace=settings"
    };
    return paths[id] ? `${base}${paths[id]}` : "#";
  }

  function agentPanel(agents, esc) {
    return `<div class="agent-panel"><h3>🤖 Agent</h3>${agents.map(([icon, name, status]) => `<div class="agent-row"><span>${icon} ${esc(name)}</span><b>${esc(status)}</b></div>`).join("")}</div>`;
  }

  function itemMarkup(id, item, options, esc) {
    const active = options.activeWorkspace === id;
    const label = `${item.icon} ${esc(item.label)}`;
    if (!item.enabled || item.comingSoon) {
      return `<div class="side-item disabled" data-shared-nav-item="${esc(id)}"><span>${label}</span>${item.comingSoon ? "<small>🚧 施工中</small>" : ""}</div>`;
    }
    if (options.externalRoot) {
      return `<a class="side-item ${active ? "on" : ""}" data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}" href="${destination(id, options.externalRoot)}"><span>${label}</span>${item.status ? `<small>${esc(item.status)}</small>` : ""}</a>`;
    }
    return `<button type="button" class="side-item ${active ? "on" : ""}" data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}"><span>${label}</span>${item.status ? `<small>${esc(item.status)}</small>` : ""}</button>`;
  }

  function section(title, group, registry, options, esc) {
    return `<div class="side-section"><h3>${title}</h3>${Object.entries(registry).filter(([, item]) => item.group === group && !item.hidden).map(([id, item]) => itemMarkup(id, item, options, esc)).join("")}</div>`;
  }

  function render(options = {}) {
    const esc = options.escapeHtml || escape;
    const registry = options.workspaceRegistry || DEFAULT_REGISTRY;
    const agents = options.agentStatuses || DEFAULT_AGENTS;
    const syncLabel = typeof options.sidebarSyncStatusLabel === "function" ? options.sidebarSyncStatusLabel() : (options.sidebarSyncStatusLabel || "🟢 已同步");
    const syncTime = options.syncTime || "尚未同步";
    const version = options.version || "";
    const build = options.build || "";
    const root = options.externalRoot || "";
    const brand = root ? `<a class="brand-stack" href="${destination("dashboard", root)}" data-shared-nav-item="dashboard" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span> Zhuge AI OS</h1><span class="brand-companion">by Mr. KM</span></a>` : `<div class="brand-stack" data-open-workspace="dashboard" role="button" tabindex="0" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span> Zhuge AI OS</h1><span class="brand-companion">by Mr. KM</span></div>`;
    return `<aside class="os-sidebar" data-zhuge-shared-navigation="true"><div class="sidebar-brand"><div class="brand-row">${brand}</div><button class="mini sidebar-close" data-close-sidebar="1" aria-label="關閉選單">×</button><button class="mini sidebar-menu-mark" type="button" data-toggle-sidebar="1" aria-label="營帳選單">☰</button></div>${agentPanel(agents, esc)}${section("🏕️ 營帳", "camp", registry, { ...options, externalRoot: root }, esc)}${section("⚙️ 系統", "system", registry, { ...options, externalRoot: root }, esc)}<div class="developer-build-info"><div class="sidebar-sync-summary" id="developerCloudSyncStatus" data-retry-cloud-sync="1"><strong>${esc(syncLabel)}</strong><span>最後同步</span><time>${esc(syncTime)}</time></div><div class="sidebar-version-summary"><span>Version</span><strong>v${esc(version)}</strong></div><div class="sidebar-build-summary"><span>Build</span><strong>${esc(build)}</strong></div></div></aside>`;
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.outerHTML = render({ ...options, externalRoot: target.dataset.externalRoot || options.externalRoot || "" });
    return document.querySelector("[data-zhuge-shared-navigation='true']");
  }

  global.ZhugeSharedNavigation = Object.freeze({ DEFAULT_REGISTRY, destination, render, mount });

  function autoMount() {
    const target = document.getElementById("zhugeSharedNavigation");
    if (target && !target.dataset.worklogManaged) mount(target);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
})(window);
