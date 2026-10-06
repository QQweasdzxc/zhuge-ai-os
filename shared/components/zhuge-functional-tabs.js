/* Shared Functional Tabs accessibility/visibility adapter.
 * Canonical classes opt in. Consumers retain all routing and panel handlers.
 */
(function (root) {
  "use strict";
  const activeTabs = new WeakMap();
  const visibleRows = new WeakMap();
  const set = (node, name, value) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  function tabsFor(row) {
    return Array.from(row.querySelectorAll('.zhuge-functional-tab')).filter(tab => tab.closest('.zhuge-functional-tabs') === row);
  }
  function keepVisible(row, tab) {
    if (!tab || row.clientWidth === 0) return;
    const bounds = row.getBoundingClientRect(), rect = tab.getBoundingClientRect();
    if (rect.left < bounds.left) row.scrollLeft += rect.left - bounds.left;
    else if (rect.right > bounds.right) row.scrollLeft += rect.right - bounds.right;
  }
  function normalizeIcon(tab) {
    // Existing GAS/Investment markup already separates decorative icons.
    const existing = tab.querySelector('span[aria-hidden="true"]');
    if (existing) { existing.dataset.functionalTabIcon = 'true'; return; }
    const label = tab.firstElementChild?.tagName === 'SPAN' && !tab.firstElementChild.classList.contains('tab-close') ? tab.firstElementChild : tab;
    const text = Array.from(label.childNodes).find(node => node.nodeType === 3 && node.textContent.trim());
    const match = text?.textContent.match(/^\s*([\p{Extended_Pictographic}\p{S}]\uFE0F?)\s+(.+)$/u);
    if (!match) return;
    const icon = document.createElement('span');
    icon.dataset.functionalTabIcon = 'true'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = match[1];
    text.replaceWith(icon, document.createTextNode(" " + match[2]));
  }
  function sync(row) {
    const tabs = tabsFor(row);
    if (!tabs.length) return;
    const navigation = row.dataset.functionalTabsMode === 'navigation' || tabs.some(tab => tab.tagName === 'A');
    set(row, 'role', navigation ? 'navigation' : 'tablist');
    const selected = tabs.find(tab => tab.classList.contains('active') || tab.classList.contains('is-active'));
    for (const tab of tabs) {
      normalizeIcon(tab);
      if (navigation) {
        tab.removeAttribute('role');
        tab.removeAttribute('aria-selected');
        if (tab === selected) set(tab, 'aria-current', 'page');
        else tab.removeAttribute('aria-current');
      } else {
        set(tab, 'role', 'tab');
        set(tab, 'aria-selected', String(tab === selected));
        set(tab, 'tabindex', tab === (selected || tabs[0]) ? '0' : '-1');
      }
    }
    const visible = row.clientWidth > 0;
    if (activeTabs.get(row) !== selected || (visible && !visibleRows.get(row))) { activeTabs.set(row, selected); keepVisible(row, selected); }
    visibleRows.set(row, visible);
  }
  function refresh() { document.querySelectorAll('.zhuge-functional-tabs').forEach(sync); }
  function boot() {
    refresh();
    new MutationObserver(refresh).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
    document.addEventListener('keydown', event => {
      const tab = event.target.closest?.('.zhuge-functional-tab');
      const row = tab?.closest('.zhuge-functional-tabs');
      if (!row || row.getAttribute('role') !== 'tablist' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      const tabs = tabsFor(row).filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
      if (!tabs.length) return;
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs.forEach(node => set(node, 'tabindex', node === tabs[next] ? '0' : '-1'));
      tabs[next].focus(); keepVisible(row, tabs[next]);
    });
    root.addEventListener('resize', () => document.querySelectorAll('.zhuge-functional-tabs').forEach(row => keepVisible(row, activeTabs.get(row))));
  }
  root.ZhugeFunctionalTabs = Object.freeze({ refresh, sync, keepVisible });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
