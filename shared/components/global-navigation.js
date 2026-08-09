/* Zhuge AI OS shared navigation.
 *
 * This is the global shell navigation for modules. A module may keep its
 * private tools, but it must not replace this navigation or strand the user
 * inside a module-specific application shell.
 */
(function (global) {
  "use strict";

  const NAV_ITEMS = Object.freeze([
    { key: "dashboard", icon: "🪶", label: "AI OS 首頁", href: "app/dashboard/" },
    { key: "ai-board", icon: "▦", label: "AI Board", href: "app/Board/ai/" },
    { key: "worklog", icon: "📝", label: "WorkLog", href: "modules/worklog/?app=1&workspace=worklog" },
    { key: "tasks", icon: "✅", label: "待辦事項", href: "modules/worklog/?app=1&workspace=tasks" },
    { key: "investment", icon: "📈", label: "Investment", href: "modules/investment/" },
    { key: "library", icon: "📚", label: "Knowledge", href: "modules/worklog/?app=1&workspace=library" },
    { key: "sync", icon: "🔗", label: "控制台", href: "modules/worklog/?app=1&workspace=sync" },
    { key: "settings", icon: "⚙️", label: "設定", href: "modules/worklog/?app=1&workspace=settings" }
  ]);

  function currentKey(pathname = global.location?.pathname || "") {
    if (/\/app\/Board\/ai\/?$/i.test(pathname)) return "ai-board";
    if (/\/modules\/investment\/?/i.test(pathname)) return "investment";
    if (/\/modules\/worklog\/?/i.test(pathname)) {
      const workspace = new URLSearchParams(global.location?.search || "").get("workspace");
      return NAV_ITEMS.some(item => item.key === workspace) ? workspace : "worklog";
    }
    if (/\/app\/dashboard\/?/i.test(pathname) || /\/zhuge-ai-os\/?$/i.test(pathname)) return "dashboard";
    return "";
  }

  function normalizeRoot(root = "") {
    const value = String(root || "");
    return value && value.endsWith("/") ? value : `${value}/`;
  }

  function render({ root = "", active = currentKey() } = {}) {
    const base = normalizeRoot(root);
    return `<div class="zhuge-global-nav-brand"><span class="zhuge-global-nav-mark">Z</span><span><strong>Zhuge AI OS</strong><small>共用導覽</small></span></div><nav class="zhuge-global-nav-links" aria-label="Zhuge AI OS 共用導覽">${NAV_ITEMS.map(item => `<a class="zhuge-global-nav-link${item.key === active ? " is-active" : ""}" data-global-nav="${item.key}" href="${base}${item.href}"${item.key === active ? ' aria-current="page"' : ""}><span class="zhuge-global-nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join("")}</nav><div class="zhuge-global-nav-foot">Zhuge AI OS<br><small>Shared Navigation</small></div>`;
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render({ root: target.dataset.rootPath || "", ...options });
    target.dataset.mounted = "true";
    return target;
  }

  global.ZhugeGlobalNavigation = Object.freeze({ items: NAV_ITEMS, currentKey, render, mount });

  function autoMount() {
    const target = document.getElementById("zhugeGlobalNavigation");
    if (target) mount(target);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
})(window);
