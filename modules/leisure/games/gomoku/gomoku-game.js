/* 五子棋 Game Module.
 *
 * Local two-player Gomoku. The board and turn rules are deliberately kept in
 * this module; the Leisure container only mounts and destroys it.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeisureGomokuGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const BOARD_SIZE = 15;
  const WIN_LENGTH = 5;
  const DIRECTIONS = Object.freeze([[1, 0], [0, 1], [1, 1], [1, -1]]);

  function indexOf(row, column) { return row * BOARD_SIZE + column; }
  function inside(row, column) { return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE; }
  function createInitialState() {
    return {
      status: "ready",
      board: Array(BOARD_SIZE * BOARD_SIZE).fill(null),
      currentPlayer: "black",
      winner: null,
      lastMove: null,
      moveCount: 0,
      outcomeReason: ""
    };
  }
  function startState(state) {
    if (!state || state.status === "playing") return state;
    return { ...state, status: "playing", outcomeReason: "" };
  }
  function countDirection(board, row, column, rowStep, columnStep, player) {
    let count = 0;
    let nextRow = row + rowStep;
    let nextColumn = column + columnStep;
    while (inside(nextRow, nextColumn) && board[indexOf(nextRow, nextColumn)] === player) {
      count += 1;
      nextRow += rowStep;
      nextColumn += columnStep;
    }
    return count;
  }
  function winnerFor(board, row, column, player) {
    if (!player) return false;
    return DIRECTIONS.some(([rowStep, columnStep]) => 1 + countDirection(board, row, column, rowStep, columnStep, player) + countDirection(board, row, column, -rowStep, -columnStep, player) >= WIN_LENGTH);
  }
  function placeStone(state, row, column) {
    if (!state || state.status !== "playing") return state;
    const targetRow = Number(row);
    const targetColumn = Number(column);
    if (!inside(targetRow, targetColumn)) return state;
    const cellIndex = indexOf(targetRow, targetColumn);
    if (state.board[cellIndex]) return state;
    const player = state.currentPlayer;
    const board = state.board.slice();
    board[cellIndex] = player;
    const moveCount = state.moveCount + 1;
    if (winnerFor(board, targetRow, targetColumn, player)) {
      return { ...state, board, moveCount, lastMove: { row: targetRow, column: targetColumn }, winner: player, status: "won", outcomeReason: "five-in-row" };
    }
    if (moveCount === board.length) {
      return { ...state, board, moveCount, lastMove: { row: targetRow, column: targetColumn }, status: "draw", outcomeReason: "board-full" };
    }
    return { ...state, board, moveCount, lastMove: { row: targetRow, column: targetColumn }, currentPlayer: player === "black" ? "white" : "black" };
  }
  function playerLabel(player) { return player === "black" ? "黑方" : "白方"; }
  function statusCopy(state) {
    if (state.status === "ready") return ["準備開始", "黑方先手，這是一局本機雙人五子棋。"];
    if (state.status === "playing") return [playerLabel(state.currentPlayer) + "回合", "輪流落子，先連成五子者勝。"];
    if (state.status === "won") return [playerLabel(state.winner) + "勝利", "恭喜完成五子連線！"];
    return ["和局", "棋盤已滿，重新開始再下一局。"];
  }
  function create(root, options = {}) {
    if (!root) throw new Error("五子棋需要一個 mount root。");
    const documentRef = root.ownerDocument || global.document;
    const boardNode = root.querySelector("[data-gomoku-board]");
    const statusNode = root.querySelector("[data-gomoku-status]");
    const resultNode = root.querySelector("[data-gomoku-result]");
    const movesNode = root.querySelector("[data-gomoku-moves]");
    const turnNode = root.querySelector("[data-gomoku-turn]");
    const startButton = root.querySelector("[data-gomoku-start]");
    const restartButton = root.querySelector("[data-gomoku-restart]");
    const exitButton = root.querySelector("[data-leisure-home]");
    const listeners = [];
    let state = createInitialState();
    let destroyed = false;
    function listen(target, eventName, handler) {
      if (!target?.addEventListener) return;
      target.addEventListener(eventName, handler);
      listeners.push(() => target.removeEventListener(eventName, handler));
    }
    function renderBoard() {
      if (!boardNode) return;
      boardNode.innerHTML = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, cellIndex) => {
        const row = Math.floor(cellIndex / BOARD_SIZE);
        const column = cellIndex % BOARD_SIZE;
        const value = state.board[cellIndex];
        const classes = ["gomoku-cell", value ? "is-" + value : "", state.lastMove && state.lastMove.row === row && state.lastMove.column === column ? "is-last" : ""].filter(Boolean).join(" ");
        const label = "第" + String(row + 1) + "列第" + String(column + 1) + "行" + (value ? " " + playerLabel(value) : "");
        return '<button class="' + classes + '" type="button" role="gridcell" data-gomoku-cell data-row="' + row + '" data-column="' + column + '" aria-label="' + label + '"' + (value || state.status !== "playing" ? " disabled" : "") + '>' + (value ? (value === "black" ? "●" : "○") : "") + '</button>';
      }).join("");
    }
    function paint() {
      if (destroyed) return;
      const copy = statusCopy(state);
      root.dataset.gameState = state.status;
      root.dataset.gomokuTurn = state.currentPlayer;
      if (statusNode) statusNode.textContent = copy[0];
      if (resultNode) resultNode.textContent = copy[1];
      if (movesNode) movesNode.textContent = String(state.moveCount);
      if (turnNode) turnNode.textContent = state.status === "playing" ? playerLabel(state.currentPlayer) : state.winner ? playerLabel(state.winner) : "—";
      if (startButton) {
        startButton.disabled = state.status === "playing";
        startButton.textContent = state.status === "ready" ? "開始遊戲" : state.status === "playing" ? "進行中…" : "再玩一局";
      }
      renderBoard();
    }
    function startGame() {
      if (destroyed || state.status === "playing") return;
      if (state.status !== "ready") state = createInitialState();
      state = startState(state);
      paint();
    }
    function restartGame() { if (destroyed) return; state = createInitialState(); paint(); startGame(); }
    function onBoardClick(event) {
      const target = event.target?.closest?.("[data-gomoku-cell]");
      if (!target) return;
      state = placeStone(state, Number(target.dataset.row), Number(target.dataset.column));
      paint();
    }
    function onExit() { if (typeof options.onExit === "function") options.onExit(); }
    listen(boardNode, "click", onBoardClick);
    listen(startButton, "click", () => { if (state.status === "ready") startGame(); else if (state.status !== "playing") restartGame(); });
    listen(restartButton, "click", restartGame);
    listen(exitButton, "click", onExit);
    paint();
    return Object.freeze({
      start: startGame,
      restart: restartGame,
      destroy() { if (destroyed) return; destroyed = true; listeners.splice(0).forEach(remove => remove()); root.dataset.gameState = "destroyed"; },
      getState() { return { ...state, board: state.board.slice(), lastMove: state.lastMove ? { ...state.lastMove } : null }; }
    });
  }
  function markup() {
    return '<section class="arcade-runtime gomoku-runtime" data-leisure-game-runtime data-game-id="gomoku" aria-labelledby="gomoku-title">' +
      '<div class="leisure-game-toolbar"><div><p class="leisure-eyebrow">GAME 03 · 本機雙人</p><h2 id="gomoku-title">⚫ 五子棋</h2></div><button class="leisure-back-button" type="button" data-leisure-home>← 返回休閒小站</button></div>' +
      '<div class="arcade-game-layout gomoku-game-layout">' +
        '<section class="arcade-board-card gomoku-board-card" aria-label="五子棋遊戲區"><div class="arcade-board-head"><div><span class="arcade-board-label">GOMOKU PLAY AREA</span><strong data-gomoku-status>準備開始</strong></div><span class="arcade-live-dot" aria-hidden="true"></span></div><div class="gomoku-board-wrap"><div class="gomoku-board" data-gomoku-board role="grid" aria-label="十五乘十五五子棋棋盤"></div></div><p class="arcade-result" data-gomoku-result aria-live="polite">黑方先手，這是一局本機雙人五子棋。</p></section>' +
        '<aside class="arcade-control-card" aria-label="五子棋遊戲控制"><div class="arcade-stat-grid"><div><span>落子數</span><strong data-gomoku-moves>0</strong></div><div><span>目前回合</span><strong data-gomoku-turn>—</strong></div><div><span>模式</span><strong>本機 2P</strong></div></div><div class="arcade-action-row"><button class="leisure-primary-button" type="button" data-gomoku-start>開始遊戲</button><button class="leisure-secondary-button" type="button" data-gomoku-restart>重新開始</button></div><div class="arcade-help"><strong>玩法</strong><span>黑白雙方輪流落子，先連成五子者勝。</span><strong>操作</strong><span>桌面與手機皆可直接點選棋盤。</span></div></aside>' +
      '</div></section>';
  }
  return Object.freeze({
    constants: Object.freeze({ BOARD_SIZE, WIN_LENGTH }),
    indexOf,
    inside,
    createInitialState,
    startState,
    winnerFor,
    placeStone,
    markup,
    create
  });
});
