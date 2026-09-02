/* 數獨 Game Module.
 *
 * A small local 9x9 Sudoku. The puzzle is embedded as a product-safe starter
 * board; no account, cloud state or external service is involved.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LeisureSudokuGame = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (global) {
  "use strict";

  const BOARD_SIZE = 9;
  const BOX_SIZE = 3;
  const PUZZLE = Object.freeze([
    Object.freeze([5, 3, 0, 0, 7, 0, 0, 0, 0]),
    Object.freeze([6, 0, 0, 1, 9, 5, 0, 0, 0]),
    Object.freeze([0, 9, 8, 0, 0, 0, 0, 6, 0]),
    Object.freeze([8, 0, 0, 0, 6, 0, 0, 0, 3]),
    Object.freeze([4, 0, 0, 8, 0, 3, 0, 0, 1]),
    Object.freeze([7, 0, 0, 0, 2, 0, 0, 0, 6]),
    Object.freeze([0, 6, 0, 0, 0, 0, 2, 8, 0]),
    Object.freeze([0, 0, 0, 4, 1, 9, 0, 0, 5]),
    Object.freeze([0, 0, 0, 0, 8, 0, 0, 7, 9])
  ]);
  const SOLUTION = Object.freeze([
    5, 3, 4, 6, 7, 8, 9, 1, 2,
    6, 7, 2, 1, 9, 5, 3, 4, 8,
    1, 9, 8, 3, 4, 2, 5, 6, 7,
    8, 5, 9, 7, 6, 1, 4, 2, 3,
    4, 2, 6, 8, 5, 3, 7, 9, 1,
    7, 1, 3, 9, 2, 4, 8, 5, 6,
    9, 6, 1, 5, 3, 7, 2, 8, 4,
    2, 8, 7, 4, 1, 9, 6, 3, 5,
    3, 4, 5, 2, 8, 6, 1, 7, 9
  ]);

  function indexOf(row, column) { return row * BOARD_SIZE + column; }
  function inside(row, column) { return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE; }
  function flattenPuzzle() { return PUZZLE.reduce((all, row) => all.concat(row), []).map(value => value || null); }
  function createInitialState() {
    const givens = flattenPuzzle();
    return { status: "ready", givens, values: givens.slice(), solution: SOLUTION.slice(), selected: null, errors: [], lastError: "", outcomeReason: "" };
  }
  function startState(state) {
    if (!state || state.status === "playing") return state;
    return { ...state, status: "playing", lastError: "", outcomeReason: "" };
  }
  function isFixed(state, row, column) {
    return Boolean(state && inside(Number(row), Number(column)) && state.givens[indexOf(Number(row), Number(column))]);
  }
  function duplicateIndices(values) {
    const duplicates = new Set();
    function inspect(indices) {
      const seen = new Map();
      indices.forEach(cellIndex => {
        const value = values[cellIndex];
        if (!value) return;
        if (!seen.has(value)) seen.set(value, []);
        seen.get(value).push(cellIndex);
      });
      seen.forEach(indicesForValue => { if (indicesForValue.length > 1) indicesForValue.forEach(cellIndex => duplicates.add(cellIndex)); });
    }
    for (let row = 0; row < BOARD_SIZE; row += 1) inspect(Array.from({ length: BOARD_SIZE }, (_, column) => indexOf(row, column)));
    for (let column = 0; column < BOARD_SIZE; column += 1) inspect(Array.from({ length: BOARD_SIZE }, (_, row) => indexOf(row, column)));
    for (let boxRow = 0; boxRow < BOARD_SIZE; boxRow += BOX_SIZE) {
      for (let boxColumn = 0; boxColumn < BOARD_SIZE; boxColumn += BOX_SIZE) {
        inspect(Array.from({ length: BOX_SIZE * BOX_SIZE }, (_, offset) => indexOf(boxRow + Math.floor(offset / BOX_SIZE), boxColumn + offset % BOX_SIZE)));
      }
    }
    return duplicates;
  }
  function deriveErrors(values, solution) {
    const errors = duplicateIndices(values);
    values.forEach((value, cellIndex) => { if (value && value !== solution[cellIndex]) errors.add(cellIndex); });
    return Array.from(errors).sort((a, b) => a - b);
  }
  function normalizeValue(value) {
    if (value === "" || value === null || typeof value === "undefined") return null;
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized >= 1 && normalized <= 9 ? normalized : undefined;
  }
  function selectCell(state, row, column) {
    if (!state || !inside(Number(row), Number(column))) return state;
    return { ...state, selected: { row: Number(row), column: Number(column) } };
  }
  function setCell(state, row, column, value) {
    const targetRow = Number(row);
    const targetColumn = Number(column);
    if (!state || state.status !== "playing" || !inside(targetRow, targetColumn) || isFixed(state, targetRow, targetColumn)) return state;
    const normalized = normalizeValue(value);
    const selected = { row: targetRow, column: targetColumn };
    if (typeof normalized === "undefined") return { ...state, selected, lastError: "invalid-value" };
    const values = state.values.slice();
    values[indexOf(targetRow, targetColumn)] = normalized;
    const errors = deriveErrors(values, state.solution);
    const complete = values.every(Boolean) && errors.length === 0 && values.every((item, cellIndex) => item === state.solution[cellIndex]);
    return { ...state, values, selected, errors, lastError: "", status: complete ? "won" : "playing", outcomeReason: complete ? "complete" : "" };
  }
  function isComplete(state) { return Boolean(state && state.status === "won" && state.errors.length === 0 && state.values.every(Boolean)); }
  function statusCopy(state) {
    if (state.status === "ready") return ["準備開始", "填入 1–9，完成這個 9 × 9 數獨。"];
    if (state.status === "won") return ["完成", "恭喜完成這一局數獨！"];
    if (state.lastError === "invalid-value") return ["格式提醒", "請輸入 1–9，或清除目前格子。"];
    if (state.errors.length) return ["需要修正", "目前有 " + state.errors.length + " 格需要確認。"];
    return ["進行中", "灰色數字是題目提示，不能修改。"];
  }
  function create(root, options = {}) {
    if (!root) throw new Error("數獨需要一個 mount root。");
    const documentRef = root.ownerDocument || global.document;
    const boardNode = root.querySelector("[data-sudoku-board]");
    const statusNode = root.querySelector("[data-sudoku-status]");
    const resultNode = root.querySelector("[data-sudoku-result]");
    const filledNode = root.querySelector("[data-sudoku-filled]");
    const startButton = root.querySelector("[data-sudoku-start]");
    const restartButton = root.querySelector("[data-sudoku-restart]");
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
      boardNode.innerHTML = state.values.map((value, cellIndex) => {
        const row = Math.floor(cellIndex / BOARD_SIZE);
        const column = cellIndex % BOARD_SIZE;
        const fixed = Boolean(state.givens[cellIndex]);
        const selected = state.selected && state.selected.row === row && state.selected.column === column;
        const error = state.errors.includes(cellIndex);
        const classes = ["sudoku-cell", fixed ? "is-fixed" : "is-editable", selected ? "is-selected" : "", error ? "is-error" : "", column === 2 || column === 5 ? "is-box-right" : "", row === 2 || row === 5 ? "is-box-bottom" : ""].filter(Boolean).join(" ");
        const label = "第" + String(row + 1) + "列第" + String(column + 1) + "行";
        return '<button class="' + classes + '" type="button" role="gridcell" data-sudoku-cell data-row="' + row + '" data-column="' + column + '" aria-label="' + label + (value ? " " + value : " 空白") + '"' + (fixed || state.status !== "playing" ? " disabled" : "") + '>' + (value || "") + '</button>';
      }).join("");
    }
    function paint() {
      if (destroyed) return;
      const copy = statusCopy(state);
      root.dataset.gameState = state.status;
      if (statusNode) statusNode.textContent = copy[0];
      if (resultNode) resultNode.textContent = copy[1];
      if (filledNode) filledNode.textContent = String(state.values.filter(Boolean).length) + "/81";
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
      const target = event.target?.closest?.("[data-sudoku-cell]");
      if (!target) return;
      state = selectCell(state, Number(target.dataset.row), Number(target.dataset.column));
      paint();
    }
    function onKeydown(event) {
      if (destroyed || state.status !== "playing" || !state.selected) return;
      const key = String(event.key || "");
      if (!/^[1-9]$/.test(key) && key !== "Backspace" && key !== "Delete" && key !== "0") return;
      event.preventDefault();
      state = setCell(state, state.selected.row, state.selected.column, key === "0" || key === "Backspace" || key === "Delete" ? null : Number(key));
      paint();
    }
    function onKeypadClick(event) {
      const target = event.target?.closest?.("[data-sudoku-key]");
      if (!target || !state.selected) return;
      state = setCell(state, state.selected.row, state.selected.column, target.dataset.sudokuKey === "clear" ? null : Number(target.dataset.sudokuKey));
      paint();
    }
    function onExit() { if (typeof options.onExit === "function") options.onExit(); }
    listen(boardNode, "click", onBoardClick);
    listen(root, "click", onKeypadClick);
    listen(documentRef, "keydown", onKeydown);
    listen(startButton, "click", () => { if (state.status === "ready") startGame(); else if (state.status !== "playing") restartGame(); });
    listen(restartButton, "click", restartGame);
    listen(exitButton, "click", onExit);
    paint();
    return Object.freeze({
      start: startGame,
      restart: restartGame,
      destroy() { if (destroyed) return; destroyed = true; listeners.splice(0).forEach(remove => remove()); root.dataset.gameState = "destroyed"; },
      getState() { return { ...state, givens: state.givens.slice(), values: state.values.slice(), solution: state.solution.slice(), selected: state.selected ? { ...state.selected } : null, errors: state.errors.slice() }; }
    });
  }
  function markup() {
    const keypad = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => '<button type="button" class="sudoku-key" data-sudoku-key="' + value + '">' + value + '</button>').join("") + '<button type="button" class="sudoku-key sudoku-key-clear" data-sudoku-key="clear">清除</button>';
    return '<section class="arcade-runtime sudoku-runtime" data-leisure-game-runtime data-game-id="sudoku" aria-labelledby="sudoku-title">' +
      '<div class="leisure-game-toolbar"><div><p class="leisure-eyebrow">GAME 04 · 邏輯挑戰</p><h2 id="sudoku-title">🔢 數獨</h2></div><button class="leisure-back-button" type="button" data-leisure-home>← 返回休閒小站</button></div>' +
      '<div class="arcade-game-layout sudoku-game-layout">' +
        '<section class="arcade-board-card sudoku-board-card" aria-label="數獨遊戲區"><div class="arcade-board-head"><div><span class="arcade-board-label">SUDOKU PLAY AREA</span><strong data-sudoku-status>準備開始</strong></div><span class="arcade-live-dot" aria-hidden="true"></span></div><div class="sudoku-board-wrap"><div class="sudoku-board" data-sudoku-board role="grid" aria-label="九乘九數獨棋盤"></div></div><p class="arcade-result" data-sudoku-result aria-live="polite">填入 1–9，完成這個 9 × 9 數獨。</p></section>' +
        '<aside class="arcade-control-card" aria-label="數獨遊戲控制"><div class="arcade-stat-grid"><div><span>已填入</span><strong data-sudoku-filled>30/81</strong></div><div><span>提示數</span><strong>30</strong></div><div><span>模式</span><strong>單人</strong></div></div><div class="arcade-action-row"><button class="leisure-primary-button" type="button" data-sudoku-start>開始遊戲</button><button class="leisure-secondary-button" type="button" data-sudoku-restart>重新開始</button></div><div class="sudoku-keypad" aria-label="數獨數字鍵盤">' + keypad + '</div><div class="arcade-help"><strong>玩法</strong><span>每一列、每一行與每一宮都要填入 1–9 且不能重複。</span><strong>提示</strong><span>題目提示為灰色，填入錯誤數字會立即標示。</span></div></aside>' +
      '</div></section>';
  }
  return Object.freeze({
    constants: Object.freeze({ BOARD_SIZE, BOX_SIZE }),
    puzzle: PUZZLE,
    solution: SOLUTION,
    indexOf,
    inside,
    createInitialState,
    startState,
    isFixed,
    deriveErrors,
    selectCell,
    setCell,
    isComplete,
    markup,
    create
  });
});
