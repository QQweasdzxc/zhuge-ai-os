/** TaskFlow-owned layout additions applied only to the pinned Habblaud build. */
import { AreaBuilder } from './builder';
import type { AreaLayout } from './types';
import type { WallStyle } from '../../art/api';
import { TILE } from '../constants';

const RECEPTION_ID = 'core:recepcao';

/**
 * Keep the pinned native Reception as the single area/layout authority while
 * reserving its east end for an enclosed, walkable meeting room. The room is
 * composed from native wall, furniture, spot and WalkGrid contracts; no second
 * Canvas or CSS-only avatar movement is introduced.
 */
export function integrateZhugeReception(area: AreaLayout, wall: WallStyle): AreaLayout {
  if (area.id !== RECEPTION_ID) throw new Error('Zhuge reception overlay received an unexpected area');

  // These reception props occupied the space reassigned to the meeting room.
  const remove = area.furniture.filter((f) =>
    (f.kind === 'reception_desk' && f.tx === 9 && f.ty === 5) ||
    (f.kind === 'filing_cabinet' && f.tx === 8 && f.ty === 5) ||
    (f.kind === 'plant_small' && f.tx === 12 && f.ty === 5) ||
    (f.kind === 'plant_tall' && f.tx === 14 && (f.ty === 4 || f.ty === 9)) ||
    (f.kind === 'armchair' && f.ty === 8 && (f.tx === 9 || f.tx === 12)) ||
    (f.kind === 'coffee_table' && f.tx === 10 && f.ty === 8)
  );
  const removedIds = new Set(remove.map((f) => f.id));
  area.furniture = area.furniture.filter((f) => !removedIds.has(f.id));
  area.spots = area.spots.filter((s) => !s.furnitureId || !removedIds.has(s.furnitureId));
  // Keep the native reception sign, but move it to the public lobby side of
  // the partition. The old x=11 placement put it inside the meeting room.
  const receptionSign = area.wallItems.find((item) => item.kind === 'sign');
  if (receptionSign) receptionSign.cx = Math.round(7.35 * TILE);
  // Remove only decorative clock/painting props that intersect the meeting bay.
  area.wallItems = area.wallItems.filter((item) => !['clock', 'painting'].includes(item.kind));

  const b = new AreaBuilder(`${RECEPTION_ID}#zhuge-meeting`, area.kind, area.rect);

  // Keep the front desk in the open reception lobby, clear of the new partition.
  b.furn('reception_desk', 4, 5, undefined, { order: 0.4 });
  b.furn('filing_cabinet', 7, 5, undefined, { order: 0.42 });

  // Meeting room: north/east are the original reception walls; western and
  // southern partitions create a real enclosed room. The 2-tile south doorway
  // remains open in both the native wall drawing and the WalkGrid.
  b.cap(8.5, 2, 0.5, 7, wall);
  b.south(8.5, 7, 9, wall, [{ lx: 11, w: 2 }]);
  b.block(8, 2, 1, 7);
  b.block(9, 9, 2, 1);
  b.block(13, 9, 3, 1);
  b.wall('door_frame', 12, undefined, { ly: 9, on: 'south', order: 0.05 });

  // Native furniture creates the room's purpose and collision footprints.
  b.rug(9.5, 3, 5.2, 4.6, '#b98a5e', 714);
  b.furn('meeting_table', 10, 4, undefined, { order: 0.45 });
  b.seat('stool', 'stool', 9, 4, 'right', undefined, { order: 0.62 });
  b.seat('stool', 'stool', 13, 4, 'left', undefined, { order: 0.63 });
  b.seat('stool', 'stool', 9, 6, 'right', undefined, { order: 0.64 });
  b.seat('stool', 'stool', 13, 6, 'left', undefined, { order: 0.65 });
  b.furn('plant_small', 14, 3, 'fern', { order: 0.2 });

  const addition = b.build();
  area.walls.push(...addition.walls);
  area.wallItems.push(...addition.wallItems);
  area.furniture.push(...addition.furniture);
  area.spots.push(...addition.spots.map((spot) => ({ ...spot, areaId: area.id })));
  area.blocked = [...(area.blocked ?? []), ...(addition.blocked ?? [])];
  return area;
}
