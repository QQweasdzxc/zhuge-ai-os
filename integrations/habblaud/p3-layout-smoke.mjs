import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstream = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'usage: p3-layout-smoke.mjs <pinned-habblaud-checkout>');
const load = relative => import(pathToFileURL(path.join(upstream, relative)).href);
const [{ assembleP3Building, layoutP3Reception, layoutP3ProjectRoom, P3_AWARDS, p3AwardAtWorldPoint }, { toP3OfficeSnapshot }, { FURNITURE }, { poster }, { coreAreas }, { PathFinder }] = await Promise.all([
  load('client/src/world/layout/zhuge-p3-layout.ts'),
  load('client/src/adapters/zhuge-p3-bridge.ts'),
  load('client/src/art/api.ts'),
  load('client/src/art/furniture/wall.ts'),
  load('client/src/world/layout/building.ts'),
  load('client/src/world/path/astar.ts'),
]);

const snapshot = toP3OfficeSnapshot(1, 1_800_000_000_000, 1_800_000_000_000);
assert.equal(snapshot.rooms.length, 3, 'P3 adds only work/tools, enclosed meeting, and lounge zones');
assert.deepEqual(snapshot.rooms.map(room => room.slot), [0, 1, 2], 'room slots are contiguous and deterministic');
assert.deepEqual(snapshot.agents.map(agent => agent.name), ['PM', 'Co', 'Gem', 'GPT', 'Betty', '安安', '卡卡']);
assert.ok(snapshot.agents.every(agent => agent.tasks.length === 0));
assert.ok(snapshot.agents.filter(agent => agent.role.includes('虛擬居民')).every(agent => agent.status === 'idle' && agent.title.includes('虛擬')));
assert.ok(snapshot.agents.filter(agent => !agent.role.includes('虛擬居民')).every(agent => agent.title === '尚無可驗證的最新狀態'));
assert.ok(snapshot.agents.every(agent => snapshot.rooms.some(room => room.id === agent.roomId)));

const theme = { carpet: '#8ca7bc', carpet2: '#778b9c', wall: { base: '#e8e7e0', trim: '#8a99a8', pattern: 'plain' }, accent: '#54728a', deskVariant: 'wood', chairVariant: 'black' };
const areas = snapshot.rooms.map(room => layoutP3ProjectRoom({ id: room.id, slot: room.slot, seed: room.seed }, theme));
const [work, meeting, lounge] = areas;
assert.ok(work.furniture.filter(item => item.kind === 'desk').length >= 3, 'work area has multiple desks');
assert.ok(work.furniture.some(item => item.kind === 'binder_shelf') && work.furniture.some(item => item.kind === 'printer'), 'tools are integrated into the work room');
assert.ok(meeting.furniture.some(item => item.kind === 'meeting_table'), 'meeting room has a meeting table');
assert.ok(meeting.spots.filter(item => item.kind === 'stool').length >= 4, 'meeting room has four seats');
assert.ok(meeting.door && meeting.walls.some(wall => wall.kind === 'face'), 'meeting room is enclosed with a real door opening');
const meetingFrame = meeting.wallItems.find(item => item.kind === 'door_frame');
const meetingSign = meeting.wallItems.find(item => item.kind === 'sign');
assert.ok(meetingFrame && meetingSign && meetingFrame.cx !== meetingSign.cx, 'meeting-room nameplate does not obscure the native door frame');
assert.ok(lounge.furniture.some(item => item.kind === 'sofa') && lounge.furniture.some(item => item.kind === 'bookshelf'), 'lounge supports rest and reading');

const reception = layoutP3Reception();
const medalVariants = reception.wallItems.filter(item => item.kind === 'poster').map(item => item.variant);
assert.deepEqual(medalVariants, ['award_gold', 'award_silver', 'award_bronze'], 'medal wall is indoor native wall furniture');
assert.deepEqual(P3_AWARDS.map(item => item.id), ['taskflow', 'worklog', 'investment'], 'medal links map only to existing published Zhuge products');
assert.ok(medalVariants.every(variant => FURNITURE.poster.variants.includes(variant)));
for (const variant of medalVariants) assert.ok(poster(variant).base.buf, `native poster sprite renders ${variant}`);
for (const award of P3_AWARDS) {
  const item = reception.wallItems.find(wallItem => wallItem.variant === award.variant);
  assert.ok(item, `${award.id} poster has a native wall position`);
  assert.equal(p3AwardAtWorldPoint(item.cx, item.baseY - 20), award.id, `${award.id} poster hit box resolves to its real product`);
  assert.equal(p3AwardAtWorldPoint(item.cx + 10, item.baseY - 20), null, `${award.id} hit box does not extend into adjacent wall items`);
}

const core = coreAreas();
const building = assembleP3Building(4, areas, 1);
assert.equal(building.cols, 4, 'native core plus two compact room columns form one desktop floor');
assert.deepEqual(building.core.map(area => area.id), ['core:recepcao', ...core.filter(area => area.id !== 'core:recepcao').map(area => area.id)]);
assert.equal(building.rooms.length, 3);
for (const area of [work, meeting, lounge]) {
  assert.ok(area.door, `${area.id} has a door`);
  for (let y = area.door.y; y < area.door.y + area.door.h; y++) {
    for (let x = area.door.x; x < area.door.x + area.door.w; x++) assert.ok(building.grid.walkable(x, y), `${area.id} door tile ${x},${y} remains walkable`);
  }
}

// Exercise the pinned Habblaud A* implementation through the meeting doorway and around
// real blocking furniture; this proves the room is reachable on the same native WalkGrid.
const start = { x: meeting.door.x, y: meeting.rect.y - 1 };
const goal = { x: meeting.rect.x + 13, y: meeting.rect.y + 4 };
assert.ok(building.grid.walkable(start.x, start.y), 'meeting approach tile in the corridor is walkable');
assert.ok(building.grid.walkable(goal.x, goal.y), 'meeting destination tile is walkable');
const finder = new PathFinder(building.grid);
const route = [];
assert.ok(finder.find(start.x, start.y, goal.x, goal.y, route), 'native A* reaches the meeting room from the corridor');
const tiles = [];
for (let index = 0; index < route.length; index += 2) tiles.push({ x: route[index], y: route[index + 1] });
assert.ok(tiles.some(tile => tile.x >= meeting.door.x && tile.x < meeting.door.x + meeting.door.w && tile.y >= meeting.door.y && tile.y < meeting.door.y + meeting.door.h), 'route crosses the real meeting doorway');
assert.ok(tiles.every(tile => building.grid.walkable(tile.x, tile.y)), 'meeting route never crosses a blocked wall or furniture tile');
const allTiles = [start, ...tiles];
assert.ok(allTiles.slice(1).every((tile, index) => Math.abs(tile.x - allTiles[index].x) + Math.abs(tile.y - allTiles[index].y) === 1), 'native A* route uses continuous 4-direction steps');
console.log('P3 native layout smoke PASS: seven roles, indoor award hit targets, meeting-room doorway A* route, furniture avoidance and original core.');
