import type { AgentInfo, AgentStatus, OfficeSnapshot, RoomInfo } from '../../../shared/types';

export interface ZhugeProjectStatus {
  project_name: string;
  overall_status: 'healthy' | 'warning' | 'blocked';
  current_phase: string;
  current_milestone: string;
  updated_at: string;
  summary: string;
  active_modules: Array<{ name: string; status: string; owner?: string; description?: string }>;
  blocked_items: Array<{ title: string; reason: string; module?: string }>;
  next_actions: Array<{ title: string; assignee?: string }>;
  recent_prs: Array<{ id: string; title: string; status: string; url?: string }>;
}

export interface HabblaudRoomPayload {
  id: string;
  projectName: string;
  lightsOn: boolean;
  agents: Array<{
    id: string;
    name: string;
    provider: 'claude' | 'codex';
    isSubagent: boolean;
    status: 'working' | 'waiting_permission' | 'waiting_input' | 'running_cmd' | 'idle' | 'done';
    currentTask: string;
    detailText: string;
    hasPackage?: boolean;
  }>;
}

/** Static project data is a timestamped snapshot, never proof of a live CLI session. */
export function isFreshStatus(status: ZhugeProjectStatus, now = Date.now()): boolean {
  const updated = Date.parse(status.updated_at);
  return Number.isFinite(updated) && updated <= now + 60_000 && now - updated <= 5 * 60_000;
}
function safe(v: unknown, max = 240): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}
function stableId(v: string): string {
  return encodeURIComponent(v.normalize('NFKC').slice(0, 90));
}
function seed(v: string): number {
  let hash = 2166136261;
  for (let i = 0; i < v.length; i++) hash = Math.imul(hash ^ v.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function convertStatusToPixelRooms(status: ZhugeProjectStatus, now = Date.now()): HabblaudRoomPayload[] {
  const fresh = isFreshStatus(status, now);
  const modules = Array.isArray(status.active_modules) ? status.active_modules.slice(0, 24) : [];
  const blocked = Array.isArray(status.blocked_items) ? status.blocked_items : [];
  const prs = Array.isArray(status.recent_prs) ? status.recent_prs.slice(0, 24) : [];
  const rooms = modules.map((mod, index) => {
    const name = safe(mod.name, 90) || '未命名模組';
    const hold = blocked.find(b => b.module === name) || (index === 0 ? blocked.find(b => !b.module) : undefined);
    const pr = prs[index];
    const running = mod.status === 'running' || mod.status === 'working';
    const statusLabel: HabblaudRoomPayload['agents'][number]['status'] =
      hold ? 'waiting_input' : fresh && running ? 'working'
      : mod.status === 'done' ? 'done' : 'idle';
    const agent = {
      id: 'zhuge-module-' + stableId(name),
      name: safe(mod.owner, 80) || 'AI OS 狀態觀察員',
      provider: 'codex' as const,
      isSubagent: false,
      status: statusLabel,
      currentTask: hold ? '待裁示：' + safe(hold.title) : safe(mod.description) || name + '｜' + safe(mod.status),
      detailText: hold ? '原因：' + safe(hold.reason) : '階段：' + safe(status.current_phase) + '／里程碑：' + safe(status.current_milestone),
    };
    const agents: HabblaudRoomPayload['agents'] = [agent];
    if (pr && safe(pr.id)) {
      agents.push({
        id: 'zhuge-pr-' + stableId(pr.id),
        name: 'PR 紀錄員 ' + safe(pr.id, 32),
        provider: 'codex',
        isSubagent: true,
        status: pr.status === 'merged' ? 'done' : 'idle',
        currentTask: '📦 PR 紀錄：' + safe(pr.title),
        detailText: '上次同步狀態：' + safe(pr.status),
        hasPackage: true,
      });
    }
    return {
      id: 'zhuge-room-' + stableId(name),
      projectName: name,
      // The native scene controls visible lights from agent presence/status.
      lightsOn: !!hold || (fresh && running),
      agents,
    };
  });
  if (!rooms.length) {
    const first = blocked[0];
    rooms.push({
      id: 'zhuge-room-hq', projectName: safe(status.project_name) || 'AI OS 指揮總部', lightsOn: true,
      agents: [{
        id: 'zhuge-hq-observer', name: 'AI OS 狀態觀察員', provider: 'codex',
        isSubagent: false, status: first ? 'waiting_input' : 'idle',
        currentTask: first ? '待裁示：' + safe(first.title) : safe(status.summary) || '等待下一次狀態更新',
        detailText: first ? safe(first.reason) : '靜態狀態快照，不代表 CLI 已接單',
      }],
    });
  }
  return rooms;
}

/** Three decorative team characters. Not a provider, session, or work-status authority. */
export const ZHUGE_CAST = [
  { id: 'zhuge-crew-pm', name: 'PM', duty: '諸葛 AI OS 決策者', intro: '負責方向、裁示與作品驗收；點選可查看角色設定。' },
  { id: 'zhuge-crew-codex', name: 'Codex', duty: '首席工程師／組長', intro: '負責主要開發與工程交付；雲端小幫手須等 P3 接上真實事件才能增生。' },
  { id: 'zhuge-crew-gem', name: 'Gem', duty: '第二工程師／組長', intro: '負責獨立任務、前端與協作；此角色不代表 Gemini API 已連線。' },
] as const;

function nativeStatus(v: HabblaudRoomPayload['agents'][number]['status']): AgentStatus {
  if (v === 'waiting_permission' || v === 'waiting_input') return 'waiting';
  if (v === 'running_cmd') return 'shell';
  return v;
}

/** Convert to Habblaud's actual OfficeSnapshot contract so the procedural pixel renderer receives real room/agent data. */
export function toOfficeSnapshot(
  status: ZhugeProjectStatus,
  live: OfficeSnapshot | null,
  rev: number,
  now = Date.now(),
  sessionStartedAt = now,
): OfficeSnapshot {
  const rooms = convertStatusToPixelRooms(status, now);
  const startSlot = Math.max(-1, ...(live?.rooms || []).map(r => r.slot)) + 1;
  const mappedRooms: RoomInfo[] = rooms.map((r, i) => ({
    id: r.id, name: r.projectName, path: '/zhuge-ai-os/status/' + r.id,
    slot: startSlot + i, seed: seed(r.id), createdAt: sessionStartedAt,
  }));
  const mappedAgents: AgentInfo[] = rooms.flatMap(room => room.agents.map(a => {
    const s = nativeStatus(a.status);
    const taskText = (isFreshStatus(status, now) ? '[狀態快照] ' : '[過期快照] ') + a.currentTask;
    return {
      id: a.id, kind: a.isSubagent ? 'sub' : 'main', provider: a.provider,
      ...(a.isSubagent ? { parentId: room.agents[0].id } : {}),
      roomId: room.id, name: a.name, look: 'm', role: a.isSubagent ? 'PR 狀態紀錄' : 'AI OS 狀態代理（非 CLI 真實連線）',
      title: taskText, sessionId: 'zhuge-status-' + stableId(a.id), account: 'zhuge-status',
      status: s, ...(s === 'waiting' ? { waitingFor: a.detailText } : {}),
      activity: { id: a.id + '-' + rev, kind: s === 'waiting' ? 'ask' : 'plan', icon: s === 'waiting' ? '🙋' : '📋', text: taskText, detail: a.detailText, at: now },
      recent: [], tasks: [], startedAt: sessionStartedAt, lastEventAt: now, statusSince: now,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
      seed: seed(a.id),
    } satisfies AgentInfo;
  }));
  // P2 fixed cast is a native Habblaud room, always idle even when the manual
  // JSON looks fresh. Do not interpret an idle sprite as an authenticated CLI.
  const crewRoomId = 'zhuge-room-crew';
  const crewRoom: RoomInfo = {
    id: crewRoomId, name: '諸葛 AI OS｜角色辦公桌', path: '/zhuge-ai-os/crew',
    slot: startSlot + mappedRooms.length, seed: seed(crewRoomId), createdAt: sessionStartedAt,
  };
  const crewAgents: AgentInfo[] = ZHUGE_CAST.map(member => ({
    id: member.id, kind: 'main', provider: 'codex',
    roomId: crewRoomId, name: member.name, look: 'm',
    role: '展示角色（非 CLI 真實連線）｜' + member.duty,
    title: '待命展示｜尚無真實工程事件來源',
    sessionId: 'zhuge-showcase-' + member.id, account: 'zhuge-showcase-only',
    status: 'idle',
    activity: {
      id: 'zhuge-showcase-intro-' + member.id,
      kind: 'plan', icon: '👋', text: '待命展示｜非實際執行',
      detail: member.intro, at: sessionStartedAt,
    },
    recent: [], tasks: [], startedAt: sessionStartedAt,
    lastEventAt: sessionStartedAt, statusSince: sessionStartedAt,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed(member.id),
  }));
  return {
    rev, serverTime: now,
    rooms: [...(live?.rooms || []), ...mappedRooms, crewRoom],
    agents: [...(live?.agents || []), ...mappedAgents, ...crewAgents],
    accounts: live?.accounts || [],
    meta: live ? { ...live.meta, terminal: false, messages: false } : {
      demo: false, sources: [], startedAt: sessionStartedAt, version: 'Zhuge Pixel v1 (snapshot)',
      terminal: false, messages: false,
    },
  };
}

export function fallbackProjectStatus(now = Date.now()): ZhugeProjectStatus {
  return {
    project_name: 'Zhuge AI OS', overall_status: 'warning', current_phase: '靜態快照暫不可用',
    current_milestone: '等待狀態來源', updated_at: new Date(now - 3600_000).toISOString(),
    summary: '目前未取得專案狀態，辦公室維持待命，不代表有 AI 正在執行。',
    active_modules: [], blocked_items: [], next_actions: [], recent_prs: [],
  };
}

export function validateProjectStatus(input: unknown): ZhugeProjectStatus {
  const d = input as Partial<ZhugeProjectStatus> | null;
  if (!d || typeof d !== 'object' || typeof d.project_name !== 'string' || typeof d.updated_at !== 'string' ||
      !Array.isArray(d.active_modules) || !Array.isArray(d.blocked_items) ||
      !Array.isArray(d.next_actions) || !Array.isArray(d.recent_prs)) throw new Error('Invalid project-status.json');
  return {
    project_name: safe(d.project_name), overall_status: ['healthy', 'warning', 'blocked'].includes(d.overall_status || '') ? d.overall_status! : 'warning',
    current_phase: safe(d.current_phase), current_milestone: safe(d.current_milestone),
    updated_at: safe(d.updated_at, 80), summary: safe(d.summary, 2000),
    active_modules: d.active_modules.slice(0, 24).map(m => ({ name: safe(m.name), status: safe(m.status), owner: safe(m.owner), description: safe(m.description, 500) })),
    blocked_items: d.blocked_items.slice(0, 60).map(b => ({ title: safe(b.title), reason: safe(b.reason, 800), module: safe(b.module) })),
    next_actions: d.next_actions.slice(0, 60).map(a => ({ title: safe(a.title), assignee: safe(a.assignee) })),
    recent_prs: d.recent_prs.slice(0, 24).map(p => ({ id: safe(p.id), title: safe(p.title), status: safe(p.status), url: typeof p.url === 'string' && /^https:\/\/github\.com\//.test(p.url) ? p.url : undefined })),
  };
}

export async function syncAiOsStatus(
  statusUrl = './status/project-status.json',
  onUpdate: (status: ZhugeProjectStatus, rooms: HabblaudRoomPayload[]) => void,
): Promise<void> {
  try {
    const url = new URL(statusUrl, window.location.href);
    url.searchParams.set('t', String(Date.now()));
    const res = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = validateProjectStatus(await res.json());
    onUpdate(data, convertStatusToPixelRooms(data));
  } catch (error) {
    console.warn('[AI OS Pixel Bridge] 專案狀態檔無法讀取，顯示待命狀態', error);
    const fallback = fallbackProjectStatus();
    onUpdate(fallback, convertStatusToPixelRooms(fallback));
  }
}
