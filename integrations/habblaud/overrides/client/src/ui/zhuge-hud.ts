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
/** Static modules and PRs remain a read-only project summary, never scene people. */
export function showZhugeStatus(): void {
  if (!current) return;
  let panel = document.getElementById('zhuge-decision-panel');
  if (!panel) {
    panel = el('aside');
    panel.id = 'zhuge-decision-panel';
    document.body.append(panel);
  }
  panel.replaceChildren();
  const close = el('button', '關閉');
  close.setAttribute('type', 'button');
  close.onclick = () => { if (panel) panel.hidden = true; };
  const updated = Date.parse(current.updated_at);
  const freshness = isFreshStatus(current) ? '快照仍在有效時間內' : '快照已過期';
  const observed = Number.isFinite(updated) ? new Date(updated).toLocaleString('zh-TW') : '時間無效';
  panel.append(el('h2', '專案狀態｜唯讀快照'), close,
    el('p', current.project_name + '｜' + current.overall_status),
    el('p', '最後更新：' + observed + '｜' + freshness),
    el('p', '來源：status/project-status.json。這是靜態專案紀錄，不代表任何人或 AI 正在工作。'),
    el('p', current.summary || '尚無摘要。'));
  panel.append(el('h3', '模組資訊'));
  if (current.active_modules.length) {
    const modules = el('ul');
    for (const item of current.active_modules) {
      const row = el('li', item.name + '｜' + item.status + (item.description ? '｜' + item.description : ''));
      modules.append(row);
    }
    panel.append(modules);
  } else panel.append(el('p', '尚無模組快照。'));
  panel.append(el('h3', 'GitHub PR 紀錄'));
  if (current.recent_prs.length) {
    const prs = el('ul');
    for (const item of current.recent_prs) {
      const row = el('li');
      row.append(el('span', item.id + '｜' + item.title + '｜' + item.status));
      if (item.url && /^https:\/\/github\.com\//.test(item.url)) {
        const link = el('a', ' 開啟 GitHub');
        (link as HTMLAnchorElement).href = item.url;
        (link as HTMLAnchorElement).target = '_blank';
        (link as HTMLAnchorElement).rel = 'noopener noreferrer';
        row.append(link);
      }
      prs.append(row);
    }
    panel.append(prs);
  } else panel.append(el('p', '尚無 PR 紀錄。'));
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
  const title = el('h2', '固定角色 · 角色介紹');
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
  const truth = el('p', '資料說明：固定像素角色不是真人位置或 Provider Session，也不代表 AI 正在工作。即時工程狀態只在可信來源驗證成功時顯示。');
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
  const project = el('button', '📋 專案狀態');
  project.setAttribute('type', 'button');
  project.addEventListener('click', () => showZhugeStatus());
  const roster = el('button', '👥 人員');
  roster.setAttribute('type', 'button');
  roster.addEventListener('click', () => showZhugeRole(ZHUGE_CAST[0].id));
  const source = el('span', (live ? 'CLI 即時 + ' : '') + (fresh ? '狀態快照' : '過期狀態快照'));
  const classic = el('a', '經典報表');
  (classic as HTMLAnchorElement).href = new URL('../status-classic.html', location.href).href;
  (classic as HTMLAnchorElement).target = '_top';
  bar.append(dot, title, phase, milestone, blocked, project, roster, source, classic);
}
