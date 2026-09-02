/* Leisure Station module container.
 *
 * This file owns only the station screen and the small game-module registry
 * bridge. A game runtime is mounted inside the existing Zhuge AI OS content
 * area and is destroyed before the station screen is rendered again.
 */
(function (global) {
  "use strict";

  const gameRegistry = global.LeisureGameRegistry;
  const gameModules = Object.freeze({
    silkworm: () => global.LeisureSilkwormGame
  });
  let appRoot = null;
  let activeGame = null;

  function releaseInfo() {
    const foundation = global.ZhugeFoundationConfig || {};
    const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
    return { version: release.version || "", build: release.build || "" };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));
  }

  function shellMarkup(title, description, content) {
    return '<div class="zhuge-module-shell workspace-shell leisure-module-shell" data-leisure-module-shell>' +
      '<div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="leisure"></div>' +
      '<div class="app workspace-app leisure-app">' +
        '<div id="zhugeSharedHeader" data-zhuge-shared-header data-title="' + escapeHtml(title) + '" data-description="' + escapeHtml(description) + '"></div>' +
        '<main class="leisure-content-container workspace-content-container" data-leisure-content>' + content + '</main>' +
      '</div>' +
    '</div>';
  }

  function mountSharedShell() {
    const release = releaseInfo();
    const navTarget = appRoot?.querySelector("#zhugeSharedNavigation");
    if (navTarget && global.ZhugeSharedNavigation) {
      global.ZhugeSharedNavigation.mount(navTarget, {
        activeWorkspace: "leisure",
        externalRoot: "../../",
        version: release.version,
        build: release.build
      });
    }
    const headerTarget = appRoot?.querySelector("#zhugeSharedHeader");
    if (headerTarget && global.ZhugeSharedShell) {
      global.ZhugeSharedShell.mountHeader(headerTarget, {
        title: headerTarget.dataset.title || "休閒小站",
        description: headerTarget.dataset.description || "工作之間，玩一小局。",
        version: release.version,
        build: release.build
      });
    }
  }

  function destroyActiveGame() {
    if (activeGame?.destroy) activeGame.destroy();
    activeGame = null;
  }

  function stationMarkup() {
    const games = gameRegistry?.list?.() || [];
    const cards = games.map(game => {
      const available = game.available === true;
      const status = available ? '<span class="leisure-card-status is-live">現在可玩</span>' : '<span class="leisure-card-status">敬請期待</span>';
      const action = available
        ? '<button class="leisure-card-action" type="button" data-leisure-open-game="' + escapeHtml(game.id) + '">開始遊戲 <span aria-hidden="true">→</span></button>'
        : '<span class="leisure-card-action is-disabled" aria-disabled="true">即將加入</span>';
      return '<article class="leisure-game-card ' + (available ? "is-featured" : "is-coming-soon") + '" data-leisure-game-card="' + escapeHtml(game.id) + '">' +
        '<div class="leisure-game-card-icon" aria-hidden="true">' + escapeHtml(game.icon) + '</div>' +
        '<div class="leisure-game-card-copy"><div class="leisure-card-topline"><span class="leisure-card-index">GAME ' + String(games.indexOf(game) + 1).padStart(2, "0") + '</span>' + status + '</div><h2>' + escapeHtml(game.label) + '</h2><p>' + escapeHtml(game.description) + '</p></div>' +
        action +
      '</article>';
    }).join("");
    return '<section class="leisure-home" data-leisure-screen="home" aria-labelledby="leisure-title">' +
      '<div class="leisure-intro"><div><p class="leisure-eyebrow">Zhuge AI OS · BREAK TIME</p><h2 id="leisure-title">休閒小站</h2><p>工作一段時間，就玩一小局。這裡是 Zhuge AI OS 裡的獨立休閒空間。</p></div><div class="leisure-intro-mark" aria-hidden="true">🎮</div></div>' +
      '<div class="leisure-section-heading"><div><p class="leisure-eyebrow">GAME REGISTRY</p><h3>選一款遊戲</h3></div><span class="leisure-local-note">低負擔 · 不需雲端存檔</span></div>' +
      '<div class="leisure-game-grid">' + cards + '</div>' +
      '<aside class="leisure-boundary-note"><span aria-hidden="true">✦</span><div><strong>休息一下，再回到工作。</strong><p>遊戲 Runtime 獨立運作，不讀取 Investment、WorkLog 或 AI Board 資料。</p></div></aside>' +
    '</section>';
  }

  function showHome() {
    if (!appRoot) return;
    destroyActiveGame();
    appRoot.innerHTML = shellMarkup("休閒小站", "工作之間，玩一小局。", stationMarkup());
    mountSharedShell();
    appRoot.querySelectorAll("[data-leisure-open-game]").forEach(button => {
      button.addEventListener("click", () => openGame(button.dataset.leisureOpenGame));
    });
  }

  function openGame(id) {
    if (!appRoot) return;
    const definition = gameRegistry?.get?.(id);
    const module = definition?.available ? gameModules[definition.id]?.() : null;
    if (!definition || !module?.markup || !module?.create) return;
    destroyActiveGame();
    appRoot.innerHTML = shellMarkup(definition.label, "原創 Web Mini Game · 直接在 Zhuge AI OS 裡遊玩。", module.markup());
    mountSharedShell();
    const gameRoot = appRoot.querySelector("[data-leisure-game-runtime]");
    activeGame = module.create(gameRoot, { onExit: showHome });
  }

  function mount() {
    appRoot = global.document?.getElementById("leisureApp") || null;
    if (appRoot) showHome();
    return appRoot;
  }

  global.ZhugeLeisureModule = Object.freeze({
    mount,
    showHome,
    openGame,
    destroyActiveGame
  });

  if (global.document?.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})(typeof window !== "undefined" ? window : globalThis);
