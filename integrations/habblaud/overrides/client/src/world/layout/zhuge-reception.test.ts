import { describe, expect, it } from 'vitest';
import { assembleBuilding, coreAreas } from './building';
import { NORTH_Y, TILE } from '../constants';
import { PathFinder } from '../path/astar';

describe('Zhuge reception native meeting-room overlay', () => {
  it('keeps the meeting room enclosed while preserving a walkable two-tile door', () => {
    const building = assembleBuilding(1, []);
    const grid = building.grid;
    const start = { x: 12, y: NORTH_Y + 10 };
    const reachable = grid.reachableFrom(start.x, start.y);
    const idx = (x: number, y: number) => reachable[y * grid.w + x];

    expect(grid.get(8, NORTH_Y + 5)).toBe(0); // solid west partition
    expect(grid.get(10, NORTH_Y + 9)).toBe(0); // solid south wall
    expect(grid.get(13, NORTH_Y + 9)).toBe(0);
    expect(grid.walkable(11, NORTH_Y + 9)).toBe(true);
    expect(grid.walkable(12, NORTH_Y + 9)).toBe(true);
    expect(idx(11, NORTH_Y + 7)).toBe(1); // reachable room interior
    expect(grid.get(11, NORTH_Y + 4)).toBe(0); // table footprint blocks movement
  });

  it('routes through the real doorway without crossing walls or furniture', () => {
    const grid = assembleBuilding(1, []).grid;
    const path: number[] = [];
    const start = { x: 12, y: NORTH_Y + 10 };
    const goal = { x: 11, y: NORTH_Y + 7 };
    expect(new PathFinder(grid).find(start.x, start.y, goal.x, goal.y, path)).toBe(true);
    let previous = start;
    let usedDoor = false;
    for (let i = 0; i < path.length; i += 2) {
      const tile = { x: path[i]!, y: path[i + 1]! };
      expect(Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y)).toBe(1);
      expect(grid.walkable(tile.x, tile.y)).toBe(true);
      if (tile.y === NORTH_Y + 9 && (tile.x === 11 || tile.x === 12)) usedDoor = true;
      previous = tile;
    }
    expect(previous).toEqual(goal);
    expect(usedDoor).toBe(true);
  });

  it('keeps the reception sign and meeting room native while removing visible medal plaques', () => {
    const reception = coreAreas().find((area) => area.id === 'core:recepcao');
    expect(reception).toBeDefined();
    expect(reception!.wallItems.some((item) => item.kind === 'sign')).toBe(true);
    expect(reception!.wallItems.some((item) => item.kind === 'poster' && ['ship_it', 'rocket', 'code', 'bug'].includes(item.variant ?? ''))).toBe(false);
    const meetingTable = reception!.furniture.find((item) => item.kind === 'meeting_table');
    expect(meetingTable).toBeDefined();
    expect(reception!.wallItems.some((item) => item.kind === 'poster' && item.on === 'south')).toBe(false);
    expect(reception!.walls.some((wall) => wall.kind === 'south' && wall.doorways?.some((door) => door.w === 2 * TILE))).toBe(true);
    const sign = reception!.wallItems.find((item) => item.kind === 'sign');
    expect(sign).toBeDefined();
    expect(sign!.cx).toBeLessThan(8.5 * TILE); // public lobby side, not the meeting-room bay
    expect(sign!.cx).toBeGreaterThan(6.5 * TILE); // clear of the elevator landing
  });
});
