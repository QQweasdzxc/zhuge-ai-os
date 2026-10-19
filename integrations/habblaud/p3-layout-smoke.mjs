import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const upstream = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], 'usage: p3-layout-smoke.mjs <pinned-habblaud-checkout>');
const load = relative => import(pathToFileURL(path.join(upstream, relative)).href);
const [{ assembleP3Building, layoutP3Reception, layoutP3ProjectRoom }, { toP3OfficeSnapshot }, { FURNITURE }, { poster }, { coreAreas }] = await Promise.all([
  load('client/src/world/layout/zhuge-p3-layout.ts'),
  load('client/src/adapters/zhuge-p3-bridge.ts'),
  load('client/src/art/api.ts'),
  load('client/src/art/furniture/wall.ts'),
  load('client/src/world/layout/building.ts'),
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
assert.ok(medalVariants.every(variant => FURNITURE.poster.variants.includes(variant)));
for (const variant of medalVariants) assert.ok(poster(variant).base.buf, `native poster sprite renders ${variant}`);

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
console.log('P3 native layout smoke PASS: 7 visual roles, 3 interior zones, preserved Habblaud core, indoor award sprites and walkable doors.');
