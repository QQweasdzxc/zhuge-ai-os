/* 天蠶變 Game Module.
 *
 * This is an original, asset-free mini-game inspired by the familiar
 * grow-and-navigate game loop. The module owns its rules, canvas drawing,
 * input bindings and lifecycle; the Leisure Station container only mounts it.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeisureSilkwormGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const GRID_COLUMNS = 18;
  const GRID_ROWS = 24;
  const CELL_SIZE = 24;
  const TARGET_LEAVES = 8;
  const STEP_MS = 240;
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
    ArrowUp: "up",
    w: "up",
    W: "up",
    ArrowRight: "right",
    d: "right",
    D: "right",
    ArrowDown: "down",
    s: "down",
    S: "down",
    ArrowLeft: "left",
    a: "left",
    A: "left"
  });
  const FIXED_HAZARDS = Object.freeze([
    Object.freeze({ x: 3, y: 5 }),
    Object.freeze({ x: 14, y: 6 }),
    Object.freeze({ x: 5, y: 12 }),
    Object.freeze({ x: 13, y: 16 })
  ]);
  const INITIAL_BODY = Object.freeze([
    Object.freeze({ x: 9, y: 20 }),
    Object.freeze({ x: 9, y: 21 }),
    Object.freeze({ x: 9, y: 22 })
  ]);

  function point(x, y) {
    return { x: Number(x), y: Number(y) };
  }

  function samePoint(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y);
  }

  function clonePoint(value) {
    return point(value.x, value.y);
  }

  function directionFromKey(key) {
    return KEY_DIRECTIONS[String(key || "")] || null;
  }

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

  function occupiedBy(points, target) {
    return points.some(item => samePoint(item, target));
  }

  function nextFood(body, hazards, random = Math.random) {
    const blocked = [...(body || []), ...(hazards || [])];
    const available = [];
    for (let y = 1; y < GRID_ROWS - 1; y += 1) {
      for (let x = 1; x < GRID_COLUMNS - 1; x += 1) {
        const candidate = point(x, y);
        if (!occupiedBy(blocked, candidate)) available.push(candidate);
      }
    }
    return available[randomIndex(available.length, random)] || null;
  }

  function createInitialState({ random = Math.random, hazards = FIXED_HAZARDS } = {}) {
    const body = INITIAL_BODY.map(clonePoint);
    const safeHazards = (hazards || FIXED_HAZARDS).map(clonePoint);
    const preferredFood = point(9, 15);
    const food = occupiedBy([...body, ...safeHazards], preferredFood)
      ? nextFood(body, safeHazards, random)
      : preferredFood;
    return {
      status: "ready",
      direction: "up",
      queuedDirection: "up",
      body,
      food,
      hazards: safeHazards,
      score: 0,
      collected: 0,
      target: TARGET_LEAVES,
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
    return {
      ...state,
      status: "lost",
      direction,
      queuedDirection: direction,
      outcomeReason: reason
    };
  }

  function advanceState(state, { random = Math.random } = {}) {
    if (!state || state.status !== "playing") return state;
    const requested = state.queuedDirection || state.direction;
    const direction = state.body.length > 1 && OPPOSITES[state.direction] === requested
      ? state.direction
      : requested;
    const vector = DIRECTIONS[direction] || DIRECTIONS.right;
    const head = state.body[0];
    const nextHead = point(head.x + vector.x, head.y + vector.y);
    if (nextHead.x < 0 || nextHead.x >= GRID_COLUMNS || nextHead.y < 0 || nextHead.y >= GRID_ROWS) {
      return lostState(state, direction, "boundary");
    }
    if (occupiedBy(state.hazards, nextHead)) {
      return lostState(state, direction, "hazard");
    }
    const ateFood = samePoint(state.food, nextHead);
    const bodyToCheck = ateFood ? state.body : state.body.slice(0, -1);
    if (occupiedBy(bodyToCheck, nextHead)) {
      return lostState(state, direction, "self");
    }
    const body = [nextHead, ...state.body.map(clonePoint)];
    if (!ateFood) body.pop();
    const collected = state.collected + (ateFood ? 1 : 0);
    const score = state.score + (ateFood ? 10 : 0);
    if (collected >= state.target) {
      return { ...state, status: "won", direction, queuedDirection: direction, body, food: null, score, collected, outcomeReason: "target" };
    }
    const food = ateFood ? nextFood(body, state.hazards, random) : state.food;
    if (!food) {
      return { ...state, status: "won", direction, queuedDirection: direction, body, food: null, score, collected, outcomeReason: "board-cleared" };
    }
    return { ...state, direction, queuedDirection: direction, body, food, score, collected };
  }

  function startState(state, startedAt = 0) {
    if (!state || state.status === "playing") return state;
    return { ...state, status: "playing", startedAt: Number(startedAt) || 0, elapsedMs: 0, outcomeReason: "" };
  }

  function formatClock(milliseconds) {
    const seconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function formatRemaining(milliseconds) {
    return formatClock(Math.max(0, MAX_DURATION_MS - Number(milliseconds || 0)));
  }

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

  function drawLeaf(context, food) {
    const centerX = food.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = food.y * CELL_SIZE + CELL_SIZE / 2;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(-0.45);
    context.fillStyle = "#9ce6a5";
    context.beginPath();
    context.ellipse(0, 0, 8, 13, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#d5f7c8";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, 10);
    context.lineTo(0, -9);
    context.stroke();
    context.restore();
  }

  function drawHazard(context, hazard) {
    const x = hazard.x * CELL_SIZE + 4;
    const y = hazard.y * CELL_SIZE + 4;
    context.save();
    context.fillStyle = "#d58d68";
    roundedRect(context, x, y, CELL_SIZE - 8, CELL_SIZE - 8, 6);
    context.fill();
    context.strokeStyle = "#ffd0a8";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x + 5, y + CELL_SIZE - 11);
    context.lineTo(x + CELL_SIZE / 2, y + 5);
    context.lineTo(x + CELL_SIZE - 5, y + CELL_SIZE - 11);
    context.stroke();
    context.restore();
  }

  function drawWorm(context, state) {
    state.body.slice().reverse().forEach((segment, index) => {
      const isHead = samePoint(segment, state.body[0]);
      const inset = isHead ? 2 : 3;
      const x = segment.x * CELL_SIZE + inset;
      const y = segment.y * CELL_SIZE + inset;
      context.fillStyle = isHead ? "#f5c26b" : (index % 2 ? "#e79a5c" : "#f1ad63");
      roundedRect(context, x, y, CELL_SIZE - inset * 2, CELL_SIZE - inset * 2, 7);
      context.fill();
      context.strokeStyle = isHead ? "#fff0c5" : "rgba(255, 229, 182, .5)";
      context.lineWidth = 1;
      context.stroke();
      if (isHead) {
        const eyeDirection = DIRECTIONS[state.direction] || DIRECTIONS.right;
        const eyeX = x + (eyeDirection.x * 3) + (eyeDirection.x === 0 ? 6 : eyeDirection.x > 0 ? 12 : 2);
        const eyeY = y + (eyeDirection.y * 3) + (eyeDirection.y === 0 ? 6 : eyeDirection.y > 0 ? 12 : 2);
        context.fillStyle = "#182536";
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
    if (!root) throw new Error("天蠶變需要一個 mount root。");
    const documentRef = root.ownerDocument || global.document;
    const canvas = root.querySelector("[data-silkworm-canvas]");
    const context = canvas?.getContext?.("2d") || null;
    const scoreNode = root.querySelector("[data-silkworm-score]");
    const progressNode = root.querySelector("[data-silkworm-progress]");
    const progressFill = root.querySelector("[data-silkworm-progress-fill]");
    const timerNode = root.querySelector("[data-silkworm-timer]");
    const statusNode = root.querySelector("[data-silkworm-status]");
    const resultNode = root.querySelector("[data-silkworm-result]");
    const startButton = root.querySelector("[data-silkworm-start]");
    const restartButton = root.querySelector("[data-silkworm-restart]");
    const exitButton = root.querySelector("[data-leisure-home]");
    const listeners = [];
    const requestFrame = typeof global.requestAnimationFrame === "function"
      ? global.requestAnimationFrame.bind(global)
      : callback => setTimeout(() => callback(now()), 16);
    const cancelFrame = typeof global.cancelAnimationFrame === "function"
      ? global.cancelAnimationFrame.bind(global)
      : clearTimeout;
    let state = createInitialState({ random: options.random || Math.random });
    let running = false;
    let destroyed = false;
    let frameId = 0;
    let lastFrameAt = 0;
    let accumulator = 0;

    function now() {
      return Number(global.performance?.now?.() || Date.now());
    }

    function listen(target, eventName, handler, listenerOptions) {
      if (!target?.addEventListener) return;
      target.addEventListener(eventName, handler, listenerOptions);
      listeners.push(() => target.removeEventListener(eventName, handler, listenerOptions));
    }

    function draw() {
      if (!context) return;
      context.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      const background = context.createLinearGradient(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      background.addColorStop(0, "#112b3d");
      background.addColorStop(1, "#071422");
      context.fillStyle = background;
      context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      context.strokeStyle = "rgba(171, 222, 238, .09)";
      context.lineWidth = 1;
      for (let x = 0; x <= GRID_COLUMNS; x += 1) {
        context.beginPath();
        context.moveTo(x * CELL_SIZE + 0.5, 0);
        context.lineTo(x * CELL_SIZE + 0.5, BOARD_HEIGHT);
        context.stroke();
      }
      for (let y = 0; y <= GRID_ROWS; y += 1) {
        context.beginPath();
        context.moveTo(0, y * CELL_SIZE + 0.5);
        context.lineTo(BOARD_WIDTH, y * CELL_SIZE + 0.5);
        context.stroke();
      }
      state.hazards.forEach(hazard => drawHazard(context, hazard));
      if (state.food) drawLeaf(context, state.food);
      drawWorm(context, state);
      if (state.status === "ready") drawOverlay(context, "天蠶準備好了", "按下「開始遊戲」開始");
      if (state.status === "won") drawOverlay(context, "成功化繭！", "你收集了足夠的桑葉");
      if (state.status === "lost") drawOverlay(context, "這局結束", "再試一次，找到更安全的路線");
    }

    function statusCopy() {
      if (state.status === "ready") return ["準備開始", "收集 8 片桑葉，讓天蠶完成變化。"];
      if (state.status === "playing") return ["進行中", "收集桑葉；避開邊界、荊棘與自己的身體。"];
      if (state.status === "won") return ["成功", "天蠶已完成變化，這局得分 " + state.score + " 分。"];
      const reasons = {
        boundary: "撞到邊界了。",
        hazard: "碰到荊棘了。",
        self: "撞到自己的身體了。",
        time: "時間到了。"
      };
      return ["失敗", (reasons[state.outcomeReason] || "這局結束了") + " 再試一次吧。"];
    }

    function paint() {
      if (destroyed) return;
      const copy = statusCopy();
      root.dataset.gameState = state.status;
      root.dataset.gameDirection = state.direction;
      root.dataset.gameQueuedDirection = state.queuedDirection;
      root.dataset.gameLength = String(state.body.length);
      if (scoreNode) scoreNode.textContent = String(state.score);
      if (progressNode) progressNode.textContent = state.collected + " / " + state.target;
      if (progressFill) progressFill.style.width = Math.min(100, (state.collected / state.target) * 100) + "%";
      if (timerNode) timerNode.textContent = state.status === "ready" ? "01:30" : formatRemaining(state.elapsedMs);
      if (statusNode) statusNode.textContent = copy[0];
      if (resultNode) resultNode.textContent = copy[1];
      if (startButton) {
        startButton.disabled = state.status === "playing";
        startButton.textContent = state.status === "ready" ? "開始遊戲" : state.status === "playing" ? "進行中…" : "再玩一局";
      }
      draw();
    }

    function stopLoop() {
      running = false;
      if (frameId) cancelFrame(frameId);
      frameId = 0;
    }

    function loop(frameTime) {
      if (destroyed || !running) return;
      const timestamp = Number(frameTime) || now();
      const delta = Math.min(250, Math.max(0, timestamp - lastFrameAt));
      lastFrameAt = timestamp;
      state = { ...state, elapsedMs: Math.min(MAX_DURATION_MS, state.elapsedMs + delta) };
      accumulator += delta;
      while (accumulator >= STEP_MS && state.status === "playing") {
        state = advanceState(state, { random: options.random || Math.random });
        accumulator -= STEP_MS;
      }
      if (state.status === "playing" && state.elapsedMs >= MAX_DURATION_MS) {
        state = lostState(state, state.direction, "time");
      }
      paint();
      if (running && state.status === "playing") {
        frameId = requestFrame(loop);
      } else {
        running = false;
        frameId = 0;
      }
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

    function restartGame() {
      if (destroyed) return;
      stopLoop();
      state = createInitialState({ random: options.random || Math.random });
      paint();
      startGame();
    }

    function changeDirection(value) {
      if (destroyed) return;
      state = requestDirection(state, value);
      paint();
    }

    function onKeydown(event) {
      const direction = directionFromKey(event.key);
      if (!direction || destroyed) return;
      event.preventDefault();
      changeDirection(direction);
    }

    function onExit() {
      stopLoop();
      if (typeof options.onExit === "function") options.onExit();
    }

    listen(documentRef, "keydown", onKeydown);
    listen(startButton, "click", () => {
      if (state.status === "ready") startGame();
      else if (state.status !== "playing") restartGame();
    });
    listen(restartButton, "click", restartGame);
    listen(exitButton, "click", onExit);
    root.querySelectorAll("[data-silkworm-direction]").forEach(button => {
      const direction = button.dataset.silkwormDirection;
      const activate = event => {
        event.preventDefault();
        changeDirection(direction);
      };
      listen(button, "pointerdown", activate, { passive: false });
      listen(button, "click", activate);
    });

    paint();

    return Object.freeze({
      start: startGame,
      restart: restartGame,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopLoop();
        listeners.splice(0).forEach(remove => remove());
        root.dataset.gameState = "destroyed";
      },
      getState() {
        return {
          ...state,
          body: state.body.map(clonePoint),
          food: state.food ? clonePoint(state.food) : null,
          hazards: state.hazards.map(clonePoint)
        };
      }
    });
  }

  function markup() {
    return '<section class="silkworm-runtime" data-leisure-game-runtime data-game-id="silkworm" aria-labelledby="silkworm-title">' +
      '<div class="leisure-game-toolbar"><div><p class="leisure-eyebrow">GAME 01 · 原創小遊戲</p><h2 id="silkworm-title">🐛 天蠶變</h2></div><button class="leisure-back-button" type="button" data-leisure-home>← 返回休閒小站</button></div>' +
      '<div class="silkworm-game-layout">' +
        '<section class="silkworm-board-card" aria-label="天蠶變遊戲區">' +
          '<div class="silkworm-board-head"><div><span class="silkworm-board-label">PLAY AREA</span><strong data-silkworm-status>準備開始</strong></div><span class="silkworm-live-dot" aria-hidden="true"></span></div>' +
          '<div class="silkworm-board-frame"><canvas data-silkworm-canvas width="432" height="576" aria-label="天蠶變遊戲畫面"></canvas></div>' +
          '<p class="silkworm-result" data-silkworm-result aria-live="polite">收集 8 片桑葉，讓天蠶完成變化。</p>' +
        '</section>' +
        '<aside class="silkworm-control-card" aria-label="天蠶變遊戲控制">' +
          '<div class="silkworm-stat-grid"><div><span>得分</span><strong data-silkworm-score>0</strong></div><div><span>桑葉</span><strong data-silkworm-progress>0 / 8</strong></div><div><span>剩餘時間</span><strong data-silkworm-timer>01:30</strong></div></div>' +
          '<div class="silkworm-progress" aria-hidden="true"><span data-silkworm-progress-fill></span></div>' +
          '<div class="silkworm-action-row"><button class="leisure-primary-button" type="button" data-silkworm-start>開始遊戲</button><button class="leisure-secondary-button" type="button" data-silkworm-restart>重新開始</button></div>' +
          '<div class="silkworm-touch-section"><div class="silkworm-control-heading"><strong>觸控方向</strong><span>手機可直接點按</span></div><div class="silkworm-touch-pad" role="group" aria-label="天蠶變觸控方向控制"><span></span><button type="button" data-silkworm-direction="up" aria-label="向上">↑</button><span></span><button type="button" data-silkworm-direction="left" aria-label="向左">←</button><span class="silkworm-touch-center" aria-hidden="true">🐛</span><button type="button" data-silkworm-direction="right" aria-label="向右">→</button><span></span><button type="button" data-silkworm-direction="down" aria-label="向下">↓</button><span></span></div></div>' +
          '<div class="silkworm-help"><strong>Desktop</strong><span>Arrow Keys 或 W / A / S / D</span><strong>玩法</strong><span>吃到桑葉會變長；撞到邊界、荊棘或自己就會結束。</span></div>' +
        '</aside>' +
      '</div>' +
    '</section>';
  }

  return Object.freeze({
    constants: Object.freeze({
      GRID_COLUMNS,
      GRID_ROWS,
      CELL_SIZE,
      TARGET_LEAVES,
      STEP_MS,
      MAX_DURATION_MS
    }),
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
