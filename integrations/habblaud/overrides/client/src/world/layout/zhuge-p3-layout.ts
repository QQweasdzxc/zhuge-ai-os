/**
 * Zhuge P3 floorplan overlay for the pinned Habblaud scene engine.
 * This file is copied into a temporary upstream checkout by build.mjs; it does
 * not edit the frozen vendor source in this repository.
 */
import type { RoomTheme, WallStyle } from '../../art/api';
import { COL_W, NORTH_Y, ROOM_H, TILE } from '../constants';
import { buildWalkGrid, coreAreas, type BuildingLayout } from './building';
import { AreaBuilder } from './builder';
import { layoutCorridor } from './corridor';
import { RECEPTION_ID } from './core';
import { buildingRect, slotRect, slotSide } from './geometry';
import type { AreaLayout } from './types';

const P3_WALL: WallStyle = { base: '#e8e7e0', trim: '#8a99a8', pattern: 'plain' };
const MEETING_WALL: WallStyle = { base: '#cfe4e8', trim: '#61828d', pattern: 'glass' };
const ENTRY_DOOR = { lx: 7, w: 2 };

function seedOf(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Interior reception keeps the native entrances and interaction spots, with awards on an indoor wall. */
export function layoutP3Reception(): AreaLayout {
  const b = new AreaBuilder(RECEPTION_ID, 'reception', { x: 0, y: NORTH_Y, w: COL_W, h: ROOM_H });
  b.floor('marble', 0, 0, 16, 12, 1101);
  b.rug(1.5, 2.2, 6.5, 2.6, '#3d5a80', 1102);
  b.rug(8.6, 6.4, 5.2, 3.2, '#b65f3a', 1103);
  b.face(0.5, 15, P3_WALL);
  b.cap(0, 0, 0.5, 12, P3_WALL);
  b.cap(15.5, 0, 0.5, 12, P3_WALL);

  // Native elevators and sign remain part of the original Habblaud reception.
  [3, 6.5].forEach((cx, i) => {
    b.wall('elevator', cx, undefined, { order: 0.2 + i * 0.1 });
    b.spot('elevator', Math.floor(cx - 0.5), 2, 'up', { x: b.px(cx), y: b.py(2) + 2, group: `elevator:${i}` });
  });
  b.wall('sign', 8.8, undefined, { order: 0.9 });
  b.wall('clock', 10, undefined, { order: 0.7 });

  // Portfolio medals are actual Habblaud wall furniture inside reception, not an external DOM wall.
  b.wall('poster', 11.5, 'award_gold', { order: 0.5 });
  b.wall('poster', 12.8, 'award_silver', { order: 0.51 });
  b.wall('poster', 14.1, 'award_bronze', { order: 0.52 });

  b.furn('plant_tall', 1, 2, 'monstera', { order: 0.2 });
  b.furn('plant_tall', 14, 4, 'ficus', { order: 0.21 });
  b.furn('reception_desk', 9, 5, undefined, { order: 0.4 });
  b.furn('plant_small', 12, 5, 'flower', { order: 0.45 });
  b.furn('filing_cabinet', 8, 5, undefined, { order: 0.42 });
  b.seat('armchair', 'armchair', 9, 8, 'right', 'right', { order: 0.6 });
  b.furn('coffee_table', 10, 8, undefined, { order: 0.58 });
  b.seat('armchair', 'armchair', 12, 8, 'left', 'left', { order: 0.61 });
  b.furn('plant_tall', 14, 9, 'palm', { order: 0.22 });
  const bench = b.furn('bench', 2, 7, undefined, { order: 0.5 });
  for (let i = 0; i < 2; i++) b.seat('bench', 'bench', 2 + i, 7, 'down', undefined, { noFurniture: true, furnitureId: bench });
  b.furn('plant_small', 4, 7, 'fern', { order: 0.52 });
  b.furn('water_cooler', 1, 7, undefined, { order: 0.53 });
  b.spot('water', 1, 8, 'up', { dy: -3 });
  for (const lx of [1, 2, 3, 12, 13, 14]) b.furn('glass_partition', lx, 11, 'h', { order: 0.15 });
  b.walk(1, 2, 14, 10);
  b.spot('talk', 6, 9, 'right', { group: 'talk:recepcao', dx: -1 });
  b.spot('talk', 7, 9, 'left', { group: 'talk:recepcao', dx: 1 });
  const area = b.build();
  area.shade = undefined;
  return area;
}

function roomBase(id: string, slot: number, wall: WallStyle, floor: 'marble' | 'wood' | 'concrete' = 'marble'): AreaBuilder {
  const rect = slotRect(slot);
  const side = slotSide(slot);
  const north = side === 'north';
  const b = new AreaBuilder(id, 'room', rect);
  b.area.side = side;
  const seed = seedOf(id);
  b.floor(floor, 0, 0, 16, 12, seed);
  b.face(0.5, 15, wall, north ? [] : [ENTRY_DOOR]);
  b.south(0.5, 15, 11, north ? wall : { ...wall, exterior: true }, north ? [ENTRY_DOOR] : []);
  if (!north) b.wall('door_frame', 8, undefined, { order: 0.05 });
  b.cap(0, 0, 0.5, 12, wall);
  b.cap(15.5, 0, 0.5, 12, wall);
  b.walk(1, 2, 14, 9);
  b.area.door = north ? { x: rect.x + ENTRY_DOOR.lx, y: rect.y + 11, w: ENTRY_DOOR.w, h: 1 }
    : { x: rect.x + ENTRY_DOOR.lx, y: rect.y, w: ENTRY_DOOR.w, h: 2 };
  b.walk(ENTRY_DOOR.lx, north ? 11 : 0, ENTRY_DOOR.w, north ? 1 : 2);
  return b;
}

function finishRoom(b: AreaBuilder): AreaLayout {
  const area = b.build();
  return area;
}

function layoutWorkRoom(id: string, slot: number, seed: number): AreaLayout {
  const b = roomBase(id, slot, P3_WALL);
  b.area.floorTint = '#c5d4dd';
  b.wall('sign', 10, undefined, { order: 0.92 });
  b.wall('whiteboard', 4, undefined, { order: 0.6 });
  b.wall('clock', 12, undefined, { order: 0.65 });
  b.wall('poster', 14, 'code', { order: 0.5 });
  b.furn('bookshelf', 1, 2, undefined, { order: 0.2 });
  b.furn('printer', 13, 2, undefined, { order: 0.21 });
  b.furn('binder_shelf', 14, 2, undefined, { order: 0.22 });
  b.rug(2, 3, 7.5, 5, '#6e8ba0', seed);
  for (const [x, label] of [[2, 'west'], [5, 'center'], [8, 'east']] as const) {
    const desk = b.furn('desk', x, 5, 'wood', { order: 0.4 + x / 100, seat: label });
    b.seat('desk', 'office_chair', x, 6, 'up', 'black', { order: 0.6 + x / 100, dx: TILE / 2, deskId: desk, rank: x, side: 'S' });
  }
  // Compact tool corner stays inside the work room and leaves the central
  // route to the two-tile room door open.
  b.rug(10.5, 6.8, 4.2, 2.7, '#a78658', seed ^ 0x2f31);
  b.furn('filing_cabinet', 10, 3, undefined, { order: 0.23 });
  b.furn('binder_shelf', 12, 3, undefined, { order: 0.24 });
  b.furn('printer', 14, 3, undefined, { order: 0.25 });
  b.furn('plant_small', 10, 9, 'succulent', { order: 0.27 });
  b.furn('plant_small', 11, 7, 'flower', { order: 0.3 });
  b.furn('trash_bin', 12, 8, undefined, { order: 0.3 });
  b.spot('whiteboard', 4, 3, 'up', { dx: 8, dy: 1 });
  return finishRoom(b);
}

function layoutMeetingRoom(id: string, slot: number): AreaLayout {
  const b = roomBase(id, slot, MEETING_WALL);
  b.area.floorTint = '#b8d6dc';
  // Keep the room name clear of the doorway and native door-frame sprite.
  b.wall('sign', 10, undefined, { order: 0.92 });
  b.wall('whiteboard', 4, undefined, { order: 0.6 });
  b.wall('clock', 12, undefined, { order: 0.7 });
  b.wall('window', 2, undefined, { order: 0.45 });
  b.wall('window', 14, undefined, { order: 0.46 });
  b.rug(3, 3, 10, 5, '#6d9cab', seedOf(id));
  b.furn('meeting_table', 6, 4, undefined, { order: 0.45 });
  b.seat('stool', 'stool', 6, 3, 'down', undefined, { order: 0.6 });
  b.seat('stool', 'stool', 8, 3, 'down', undefined, { order: 0.61 });
  b.seat('stool', 'stool', 6, 6, 'up', undefined, { order: 0.62 });
  b.seat('stool', 'stool', 8, 6, 'up', undefined, { order: 0.63 });
  b.furn('plant_small', 2, 8, 'fern', { order: 0.24 });
  b.furn('plant_tall', 13, 8, 'monstera', { order: 0.25 });
  b.spot('whiteboard', 4, 3, 'up', { dx: 8, dy: 1 });
  return finishRoom(b);
}

function layoutLoungeRoom(id: string, slot: number): AreaLayout {
  const b = roomBase(id, slot, { base: '#e5e1e9', trim: '#8c8295', pattern: 'plain' }, 'wood');
  b.area.floorTint = '#d1c3d4';
  b.wall('sign', 10, undefined, { order: 0.92 });
  b.wall('painting', 3, undefined, { order: 0.5 });
  b.wall('window', 12, undefined, { order: 0.45 });
  b.rug(3, 3.2, 9.5, 5.8, '#806b88', seedOf(id));
  b.furn('bookshelf', 1, 2, undefined, { order: 0.2 });
  b.furn('floor_lamp', 2, 7, undefined, { order: 0.22 });
  const sofa = b.furn('sofa', 6, 6, 'up', { order: 0.45 });
  for (let i = 0; i < 3; i++) b.seat('sofa', 'sofa', 6 + i, 6, 'up', 'up', { noFurniture: true, furnitureId: sofa, order: 0.6 + i / 100 });
  b.furn('coffee_table', 6, 4, undefined, { order: 0.4 });
  b.seat('armchair', 'armchair', 12, 4, 'left', 'left', { order: 0.65 });
  b.furn('beanbag', 12, 7, 'green', { order: 0.66 });
  b.furn('plant_small', 14, 8, 'fern', { order: 0.25 });
  b.spot('shelf', 1, 3, 'up', { dx: 8, dy: -2 });
  return finishRoom(b);
}

export interface P3RoomInput { id: string; slot: number; seed: number }

/** Three interior P3 zones form one floor; PM can extend them later without changing TaskFlow data. */
export function layoutP3ProjectRoom(room: P3RoomInput, _theme: RoomTheme): AreaLayout {
  switch (room.id) {
    case 'p3-room-work': return layoutWorkRoom(room.id, room.slot, room.seed);
    case 'p3-room-meeting': return layoutMeetingRoom(room.id, room.slot);
    case 'p3-room-lounge': return layoutLoungeRoom(room.id, room.slot);
    default: return layoutWorkRoom(room.id, room.slot, room.seed);
  }
}

/** Same Habblaud assembly/walk-grid engine, with only the P3 reception layout swapped in. */
export function assembleP3Building(cols: number, rooms: readonly AreaLayout[], version = 0): BuildingLayout {
  const base = coreAreas();
  const core = [layoutP3Reception(), ...base.filter(area => area.id !== RECEPTION_ID)];
  const corridor = layoutCorridor(cols);
  const all = [...core, corridor, ...rooms];
  const grid = buildWalkGrid(cols, all, version);
  const spots = all.flatMap(area => area.spots);
  return { cols, rect: buildingRect(cols), core, corridor, rooms: [...rooms], grid, spots };
}
