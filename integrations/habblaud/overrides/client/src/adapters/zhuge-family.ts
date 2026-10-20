import type { AgentInfo } from '../../../shared/types';

/**
 * Stable non-worker residents for the Pixel Office.
 *
 * These records intentionally use the native AgentInfo wire shape so the
 * existing Habblaud Sim owns spawning, WalkGrid routing, furniture collision,
 * seating and disappearance.  `zhugeResident` is an additive local marker;
 * it never supplies a TaskFlow run, provider session or work status.
 */
export type ZhugeResidentKind = 'family' | 'pet';

export interface ZhugeFamilyResident {
  id: string;
  name: string;
  kind: ZhugeResidentKind;
  look: 'f' | 'm';
  seed: number;
  role: string;
  intro: string;
  parts?: AgentInfo['parts'];
}

export const ZHUGE_FAMILY_RESIDENTS: readonly ZhugeFamilyResident[] = [
  {
    id: 'zhuge-family-beidili', name: '背地裡', kind: 'family', look: 'f', seed: 7801,
    role: '家庭生活角色', intro: '固定家庭生活角色；不代表真人位置、工作或任務狀態。',
    parts: { hairStyle: 'long', topStyle: 'blouse', top: '#e7a1b8', topAccent: '#fff1f5', bottom: '#5d547b', bottomStyle: 'skirt', accessory: 'earrings', accessoryColor: '#f5c85b' },
  },
  {
    id: 'zhuge-family-anan', name: '安安', kind: 'family', look: 'f', seed: 7802,
    role: '家庭生活角色', intro: '陽光、活潑、愛打扮的固定家庭生活角色；不代表真人資訊。',
    parts: { hairStyle: 'ponytail', topStyle: 'blouse', top: '#f3c85b', topAccent: '#fff7d6', bottom: '#4f88a8', accessory: 'bow', accessoryColor: '#f4879b' },
  },
  {
    id: 'zhuge-family-kaka', name: '卡卡', kind: 'family', look: 'f', seed: 7803,
    role: '家庭生活角色', intro: '活潑、調皮、喜歡跑步的固定家庭生活角色；不代表真人資訊。',
    parts: { hairStyle: 'pigtails', topStyle: 'tshirt', top: '#79c98a', topAccent: '#eaffda', bottom: '#ed8d52', bottomStyle: 'shorts', accessory: 'cap', accessoryColor: '#4c76bc' },
  },
  {
    id: 'zhuge-pet-blackgray-cat', name: '黑灰色小貓', kind: 'pet', look: 'm', seed: 7804,
    role: '家庭寵物角色', intro: '黑灰色虛擬小貓；只顯示像素場景活動，不代表真實寵物位置或資料。',
  },
];

export function residentAgent(resident: ZhugeFamilyResident, roomId: string, now: number): AgentInfo {
  return {
    id: resident.id,
    kind: 'main',
    roomId,
    name: resident.name,
    look: resident.look,
    role: resident.role,
    title: '生活角色｜非 AI Worker｜僅顯示虛擬活動',
    sessionId: `zhuge-resident-${resident.id}`,
    account: 'zhuge-family-cast',
    status: 'idle',
    zhugeResident: resident.kind,
    activity: {
      id: `zhuge-resident-intro-${resident.id}`,
      kind: 'plan',
      icon: resident.kind === 'pet' ? '🐾' : '🏠',
      text: '生活角色｜非工程工作狀態',
      detail: resident.intro,
      at: now,
    },
    recent: [],
    tasks: [],
    startedAt: now,
    lastEventAt: now,
    statusSince: now,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: resident.seed,
    ...(resident.parts ? { parts: resident.parts } : {}),
  };
}
