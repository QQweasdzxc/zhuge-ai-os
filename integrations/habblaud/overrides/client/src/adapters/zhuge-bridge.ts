import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';

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
  // Project/PR snapshots are information, not evidence of a person or live
  // session. They are deliberately rendered in the read-only HUD panel only.
  void status;
  void now;
  return [];
}

/** Fixed cast identity. These are scene roles, never provider/session/work evidence. */
export const ZHUGE_CAST = [
  { id: 'zhuge-crew-pm', name: 'Jackal', duty: 'PM／諸葛 AI OS 決策者', intro: '負責方向、裁示與作品驗收；這是固定像素角色。' },
  { id: 'zhuge-crew-gpt', name: 'GPT', duty: 'PM 助理／協作 AI', intro: '負責規劃與審查；此固定角色不代表目前有背景工作正在執行。' },
  { id: 'zhuge-crew-codex', name: 'Codex', duty: '首席工程師', intro: '負責主要開發交付；此固定角色不代表目前有 Codex Run 正在執行。' },
  { id: 'zhuge-crew-gem', name: 'Gem', duty: '第二工程師', intro: '負責協作開發；此固定角色不代表 Gemini Provider 已連線。' },
] as const;

/** Convert to Habblaud's actual OfficeSnapshot contract so the procedural pixel renderer receives real room/agent data. */
export function toOfficeSnapshot(
  status: ZhugeProjectStatus,
  live: OfficeSnapshot | null,
  rev: number,
  now = Date.now(),
  sessionStartedAt = now,
  streamOpen = false,
): OfficeSnapshot {
  const verified = verifiedHabblaudSnapshot(live, streamOpen, now);
  const startSlot = Math.max(-1, ...(verified?.rooms || []).map(r => r.slot)) + 1;
  // Fixed roles are renderer characters, not connected CLI agents. Their
  // account/session identifiers are explicitly synthetic and status is fixed idle.
  const crewRoomId = 'zhuge-room-crew';
  const crewRoom: RoomInfo = {
    id: crewRoomId, name: '諸葛 AI OS｜固定角色', path: '/zhuge-ai-os/crew',
    slot: startSlot, seed: seed(crewRoomId), createdAt: sessionStartedAt,
  };
  const crewAgents: AgentInfo[] = ZHUGE_CAST.map(member => ({
    id: member.id, kind: 'main',
    roomId: crewRoomId, name: member.name, look: 'm',
    role: '固定像素角色（非真人位置／非 Provider Session）｜' + member.duty,
    title: '固定角色｜尚無可驗證的即時工作狀態',
    sessionId: 'zhuge-role-' + member.id, account: 'zhuge-fixed-cast',
    status: 'idle',
    activity: {
      id: 'zhuge-role-intro-' + member.id,
      kind: 'plan', icon: '👋', text: '固定像素角色｜非實際工作狀態',
      detail: member.intro, at: sessionStartedAt,
    },
    recent: [], tasks: [], startedAt: sessionStartedAt,
    lastEventAt: sessionStartedAt, statusSince: sessionStartedAt,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed(member.id),
  }));
  return {
    rev, serverTime: now,
    rooms: [...(verified?.rooms || []), crewRoom],
    agents: [...(verified?.agents || []), ...crewAgents],
    accounts: verified?.accounts || [],
    meta: verified ? { ...verified.meta, terminal: false, messages: false } : {
      demo: false, sources: [], startedAt: sessionStartedAt, version: 'Zhuge Pixel v1 (snapshot)',
      terminal: false, messages: false,
    },
  };
}

/**
 * A live Habblaud session is accepted only while its SSE is open and the
 * payload proves a non-demo, active source + matching account + main agent.
 * Static project status, demo snapshots, subagents and stale API snapshots
 * cannot create people or change their work status.
 */
export function verifiedHabblaudSnapshot(
  input: OfficeSnapshot | null,
  streamOpen: boolean,
  now = Date.now(),
): OfficeSnapshot | null {
  if (!streamOpen || !input || input.meta?.demo !== false ||
      !Array.isArray(input.rooms) || !Array.isArray(input.agents) ||
      !Array.isArray(input.accounts) || !Array.isArray(input.meta?.sources)) return null;
  const serverTime = input.serverTime;
  if (!Number.isFinite(serverTime) || serverTime > now + 60_000 || now - serverTime > 60_000) return null;
  const accounts = new Map(input.accounts
    .filter(a => a && typeof a.id === 'string' && a.id && !a.id.startsWith('demo:') && Number.isFinite(a.sessions) && a.sessions > 0)
    .map(a => [a.id, a] as const));
  const sources = new Map(input.meta.sources
    .filter(s => s && s.ok === true && typeof s.label === 'string' && s.label &&
      !s.label.startsWith('demo:') && Number.isFinite(s.sessions) && s.sessions > 0)
    .map(s => [s.label, s] as const));
  const agents = input.agents.filter(a => {
    if (!a || a.kind !== 'main' || typeof a.id !== 'string' || !a.id || a.id.startsWith('demo:') ||
        typeof a.roomId !== 'string' || !a.roomId || a.roomId.startsWith('demo:') ||
        typeof a.sessionId !== 'string' || !a.sessionId || a.sessionId.startsWith('demo:') ||
        typeof a.account !== 'string' || !a.account || a.status === 'offline' ||
        !['working', 'waiting', 'idle', 'shell', 'done', 'offline'].includes(a.status) ||
        (a.provider !== undefined && a.provider !== 'claude' && a.provider !== 'codex')) return false;
    const account = accounts.get(a.account);
    const source = sources.get(a.account);
    const provider = a.provider ?? 'claude';
    return !!account && !!source && (account.provider ?? 'claude') === provider &&
      (source.provider ?? 'claude') === provider;
  });
  if (!agents.length) return null;
  const roomIds = new Set(agents.map(a => a.roomId));
  const accountIds = new Set(agents.map(a => a.account));
  return {
    ...input,
    rooms: input.rooms.filter(r => roomIds.has(r.id) && !r.id.startsWith('demo:')),
    agents,
    accounts: input.accounts.filter(a => accountIds.has(a.id)).map(a => ({
      ...a, email: undefined, organization: undefined, configDir: '',
    })),
    meta: {
      ...input.meta,
      sources: input.meta.sources.filter(s => sources.has(s.label) && accountIds.has(s.label)).map(s => ({
        ...s, path: '', error: undefined,
      })),
      terminal: false,
      messages: false,
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
