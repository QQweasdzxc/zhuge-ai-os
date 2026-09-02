/* 貪食蛇 Game Module.
 *
 * This is the retained grow-and-navigate runtime from the first Arcade
 * integration, now presented as a small Nokia-style classic Snake. It owns
 * only its local rules, canvas, input bindings and lifecycle.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeisureSnakeGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const GRID_COLUMNS = 18;
  const GRID_ROWS = 18;
  const CELL_SIZE = 24;
  const STEP_MS = 220;
  const MAX_DURATION_MS = 90 * 1000;
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
  const INITIAL_BODY = Object.freeze([
    Object.freeze({ x: 9, y: 9 }),
    Object.freeze({ x: 8, y: 9 }),
    Object.freeze({ x: 7, y: 9 })
  ]);

  function point(x, y) { return { x: Number(x), y: Number(y) }; }
  function samePoint(a, b) { return Boolean(a && b && a.x === b.x && a.y === b.y); }
  function clonePoint(value) { return point(value.x, value.y); }
  function directionFromKey(key) { return KEY_DIRECTIONS[String(key || "")] || null; }
  function normalizeDirection(value) {
    if (typeof value === "string" && DIRECTIONS[value]) return value;
    if (!value || typeof value !== "object") return null;
    return Object.keys(DIRECTIONS).find(name => DIRECTIONS[name].x === Number(value.x) && DIRECTIONS[name].y === Number(value.y)) || null;
  }
  function randomIndex(length, random) {
    if (!length) return -1;
    const candidate = typeof random === "function" ? Number(random()) : Math.random();
    const normalized = Number.isFinite(candidate) ? Math.max(0, Math.min(0.999999, candidate)) : 0;
    return Math.floor(normalized * length);
  }
  function occupiedBy(points, target) { return points.some(item => samePoint(item, target)); }
  function nextFood(body, random = Math.random) {
    const available = [];
    for (let y = 1; y < GRID_ROWS - 1; y += 1) {
      for (let x = 1; x < GRID_COLUMNS - 1; x += 1) {
        const candidate = point(x, y);
        if (!occupiedBy(body || [], candidate)) available.push(candidate);
      }
    }
    return available[randomIndex(available.length, random)] || null;
  }
  function createInitialState({ random = Math.random } = {}) {
    const body = INITIAL_BODY.map(clonePoint);
    return {
      status: "ready",
      direction: "right",
      queuedDirection: "right",
      body,
      food: nextFood(body, random),
      score: 0,
      elapsedMs: 0,
      startedAt: 0,
      outcomeReason: ""
    };
  }
  function requestDirection(state, value) {
    const nextDirection = normalizeDirection(value);
    if (!nextDirection || !state) return state;
    const currentDirection = state.queuedDirection || state.direction;
    if (state.body?.length > 1 && OPPOSITES[currentDirection] === nextDirection) return state;
    return { ...state, queuedDirection: nextDirection };
  }
  function lostState(state, direction, reason) {
    return { ...state, status: "lost", direction, queuedDirection: direction, outcomeReason: reason };
  }
  function advanceState(state, { random = Math.random } = {}) {
    if (!state || state.status !== "playing") return state;
    const requested = state.queuedDirection || state.direction;
    const direction = state.body.length > 1 && OPPOSITES[state.direction] === requested ? state.direction : requested;
    const vector = DIRECTIONS[direction] || DIRECTIONS.right;
    const head = state.body[0];
    const nextHead = point(head.x + vector.x, head.y + vector.y);
    if (nextHead.x < 0 || nextHead.x >= GRID_COLUMNS || nextHead.y < 0 || nextHead.y >= GRID_ROWS) return lostState(state, direction, "boundary");
    const ateFood = samePoint(state.food, nextHead);
    const bodyToCheck = ateFood ? state.body : state.body.slice(0, -1);
    if (occupiedBy(bodyToCheck, nextHead)) return lostState(state, direction, "self");
    const body = [nextHead, ...state.body.map(clonePoint)];
    if (!ateFood) body.pop();
    const score = state.score + (ateFood ? 10 : 0);
    const food = ateFood ? nextFood(body, random) : state.food;
    if (!food) return { ...state, status: "won", direction, queuedDirection: direction, body, food: null, score, outcomeReason: "board-cleared" };
    return { ...state, direction, queuedDirection: direction, body, food, score };
  }
  function startState(state, startedAt = 0) {
    if (!state || state.status === "playing") return state;
    return { ...state, status: "playing", startedAt: Number(startedAt) || 0, elapsedMs: 0, outcomeReason: "" };
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
  function drawFood(context, food) {
    const centerX = food.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = food.y * CELL_SIZE + CELL_SIZE / 2;
    context.save();
    context.fillStyle = "#f0cf72";
    context.beginPath();
    context.arc(centerX, centerY + 1, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#fff5c7";
    context.lineWidth = 1.5;
    context.stroke();
    context.strokeStyle = "#76d79f";
    context.beginPath();
    context.moveTo(centerX + 1, centerY - 7);
    context.quadraticCurveTo(centerX + 4, centerY - 12, centerX + 7, centerY - 9);
    context.stroke();
    context.restore();
  }
  function drawSnake(context, state) {
    state.body.slice().reverse().forEach((segment, index) => {
      const isHead = samePoint(segment, state.body[0]);
      const inset = isHead ? 2 : 3;
      const x = segment.x * CELL_SIZE + inset;
      const y = segment.y * CELL_SIZE + inset;
      context.fillStyle = isHead ? "#8ee7a7" : (index % 2 ? "#4db982" : "#61c88f");
      roundedRect(context, x, y, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 6);
      context.fill();
      context.strokeStyle = isHead ? "#e1ffe6" : "rgba(220, 255, 226, .5)";
      context.lineWidth = 1;
      context.stroke();
      if (isHead) {
        const eyeDirection = DIRECTIONS[state.direction] || DIRECTIONS.right;
        const eyeX = x + (eyeDirection.x * 3) + (eyeDirection.x === 0 ? 6 : eyeDirection.x > 0 ? 12 : 2);
        const eyeY = y + (eyeDirection.y * 3) + (eyeDirection.y === 0 ? 6 : eyeDirection.y > 0 ? 12 : 2);
        context.fillStyle = "#142632";
        context.beginPath();
        context.arc(eyeX, eyeY, 2, 0, Math.PI * 2);
        context.fill();
      }
    });
  }
  function drawOverlay(context, title, detail) {
    context.save();
    context.fillStyle = "rgba(3, 9, 20, .74)";
    context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    const cardWidth = 296;
    const cardHeight = 128;
    const cardX = (BOARD_WIDTH - cardWidth) / 2;
    const cardY = (BOARD_HEIGHT - cardHeight) / 2;
    context.fillStyle = "rgba(20, 35, 55, .96)";
    roundedRect(context, cardX, cardY, cardWidth, cardHeight, 16);
    context.fill();
    context.strokeStyle = "rgba(156, 207, 255, .44)";
    context.stroke();
    context.textAlign = "center";
    context.fillStyle = "#f7fbff";
    context.font = "700 23px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(title, BOARD_WIDTH / 2, cardY + 49);
    context.fillStyle = "#b7c9db";
    context.font = "500 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    context.fillText(detail, BOARD_WIDTH / 2, cardY + 79);
    context.restore();
  }
  function create(root, options = {}) {
    if (!root) throw new Error("貪食蛇需要一個 mount root。");
    const documentRef = root.ownerDocument || global.document;
    const canvas = root.querySelector("[data-snake-canvas]");
    const context = canvas?.getContext?.("2d") || null;
    const scoreNode = root.querySelector("[data-snake-score]");
    const lengthNode = root.querySelector("[data-snake-length]");
    const timerNode = root.querySelector("[data-snake-timer]");
    const statusNode = root.querySelector("[data-snake-status]");
    const resultNode = root.querySelector("[data-snake-result]");
    const startButton = root.querySelector("[data-snake-start]");
    const restartButton = root.querySelector("[data-snake-restart]");
    const exitButton = root.querySelector("[data-leisure-home]");
    const listeners = [];
    const requestFrame = typeof global.requestAnimationFrame === "function" ? global.requestAnimationFrame.bind(global) : callback => setTimeout(() => callback(now()), 16);
    const cancelFrame = typeof global.cancelAnimationFrame === "function" ? global.cancelAnimationFrame.bind(global) : clearTimeout;
    let state = createInitialState({ random: options.random || Math.random });
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
      context.fillStyle = "#071a18";
      context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      context.strokeStyle = "rgba(167, 235, 190, .08)";
      context.lineWidth = 1;
      for (let x = 0; x <= GRID_COLUMNS; x += 1) { context.beginPath(); context.moveTo(x * CELL_SIZE + .5, 0); context.lineTo(x * CELL_SIZE + .5, BOARD_HEIGHT); context.stroke(); }
      for (let y = 0; y <= GRID_ROWS; y += 1) { context.beginPath(); context.moveTo(0, y * CELL_SIZE + .5); context.lineTo(BOARD_WIDTH, y * CELL_SIZE + .5); context.stroke(); }
      if (state.food) drawFood(context, state.food);
      drawSnake(context, state);
      if (state.status === "ready") drawOverlay(context, "貪食蛇", "按下「開始遊戲」開始");
      if (state.status === "won") drawOverlay(context, "盤面清空！", "你完成了這一局貪食蛇");
      if (state.status === "lost") drawOverlay(context, "這局結束", "再試一次，挑戰更高分");
    }
    function statusCopy() {
      if (state.status === "ready") return ["準備開始", "吃到食物會成長並得分。"];
      if (state.status === "playing") return ["進行中", "吃食物、變長；避開邊界與自己的身體。"];
      if (state.status === "won") return ["成功", "你清空了盤面，這局得分 " + state.score + " 分。"];
      const reason = state.outcomeReason === "self" ? "撞到自己的身體了。" : state.outcomeReason === "time" ? "時間到了。" : "撞到邊界了。";
      return ["失敗", reason + " 再試一次吧。"];
    }
    function paint() {
      if (destroyed) return;
      const copy = statusCopy();
      root.dataset.gameState = state.status;
      root.dataset.gameDirection = state.direction;
      root.dataset.gameLength = String(state.body.length);
      if (scoreNode) scoreNode.textContent = String(state.score);
      if (lengthNode) lengthNode.textContent = String(state.body.length);
      if (timerNode) timerNode.textContent = state.status === "ready" ? "01:30" : formatRemaining(state.elapsedMs);
      if (statusNode) statusNode.textContent = copy[0];
      if (resultNode) resultNode.textContent = copy[1];
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
      while (accumulator >= STEP_MS && state.status === "playing") { state = advanceState(state, { random: options.random || Math.random }); accumulator -= STEP_MS; }
      if (state.status === "playing" && state.elapsedMs >= MAX_DURATION_MS) state = lostState(state, state.direction, "time");
      paint();
      if (running && state.status === "playing") frameId = requestFrame(loop); else { running = false; frameId = 0; }
    }
    function startGame() {
      if (destroyed || state.status === "playing") return;
      if (state.status !== "ready") state = createInitialState({ random: options.random || Math.random });
      state = startState(state, now());
      running = true;
      lastFrameAt = now();
      accumulator = 0;
      paint();
      frameId = requestFrame(loop);
    }
    function restartGame() { if (destroyed) return; stopLoop(); state = createInitialState({ random: options.random || Math.random }); paint(); startGame(); }
    function changeDirection(value) { if (destroyed) return; state = requestDirection(state, value); paint(); }
    function onKeydown(event) { const direction = directionFromKey(event.key); if (!direction || destroyed) return; event.preventDefault(); changeDirection(direction); }
    function onExit() { stopLoop(); if (typeof options.onExit === "function") options.onExit(); }
    listen(documentRef, "keydown", onKeydown);
    listen(startButton, "click", () => { if (state.status === "ready") startGame(); else if (state.status !== "playing") restartGame(); });
    listen(restartButton, "click", restartGame);
    listen(exitButton, "click", onExit);
    root.querySelectorAll("[data-snake-direction]").forEach(button => {
      const direction = button.dataset.snakeDirection;
      const activate = event => { event.preventDefault(); changeDirection(direction); };
      listen(button, "pointerdown", activate, { passive: false });
      listen(button, "click", activate);
    });
    paint();
    return Object.freeze({
      start: startGame,
      restart: restartGame,
      destroy() { if (destroyed) return; destroyed = true; stopLoop(); listeners.splice(0).forEach(remove => remove()); root.dataset.gameState = "destroyed"; },
      getState() { return { ...state, body: state.body.map(clonePoint), food: state.food ? clonePoint(state.food) : null }; }
    });
  }
  function markup() {
    return '<section class="arcade-runtime snake-runtime" data-leisure-game-runtime data-game-id="snake" aria-labelledby="snake-title">' +
      '<div class="leisure-game-toolbar"><div><p class="leisure-eyebrow">GAME 02 · 經典小遊戲</p><h2 id="snake-title">🐍 貪食蛇</h2></div><button class="leisure-back-button" type="button" data-leisure-home>← 返回休閒小站</button></div>' +
      '<div class="arcade-game-layout snake-game-layout">' +
        '<section class="arcade-board-card snake-board-card" aria-label="貪食蛇遊戲區"><div class="arcade-board-head"><div><span class="arcade-board-label">PLAY AREA</span><strong data-snake-status>準備開始</strong></div><span class="arcade-live-dot" aria-hidden="true"></span></div><div class="arcade-board-frame snake-board-frame"><canvas data-snake-canvas width="432" height="432" aria-label="貪食蛇遊戲畫面"></canvas></div><p class="arcade-result" data-snake-result aria-live="polite">吃到食物會成長並得分。</p></section>' +
        '<aside class="arcade-control-card" aria-label="貪食蛇遊戲控制"><div class="arcade-stat-grid"><div><span>得分</span><strong data-snake-score>0</strong></div><div><span>長度</span><strong data-snake-length>3</strong></div><div><span>剩餘時間</span><strong data-snake-timer>01:30</strong></div></div><div class="arcade-action-row"><button class="leisure-primary-button" type="button" data-snake-start>開始遊戲</button><button class="leisure-secondary-button" type="button" data-snake-restart>重新開始</button></div><div class="arcade-touch-section"><div class="arcade-control-heading"><strong>觸控方向</strong><span>手機可直接點按</span></div><div class="arcade-touch-pad" role="group" aria-label="貪食蛇觸控方向控制"><span></span><button type="button" data-snake-direction="up" aria-label="向上">↑</button><span></span><button type="button" data-snake-direction="left" aria-label="向左">←</button><span class="arcade-touch-center" aria-hidden="true">🐍</span><button type="button" data-snake-direction="right" aria-label="向右">→</button><span></span><button type="button" data-snake-direction="down" aria-label="向下">↓</button><span></span></div></div><div class="arcade-help"><strong>Desktop</strong><span>Arrow Keys 或 W / A / S / D</span><strong>玩法</strong><span>吃到食物會變長；撞到邊界或自己就會結束。</span></div></aside>' +
      '</div></section>';
  }
  return Object.freeze({
    constants: Object.freeze({ GRID_COLUMNS, GRID_ROWS, CELL_SIZE, STEP_MS, MAX_DURATION_MS }),
    directions: DIRECTIONS,
    directionFromKey,
    requestDirection,
    createInitialState,
    startState,
    advanceState,
    nextFood,
    formatClock,
    markup,
    create
  });
});
