/* Shared Functional Tabs DOM, accessibility and active-visibility authority. */
(function (root) {
  "use strict";
  const activeTabs = new WeakMap();
  const visibleRows = new WeakMap();
  const ICON = /^[\p{Extended_Pictographic}\p{S}](?:\uFE0F|\uFE0E)?(?:\u200D[\p{Extended_Pictographic}\p{S}](?:\uFE0F|\uFE0E)?)*$/u;
  const set = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };

  function tabsFor(row) {
    return Array.from(row.querySelectorAll('.zhuge-functional-tab')).filter(tab => tab.closest('.zhuge-functional-tabs') === row);
  }

  function iconAndLabel(tab) {
    const close = Array.from(tab.querySelectorAll('.tab-close'));
    const iconNode = Array.from(tab.querySelectorAll('[aria-hidden="true"]')).find(node => !node.classList.contains('tab-close'));
    let icon = iconNode?.textContent.trim() || '';
    const text = Array.from(tab.childNodes).filter(node => !close.some(control => node === control || node.contains?.(control)) && node !== iconNode)
      .map(node => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    let label = text;
    if (!icon) {
      const first = text.match(/^(\S+)(?:\s+|$)([\s\S]*)$/u);
      if (first && ICON.test(first[1]) && first[2]) { icon = first[1]; label = first[2].trim(); }
    } else {
      label = text.replace(new RegExp('^' + icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s+|$)'), '').trim();
    }
    return { icon, label, close };
  }

  function normalizeTab(tab) {
    if (tab.dataset.functionalTabNormalized === 'true') return;
    const { icon, label, close } = iconAndLabel(tab);
    const iconSlot = document.createElement('span');
    iconSlot.className = 'zhuge-functional-tab-icon';
    iconSlot.setAttribute('aria-hidden', 'true');
    iconSlot.textContent = icon;
    const labelSlot = document.createElement('span');
    labelSlot.className = 'zhuge-functional-tab-label';
    labelSlot.textContent = label;
    tab.replaceChildren(iconSlot, labelSlot, ...close);
    tab.dataset.functionalTabNormalized = 'true';
  }

  function keepVisible(row, tab) {
    if (!tab || row.clientWidth === 0) return;
    const bounds = row.getBoundingClientRect(), rect = tab.getBoundingClientRect();
    const edgeClearance = 1;
    if (rect.left < bounds.left + edgeClearance) row.scrollLeft += rect.left - bounds.left - edgeClearance;
    else if (rect.right > bounds.right - edgeClearance) row.scrollLeft += rect.right - bounds.right + edgeClearance;
  }

  function sync(row) {
    if (row.tagName !== 'NAV') throw new Error('Functional Tab row must use the canonical <nav> DOM contract.');
    const tabs = tabsFor(row);
    if (!tabs.length) return;
    if (tabs.some(tab => tab.parentElement !== row)) throw new Error('Functional Tabs must be direct children of their canonical row.');
    if (Array.from(row.children).some(child => !child.classList.contains('zhuge-functional-tab') && !child.classList.contains('zhuge-functional-tabs-actions'))) throw new Error('Functional Tab row contains a non-canonical child.');
    for (const tab of tabs) normalizeTab(tab);
    const navigation = row.dataset.functionalTabsMode === 'navigation' || tabs.some(tab => tab.tagName === 'A');
    set(row, 'role', navigation ? 'navigation' : 'tablist');
    const selected = tabs.find(tab => tab.classList.contains('active') || tab.classList.contains('is-active'));
    for (const tab of tabs) {
      if (navigation) {
        tab.removeAttribute('role');
        tab.removeAttribute('aria-selected');
        if (tab === selected) set(tab, 'aria-current', 'page');
        else if (tab.hasAttribute('aria-current')) tab.removeAttribute('aria-current');
      } else {
        set(tab, 'role', 'tab');
        set(tab, 'aria-selected', String(tab === selected));
        set(tab, 'tabindex', tab === (selected || tabs[0]) ? '0' : '-1');
        tab.removeAttribute('aria-current');
      }
    }
    const visible = row.clientWidth > 0;
    if (activeTabs.get(row) !== selected || (visible && !visibleRows.get(row))) {
      activeTabs.set(row, selected);
      keepVisible(row, selected);
    }
    visibleRows.set(row, visible);
  }

  function normalizePageRhythm() {
    document.querySelectorAll('[data-zhuge-page-rhythm="stacked-tabs"]').forEach(layout => {
      const stack = layout.querySelector(':scope > .zhuge-functional-tabs-stack');
      const content = layout.querySelector(':scope > .workspace-canvas');
      const secondary = content?.querySelector(':scope > .workspace-subnav.zhuge-functional-tabs');
      if (stack && secondary && secondary.parentElement !== stack) stack.append(secondary);
    });
  }

  function refresh() { normalizePageRhythm(); document.querySelectorAll('.zhuge-functional-tabs').forEach(sync); }
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

  root.ZhugeFunctionalTabs = Object.freeze({ refresh, sync, keepVisible, normalizeTab });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})(window);
