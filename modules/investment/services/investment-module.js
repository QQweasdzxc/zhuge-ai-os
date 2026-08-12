(function (global) {
  "use strict";

  const pageRegistry = Object.freeze({
    overview: global.InvestmentOverviewPage,
    portfolio: global.InvestmentPortfolioPage,
    watchlist: global.InvestmentWatchlistPage,
    strategy: global.InvestmentStrategyPage,
    settings: global.InvestmentSettingsPage
  });

  function dependencyBundle() {
    return {
      escape: global.InvestmentSafeHtml.escape,
      format: global.InvestmentFormatters,
      calculation: global.PortfolioCalculationService,
      positionCard: global.InvestmentPositionCard,
      version: global.InvestmentConfig.version
    };
  }

  // Locked/error states still belong to the Investment Workspace. Keep the
  // protected message inside the canonical OS Shell so a security gate never
  // makes the product look like a separate application. This is presentation
  // only; the existing session, MFA and permission decisions remain intact.
  function accessShell(content, options = {}) {
    const title = global.InvestmentSafeHtml.escape(options.title || "Investment");
    const description = global.InvestmentSafeHtml.escape(options.description || "投資模組｜受保護的工作空間");
    return `<div class="zhuge-module-shell workspace-shell investment-module-shell investment-access-shell"><div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="investment"></div><div class="app workspace-app investment-app"><div id="zhugeSharedHeader" data-zhuge-shared-header data-title="${title}" data-description="${description}"></div><main class="investment-access-content">${content}</main></div></div>`;
  }

  function mountAccessShell(root, options = {}) {
    const nav = root?.querySelector("#zhugeSharedNavigation");
    if (nav && global.ZhugeSharedNavigation) {
      const foundation = global.ZhugeFoundationConfig || {};
      const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
      global.ZhugeSharedNavigation.mount(nav, { activeWorkspace: "investment", externalRoot: "../../", version: release.version, build: release.build });
    }
    const header = root?.querySelector("#zhugeSharedHeader");
    if (header && global.ZhugeSharedShell) {
      const foundation = global.ZhugeFoundationConfig || {};
      const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
      global.ZhugeSharedShell.mountHeader(header, { title: options.title || "Investment", description: options.description || "投資模組｜受保護的工作空間", version: release.version, build: release.build });
    }
  }

  function accessScreen(result = {}) {
    const reason = result.code === "SESSION_EXPIRED"
      ? "登入狀態已過期，請重新登入。"
      : "請先使用 Google 帳號登入 Zhuge AI OS，再開啟投資模組。";
    return accessShell(`<div class="investment-access-panel"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt="Zhuge AI OS"><p class="investment-eyebrow">Zhuge AI OS › 投資</p><h1>請先登入</h1><p>${global.InvestmentSafeHtml.escape(reason)}</p><div><a class="investment-primary-link" href="../worklog/?app=1">使用 Google 帳號登入</a><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></div></div>`, { title: "Investment", description: "投資模組｜登入後即可使用投資工作空間" });
  }

  function unlockScreen(state = {}) {
    const escape = global.InvestmentSafeHtml.escape;
    const busy = state.status === "loading" || state.status === "verifying";
    const error = state.error ? `<div class="investment-unlock-error" role="alert">${escape(state.error)}</div>` : "";
    let content = `<div class="investment-loading zhuge-mfa-progress"><span></span><p>正在檢查安全驗證…</p></div>`;
    if (state.mode === "enrollment_required") {
      content = `<div class="zhuge-mfa-info"><strong>投資資料需要額外保護</strong><span>第一次使用請先設定驗證器。完成後，之後只要輸入驗證碼即可進入。</span></div><div class="investment-unlock-actions"><button class="investment-unlock-button" type="button" data-investment-enroll ${busy ? "disabled" : ""}>開始設定驗證器</button></div>`;
    } else if (state.mode === "enroll") {
      content = `<div class="zhuge-mfa-grid"><div class="zhuge-mfa-qr"><img class="investment-unlock-qr" src="${escape(state.qrCode || "")}" alt="Google Authenticator 設定 QR Code"><p>用 Google Authenticator 掃描此 QR Code</p><details class="investment-unlock-secret zhuge-mfa-secret"><summary>無法掃描？查看設定金鑰</summary><code>${escape(state.secret || "")}</code></details></div><div class="zhuge-mfa-step"><div class="zhuge-mfa-info"><strong>完成安全驗證</strong><span>掃描後，輸入 App 顯示的 6 位數驗證碼。QR Code 只用於設定驗證器，不會取代 Google 登入。</span></div>${unlockCodeForm(state, busy)}</div></div>`;
    } else if (state.mode === "challenge") {
      content = `<div class="zhuge-mfa-info"><strong>請輸入驗證碼</strong><span>開啟 Google Authenticator，輸入目前顯示的 6 位數驗證碼。驗證成功後，投資模組會解鎖 10 分鐘。</span></div>${unlockCodeForm(state, busy)}`;
    }
    return accessShell(`<div class="investment-access-panel investment-unlock-panel zhuge-mfa-panel"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt="Zhuge AI OS"><p class="investment-eyebrow zhuge-mfa-kicker">安全驗證</p><h1>解鎖投資</h1><p class="zhuge-mfa-intro">這是受保護的投資工作區。完成安全驗證後即可進入。</p>${error}${content}<a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a><small>只會解鎖投資模組；AI OS 首頁與工時模組不受影響。</small></div>`, { title: "Investment 安全驗證", description: "投資模組｜完成安全驗證後即可進入" });
  }

  function unlockCodeForm(state = {}, busy = false) {
    return `<form class="investment-unlock-form zhuge-mfa-form" data-investment-unlock-form><label for="investmentTotpCode">驗證碼</label><input class="zhuge-mfa-code" id="investmentTotpCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="輸入 6 位數驗證碼" required><button class="investment-unlock-button" type="submit" ${busy ? "disabled" : ""}>${busy ? "驗證中…" : "驗證並進入"}</button><input type="hidden" name="factorId" value="${global.InvestmentSafeHtml.escape(state.factorId || "")}"></form>`;
  }

  async function mountUnlock(root, context) {
    let state = { status: "loading", mode: "preparing", error: "" };
    const paint = () => {
      global.ZhugeComponents.Summary.mount(root, unlockScreen(state));
      mountAccessShell(root, { title: "Investment 解鎖", description: "投資模組｜完成安全驗證後即可進入" });
    };
    const bind = () => {
      const enroll = root.querySelector("[data-investment-enroll]");
      if (enroll) enroll.onclick = async () => {
        state = { ...state, status: "loading", error: "" };
        paint();
        try {
          state = { status: "ready", error: "", ...(await context.security.enrollTotp()) };
        } catch (error) {
          state = { ...state, status: "ready", error: error?.message || "無法開始二次驗證。" };
        }
        paint();
        bind();
      };
      const form = root.querySelector("[data-investment-unlock-form]");
      if (form) form.onsubmit = async event => {
        event.preventDefault();
        const code = new FormData(form).get("code");
        const factorId = new FormData(form).get("factorId");
        state = { ...state, status: "verifying", error: "" };
        paint();
        try {
          await context.security.verifyUnlock({ factorId, code });
          global.InvestmentRuntime = await createRuntime(root);
          return;
        } catch (error) {
          state = { ...state, status: "ready", error: error?.message || "驗證碼不正確，請重新輸入。" };
        }
        paint();
        bind();
        root.querySelector("#investmentTotpCode")?.focus();
      };
    };
    paint();
    try {
      state = { status: "ready", error: "", ...(await context.security.prepareUnlock()) };
    } catch (error) {
      state = { status: "ready", mode: "enrollment_required", error: error?.message || "無法讀取驗證狀態。" };
    }
    paint();
    bind();
    root.querySelector("#investmentTotpCode")?.focus();
    return Object.freeze({ status: "locked", context });
  }

  function errorScreen(error) {
    return accessShell(`<div class="investment-access-panel"><p class="investment-eyebrow">投資模組</p><h1>投資模組初始化失敗</h1><p>${global.InvestmentSafeHtml.escape(error?.message || "發生未知錯誤")}</p><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></div>`, { title: "Investment", description: "投資模組｜初始化狀態" });
  }

  async function createRuntime(root) {
    const platform = global.ZhugeRuntimeSessionProvider.createPlatform();
    const context = platform.forModule("investment");
    const access = context.security.evaluate("view");
    if (!access.allowed) {
      if (["STEP_UP_REQUIRED", "MODULE_LOCKED"].includes(access.code) && context.session.getSnapshot().isAuthenticated) {
        return mountUnlock(root, context);
      }
      global.ZhugeComponents.Summary.mount(root, accessScreen(access));
      mountAccessShell(root, { title: "Investment", description: "投資模組｜登入後即可使用投資工作空間" });
      return Object.freeze({ status: "blocked", access });
    }

    const identity = context.identity.getCurrent();
    const repository = global.InvestmentRepositoryContract.assertRepository(
      global.SupabaseInvestmentRepository.create({ userId: context.identity.getUserId(), data: context.data })
    );
    const initialHash = String(global.location.hash || "").replace(/^#/, "");
    const activePage = global.InvestmentConfig.pages.includes(initialHash) ? initialHash : "overview";
    const store = global.InvestmentStore.create({ pages: global.InvestmentConfig.pages, activePage });
    const dependencies = dependencyBundle();

    global.ZhugeComponents.Summary.mount(root, global.InvestmentModuleShell.render({ activePage, identity }, dependencies));
    const sharedNavTarget = root.querySelector("#zhugeSharedNavigation");
    if (sharedNavTarget && global.ZhugeSharedNavigation) {
      const foundation = global.ZhugeFoundationConfig || {};
      const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
      global.ZhugeSharedNavigation.mount(sharedNavTarget, { activeWorkspace: "investment", externalRoot: "../../", version: release.version, build: release.build });
    }
    function renderSharedHeader(pageId) {
      const sharedHeaderTarget = root.querySelector("#zhugeSharedHeader");
      if (!sharedHeaderTarget || !global.ZhugeSharedShell) return;
      const pageKey = pageId || activePage;
      const [pageTitle, pageIcon] = global.InvestmentModuleShell.labels[pageKey] || ["投資", "📈"];
      const descriptions = {
        overview: "投資模組｜查看投資組合、近期變化與今日重點",
        portfolio: "投資組合｜查看目前持倉、成本與損益",
        watchlist: "觀察清單｜追蹤關注中的市場標的",
        strategy: "投資策略｜整理策略、判斷與風險提醒",
        settings: "偏好設定｜管理投資模組的顯示與計算偏好"
      };
      const release = global.ZhugeFoundationConfig?.version || {};
      global.ZhugeSharedShell.mountHeader(sharedHeaderTarget, {
        title: `${pageIcon} ${pageTitle}`,
        description: descriptions[pageKey] || "Zhuge AI OS 投資模組",
        identity,
        version: release.version,
        build: release.build,
        actionMarkup: '<button class="btn" type="button" data-investment-refresh>↻ 重新整理</button>'
      });
    }
    renderSharedHeader(activePage);
    const pageRoot = root.querySelector("#investmentPage");

    function renderPage() {
      const state = store.getState();
      const page = pageRegistry[state.activePage] || pageRegistry.overview;
      global.ZhugeComponents.Summary.update(pageRoot, state.status === "loading"
        ? '<div class="investment-loading"><span></span><p>正在讀取投資資料…</p></div>'
        : page.render(state, dependencies));
      root.querySelectorAll("[data-investment-route]").forEach(button => {
        button.classList.toggle("active", button.dataset.investmentRoute === state.activePage);
      });
    }

    function navigate(page, updateHash = true) {
      if (!global.InvestmentConfig.pages.includes(page)) return;
      if (updateHash && global.location.hash !== `#${page}`) global.location.hash = page;
      store.setActivePage(page);
      renderSharedHeader(page);
      renderPage();
    }

    async function load() {
      store.update({ status: "loading", identity, error: null });
      renderPage();
      const [portfolio, positions, transactions, watchlist, strategies, settings] = await Promise.all([
        repository.loadPortfolio(),
        repository.loadPositions(),
        repository.loadTransactions(),
        repository.loadWatchlist(),
        repository.loadStrategies(),
        repository.loadSettings()
      ]);
      store.update({
        status: "ready",
        identity,
        portfolio,
        positions,
        transactions,
        watchlist,
        strategies,
        settings,
        loadedAt: new Date().toISOString()
      });
      renderPage();
    }

    root.addEventListener("click", event => {
      if (event.target.closest("[data-toggle-sidebar]")) {
        root.querySelector(".zhuge-module-shell")?.classList.toggle("sidebar-open");
        return;
      }
      if (event.target.closest("[data-close-sidebar]")) {
        root.querySelector(".zhuge-module-shell")?.classList.remove("sidebar-open");
        return;
      }
      const route = event.target.closest("[data-investment-route]");
      if (route) navigate(route.dataset.investmentRoute);
      if (event.target.closest("[data-investment-refresh]")) load().catch(handleError);
    });
    global.addEventListener("hashchange", () => navigate(String(global.location.hash || "#overview").slice(1), false));

    function handleError(error) {
      console.error("Investment SIT runtime error", { message: error?.message || String(error) });
      store.update({ status: "error", error });
      global.ZhugeComponents.Summary.update(pageRoot, errorScreen(error));
    }

    try {
      await load();
      return Object.freeze({ status: "ready", context, repository, store, reload: load, navigate });
    } catch (error) {
      handleError(error);
      return Object.freeze({ status: "error", context, repository, store, reload: load, navigate });
    }
  }

  async function boot() {
    const root = document.getElementById("investmentApp");
    if (!root) throw new Error("Investment root element is missing.");
    try {
      global.InvestmentRuntime = await createRuntime(root);
    } catch (error) {
      console.error("Investment module boot failed", { message: error?.message || String(error) });
      global.ZhugeComponents.Summary.mount(root, errorScreen(error));
      mountAccessShell(root, { title: "Investment", description: "投資模組｜初始化狀態" });
    }
  }

  global.InvestmentModule = Object.freeze({ boot, createRuntime });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window);
