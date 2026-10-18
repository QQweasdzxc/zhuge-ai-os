import type { ZhugeProjectStatus } from '../adapters/zhuge-bridge';
import { isFreshStatus, ZHUGE_CAST } from '../adapters/zhuge-bridge';
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
/** Accessible roster uses the existing modal; it never overrides runtime status. */
export function showZhugeRole(agentId: string): void {
  const role = ZHUGE_CAST.find(candidate => candidate.id === agentId);
  if (!role) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const title = el('h2', '三位主角 · 角色介紹');
  const close = el('button', '關閉');
  close.setAttribute('type', 'button');
  close.onclick = () => { if (panel) panel.hidden = true; };
  const roster = el('nav');
  roster.className = 'zhuge-role-roster';
  roster.setAttribute('aria-label', '切換辦公室角色');
  for (const person of ZHUGE_CAST) {
    const item = el('button', person.name);
    item.setAttribute('type', 'button');
    item.setAttribute('aria-pressed', String(person.id === agentId));
    item.onclick = () => showZhugeRole(person.id);
    roster.append(item);
  }
  const name = el('h3', role.name + '｜' + role.duty);
  const content = el('p', role.intro);
  const status = el('p', '目前呈現：角色待命（場景裝飾）');
  status.className = 'zhuge-role-label';
  const truth = el('p', '資料說明：這不是 Co、Gem、PM 的即時 CLI／任務執行證明。真正自動狀態與雲端小幫手會在 P3 接通事件後才顯示。');
  truth.className = 'zhuge-role-provenance';
  panel.append(title, close, roster, name, content, status, truth);
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
  const roster = el('button', '👥 人員');
  roster.setAttribute('type', 'button');
  roster.addEventListener('click', () => showZhugeRole(ZHUGE_CAST[0].id));
  const source = el('span', (live ? 'CLI 即時 + ' : '') + (fresh ? '狀態快照' : '過期狀態快照'));
  const classic = el('a', '經典報表');
  (classic as HTMLAnchorElement).href = new URL('../status-classic.html', location.href).href;
  (classic as HTMLAnchorElement).target = '_top';
  bar.append(dot, title, phase, milestone, blocked, roster, source, classic);
}
