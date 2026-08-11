/* Zhuge AI OS Shared App Shell presentation adapter.
 *
 * The existing ZhugeSharedNavigation remains the single source for the
 * sidebar. This adapter owns only the shared page header so modules can keep
 * their business UI while presenting one consistent application frame.
 * It intentionally has no auth, data, routing, or persistence side effects.
 */
(function (global) {
  "use strict";

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));

  function releaseInfo(options = {}) {
    const foundation = global.ZhugeFoundationConfig || {};
    const release = foundation.version && typeof foundation.version === "object"
      ? foundation.version
      : foundation;
    return {
      version: String(options.version || release.version || "").replace(/^v/i, ""),
      build: String(options.build || release.build || "")
    };
  }

  function identityInfo(options = {}) {
    if (options.identity) return options.identity;
    try {
      const platform = global.ZhugeRuntimeSessionProvider?.createPlatform?.();
      return platform?.getCurrentIdentity?.() || null;
    } catch {
      return null;
    }
  }

  function renderIdentity(identity, options = {}) {
    const displayName = String(identity?.displayName || identity?.name || "").trim();
    const email = String(identity?.email || "").trim();
    const authenticated = Boolean(identity?.isAuthenticated || displayName || email);
    const title = authenticated ? (displayName || email || "已登入") : "Shared Identity";
    const detail = authenticated ? (email || "已登入") : (options.identityHint || "登入後顯示目前身份");
    return `<div class="zhuge-shared-identity" data-shared-identity="1" aria-label="登入身份"><span class="zhuge-shared-identity-dot ${authenticated ? "is-authenticated" : ""}" aria-hidden="true"></span><span class="zhuge-shared-identity-copy"><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></div>`;
  }

  function renderHeader(options = {}) {
    const release = releaseInfo(options);
    const identity = identityInfo(options);
    const title = options.title || "Zhuge AI OS";
    const description = options.description || "AI 工作管理平台";
    const actionMarkup = options.actionMarkup || (options.actionLabel
      ? `<button class="btn" type="button" ${options.actionId ? `id="${esc(options.actionId)}"` : ""} ${options.actionData ? esc(options.actionData) : ""}>${esc(options.actionLabel)}</button>`
      : "");
    const actions = actionMarkup ? `<div class="actions zhuge-shared-header-actions">${actionMarkup}</div>` : "";
    const id = options.id ? ` id="${esc(options.id)}"` : "";
    return `<header${id} class="workspace-shell-header zhuge-shared-header" data-zhuge-shared-header="true"><div class="zhuge-shared-header-main"><button class="mini adaptive-menu zhuge-shared-menu" type="button" data-toggle-sidebar="1" aria-label="開啟 Zhuge AI OS 導覽">☰</button><div class="zhuge-shared-header-copy"><p class="zhuge-shared-header-kicker">Zhuge AI OS</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div></div><div class="zhuge-shared-header-right">${renderIdentity(identity, options)}${actions}<span class="zhuge-shared-header-build" title="目前 Runtime 版本與 Build">v${esc(release.version)} · ${esc(release.build)}</span></div></header>`;
  }

  function optionsFromTarget(target) {
    return {
      title: target.dataset.title || "Zhuge AI OS",
      description: target.dataset.description || "AI 工作管理平台",
      actionLabel: target.dataset.actionLabel || "",
      actionId: target.dataset.actionId || "",
      identityHint: target.dataset.identityHint || "登入後顯示目前身份",
      version: target.dataset.version || "",
      build: target.dataset.build || ""
    };
  }

  function mountHeader(target, options = {}) {
    if (!target) return null;
    const merged = { ...optionsFromTarget(target), id: target.id || "", ...options };
    const markup = renderHeader(merged);
    target.outerHTML = markup;
    return document.querySelector("[data-zhuge-shared-header='true']");
  }

  function autoMount() {
    document.querySelectorAll("[data-zhuge-shared-header]:not([data-mounted='true'])").forEach(target => {
      target.dataset.mounted = "true";
      mountHeader(target);
    });
  }

  global.ZhugeSharedShell = Object.freeze({
    escape: esc,
    renderHeader,
    mountHeader,
    autoMount
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
})(window);
