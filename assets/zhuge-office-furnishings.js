/* Zhuge AI OS P1 — native office quick links; no floating medal wall or invented live status. */
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

  // Keep the historical work/medal records for a later PM-directed placement,
  // but do not render them as a floating panel or over the native room.
  const works = Object.freeze([
    { id: "taskflow", title: "TaskFlow", caption: "正式大廳", glyph: "TF", note: "AI 工程任務與專案協作的正式作品入口。" },
    { id: "worklog", title: "WorkLog", caption: "工時作品", glyph: "WL", note: "工時、工作紀錄與待辦管理的作品入口。" },
    { id: "investment", title: "Investment", caption: "投資作品", glyph: "IV", note: "投資研究與資產觀察的作品入口。" },
    { id: "lab", title: "Lab", caption: "實驗室", glyph: "LB", note: "Zhuge AI OS Labs 的功能實驗與作品集合。" }
  ].map((work) => Object.freeze({ ...work, href: routes[work.id] })));
  if (!Object.prototype.hasOwnProperty.call(window, "ZhugeOfficeAwards")) {
    Object.defineProperty(window, "ZhugeOfficeAwards", { configurable: false, enumerable: false, writable: false, value: works });
  }

  const pending = Object.freeze({
    cockpit: "AI 指揮艙正式連結待 PM 補充。",
    tools: "TF-03 駕駛艙正式下載來源尚待驗證。"
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
    root.setAttribute("aria-label", "像素辦公室快速入口");

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
        element.setAttribute("aria-description", "連結待驗證");
        element.addEventListener("click", function () { tell(pending[key]); });
      }
      element.append(node("span", "zgf-device-face", sprite), node("span", "zgf-device-name", name));
      return element;
    }

    const rack = node("nav", "zgf-rack");
    rack.setAttribute("aria-label", "辦公室設備快速入口");
    rack.append(
      furniture("TaskFlow", "TF", "正式工作入口", routes.taskflow, "taskflow"),
      furniture("打卡鐘", "WL", "WorkLog 工時", routes.worklog, "worklog"),
      furniture("行情電視", "IV", "Investment 投資", routes.investment, "investment"),
      furniture("工具櫃", "03", "TF-03 待補下載", null, "tools"),
      furniture("檔案櫃", "檔", "經典狀態報表", routes.classic, "classic"),
      furniture("AI 指揮艙", "艙", "正式連結待補", null, "cockpit")
    );
    root.append(rack, toast);
    document.body.append(root);

    // Native Habblaud modal always wins; the rack never covers its controls.
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
