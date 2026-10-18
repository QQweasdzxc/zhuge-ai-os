import type { ZhugeProjectStatus } from '../adapters/zhuge-bridge';
import { isFreshStatus } from '../adapters/zhuge-bridge';
import './zhuge-hud.css';

let current: ZhugeProjectStatus | null = null;
function el(tag: string, value = ''): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
}
export function showZhugeDecisions(): void {
  if (!current) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const heading = el('h2', '待裁示事項');
  const close = el('button', '關閉');
  close.onclick = () => { if (panel) panel.hidden = true; };
  panel.append(heading, close);
  for (const blocked of current.blocked_items || []) {
    const item = el('article');
    item.append(el('strong', blocked.title), el('p', blocked.reason));
    panel.append(item);
  }
  if (!current.blocked_items?.length) panel.append(el('p', '目前沒有待裁示紀錄。'));
  panel.append(el('h3', '下一步'));
  const list = el('ol');
  for (const action of current.next_actions || [])
    list.append(el('li', action.title + (action.assignee ? '（' + action.assignee + '）' : '')));
  panel.append(list);
  panel.hidden = false;
}
export function mountZhugeHud(status: ZhugeProjectStatus, live = false): void {
  current = status;
  let bar = document.getElementById('zhuge-aios-hud');
  if (!bar) {
    bar = el('header');
    bar.id = 'zhuge-aios-hud';
    document.body.append(bar);
  }
  bar.replaceChildren();
  const fresh = isFreshStatus(status);
  const dot = el('span', '●');
  dot.className = 'zhuge-light-' + (fresh ? status.overall_status : 'stale');
  const title = el('strong', status.project_name || 'AI OS');
  const phase = el('span', '階段：' + status.current_phase);
  const milestone = el('span', '里程碑：' + status.current_milestone);
  const blocked = el('button', '🙋 ' + (status.blocked_items?.length || 0) + ' 項待裁示');
  blocked.addEventListener('click', () => showZhugeDecisions());
  const source = el('span', (live ? 'CLI 即時 + ' : '') + (fresh ? '狀態快照' : '過期狀態快照'));
  const classic = el('a', '經典報表');
  (classic as HTMLAnchorElement).href = new URL('../status-classic.html', location.href).href;
  bar.append(dot, title, phase, milestone, blocked, source, classic);
}
