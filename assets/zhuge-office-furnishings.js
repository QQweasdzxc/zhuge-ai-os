/* Zhuge AI OS P1 — scene furnishings; static navigation only, no fake agent/CLI state. */
(function () {
  "use strict";
  const current = new URL(location.href);
  const siteRoot = new URL(/\/docs\//.test(current.pathname) ? "../" : "./", current.href);
  const routes = Object.freeze({
    taskflow: "https://zhuge-taskflow-web.onrender.com/",
    worklog: new URL("modules/worklog/", siteRoot).href,
    investment: new URL("modules/investment/", siteRoot).href,
    lab: new URL("modules/labs/", siteRoot).href,
    classic: new URL("status-classic.html", /\/docs\//.test(current.pathname) ? new URL("./", current.href) : siteRoot).href
  });
  // AI Command Cockpit and TF-03 download have NOT been supplied or verified by PM.
  // Do not guess a URL or turn a placeholder into a fake download.
  const pending = Object.freeze({
    cockpit: "接待區內已設置獨立會議室；AI 指揮艙正式連結待 PM 補充。",
    tools: "TF-03 駕駛艙 v1.0.1 正式下載來源尚待驗證，不提供假下載。"
  });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function mount() {
    if (document.getElementById("zgf-root")) return;
    const root = node("aside", "zgf-root");
    root.id = "zgf-root";
    root.setAttribute("aria-label", "像素辦公室互動家具和作品入口");

    const toast = node("p", "zgf-toast");
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.hidden = true;
    let toastTimer;
    function tell(message) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.hidden = true; }, 5200);
    }

    function furniture(name, sprite, caption, href, key) {
      const element = node(href ? "a" : "button", "zgf-device");
      element.dataset.zgfWork = key;
      element.setAttribute("aria-label", name + "：" + caption);
      element.title = name + "｜" + caption;
      if (href) {
        element.href = href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
      } else {
        element.type = "button";
        element.dataset.zgfPending = key;
        element.setAttribute("aria-description", "連結待補充");
        element.addEventListener("click", function () { tell(pending[key]); });
      }
      element.append(node("span", "zgf-device-face", sprite), node("span", "zgf-device-name", name));
      return element;
    }

    const board = node("section", "zgf-awards");
    board.id = "zgf-trophy-board";
    board.dataset.sceneAnchor = "core:recepcao";
    board.setAttribute("aria-label", "Zhuge AI OS 作品獎牌牆");
    const boardHeader = node("div", "zgf-board-header");
    boardHeader.append(node("span", "zgf-board-title", "★ 作品獎牌牆"));
    const toggle = node("button", "zgf-board-toggle", "−");
    toggle.type = "button";
    toggle.setAttribute("aria-label", "展開或收合獎牌牆");
    toggle.setAttribute("aria-controls", "zgf-medals");
    const medals = node("div", "zgf-medals");
    medals.id = "zgf-medals";

    const works = [
      { id: "taskflow", title: "TaskFlow", caption: "正式大廳", glyph: "TF", note: "AI 工程任務與專案協作的正式作品入口。" },
      { id: "worklog", title: "WorkLog", caption: "工時作品", glyph: "WL", note: "工時、工作紀錄與待辦管理的作品入口。" },
      { id: "investment", title: "Investment", caption: "投資作品", glyph: "IV", note: "投資研究與資產觀察的作品入口。" },
      { id: "lab", title: "Lab", caption: "實驗室", glyph: "LB", note: "Zhuge AI OS Labs 的功能實驗與作品集合。" }
    ];
    const details = node("section", "zgf-work-details");
    details.id = "zgf-work-details";
    details.setAttribute("aria-label", "作品簡介");
    details.hidden = true;
    function showMedalInfo(work) {
      details.replaceChildren();
      const heading = node("strong", "zgf-work-heading", work.title + "｜" + work.caption);
      const close = node("button", "zgf-work-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "關閉作品介紹");
      close.addEventListener("click", function () { details.hidden = true; });
      const note = node("p", "zgf-work-summary", work.note);
      const truth = node("p", "zgf-work-truth", "此處是作品入口；不代表程式目前正在執行。");
      const go = node("a", "zgf-work-go", "↗ 進入作品");
      go.href = routes[work.id];
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      go.setAttribute("aria-label", "新分頁進入 " + work.title);
      details.append(heading, close, note, truth, go);
      details.hidden = false;
    }
    works.forEach(function (work) {
      const a = node("a", "zgf-medal");
      a.href = routes[work.id];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.dataset.zgfWork = work.id;
      a.title = work.title + "｜" + work.caption;
      a.setAttribute("aria-label", work.title + "：" + work.caption + "，新分頁開啟");
      a.append(node("span", "zgf-medal-face", work.glyph), node("span", "zgf-medal-label", work.title));
      const slot = node("div", "zgf-medal-slot");
      const info = node("button", "zgf-medal-info", "i");
      info.type = "button";
      info.dataset.zgfInfo = work.id;
      info.setAttribute("aria-label", "查看 " + work.title + " 作品介紹");
      info.setAttribute("aria-controls", "zgf-work-details");
      info.addEventListener("click", function () { showMedalInfo(work); });
      slot.append(a, info);
      medals.append(slot);
    });
    boardHeader.append(toggle);
    board.append(boardHeader, medals, details, node("p", "zgf-board-note", "點獎牌進作品 · 點 i 看介紹"));
    function setBoard(open) {
      board.dataset.open = open ? "true" : "false";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "−" : "+";
      if (!open) details.hidden = true;
    }
    // Keep the native Habblaud room visible on first paint. The real award
    // plaques live on its interior wall; open this compact info board on demand.
    setBoard(false);
    toggle.addEventListener("click", function () { setBoard(board.dataset.open !== "true"); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") details.hidden = true;
    });

    const rack = node("nav", "zgf-rack");
    rack.setAttribute("aria-label", "辦公室設備快速入口");
    rack.append(
      furniture("TaskFlow", "TF", "正式大廳", routes.taskflow, "taskflow"),
      furniture("打卡鐘", "WL", "WorkLog 工時", routes.worklog, "worklog"),
      furniture("行情電視", "IV", "Investment 投資", routes.investment, "investment"),
      furniture("工具櫃", "03", "TF-03 待補下載", null, "tools"),
      furniture("檔案櫃", "檔", "經典狀態報表", routes.classic, "classic"),
      furniture("會議室", "會", "AI 指揮艙連結待補", null, "cockpit")
    );
    root.append(board, rack, toast);
    document.body.append(root);

    // Native Habblaud modal must ALWAYS win: do not cover its close/decision controls.
    // The game iframe shares the same origin, so observe only the decision panel's
    // hidden attribute and direct body children (not the animated world).
    const game = document.querySelector("iframe");
    if (game) {
      let bodyObserver;
      let panelObserver;
      let watchedPanel;
      function updateVisibility() {
        try {
          const panel = game.contentDocument?.getElementById("zhuge-decision-panel") || null;
          if (panel !== watchedPanel) {
            if (panelObserver) panelObserver.disconnect();
            watchedPanel = panel;
            if (panel) {
              panelObserver = new MutationObserver(updateVisibility);
              panelObserver.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
            }
          }
          root.hidden = Boolean(panel && !panel.hidden);
        } catch { root.hidden = false; }
      }
      function watchGame() {
        try {
          if (bodyObserver) bodyObserver.disconnect();
          const body = game.contentDocument?.body;
          if (!body) return;
          bodyObserver = new MutationObserver(updateVisibility);
          bodyObserver.observe(body, { childList: true });
          updateVisibility();
        } catch { root.hidden = false; }
      }
      game.addEventListener("load", watchGame);
      try { if (game.contentDocument?.body) watchGame(); } catch { /* same-origin iframe expected */ }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
