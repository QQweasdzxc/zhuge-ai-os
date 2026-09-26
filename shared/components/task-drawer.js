/*
 * Shared Task Drawer Foundation
 *
 * This file owns presentation only. Consumers provide already-normalized,
 * escaped section markup and keep their domain, Cloud, authorization, and
 * audit behavior outside this component.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSharedTaskDrawer = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asMarkup(value, emptyText) {
    return value == null || value === "" ? `<div class="shared-task-drawer-empty">${escapeHtml(emptyText || "尚未提供內容")}</div>` : String(value);
  }

  function renderProperties(properties) {
    const rows = Array.isArray(properties) ? properties.filter(item => item && (item.label || item.value)) : [];
    if (!rows.length) return "";
    return `<div class="shared-task-drawer-properties" data-shared-task-properties role="list">${rows.map(item => {
      const icon = item.icon ? `<span class="shared-task-drawer-property-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>` : "";
      const label = escapeHtml(item.label || "");
      const value = escapeHtml(item.value || "—");
      const key = escapeHtml(item.key || item.label || "property");
      const interactive = item.interactive === true;
      const action = interactive ? escapeHtml(item.action || item.key || "property") : "";
      const tag = interactive ? "button" : "div";
      const type = interactive ? ' type="button"' : "";
      const actionAttribute = interactive ? ` data-task-property-action="${action}" aria-label="${label}：${value}"` : "";
      return `<${tag} class="shared-task-drawer-property${interactive ? " is-interactive" : ""}" data-task-property="${key}"${actionAttribute}${type} role="listitem">${icon}<span class="shared-task-drawer-property-copy"><span class="shared-task-drawer-property-label">${label}</span><strong class="shared-task-drawer-property-value" data-task-property-value>${value}</strong></span></${tag}>`;
    }).join("")}</div>`;
  }

  function renderSection(section) {
    const item = section || {};
    const title = escapeHtml(item.title || "");
    const content = asMarkup(item.html, item.emptyText);
    const className = item.className ? ` ${escapeHtml(item.className)}` : "";
    const hidden = item.hidden === true ? " hidden" : "";
    if (item.collapsible) {
      return `<details class="shared-task-drawer-section shared-task-drawer-collapsible${className}"${item.open ? " open" : ""}><summary>${title}</summary><div class="shared-task-drawer-section-body">${content}</div></details>`;
    }
    return `<section class="shared-task-drawer-section${className}"${hidden} data-shared-task-drawer-section="${escapeHtml(item.id || "")}"><div class="shared-task-drawer-section-heading"><h3>${title}</h3>${item.hint ? `<span>${escapeHtml(item.hint)}</span>` : ""}</div><div class="shared-task-drawer-section-body">${content}</div></section>`;
  }

  function render(options) {
    const config = options || {};
    const itemLabel = escapeHtml(config.itemLabel || "TASK");
    const title = escapeHtml(config.title || itemLabel);
    const titleCode = escapeHtml(config.titleCode || itemLabel);
    const subtitle = escapeHtml(config.subtitle || "Task Detail");
    const sections = Array.isArray(config.sections) ? config.sections : [];
    const activity = config.activity || {};
    const activityTitle = escapeHtml(activity.title || "💬 工作進度紀錄");
    const activityHint = escapeHtml(activity.hint || "人工備註＋System Activity");
    const activityTop = activity.topHtml ? String(activity.topHtml) : "";
    const activityComposer = activity.bottomHtml ? "" : (activity.composerHtml ? String(activity.composerHtml) : "");
    const activityFloating = activity.floatingHtml ? `<div class="shared-task-drawer-floating-action" data-shared-task-floating-action>${String(activity.floatingHtml)}</div>` : "";
    const activityNotes = activity.notesHtml ? String(activity.notesHtml) : "";
    const activityRows = asMarkup(activity.html, "目前沒有可讀取的 System Activity。");
    const activityNotesMarkup = activityComposer || activityNotes
      ? `<div class="shared-task-drawer-activity-notes">${activityComposer}${activityNotes}</div>`
      : "";
    const activityBottom = activity.bottomHtml ? `<div class="shared-task-drawer-activity-bottom">${String(activity.bottomHtml)}</div>` : "";
    const footer = config.footerHtml ? `<footer class="shared-task-drawer-footer">${config.footerHtml}</footer>` : "";
    const readOnly = config.readOnly === true ? " data-read-only=\"true\"" : "";
    const titleEditor = config.titleEditable === true && config.readOnly !== true
      ? `<button class="shared-task-drawer-title-edit zhuge-core-button" type="button" data-task-title-edit aria-label="編輯 ${itemLabel} 主旨" title="編輯 ${itemLabel} 主旨">✏️</button>`
      : "";
    const heading = titleCode
      ? `<span class="shared-task-drawer-title-code" data-shared-task-title-code>${titleCode}</span><span class="shared-task-drawer-title-separator" aria-hidden="true">｜</span><span id="taskDetailTitle" data-shared-task-title>${title}</span>`
      : `<span id="taskDetailTitle" data-shared-task-title>${title}</span>`;
    const properties = Array.isArray(config.properties) ? config.properties : config.meta;
    const propertyMarkup = renderProperties(properties);
    return `<div class="shared-task-drawer zhuge-core-modal" data-shared-task-drawer data-shared-task-framework="v1"${readOnly}>
      <button class="shared-task-drawer-backdrop" type="button" data-shared-task-drawer-close aria-label="關閉工作抽屜"></button>
      <aside class="shared-task-drawer-panel zhuge-core-card zhuge-core-modal-panel" data-shared-task-drawer-panel role="dialog" aria-modal="true" aria-labelledby="taskDetailTitle" tabindex="-1">
        <header class="shared-task-drawer-header" data-shared-task-region="header"><div><span class="shared-task-drawer-kicker">${subtitle}</span><div class="shared-task-drawer-title-row"><h2 data-shared-task-title-heading>${heading}</h2>${titleEditor}</div></div><div class="shared-task-drawer-header-actions">${config.headerMenuHtml ? String(config.headerMenuHtml) : ""}<button class="shared-task-drawer-close zhuge-core-button" type="button" data-shared-task-drawer-close aria-label="關閉工作抽屜" title="關閉工作抽屜">×</button></div></header>
        ${propertyMarkup ? `<div class="shared-task-drawer-properties-wrap">${propertyMarkup}</div>` : ""}
        <div class="shared-task-drawer-grid">
          <main class="shared-task-drawer-content" data-shared-task-region="work-body">${sections.map(renderSection).join("")}</main>
          <aside class="shared-task-drawer-activity" data-shared-task-region="activity" aria-label="${activityTitle}"><div class="shared-task-drawer-section-heading"><h3>${activityTitle}</h3><span>${activityHint}</span></div>${activityTop ? `<div class="shared-task-drawer-activity-top">${activityTop}</div>` : ""}${activityNotesMarkup}<div id="taskActivityList" class="shared-task-drawer-activity-list zhuge-core-list" data-shared-task-timeline>${activityRows}</div>${activityBottom}</aside>
        </div>
        ${activityFloating}
        ${footer}
      </aside>
    </div>`;
  }

  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const behaviorState = new WeakMap();
  let behaviorInstalled = false;
  let openDrawerCount = 0;
  let previousBodyOverflow = "";

  function focusableNodes(panel) {
    if (!panel) return [];
    return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(node => {
      if (!(node instanceof Element)) return false;
      const style = typeof getComputedStyle === "function" ? getComputedStyle(node) : null;
      return style?.display !== "none" && style?.visibility !== "hidden" && node.getClientRects().length > 0;
    });
  }

  function isVisible(root) {
    if (!root || !root.isConnected) return false;
    if (!root.getClientRects().length) return false;
    for (let node = root; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }

  function lockBodyScroll() {
    if (!document.body) return;
    if (openDrawerCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.dataset.sharedTaskDrawerScrollLocked = "true";
    }
    openDrawerCount += 1;
  }

  function unlockBodyScroll() {
    if (!document.body || openDrawerCount === 0) return;
    openDrawerCount -= 1;
    if (openDrawerCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
      delete document.body.dataset.sharedTaskDrawerScrollLocked;
      previousBodyOverflow = "";
    }
  }

  function enhance(root, options) {
    if (!root || typeof document === "undefined") return root || null;
    const existing = behaviorState.get(root);
    if (existing) return root;
    const panel = root.querySelector("[data-shared-task-drawer-panel]");
    if (!panel || !isVisible(root)) return root;
    const previousFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const config = options || {};
    const state = { closed: false, previousFocus, panel };
    const cleanup = () => {
      if (state.closed) return;
      state.closed = true;
      root.dataset.sharedTaskDrawerState = "closed";
      unlockBodyScroll();
      if (state.previousFocus?.isConnected && typeof state.previousFocus.focus === "function") {
        state.previousFocus.focus({ preventScroll: true });
      }
    };
    const onClose = event => {
      cleanup();
      if (typeof config.onClose === "function") config.onClose(event);
    };
    const onClick = event => {
      if (event.target?.closest?.("[data-shared-task-drawer-close]")) {
        if (typeof config.onClose === "function") event.preventDefault();
        onClose(event);
      }
    };
    const onKeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        const closeButton = root.querySelector("button[data-shared-task-drawer-close]");
        if (closeButton) closeButton.click();
        else cleanup();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusableNodes(panel);
      if (!nodes.length) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    root.addEventListener("click", onClick, true);
    root.addEventListener("keydown", onKeydown);
    root.dataset.sharedTaskDrawerEnhanced = "true";
    root.dataset.sharedTaskDrawerState = "open";
    behaviorState.set(root, { cleanup, onClose });
    lockBodyScroll();
    const initialFocus = root.querySelector("button.shared-task-drawer-close") || panel;
    if (typeof initialFocus.focus === "function") initialFocus.focus({ preventScroll: true });
    return root;
  }

  function installBehavior() {
    if (behaviorInstalled || typeof document === "undefined" || typeof MutationObserver !== "function") return;
    behaviorInstalled = true;
    const start = () => {
      if (!document.body) return;
      const scan = () => document.querySelectorAll("[data-shared-task-drawer]").forEach(root => enhance(root));
      scan();
      const observer = new MutationObserver(scan);
      observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  function mount(target, options) {
    if (!target) return null;
    target.innerHTML = render(options);
    const root = target.querySelector("[data-shared-task-drawer]");
    if (!root) return null;
    enhance(root, options);
    return root;
  }

  installBehavior();
  return Object.freeze({ escapeHtml, renderProperties, render, mount, enhance });
});
