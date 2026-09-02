const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const game = require(path.join(ROOT, "modules/leisure/games/silkworm/silkworm-game.js"));

function registryFromBrowserScript() {
  const window = {};
  vm.runInNewContext(read("modules/leisure/config/game-registry.js"), { window });
  return window.LeisureGameRegistry;
}

test("Leisure Station is registered through the existing OS entry points", () => {
  const nav = read("shared/components/zhuge-navigation.js");
  const config = read("shared/app-config.js");
  const router = read("app/router/index.js");
  const dashboard = read("app/dashboard/index.html");
  const rootDashboard = read("app/dashboard/zhuge-dashboard.js");
  assert.match(nav, /leisure: \{ icon: "🎮", label: "休閒小站"/);
  assert.match(nav, /leisure: "modules\/leisure\/"/);
  assert.match(nav, /sectionMarkup\("休閒小站", "🎮", \["leisure"\]/);
  assert.match(config, /leisure: \{ icon: "🎮", label: "休閒小站".*externalHref: "\.\.\/leisure\/"/);
  assert.match(router, /leisure: "modules\/leisure\/"/);
  assert.match(dashboard, /data-module="leisure"/);
  assert.match(rootDashboard, /\["leisure", "🎮", "休閒小站"/);
});
test("Game Registry enables only 天蠶變 and leaves future games disabled", () => {
  const registry = registryFromBrowserScript();
  assert.equal(JSON.stringify(Array.from(registry.list(), game => game.id)), JSON.stringify(["silkworm", "gomoku", "sudoku"]));
  assert.equal(registry.get("silkworm").available, true);
  assert.equal(registry.get("gomoku").available, false);
  assert.equal(registry.get("sudoku").available, false);
  assert.equal(registry.get("gomoku").comingSoon, true);
  assert.equal(registry.get("sudoku").comingSoon, true);
});

test("天蠶變 maps desktop controls and rejects an immediate reverse", () => {
  assert.equal(game.directionFromKey("ArrowUp"), "up");
  assert.equal(game.directionFromKey("w"), "up");
  assert.equal(game.directionFromKey("D"), "right");
  assert.equal(game.directionFromKey("nope"), null);
  const ready = game.createInitialState();
  const playing = game.startState(ready, 123);
  assert.equal(game.requestDirection(playing, "down").queuedDirection, "up");
  assert.equal(game.requestDirection(playing, "left").queuedDirection, "left");
});

test("天蠶變 moves, grows on桑葉, and reaches the win condition", () => {
  const ready = game.createInitialState();
  const moving = game.startState({ ...ready, food: { x: 9, y: 15 } }, 0);
  const first = game.advanceState(moving, { random: () => 0 });
  assert.equal(first.status, "playing");
  assert.deepEqual(first.body[0], { x: 9, y: 19 });

  const eating = game.startState({
    ...ready,
    body: [{ x: 9, y: 18 }, { x: 8, y: 18 }],
    food: { x: 10, y: 18 },
    direction: "right",
    queuedDirection: "right",
    collected: 0,
    score: 0
  }, 0);
  const grown = game.advanceState(eating, { random: () => 0 });
  assert.equal(grown.status, "playing");
  assert.equal(grown.body.length, 3);
  assert.equal(grown.collected, 1);
  assert.equal(grown.score, 10);

  const finalLeaf = game.advanceState({ ...eating, collected: 7 }, { random: () => 0 });
  assert.equal(finalLeaf.status, "won");
  assert.equal(finalLeaf.outcomeReason, "target");
  assert.equal(finalLeaf.score, 10);
  assert.equal(finalLeaf.food, null);
});

test("天蠶變 has explicit boundary, hazard, self-collision, and timeout rules", () => {
  const ready = game.createInitialState();
  const boundary = game.advanceState(game.startState({
    ...ready,
    body: [{ x: 17, y: 5 }, { x: 16, y: 5 }],
    food: { x: 2, y: 2 },
    direction: "right",
    queuedDirection: "right"
  }, 0));
  assert.equal(boundary.status, "lost");
  assert.equal(boundary.outcomeReason, "boundary");

  const hazard = game.advanceState(game.startState({
    ...ready,
    body: [{ x: 2, y: 5 }, { x: 1, y: 5 }],
    food: { x: 2, y: 2 },
    direction: "right",
    queuedDirection: "right"
  }, 0));
  assert.equal(hazard.status, "lost");
  assert.equal(hazard.outcomeReason, "hazard");

  const self = game.advanceState(game.startState({
    ...ready,
    body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
    food: { x: 2, y: 2 },
    direction: "left",
    queuedDirection: "left"
  }, 0));
  assert.equal(self.status, "lost");
  assert.equal(self.outcomeReason, "self");

  assert.equal(game.constants.MAX_DURATION_MS, 90000);
  assert.match(read("modules/leisure/games/silkworm/silkworm-game.js"), /lostState\(state, state\.direction, "time"\)/);
});

test("Leisure Station runtime stays local and owns cleanup hooks", () => {
  const entry = read("modules/leisure/index.html");
  const runtime = read("modules/leisure/leisure-runtime.js");
  const gameSource = read("modules/leisure/games/silkworm/silkworm-game.js");
  assert.match(entry, /shared\/components\/zhuge-navigation\.js/);
  assert.match(entry, /shared\/components\/zhuge-shell\.js/);
  assert.doesNotMatch(entry, /supabase|oauth|auth-service|session-service/i);
  assert.match(runtime, /destroyActiveGame/);
  assert.match(runtime, /module\.create/);
  assert.match(gameSource, /requestAnimationFrame/);
  assert.match(gameSource, /cancelAnimationFrame/);
  assert.match(gameSource, /listeners\.splice\(0\)/);
  assert.match(gameSource, /data-silkworm-direction="up"/);
  assert.match(gameSource, /ArrowUp/);
});
