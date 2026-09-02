const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const territory = require(path.join(ROOT, "modules/leisure/games/territory/territory-game.js"));
const snake = require(path.join(ROOT, "modules/leisure/games/snake/snake-game.js"));
const gomoku = require(path.join(ROOT, "modules/leisure/games/gomoku/gomoku-game.js"));
const sudoku = require(path.join(ROOT, "modules/leisure/games/sudoku/sudoku-game.js"));

function registryFromBrowserScript() {
  const window = {};
  vm.runInNewContext(read("modules/leisure/config/game-registry.js"), { window });
  return window.LeisureGameRegistry;
}

test("Leisure Station remains on the existing OS entry points", () => {
  const nav = read("shared/components/zhuge-navigation.js");
  const config = read("shared/app-config.js");
  const router = read("app/router/index.js");
  const dashboard = read("app/dashboard/index.html");
  const rootDashboard = read("app/dashboard/zhuge-dashboard.js");
  assert.match(nav, /leisure: \{ icon: "🎮", label: "休閒小站", group: "system"/);
  assert.match(nav, /leisure: "modules\/leisure\/"/);
  assert.doesNotMatch(nav, /sectionMarkup\("休閒小站"/);
  assert.match(nav, /\["library", "settings", "leisure"\]/);
  assert.match(config, /leisure: \{ icon: "🎮", label: "休閒小站", group: "system".*externalHref: "\.\.\/leisure\/"/);
  assert.match(router, /leisure: "modules\/leisure\/"/);
  assert.match(dashboard, /data-module="leisure"/);
  assert.match(rootDashboard, /\["leisure", "🎮", "休閒小站"/);
});

test("Game Registry exposes four playable local games in product order", () => {
  const registry = registryFromBrowserScript();
  assert.deepEqual(JSON.parse(JSON.stringify(registry.list().map(game => game.id))), ["territory", "snake", "gomoku", "sudoku"]);
  assert.deepEqual(JSON.parse(JSON.stringify(registry.list().map(game => game.available))), [true, true, true, true]);
  assert.deepEqual(JSON.parse(JSON.stringify(registry.list().map(game => game.status))), ["現在可玩", "現在可玩", "現在可玩", "現在可玩"]);
  assert.ok(registry.list().every(game => game.module));
  assert.doesNotMatch(JSON.stringify(registry.list()), /敬請期待|comingSoon/);
});

test("天蠶變 supports direction input and closes a territory", () => {
  assert.equal(territory.directionFromKey("ArrowUp"), "up");
  assert.equal(territory.directionFromKey("d"), "right");
  assert.equal(territory.directionFromKey("nope"), null);
  const ready = territory.createInitialState();
  const playing = territory.startState(ready, 123);
  assert.equal(territory.requestDirection(playing, "left").queuedDirection, "left");
  assert.equal(territory.requestDirection({ ...playing, drawing: true, direction: "right", queuedDirection: "right" }, "left").queuedDirection, "right");

  const wall = ready.safe.slice();
  const trail = [];
  for (let y = 1; y < territory.constants.GRID_ROWS - 1; y += 1) trail.push({ x: 5, y });
  const captured = territory.captureTerritory({ ...playing, safe: wall, trail, enemy: { x: 16, y: 9, direction: "left" } }, { x: 2, y: 9 });
  assert.ok(captured.capturedPercent > playing.capturedPercent);
  assert.equal(captured.safe[territory.constants.GRID_COLUMNS * 9 + 4], true);
});

test("天蠶變 keeps hazards, lives and target outcome explicit", () => {
  const ready = territory.createInitialState();
  const boundary = territory.advanceState(territory.startState({ ...ready, lives: 1, player: { x: 23, y: 5 }, direction: "right", queuedDirection: "right" }, 0));
  assert.equal(boundary.status, "lost");
  assert.equal(boundary.outcomeReason, "boundary");
  const hit = territory.advanceState(territory.startState({ ...ready, player: { x: 13, y: 9 }, enemy: { x: 14, y: 9, direction: "left" }, direction: "right", queuedDirection: "right" }, 0));
  assert.equal(hit.lives, ready.lives - 1);
  assert.equal(hit.outcomeReason, "enemy");
  const won = territory.advanceState(territory.startState({
    ...ready,
    player: { x: 3, y: 7 },
    trail: [{ x: 3, y: 9 }, { x: 3, y: 8 }, { x: 3, y: 7 }],
    drawing: true,
    direction: "left",
    queuedDirection: "left",
    targetPercent: 0,
    enemy: { x: 16, y: 2, direction: "left" }
  }, 0));
  assert.equal(won.status, "won");
  assert.equal(won.outcomeReason, "target");
  assert.equal(territory.constants.MAX_DURATION_MS, 90000);
});

test("貪食蛇 is a separate classic growth game", () => {
  assert.equal(snake.directionFromKey("ArrowUp"), "up");
  const ready = snake.createInitialState();
  const eating = snake.startState({ ...ready, body: [{ x: 5, y: 5 }, { x: 4, y: 5 }], food: { x: 6, y: 5 }, direction: "right", queuedDirection: "right" }, 0);
  const grown = snake.advanceState(eating, { random: () => 0 });
  assert.equal(grown.body.length, 3);
  assert.equal(grown.score, 10);
  const boundary = snake.advanceState(snake.startState({ ...ready, body: [{ x: 17, y: 5 }, { x: 16, y: 5 }], food: { x: 2, y: 2 }, direction: "right", queuedDirection: "right" }, 0));
  assert.equal(boundary.status, "lost");
  assert.equal(boundary.outcomeReason, "boundary");
});

test("五子棋 alternates local turns and detects five in a row", () => {
  let state = gomoku.startState(gomoku.createInitialState());
  [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]].forEach(([row, column]) => { state = gomoku.placeStone(state, row, column); });
  assert.equal(state.status, "won");
  assert.equal(state.winner, "black");
  assert.equal(state.moveCount, 9);
  assert.equal(gomoku.placeStone(state, 0, 4), state);
  const duplicate = gomoku.placeStone(gomoku.startState(gomoku.createInitialState()), 0, 0);
  assert.equal(gomoku.placeStone(duplicate, 0, 0), duplicate);
});

test("數獨 protects givens, marks errors and can be completed", () => {
  const ready = sudoku.createInitialState();
  const playing = sudoku.startState(ready);
  assert.equal(sudoku.isFixed(playing, 0, 0), true);
  assert.equal(sudoku.setCell(playing, 0, 0, 4), playing);
  const wrong = sudoku.setCell(playing, 0, 2, 3);
  assert.ok(wrong.errors.includes(sudoku.indexOf(0, 2)));
  const invalid = sudoku.setCell(playing, 0, 2, 10);
  assert.equal(invalid.lastError, "invalid-value");
  let solved = playing;
  sudoku.solution.forEach((value, cellIndex) => {
    const row = Math.floor(cellIndex / sudoku.constants.BOARD_SIZE);
    const column = cellIndex % sudoku.constants.BOARD_SIZE;
    if (!solved.givens[cellIndex]) solved = sudoku.setCell(solved, row, column, value);
  });
  assert.equal(solved.status, "won");
  assert.equal(sudoku.isComplete(solved), true);
});

test("Leisure Station loads all runtimes, stays local, and exposes cleanup", () => {
  const entry = read("modules/leisure/index.html");
  const runtime = read("modules/leisure/leisure-runtime.js");
  assert.match(entry, /shared\/components\/zhuge-navigation\.js/);
  assert.match(entry, /shared\/components\/zhuge-shell\.js/);
  assert.match(entry, /games\/territory\/territory-game\.js/);
  assert.match(entry, /games\/snake\/snake-game\.js/);
  assert.match(entry, /games\/gomoku\/gomoku-game\.js/);
  assert.match(entry, /games\/sudoku\/sudoku-game\.js/);
  assert.doesNotMatch(entry, /silkworm\/silkworm-game/);
  assert.doesNotMatch(entry, /supabase|oauth|auth-service|session-service/i);
  assert.match(runtime, /destroyActiveGame/);
  assert.match(runtime, /territory: \(\) => global\.LeisureTerritoryGame/);
  assert.match(runtime, /snake: \(\) => global\.LeisureSnakeGame/);
  assert.doesNotMatch(runtime, /leisure-intro|leisure-boundary-note|敬請期待/);
  [
    "modules/leisure/games/territory/territory-game.js",
    "modules/leisure/games/snake/snake-game.js",
    "modules/leisure/games/gomoku/gomoku-game.js",
    "modules/leisure/games/sudoku/sudoku-game.js"
  ].forEach(file => {
    const source = read(file);
    assert.match(source, /listeners\.splice\(0\)/, file + " must clean listeners");
    assert.doesNotMatch(source, /supabase|localStorage|fetch\(/i, file + " must remain local");
  });
  assert.match(read("modules/leisure/games/territory/territory-game.js"), /requestAnimationFrame/);
  assert.match(read("modules/leisure/games/snake/snake-game.js"), /cancelAnimationFrame/);
});
