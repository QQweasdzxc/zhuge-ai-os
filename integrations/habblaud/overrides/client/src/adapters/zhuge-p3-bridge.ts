/** P3 display-only snapshot. It supplies scene characters, never current work evidence. */
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';

export const P3_ROLE_IDS = ['pm', 'co', 'gem', 'gpt', 'betty', 'anan', 'kaka'] as const;
export type P3RoleId = typeof P3_ROLE_IDS[number];

export const P3_ROLES: ReadonlyArray<{
  id: P3RoleId;
  name: string;
  kind: 'operator' | 'agent' | 'resident';
  title: string;
  description: string;
  roomId: string;
  look: 'm' | 'f';
}> = [
  { id: 'pm', name: 'PM', kind: 'operator', title: '產品決策者', description: '負責方向、正式決策與驗收。像素位置只是場景呈現，不是實際定位。', roomId: 'p3-room-work', look: 'm' },
  { id: 'co', name: 'Co', kind: 'agent', title: '首席工程師', description: '負責工程實作、整合與 QA。尚無可驗證的最新狀態。', roomId: 'p3-room-work', look: 'm' },
  { id: 'gem', name: 'Gem', kind: 'agent', title: '第二工程師', description: '依明確交接範圍協作開發。尚無可驗證的最新狀態。', roomId: 'p3-room-work', look: 'f' },
  { id: 'gpt', name: 'GPT', kind: 'agent', title: 'PM 助理／協作 AI', description: '協助需求整理、技術審查與驗收。尚無可驗證的最新狀態。', roomId: 'p3-room-meeting', look: 'f' },
  { id: 'betty', name: 'Betty', kind: 'resident', title: '虛擬生活型角色', description: '常在 Lounge 與休息區活動。僅為像素世界的虛擬活動，不追蹤真人。', roomId: 'p3-room-lounge', look: 'f' },
  { id: 'anan', name: '安安', kind: 'resident', title: '虛擬生活型角色', description: '偏好閱讀與休閒互動。僅為像素世界的虛擬活動，不追蹤真人。', roomId: 'p3-room-lounge', look: 'f' },
  { id: 'kaka', name: '卡卡', kind: 'resident', title: '虛擬生活型角色', description: '偏好活潑走動與休閒互動。僅為像素世界的虛擬活動，不追蹤真人。', roomId: 'p3-room-work', look: 'f' },
];

const P3_ROOM_DEFS = [
  { id: 'p3-room-work', name: '工程工作區與工具區', path: '/labs/pixel-office-p3-preview/#work-tools', slot: 0 },
  { id: 'p3-room-meeting', name: '會議室', path: '/labs/pixel-office-p3-preview/#meeting', slot: 1 },
  { id: 'p3-room-lounge', name: 'Lounge／閱讀休息區', path: '/labs/pixel-office-p3-preview/#lounge', slot: 2 },
] as const;

function seedFor(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function isP3RoleId(value: unknown): value is P3RoleId {
  return typeof value === 'string' && (P3_ROLE_IDS as readonly string[]).includes(value);
}

export function p3AgentId(roleId: P3RoleId): string {
  return `p3-role-${roleId}`;
}

/** Synthetic character presence is explicitly labeled as visual-only and has no task/status evidence. */
export function toP3OfficeSnapshot(rev: number, now = Date.now(), startedAt = now): OfficeSnapshot {
  // `OfficeSnapshot.rooms` only carries dynamic rooms: Habblaud's reception,
  // restroom, cafe, and lounge are native core areas. Listing them here would
  // create duplicate dynamic rooms on the same floor.
  const rooms: RoomInfo[] = P3_ROOM_DEFS.map(room => ({ ...room, seed: seedFor(room.id), createdAt: startedAt }));
  // Habblaud assigns visual slots by arrival order. Three interior zones occupy
  // two adjacent north/south columns beside the intact two-column core.
  const agents: AgentInfo[] = P3_ROLES.map(role => {
    const id = p3AgentId(role.id);
    const resident = role.kind === 'resident';
    const neutralTitle = resident ? '虛擬生活活動｜不追蹤真人位置或工作' : '尚無可驗證的最新狀態';
    return {
      id,
      kind: 'main',
      roomId: role.roomId,
      name: role.name,
      look: role.look,
      role: `${role.kind === 'resident' ? '虛擬居民' : role.title}｜展示角色，不代表即時人員位置`,
      title: neutralTitle,
      sessionId: `p3-visual-only-${role.id}`,
      account: 'p3-visual-only',
      status: 'idle',
      activity: {
        id: `p3-intro-${role.id}`,
        kind: 'plan',
        icon: resident ? '☕' : '•',
        text: resident ? '虛擬角色活動' : '尚無可驗證的最新狀態',
        detail: role.description,
        at: startedAt,
      },
      recent: [],
      tasks: [],
      startedAt,
      lastEventAt: startedAt,
      statusSince: startedAt,
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
      seed: seedFor(id),
    } satisfies AgentInfo;
  });
  return {
    rev,
    serverTime: now,
    rooms,
    agents,
    accounts: [],
    meta: {
      // The character roster is a visual-only fixture, never live TaskFlow state.
      demo: true,
      sources: [],
      startedAt,
      version: 'Zhuge Pixel P3',
      terminal: false,
      messages: false,
    },
  };
}
