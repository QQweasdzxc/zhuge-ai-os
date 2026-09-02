/* Leisure Station game registry.
 *
 * The registry is intentionally small: the container owns navigation between
 * games, while each game owns its markup and runtime. All four first-release
 * games are local-only and are intentionally independent of cloud state.
 */
(function (global) {
  "use strict";

  const entries = Object.freeze({
    territory: Object.freeze({
      id: "territory",
      icon: "🐛",
      label: "天蠶變",
      description: "離開安全區圈出土地，挑戰佔領率。",
      status: "現在可玩",
      available: true,
      module: "LeisureTerritoryGame"
    }),
    snake: Object.freeze({
      id: "snake",
      icon: "🐍",
      label: "貪食蛇",
      description: "吃到食物成長，挑戰自己的最高分。",
      status: "現在可玩",
      available: true,
      module: "LeisureSnakeGame"
    }),
    gomoku: Object.freeze({
      id: "gomoku",
      icon: "⚫",
      label: "五子棋",
      description: "本機雙人輪流落子，先連成五子者勝。",
      status: "現在可玩",
      available: true,
      module: "LeisureGomokuGame"
    }),
    sudoku: Object.freeze({
      id: "sudoku",
      icon: "🔢",
      label: "數獨",
      description: "填入 1–9，完成一局安靜的邏輯挑戰。",
      status: "現在可玩",
      available: true,
      module: "LeisureSudokuGame"
    })
  });

  function get(id) {
    return entries[String(id || "")] || null;
  }

  function list() {
    return Object.values(entries);
  }

  global.LeisureGameRegistry = Object.freeze({ entries, get, list });
})(typeof window !== "undefined" ? window : globalThis);
