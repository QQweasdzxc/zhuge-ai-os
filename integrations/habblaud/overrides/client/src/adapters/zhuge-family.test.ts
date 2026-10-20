import { describe, expect, it } from 'vitest';
import { residentAgent, ZHUGE_FAMILY_RESIDENTS } from './zhuge-family';

describe('P2 #78 family and pet resident contract', () => {
  it('defines exactly three family residents and one pet with stable identities', () => {
    expect(ZHUGE_FAMILY_RESIDENTS.map((resident) => resident.name)).toEqual(['背地裡', '安安', '卡卡', '黑灰色小貓']);
    expect(ZHUGE_FAMILY_RESIDENTS.filter((resident) => resident.kind === 'family')).toHaveLength(3);
    expect(ZHUGE_FAMILY_RESIDENTS.filter((resident) => resident.kind === 'pet')).toHaveLength(1);
    expect(new Set(ZHUGE_FAMILY_RESIDENTS.map((resident) => resident.id)).size).toBe(4);
  });

  it('keeps residents idle, provider-less and task-less while using the native agent shape', () => {
    const now = 1_800_000_000_000;
    const agents = ZHUGE_FAMILY_RESIDENTS.map((resident) => residentAgent(resident, 'zhuge-room-crew', now));
    expect(agents.every((agent) => agent.status === 'idle' && agent.provider === undefined)).toBe(true);
    expect(agents.every((agent) => agent.tasks.length === 0 && agent.stats.toolCalls === 0)).toBe(true);
    expect(agents.map((agent) => agent.zhugeResident)).toEqual(['family', 'family', 'family', 'pet']);
    expect(agents.every((agent) => agent.title?.includes('非 AI Worker'))).toBe(true);
  });
});
