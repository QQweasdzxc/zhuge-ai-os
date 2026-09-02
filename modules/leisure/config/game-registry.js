/* Leisure Station game registry.
 *
 * The registry is intentionally small: the container owns navigation between
 * games, while each available game owns its markup and runtime. Future games
 * are represented as disabled metadata until their modules are implemented.
 */
(function (global) {
  "use strict";

  const entries = Object.freeze({
    silkworm: Object.freeze({
      id: "silkworm",
      icon: "🐛",
      label: "天蠶變",
      description: "收集桑葉，讓天蠶長成自己的新模樣。",
      status: "現在可玩",
      available: true,
      module: "LeisureSilkwormGame"
    }),
    gomoku: Object.freeze({
      id: "gomoku",
      icon: "⚫",
      label: "五子棋",
      description: "雙人棋局，準備中。",
      status: "敬請期待",
      available: false,
      comingSoon: true
    }),
    sudoku: Object.freeze({
      id: "sudoku",
      icon: "🔢",
      label: "數獨",
      description: "安靜解題，準備中。",
      status: "敬請期待",
      available: false,
      comingSoon: true
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
