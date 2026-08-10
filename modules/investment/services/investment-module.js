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

  function accessScreen(result = {}) {
    const reason = result.code === "SESSION_EXPIRED"
      ? "登入狀態已過期，請重新登入。"
      : "請先使用 Google 帳號登入 Zhuge AI OS，再開啟投資模組。";
    return `<main class="investment-access-screen"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt="Zhuge AI OS"><p class="investment-eyebrow">Zhuge AI OS › 投資</p><h1>請先登入</h1><p>${global.InvestmentSafeHtml.escape(reason)}</p><div><a class="investment-primary-link" href="../worklog/?app=1">使用 Google 帳號登入</a><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></div></main>`;
  }

  function unlockScreen(state = {}) {
    const escape = global.InvestmentSafeHtml.escape;
    const busy = state.status === "loading" || state.status === "verifying";
    const error = state.error ? `<div class="investment-unlock-error" role="alert">${escape(state.error)}</div>` : "";
    let content = `<div class="investment-loading"><span></span><p>正在檢查二次驗證狀態…</p></div>`;
    if (state.mode === "enrollment_required") {
      content = `<p>投資資料屬於較敏感的個人資訊。第一次使用時，請設定 Google Authenticator。</p><button class="investment-unlock-button" type="button" data-investment-enroll ${busy ? "disabled" : ""}>設定 Google Authenticator</button>`;
    } else if (state.mode === "enroll") {
      content = `<p>請用 Google Authenticator 掃描 QR Code，再輸入 App 顯示的 6 位數驗證碼。</p><img class="investment-unlock-qr" src="${escape(state.qrCode || "")}" alt="Google Authenticator QR Code"><details class="investment-unlock-secret"><summary>無法掃描？顯示設定金鑰</summary><code>${escape(state.secret || "")}</code></details>${unlockCodeForm(state, busy)}`;
    } else if (state.mode === "challenge") {
      content = `<p>請輸入 Google Authenticator 顯示的 6 位數驗證碼。驗證成功後，投資模組會解鎖 10 分鐘。</p>${unlockCodeForm(state, busy)}`;
    }
    return `<main class="investment-access-screen investment-unlock-screen"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt="Zhuge AI OS"><p class="investment-eyebrow">投資安全驗證</p><h1>解鎖投資模組</h1>${error}${content}<a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a><small>只會解鎖投資模組；AI OS 首頁與工時模組不受影響。</small></main>`;
  }

  function unlockCodeForm(state = {}, busy = false) {
    return `<form class="investment-unlock-form" data-investment-unlock-form><label for="investmentTotpCode">6 位數驗證碼</label><input id="investmentTotpCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required><button class="investment-unlock-button" type="submit" ${busy ? "disabled" : ""}>${busy ? "驗證中…" : "驗證並解鎖"}</button><input type="hidden" name="factorId" value="${global.InvestmentSafeHtml.escape(state.factorId || "")}"></form>`;
  }

  async function mountUnlock(root, context) {
    let state = { status: "loading", mode: "preparing", error: "" };
    const paint = () => global.ZhugeComponents.Summary.mount(root, unlockScreen(state));
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
    return `<main class="investment-access-screen"><p class="investment-eyebrow">投資模組</p><h1>投資模組初始化失敗</h1><p>${global.InvestmentSafeHtml.escape(error?.message || "發生未知錯誤")}</p><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></main>`;
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
    }
  }

  global.InvestmentModule = Object.freeze({ boot, createRuntime });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window);
