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
      ? "Shared Session 已過期，請重新登入。"
      : "請先使用 Google 帳號登入 Zhuge AI OS，再開啟 Investment。";
    return `<main class="investment-access-screen"><img src="../../shared/assets/logo/zhuge-ai-os.svg" alt="Zhuge AI OS"><p class="investment-eyebrow">Zhuge AI OS › Investment</p><h1>需要 Shared Identity</h1><p>${global.InvestmentSafeHtml.escape(reason)}</p><div><a class="investment-primary-link" href="../worklog/?app=1">前往 Google 登入</a><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></div><small>Investment 不會啟動第二套 OAuth，也不保存獨立 Session。</small></main>`;
  }

  function errorScreen(error) {
    return `<main class="investment-access-screen"><p class="investment-eyebrow">INVESTMENT SIT</p><h1>Module 初始化失敗</h1><p>${global.InvestmentSafeHtml.escape(error?.message || "Unknown error")}</p><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></main>`;
  }

  async function createRuntime(root) {
    const platform = global.ZhugeRuntimeSessionProvider.createPlatform();
    const context = platform.forModule("investment");
    const access = context.security.evaluate("view");
    if (!access.allowed) {
      global.ZhugeComponents.Summary.mount(root, accessScreen(access));
      return Object.freeze({ status: "blocked", access });
    }

    const identity = context.identity.getCurrent();
    const repository = global.InvestmentRepositoryContract.assertRepository(
      global.MockInvestmentRepository.create({ userId: context.identity.getUserId() })
    );
    const initialHash = String(global.location.hash || "").replace(/^#/, "");
    const activePage = global.InvestmentConfig.pages.includes(initialHash) ? initialHash : "overview";
    const store = global.InvestmentStore.create({ pages: global.InvestmentConfig.pages, activePage });
    const dependencies = dependencyBundle();

    global.ZhugeComponents.Summary.mount(root, global.InvestmentModuleShell.render({ activePage, identity }, dependencies));
    const pageRoot = root.querySelector("#investmentPage");

    function renderPage() {
      const state = store.getState();
      const page = pageRegistry[state.activePage] || pageRegistry.overview;
      global.ZhugeComponents.Summary.update(pageRoot, state.status === "loading"
        ? '<div class="investment-loading"><span></span><p>正在準備 Investment Mock Data…</p></div>'
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

    await load().catch(handleError);
    return Object.freeze({ status: "ready", context, repository, store, reload: load, navigate });
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
