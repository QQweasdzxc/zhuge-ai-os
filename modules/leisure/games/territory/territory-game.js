/* 天蠶變 Game Module.
 *
 * A compact territory-capture game: the player leaves the safe edge, draws a
 * trail through unclaimed space, and closes it back at the safe area. The
 * enemy remains an in-game hazard; the module owns its state and lifecycle.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeisureTerritoryGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const GRID_COLUMNS = 24;
  const GRID_ROWS = 18;
  const CELL_SIZE = 28;
  const STEP_MS = 160;
  const MAX_DURATION_MS = 90 * 1000;
  const TARGET_PERCENT = 55;
  const INITIAL_LIVES = 3;
  const BOARD_WIDTH = GRID_COLUMNS * CELL_SIZE;
  const BOARD_HEIGHT = GRID_ROWS * CELL_SIZE;
  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1 }),
    right: Object.freeze({ x: 1, y: 0 }),
    down: Object.freeze({ x: 0, y: 1 }),
    left: Object.freeze({ x: -1, y: 0 })
  });
  const OPPOSITES = Object.freeze({ up: "down", right: "left", down: "up", left: "right" });
  const KEY_DIRECTIONS = Object.freeze({
    ArrowUp: "up", w: "up", W: "up",
    ArrowRight: "right", d: "right", D: "right",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left"
  });

  function point(x, y) { return { x: Number(x), y: Number(y) }; }
  function clonePoint(value) { return point(value.x, value.y); }
  function samePoint(a, b) { return Boolean(a && b && a.x === b.x && a.y === b.y); }
  function keyOf(value) { return String(value.x) + ":" + String(value.y); }
  function indexOf(x, y) { return y * GRID_COLUMNS + x; }
  function inside(value) { return Boolean(value && value.x >= 0 && value.x < GRID_COLUMNS && value.y >= 0 && value.y < GRID_ROWS); }
  function directionFromKey(key) { return KEY_DIRECTIONS[String(key || "")] || null; }
  function normalizeDirection(value) {
    if (typeof value === "string" && DIRECTIONS[value]) return value;
    if (!value || typeof value !== "object") return null;
    return Object.keys(DIRECTIONS).find(name => DIRECTIONS[name].x === Number(value.x) && DIRECTIONS[name].y === Number(value.y)) || null;
  }
  function makeInitialBoard() {
    return Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, cellIndex) => {
      const x = cellIndex % GRID_COLUMNS;
      const y = Math.floor(cellIndex / GRID_COLUMNS);
      return x < 3 || x === GRID_COLUMNS - 1 || y === 0 || y === GRID_ROWS - 1;
    });
  }
  function occupiedPercent(safe) {
    const total = GRID_COLUMNS * GRID_ROWS;
    const occupied = (safe || []).reduce((count, value) => count + (value ? 1 : 0), 0);
    return Math.round((occupied / total) * 1000) / 10;
  }
  function availableEmptyCell(safe, trail, start) {
    const blocked = new Set((trail || []).map(keyOf));
    const candidates = [];
    if (inside(start) && !safe[indexOf(start.x, start.y)] && !blocked.has(keyOf(start))) candidates.push(start);
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const candidate = point(x, y);
        if (!safe[indexOf(x, y)] && !blocked.has(keyOf(candidate)) && !candidates.some(item => samePoint(item, candidate))) candidates.push(candidate);
      }
    }
    return candidates[0] || null;
  }
  function createInitialState() {
    const safe = makeInitialBoard();
    const player = point(2, Math.floor(GRID_ROWS / 2));
    const enemy = point(Math.floor(GRID_COLUMNS * 0.68), Math.floor(GRID_ROWS / 2));
    return {
      status: "ready",
      safe,
      player,
      direction: "right",
      queuedDirection: "right",
      trail: [],
      drawing: false,
      enemy: { ...enemy, direction: "left" },
      lives: INITIAL_LIVES,
      capturedPercent: occupiedPercent(safe),
      targetPercent: TARGET_PERCENT,
      elapsedMs: 0,
      startedAt: 0,
      outcomeReason: ""
    };
  }
  function requestDirection(state, value) {
    const nextDirection = normalizeDirection(value);
    if (!state || !nextDirection) return state;
    const currentDirection = state.queuedDirection || state.direction;
    if (state.drawing && OPPOSITES[currentDirection] === nextDirection) return state;
    return { ...state, queuedDirection: nextDirection };
  }
  function startState(state, startedAt = 0) {
    if (!state || state.status === "playing") return state;
    return { ...state, status: "playing", startedAt: Number(startedAt) || 0, elapsedMs: 0, outcomeReason: "" };
  }
  function trailHas(trail, target) { return (trail || []).some(item => samePoint(item, target)); }
  function captureTerritory(state, closingPoint) {
    const safe = (state.safe || []).slice();
    const trail = (state.trail || []).map(clonePoint);
    const blocked = new Set(trail.map(keyOf));
    if (closingPoint) { trail.push(clonePoint(closingPoint)); blocked.add(keyOf(closingPoint)); }
    trail.forEach(item => { if (inside(item)) safe[indexOf(item.x, item.y)] = true; });
    const reachable = new Set();
    const start = availableEmptyCell(safe, trail, state.enemy);
    if (start) {
      const queue = [start];
      reachable.add(keyOf(start));
      while (queue.length) {
        const current = queue.shift();
        Object.values(DIRECTIONS).forEach(vector => {
          const next = point(current.x + vector.x, current.y + vector.y);
          const nextKey = keyOf(next);
          if (!inside(next) || safe[indexOf(next.x, next.y)] || blocked.has(nextKey) || reachable.has(nextKey)) return;
          reachable.add(nextKey);
          queue.push(next);
        });
      }
    }
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const cellKey = keyOf(point(x, y));
        if (!safe[indexOf(x, y)] && !reachable.has(cellKey)) safe[indexOf(x, y)] = true;
      }
    }
    return { safe, capturedPercent: occupiedPercent(safe) };
  }
  function moveEnemy(state) {
    const current = state.enemy || { x: 14, y: 9, direction: "left" };
    const directions = [current.direction, "up", "right", "down", "left"].filter((value, position, list) => value && list.indexOf(value) === position);
    for (const direction of directions) {
      const vector = DIRECTIONS[direction];
      const candidate = point(current.x + vector.x, current.y + vector.y);
      if (inside(candidate) && !state.safe[indexOf(candidate.x, candidate.y)] && !trailHas(state.trail, candidate) && !samePoint(candidate, state.player)) {
        return { ...state, enemy: { ...candidate, direction } };
      }
    }
    return state;
  }
  function damageState(state, reason = "hazard") {
    const lives = Math.max(0, Number(state.lives || 0) - 1);
    if (!lives) return { ...state, status: "lost", lives: 0, trail: [], drawing: false, outcomeReason: reason };
    const resetPoint = point(2, Math.floor(GRID_ROWS / 2));
    return {
      ...state,
      player: resetPoint,
      direction: "right",
      queuedDirection: "right",
      trail: [],
      drawing: false,
      lives,
      outcomeReason: reason
    };
  }
  function advanceState(state) {
    if (!state || state.status !== "playing") return state;
    const requested = state.queuedDirection || state.direction;
    const direction = state.drawing && OPPOSITES[state.direction] === requested ? state.direction : requested;
    const vector = DIRECTIONS[direction] || DIRECTIONS.right;
    const next = point(state.player.x + vector.x, state.player.y + vector.y);
    if (!inside(next)) return damageState({ ...state, direction, queuedDirection: direction }, "boundary");
    if (state.drawing && trailHas(state.trail, next)) return damageState({ ...state, direction, queuedDirection: direction }, "trail");
    if (samePoint(state.enemy, next)) return damageState({ ...state, direction, queuedDirection: direction }, "enemy");
    const isSafe = state.safe[indexOf(next.x, next.y)];
    let nextState = { ...state, player: next, direction, queuedDirection: direction };
    if (!state.drawing && isSafe) return moveEnemy(nextState);
    if (!state.drawing && !isSafe) {
      nextState = { ...nextState, trail: [clonePoint(next)], drawing: true };
    } else if (state.drawing && isSafe) {
      const captured = captureTerritory(state, next);
      nextState = { ...nextState, safe: captured.safe, capturedPercent: captured.capturedPercent, trail: [], drawing: false };
      if (captured.capturedPercent >= state.targetPercent) return { ...nextState, status: "won", outcomeReason: "target" };
    } else {
      nextState = { ...nextState, trail: [...state.trail.map(clonePoint), clonePoint(next)], drawing: true };
    }
    const moved = moveEnemy(nextState);
    if (samePoint(moved.enemy, moved.player) || trailHas(moved.trail, moved.enemy)) return damageState(moved, "enemy");
    return moved;
  }
  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }
  function formatRemaining(milliseconds) { return formatClock(Math.max(0, MAX_DURATION_MS - Number(milliseconds || 0))); }
  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }
  function drawOverlay(context, title, detail) {
    context.save();
    context.fillStyle = "rgba(3, 9, 20, .76)";
    context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    const width = 360;
    const height = 132;
    const x = (BOARD_WIDTH - width) / 2;
    const y = (BOARD_HEIGHT - height) / 2;
    context.fillStyle = "rgba(20, 35, 55, .97)";
    roundedRect(context, x, y, width, height, 16);
    context.fill();
    context.strokeStyle = "rgba(156, 207, 255, .44)";
    context.stroke();
    context.textAlign = "center";
    context.fillStyle = "#f7fbff";
    context.font = "700 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(title, BOARD_WIDTH / 2, y + 51);
    context.fillStyle = "#b7c9db";
    context.font = "500 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(detail, BOARD_WIDTH / 2, y + 83);
    context.restore();
  }
  function create(root, options = {}) {
    if (!root) throw new Error("天蠶變需要一個 mount root。");
    const documentRef = root.ownerDocument || global.document;
    const canvas = root.querySelector("[data-territory-canvas]");
    const context = canvas?.getContext?.("2d") || null;
    const percentNode = root.querySelector("[data-territory-percent]");
    const livesNode = root.querySelector("[data-territory-lives]");
    const timerNode = root.querySelector("[data-territory-timer]");
    const statusNode = root.querySelector("[data-territory-status]");
    const resultNode = root.querySelector("[data-territory-result]");
    const progressNode = root.querySelector("[data-territory-progress-fill]");
    const startButton = root.querySelector("[data-territory-start]");
    const restartButton = root.querySelector("[data-territory-restart]");
    const exitButton = root.querySelector("[data-leisure-home]");
    const listeners = [];
    const requestFrame = typeof global.requestAnimationFrame === "function" ? global.requestAnimationFrame.bind(global) : callback => setTimeout(() => callback(now()), 16);
    const cancelFrame = typeof global.cancelAnimationFrame === "function" ? global.cancelAnimationFrame.bind(global) : clearTimeout;
    let state = createInitialState();
    let running = false;
    let destroyed = false;
    let frameId = 0;
    let lastFrameAt = 0;
    let accumulator = 0;
    function now() { return Number(global.performance?.now?.() || Date.now()); }
    function listen(target, eventName, handler, listenerOptions) {
      if (!target?.addEventListener) return;
      target.addEventListener(eventName, handler, listenerOptions);
      listeners.push(() => target.removeEventListener(eventName, handler, listenerOptions));
    }
    function draw() {
      if (!context) return;
      context.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      context.fillStyle = "#071a25";
      context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      for (let y = 0; y < GRID_ROWS; y += 1) {
        for (let x = 0; x < GRID_COLUMNS; x += 1) {
          const cell = indexOf(x, y);
          context.fillStyle = state.safe[cell] ? "#174b49" : ((x + y) % 2 ? "#0a2633" : "#09222d");
          context.fillRect(x * CELL_SIZE + 1, y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        }
      }
      state.trail.forEach(item => {
        context.fillStyle = "#f1c96e";
        context.fillRect(item.x * CELL_SIZE + 5, item.y * CELL_SIZE + 5, CELL_SIZE - 10, CELL_SIZE - 10);
      });
      context.fillStyle = "#ff7080";
      context.beginPath();
      context.arc(state.enemy.x * CELL_SIZE + CELL_SIZE / 2, state.enemy.y * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE * .29, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffd1d8";
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = "#6ce7e0";
      roundedRect(context, state.player.x * CELL_SIZE + 4, state.player.y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8, 7);
      context.fill();
      context.strokeStyle = "#e4fffe";
      context.stroke();
      if (state.status === "ready") drawOverlay(context, "天蠶變", "離開安全區，圈出更多土地");
      if (state.status === "won") drawOverlay(context, "成功佔領！", "你已完成這一局天蠶變");
      if (state.status === "lost") drawOverlay(context, "這局結束", "小心荊棘與敵人，再試一次");
    }
    function statusCopy() {
      if (state.status === "ready") return ["準備開始", "離開安全區畫線，回到安全區即可佔領土地。"];
      if (state.status === "playing") return [state.drawing ? "畫線中" : "安全區內", "目前佔領 " + state.capturedPercent + "%，目標 " + state.targetPercent + "%。"];
      if (state.status === "won") return ["成功", "已達到目標佔領率 " + state.capturedPercent + "%。"];
      const reason = state.outcomeReason === "enemy" ? "碰到敵人了。" : state.outcomeReason === "trail" ? "碰到未完成的線了。" : state.outcomeReason === "time" ? "時間到了。" : "撞到邊界了。";
      return ["失敗", reason + " 剩餘生命 " + state.lives + "。"];
    }
    function paint() {
      if (destroyed) return;
      const copy = statusCopy();
      root.dataset.gameState = state.status;
      root.dataset.gameDrawing = String(state.drawing);
      if (percentNode) percentNode.textContent = String(state.capturedPercent) + "%";
      if (livesNode) livesNode.textContent = String(state.lives);
      if (timerNode) timerNode.textContent = state.status === "ready" ? "01:30" : formatRemaining(state.elapsedMs);
      if (statusNode) statusNode.textContent = copy[0];
      if (resultNode) resultNode.textContent = copy[1];
      if (progressNode) progressNode.style.width = Math.min(100, (state.capturedPercent / state.targetPercent) * 100) + "%";
      if (startButton) {
        startButton.disabled = state.status === "playing";
        startButton.textContent = state.status === "ready" ? "開始遊戲" : state.status === "playing" ? "進行中…" : "再玩一局";
      }
      draw();
    }
    function stopLoop() { running = false; if (frameId) cancelFrame(frameId); frameId = 0; }
    function loop(frameTime) {
      if (destroyed || !running) return;
      const timestamp = Number(frameTime) || now();
      const delta = Math.min(250, Math.max(0, timestamp - lastFrameAt));
      lastFrameAt = timestamp;
      state = { ...state, elapsedMs: Math.min(MAX_DURATION_MS, state.elapsedMs + delta) };
      accumulator += delta;
      while (accumulator >= STEP_MS && state.status === "playing") { state = advanceState(state); accumulator -= STEP_MS; }
      if (state.status === "playing" && state.elapsedMs >= MAX_DURATION_MS) state = damageState(state, "time");
      paint();
      if (running && state.status === "playing") frameId = requestFrame(loop); else { running = false; frameId = 0; }
    }
    function startGame() {
      if (destroyed || state.status === "playing") return;
      if (state.status !== "ready") state = createInitialState();
      state = startState(state, now());
      running = true;
      lastFrameAt = now();
      accumulator = 0;
      paint();
      frameId = requestFrame(loop);
    }
    function restartGame() { if (destroyed) return; stopLoop(); state = createInitialState(); paint(); startGame(); }
    function changeDirection(value) { if (destroyed) return; state = requestDirection(state, value); paint(); }
    function onKeydown(event) { const direction = directionFromKey(event.key); if (!direction || destroyed) return; event.preventDefault(); changeDirection(direction); }
    function onExit() { stopLoop(); if (typeof options.onExit === "function") options.onExit(); }
    listen(documentRef, "keydown", onKeydown);
    listen(startButton, "click", () => { if (state.status === "ready") startGame(); else if (state.status !== "playing") restartGame(); });
    listen(restartButton, "click", restartGame);
    listen(exitButton, "click", onExit);
    root.querySelectorAll("[data-territory-direction]").forEach(button => {
      const direction = button.dataset.territoryDirection;
      const activate = event => { event.preventDefault(); changeDirection(direction); };
      listen(button, "pointerdown", activate, { passive: false });
      listen(button, "click", activate);
    });
    paint();
    return Object.freeze({
      start: startGame,
      restart: restartGame,
      destroy() { if (destroyed) return; destroyed = true; stopLoop(); listeners.splice(0).forEach(remove => remove()); root.dataset.gameState = "destroyed"; },
      getState() { return { ...state, safe: state.safe.slice(), player: clonePoint(state.player), enemy: { ...state.enemy }, trail: state.trail.map(clonePoint) }; }
    });
  }
  function markup() {
    return '<section class="arcade-runtime territory-runtime" data-leisure-game-runtime data-game-id="territory" aria-labelledby="territory-title">' +
      '<div class="leisure-game-toolbar"><div><p class="leisure-eyebrow">GAME 01 · 原創領地遊戲</p><h2 id="territory-title">🐛 天蠶變</h2></div><button class="leisure-back-button" type="button" data-leisure-home>← 返回休閒小站</button></div>' +
      '<div class="arcade-game-layout territory-game-layout">' +
        '<section class="arcade-board-card territory-board-card" aria-label="天蠶變遊戲區"><div class="arcade-board-head"><div><span class="arcade-board-label">TERRITORY PLAY AREA</span><strong data-territory-status>準備開始</strong></div><span class="arcade-live-dot" aria-hidden="true"></span></div><div class="arcade-board-frame territory-board-frame"><canvas data-territory-canvas width="672" height="504" aria-label="天蠶變遊戲畫面"></canvas></div><p class="arcade-result" data-territory-result aria-live="polite">離開安全區畫線，回到安全區即可佔領土地。</p></section>' +
        '<aside class="arcade-control-card" aria-label="天蠶變遊戲控制"><div class="arcade-stat-grid"><div><span>佔領率</span><strong data-territory-percent>25.9%</strong></div><div><span>生命</span><strong data-territory-lives>3</strong></div><div><span>剩餘時間</span><strong data-territory-timer>01:30</strong></div></div><div class="territory-progress" aria-label="佔領進度"><div data-territory-progress-fill></div></div><p class="territory-target-copy">目標：佔領 <strong>55%</strong> 的土地</p><div class="arcade-action-row"><button class="leisure-primary-button" type="button" data-territory-start>開始遊戲</button><button class="leisure-secondary-button" type="button" data-territory-restart>重新開始</button></div><div class="arcade-touch-section"><div class="arcade-control-heading"><strong>觸控方向</strong><span>手機可直接點按</span></div><div class="arcade-touch-pad" role="group" aria-label="天蠶變觸控方向控制"><span></span><button type="button" data-territory-direction="up" aria-label="向上">↑</button><span></span><button type="button" data-territory-direction="left" aria-label="向左">←</button><span class="arcade-touch-center" aria-hidden="true">🐛</span><button type="button" data-territory-direction="right" aria-label="向右">→</button><span></span><button type="button" data-territory-direction="down" aria-label="向下">↓</button><span></span></div></div><div class="arcade-help"><strong>Desktop</strong><span>Arrow Keys 或 W / A / S / D</span><strong>玩法</strong><span>離開安全區圈出土地；未完成的線與敵人都會消耗生命。</span></div></aside>' +
      '</div></section>';
  }
  return Object.freeze({
    constants: Object.freeze({ GRID_COLUMNS, GRID_ROWS, CELL_SIZE, STEP_MS, MAX_DURATION_MS, TARGET_PERCENT, INITIAL_LIVES }),
    directions: DIRECTIONS,
    directionFromKey,
    requestDirection,
    createInitialState,
    startState,
    advanceState,
    captureTerritory,
    occupiedPercent,
    formatClock,
    markup,
    create
  });
});
