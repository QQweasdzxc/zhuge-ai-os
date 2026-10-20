import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { BLOCKED, FREE } from '../path/grid';
import { fallbackProjectStatus, toOfficeSnapshot, ZHUGE_CAST } from '../../adapters/zhuge-bridge';
import { ZHUGE_FAMILY_RESIDENTS } from '../../adapters/zhuge-family';
import { Sim } from './sim';

const T0 = 1_800_000_000_000;
const theme: RoomTheme = {
  carpet: '#4f6d8f', carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black',
};
const appearance: Appearance = {
  skin: '#f0c8a0', hair: '#3a2a20', hairStyle: 'short', eyes: '#222',
  top: '#3f7fd8', topAccent: '#fff', topStyle: 'tshirt', bottom: '#333',
  shoes: '#111', accessory: 'none', accessoryColor: '#000', lanyard: null, look: 'm',
};
const art = {
  appearanceFromSeed: () => appearance,
  roomTheme: () => theme,
} as unknown as ArtModule;

function makeSnapshot(): OfficeSnapshot {
  const room: RoomInfo = { id: '/p2-path-fixture', name: 'fixture', path: '/p2-path-fixture', slot: 0, seed: 71, createdAt: T0 };
  const agent: AgentInfo = {
    id: 'p2-path-fixture-agent', kind: 'main', roomId: room.id, name: 'Fixture', look: 'm',
    role: 'isolated path test fixture', sessionId: 'fixture-session', account: 'fixture-account', status: 'idle',
    recent: [], tasks: [], startedAt: T0, lastEventAt: T0, statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: 71,
  };
  return {
    rev: 1, serverTime: T0, rooms: [room], agents: [agent], accounts: [],
    meta: { demo: true, sources: [], startedAt: T0, version: 'isolated-p2-path-fixture' },
  };
}

describe('P2 #72 native simulation no-path guard', () => {
  it('uses Habblaud idle outings for the fixed cast while keeping every tile on the native WalkGrid', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'lively' }), null);
    const snapshot = toOfficeSnapshot(fallbackProjectStatus(T0), null, 1, T0, T0, false);
    sim.applySnapshot(snapshot, T0);
    expect([...sim.chars.values()].map((ch) => ch.id)).toEqual([
      ...ZHUGE_CAST.map((member) => member.id),
      ...ZHUGE_FAMILY_RESIDENTS.map((member) => member.id),
    ]);

    let observedIdleRoam = false;
    let now = T0;
    for (let frame = 0; frame < 1800; frame++) {
      const previous = new Map([...sim.chars.values()].map((ch) => [ch.id, { x: ch.x, y: ch.y }]));
      now += 1000 / 30;
      sim.update(1 / 30, now);
      for (const ch of sim.chars.values()) {
        expect(ch.mode).toBe('idle');
        if (ch.info.zhugeResident) expect(ch.info.status).toBe('idle');
        const before = previous.get(ch.id)!;
        if (ch.x !== before.x || ch.y !== before.y) observedIdleRoam = true;
        if (!ch.inside && !ch.atSpot) expect(sim.building.grid.walkable(ch.tx, ch.ty)).toBe(true);
      }
    }
    expect(observedIdleRoam).toBe(true);
  });

  it('keeps a character in place, clears a blocked plan and waits when no legal route exists', () => {
    const sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }), null);
    sim.applySnapshot(makeSnapshot(), T0);
    const character = sim.chars.get('p2-path-fixture-agent');
    expect(character).toBeDefined();
    const ch = character!;
    const before = { x: ch.x, y: ch.y, tx: ch.tx, ty: ch.ty };
    const grid = sim.building.grid;
    const goal = { x: Math.min(grid.w - 1, ch.tx + 2), y: ch.ty };

    // Two disconnected walkable cells model a route made invalid by a wall/layout change.
    grid.cells.fill(BLOCKED);
    grid.set(ch.tx, ch.ty, FREE);
    grid.set(goal.x, goal.y, FREE);
    const reserved = sim.building.spots.find((spot) => spot.id !== ch.homeSpot && sim.spots.isFree(spot.id, ch.id));
    expect(reserved).toBeDefined();
    expect(sim.spots.reserve(reserved!.id, ch.id)).toBe(true);
    ch.tempSpots.push(reserved!.id);
    ch.queue.push({ t: 'act', pose: 'walk', ms: 1000 });

    const stepGo = (sim as unknown as { stepGo(character: typeof ch, step: { t: 'go'; tx: number; ty: number; path?: number[]; i?: number }, dt: number): boolean }).stepGo.bind(sim);
    const completed = stepGo(ch, { t: 'go', tx: goal.x, ty: goal.y }, 1 / 30);

    expect(completed).toBe(true);
    expect({ x: ch.x, y: ch.y, tx: ch.tx, ty: ch.ty }).toEqual(before);
    expect(ch.queue).toEqual([]);
    expect(ch.thinkAt).toBe(T0 + 1500);
    expect(sim.spots.ownerOf(reserved!.id)).toBeUndefined();
  });
});
