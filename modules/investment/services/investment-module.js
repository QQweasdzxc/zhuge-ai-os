(function (global) {
  "use strict";

  const pageRegistry = Object.freeze({
    overview: global.InvestmentOverviewPage,
    portfolio: global.InvestmentPortfolioPage,
    strategy: global.InvestmentStrategyPage,
    settings: global.InvestmentSettingsPage,
    import: global.InvestmentScreenshotImportPage
  });

  function dependencyBundle() {
    return {
      escape: global.InvestmentSafeHtml.escape,
      format: global.InvestmentFormatters,
      calculation: global.PortfolioCalculationService,
      positionCard: global.InvestmentPositionCard,
      importEngine: global.InvestmentScreenshotImportEngine,
      recognitionProvider: global.InvestmentRecognitionProvider,
      goldenMaster: global.ZhugeGoldenMaster,
      drawer: global.ZhugeSharedTaskDrawer,
      parity: global.ZhugeTemplateParityEngine,
      actionContract: global.ZhugeSharedTaskActionContract,
      actionAdapters: global.ZhugeSharedTaskActionAdapters,
      releaseService: global.ZhugeModulePublishService,
      ivtk: global.InvestmentIVTKBoardAdapter,
      version: global.InvestmentConfig.version
    };
  }

  function snapshotWriteError(code, message, detail = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, detail);
    return error;
  }

  function snapshotWriteFormValues(formOrValues) {
    if (formOrValues && typeof formOrValues === "object" &&
      ["broker", "snapshotAt", "source", "idempotencyKey"].some(key => key in formOrValues)) {
      return Object.freeze({
        broker: String(formOrValues.broker || "").trim(),
        snapshotAt: String(formOrValues.snapshotAt || "").trim(),
        source: String(formOrValues.source || "").trim(),
        idempotencyKey: String(formOrValues.idempotencyKey || "").trim()
      });
    }
    const formData = new FormData(formOrValues);
    return Object.freeze({
      broker: String(formData.get("broker") || "").trim(),
      snapshotAt: String(formData.get("snapshotAt") || "").trim(),
      source: String(formData.get("source") || "").trim(),
      idempotencyKey: String(formData.get("idempotencyKey") || "").trim()
    });
  }

  function taipeiTimestamp(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) {
      throw snapshotWriteError("INVESTMENT_SNAPSHOT_TIME_INVALID", "請輸入有效的 Asia/Taipei Snapshot 時間。");
    }
    const local = raw.length === 16 ? `${raw}:00` : raw;
    const parsed = new Date(`${local}+08:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw snapshotWriteError("INVESTMENT_SNAPSHOT_TIME_INVALID", "請輸入有效的 Asia/Taipei Snapshot 時間。");
    }
    return parsed.toISOString();
  }

  function snapshotPosition(row) {
    const values = row?.values || {};
    return {
      symbol: values.symbol,
      name: values.name,
      market: values.market,
      currency: values.currency,
      quantity: values.quantity,
      avg_cost: values.averageCost,
      invested_cost: values.investedCost,
      last_price: values.currentPrice,
      market_value: values.marketValue,
      unrealized_pnl: values.unrealizedPnl,
      unrealized_pct: values.returnRate,
      raw_broker_values: {
        market: values.market,
        symbol: values.symbol,
        name: values.name,
        currency: values.currency,
        quantity: values.quantity,
        average_cost: values.averageCost,
        total_cost: values.investedCost,
        current_price: values.currentPrice,
        market_value: values.marketValue,
        unrealized_pnl: values.unrealizedPnl,
        return_rate: values.returnRate,
        recognition_confidence: row.recognitionConfidence,
        confidence_level: row.confidenceLevel,
        source_images: row.sourceImages,
        source_fields: row.sourceFields
      }
    };
  }

  function parseConfirmedSnapshotInput(raw) {
    let parsed;
    try {
      parsed = JSON.parse(String(raw || ""));
    } catch {
      throw snapshotWriteError("INVESTMENT_CONFIRMED_INPUT_INVALID", "PM Confirmed 結構化輸入不是有效 JSON。");
    }
    const container = Array.isArray(parsed) ? {} : parsed && typeof parsed === "object" ? parsed : {};
    const metadata = container.metadata && typeof container.metadata === "object" ? container.metadata : container;
    const positions = Array.isArray(parsed) ? parsed : container.positions;
    if (!Array.isArray(positions) || !positions.length) {
      throw snapshotWriteError("INVESTMENT_CONFIRMED_INPUT_INVALID", "PM Confirmed 結構化輸入缺少 positions 陣列。");
    }
    const requiredMetadata = ["broker", "snapshotAt", "source", "idempotencyKey"];
    if (requiredMetadata.some(key => !String(metadata[key] || "").trim())) {
      throw snapshotWriteError("INVESTMENT_CONFIRMED_INPUT_INVALID", "PM Confirmed 輸入必須包含 Broker、Snapshot 時間、Source 與 Idempotency Key。");
    }
    return Object.freeze({
      positions: Object.freeze(positions.slice(0, 100)),
      metadata: Object.freeze({
        broker: String(metadata.broker).trim(),
        snapshotAt: String(metadata.snapshotAt).trim(),
        source: String(metadata.source).trim(),
        idempotencyKey: String(metadata.idempotencyKey).trim(),
        provider: String(metadata.provider || "gpt-5.6-luna").trim(),
        model: String(metadata.model || "gpt-5.6-luna").trim()
      })
    });
  }

  // Locked/error states still belong to the Investment Workspace. Keep the
  // protected message inside the canonical OS Shell so a security gate never
  // makes the product look like a separate application. This is presentation
  // only; the existing session, MFA and permission decisions remain intact.
  function accessShell(content, options = {}) {
    const title = global.InvestmentSafeHtml.escape(options.title || "Investment");
    const description = global.InvestmentSafeHtml.escape(options.description || "投資模組｜受保護的工作空間");
    return `<div class="zhuge-module-shell workspace-shell investment-module-shell investment-access-shell" data-shared-navigation-mode="template-only" data-template-page-id="investment"><div id="zhugeSharedNavigation" data-external-root="../../" data-active-workspace="investment" data-template-page-id="investment" data-shared-navigation-disabled="true" data-exclude-board-prefix="IVTK"></div><div class="app workspace-app investment-app"><div id="zhugeSharedHeader" data-zhuge-shared-header data-title="${title}" data-description="${description}"></div><main class="investment-access-content">${content}</main></div></div>`;
  }

  function mountAccessShell(root, options = {}) {
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
    const code = String(error?.code || "");
    const copy = {
      INVESTMENT_OWNER_MAPPING_REQUIRED: {
        title: "需要完成 Investment 身分對應",
        message: "目前登入身份尚未取得 Investment Legacy Owner 對應，請聯絡系統管理員。"
      },
      INVESTMENT_ASSURANCE_REQUIRED: {
        title: "需要完成安全驗證",
        message: "投資資料受到額外安全保護，請完成安全驗證後繼續。"
      },
      INVESTMENT_SESSION_EXPIRED: {
        title: "登入工作階段已過期",
        message: "請重新登入後再讀取投資資料。"
      },
      INVESTMENT_SESSION_REQUIRED: {
        title: "需要登入",
        message: "請先使用 Google 帳號登入 Zhuge AI OS，再開啟投資模組。"
      },
      INVESTMENT_DATA_QUERY_ERROR: {
        title: "投資資料讀取失敗",
        message: "目前無法讀取正式 Investment Cloud 資料，請稍後再試。"
      },
      INVESTMENT_DATA_EMPTY: {
        title: "目前尚無投資資料",
        message: "目前登入身份沒有可呈現的 Investment 資料。"
      }
    }[code] || { title: "投資模組初始化失敗", message: "投資資料初始化時發生問題，請稍後再試。" };
    return accessShell(`<div class="investment-access-panel"><p class="investment-eyebrow">投資模組</p><h1>${global.InvestmentSafeHtml.escape(copy.title)}</h1><p>${global.InvestmentSafeHtml.escape(copy.message)}</p><a class="investment-secondary-link" href="../../app/dashboard/">返回 AI OS 首頁</a></div>`, { title: "Investment", description: "投資模組｜初始化狀態" });
  }

  async function createRuntime(root) {
    const platform = global.ZhugeRuntimeSessionProvider.createPlatform();
    const context = platform.forModule("investment");
    await context.creator?.resolve?.();
    await context.security.loadMfaPolicy?.();
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
      global.SupabaseInvestmentRepository.create({
        userId: context.identity.getUserId(),
        data: context.data,
        gateway: global.ZhugeSupabaseGateway?.createDataGateway?.(),
        sessionSnapshot: context.session.getSnapshot(),
        getSessionSnapshot: () => context.session.getSnapshot(),
        allowAal1Read: access.bypassedMfa === true
      })
    );
    const initialHash = String(global.location.hash || "").replace(/^#/, "");
    const canonicalPage = page => page === "watchlist" ? "portfolio" : page;
    const requestedPage = canonicalPage(initialHash);
    const activePage = global.InvestmentConfig.pages.includes(requestedPage) ? requestedPage : "overview";
    if (initialHash === "watchlist" && global.history?.replaceState) {
      global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}#portfolio`);
    }
    const store = global.InvestmentStore.create({ pages: global.InvestmentConfig.pages, activePage });
    const dependencies = dependencyBundle();
    const recognitionProvider = dependencies.recognitionProvider?.create?.({
      invokeFunction: context.data.invokeFunction
    }) || null;

    global.ZhugeComponents.Summary.mount(root, global.InvestmentModuleShell.render({ activePage, identity }, dependencies));
    function renderSharedHeader(pageId) {
      const sharedHeaderTarget = root.querySelector("#zhugeSharedHeader");
      if (!sharedHeaderTarget || !global.ZhugeSharedShell) return;
      const pageKey = pageId || activePage;
      const [pageTitle, pageIcon] = global.InvestmentModuleShell.labels[pageKey] || ["投資", "📈"];
      const descriptions = {
        overview: "投資模組｜查看投資組合、近期變化與今日重點",
        portfolio: "投資組合｜查看目前持倉、成本與損益",
        strategy: "投資策略｜整理策略、判斷與風險提醒",
        settings: "偏好設定｜管理投資模組的顯示與計算偏好",
        import: "截圖匯入｜辨識、Reconciliation 與受控 Snapshot"
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
    const importSession = global.InvestmentScreenshotImportEngine.createSession({
      createPreviewUrl: file => typeof global.URL?.createObjectURL === "function" ? global.URL.createObjectURL(file) : "",
      revokePreviewUrl: url => typeof global.URL?.revokeObjectURL === "function" ? global.URL.revokeObjectURL(url) : undefined
    });
    let snapshotWrite = Object.freeze({ status: "idle", form: Object.freeze({}), result: null, error: "", stepUp: null });
    let lastRenderedPageMarkup = "";

    function resetSnapshotWrite() {
      snapshotWrite = Object.freeze({ status: "idle", form: Object.freeze({}), result: null, error: "", stepUp: null });
    }

    function captureSnapshotWriteForm() {
      if (snapshotWrite.form && Object.keys(snapshotWrite.form).length) return;
      const form = pageRoot?.querySelector?.("[data-investment-snapshot-write-form]");
      if (!form) return;
      const values = snapshotWriteFormValues(form);
      if (!values.broker && !values.snapshotAt && !values.source && !values.idempotencyKey) return;
      snapshotWrite = Object.freeze({ ...snapshotWrite, form: values });
    }

    function currentSessionHasAal2() {
      return String(context.session.getSnapshot()?.aal || "").trim().toLowerCase() === "aal2";
    }

    function sensitiveWriteRequiresStepUp() {
      const policy = context.security.getMfaPolicy?.() || {};
      return policy.investment_sensitive_write_mfa_required !== false;
    }

    function loadConfirmedInput(form) {
      resetSnapshotWrite();
      try {
        const input = parseConfirmedSnapshotInput(new FormData(form).get("positionsJson"));
        importSession.loadConfirmedRows(input.positions, input.metadata);
      } catch (error) {
        importSession.setNotice(error?.message || "PM Confirmed 結構化輸入無法載入。");
      }
      renderPage();
    }

    function renderPage() {
      captureSnapshotWriteForm();
      const state = store.getState();
      const page = pageRegistry[state.activePage] || pageRegistry.overview;
      const importSnapshot = importSession.getSnapshot();
      const recognizedRows = importSnapshot.recognition?.status === "recognized"
        ? importSnapshot.recognition.rows
        : null;
      const scope = importSnapshot.recognition?.completeness === "full"
        ? "full"
        : importSnapshot.recognition?.completeness === "partial"
          ? "partial"
          : "unknown";
      const pageDependencies = {
        ...dependencies,
        importSession: importSnapshot,
        reconciliation: dependencies.importEngine.reconcile(state.positions, recognizedRows, { scope }),
        snapshotWrite,
        onSnapshotWrite: writeBrokerSnapshot
      };
      const markup = state.status === "loading"
        ? '<div class="investment-loading"><span></span><p>正在讀取投資資料…</p></div>'
        : page.render(state, pageDependencies);
      if (markup !== lastRenderedPageMarkup || !pageRoot?.firstElementChild) {
        global.ZhugeComponents.Summary.update(pageRoot, markup);
        lastRenderedPageMarkup = markup;
      }
      if (state.activePage === "portfolio") {
        const surface = pageRoot?.querySelector?.("[data-golden-master-surface]");
        if (surface && typeof dependencies.ivtk?.createRuntimeBridge === "function") {
          global.ZhugeBoardRuntime = dependencies.ivtk.createRuntimeBridge(state, pageDependencies, { root: global, boardRoot: surface, refresh: load });
          const parity = global.ZhugeBoardRuntime.runParityGuard({ trigger: "runtime", silent: true });
        }
      } else if (global.ZhugeBoardRuntime?.consumer === "investment-ivtk") {
        delete global.ZhugeBoardRuntime;
      }
      global.ZhugeMotherTemplateRelease?.applyToDocument?.("investment-ivtk");
      root.querySelectorAll("[data-investment-route]").forEach(button => {
        button.classList.toggle("active", button.dataset.investmentRoute === state.activePage);
        button.setAttribute("aria-selected", button.dataset.investmentRoute === state.activePage ? "true" : "false");
      });
    }

    async function beginSensitiveWriteStepUp(formValues) {
      snapshotWrite = Object.freeze({
        status: "step-up-required",
        form: formValues,
        result: null,
        error: "",
        stepUp: Object.freeze({ status: "preparing", mode: "preparing", error: "" })
      });
      renderPage();
      try {
        const prepared = await context.security.prepareUnlock();
        snapshotWrite = Object.freeze({
          status: "step-up-required",
          form: formValues,
          result: null,
          error: "",
          stepUp: Object.freeze({ status: "ready", error: "", ...prepared })
        });
      } catch (error) {
        snapshotWrite = Object.freeze({
          status: "step-up-required",
          form: formValues,
          result: null,
          error: "",
          stepUp: Object.freeze({ status: "error", mode: "error", error: error?.message || "無法準備安全驗證。" })
        });
      }
      renderPage();
    }

    async function enrollSensitiveWriteTotp() {
      const formValues = snapshotWrite.form || Object.freeze({});
      snapshotWrite = Object.freeze({
        ...snapshotWrite,
        status: "step-up-required",
        stepUp: Object.freeze({ ...(snapshotWrite.stepUp || {}), status: "enrolling", error: "" })
      });
      renderPage();
      try {
        const enrolled = await context.security.enrollTotp();
        snapshotWrite = Object.freeze({
          status: "step-up-required",
          form: formValues,
          result: null,
          error: "",
          stepUp: Object.freeze({ status: "ready", error: "", ...enrolled })
        });
      } catch (error) {
        snapshotWrite = Object.freeze({
          status: "step-up-required",
          form: formValues,
          result: null,
          error: "",
          stepUp: Object.freeze({ status: "error", mode: "error", error: error?.message || "無法設定安全驗證。" })
        });
      }
      renderPage();
    }

    async function verifySensitiveWrite(form) {
      const formValues = snapshotWrite.form || Object.freeze({});
      const formData = new FormData(form);
      const code = formData.get("code");
      const factorId = formData.get("factorId");
      const previousStepUp = snapshotWrite.stepUp || {};
      snapshotWrite = Object.freeze({
        ...snapshotWrite,
        status: "step-up-required",
        stepUp: Object.freeze({ ...previousStepUp, status: "verifying", error: "" })
      });
      renderPage();
      try {
        await context.security.verifyUnlock({ moduleId: "investment-sensitive-write", factorId, code });
        if (!currentSessionHasAal2()) {
          throw snapshotWriteError("INVESTMENT_ASSURANCE_REQUIRED", "安全驗證尚未完成，請再試一次。");
        }
        await writeBrokerSnapshot(formValues, { skipStepUp: true });
      } catch (error) {
        snapshotWrite = Object.freeze({
          status: "step-up-required",
          form: formValues,
          result: null,
          error: "",
          stepUp: Object.freeze({ ...previousStepUp, status: "ready", error: error?.message || "驗證碼不正確，請重新輸入。" })
        });
        renderPage();
        root.querySelector('[data-investment-sensitive-write-step-up] input[name="code"]')?.focus();
      }
    }

    async function writeBrokerSnapshot(formOrValues, { skipStepUp = false } = {}) {
      const formValues = snapshotWriteFormValues(formOrValues);
      const importSnapshot = importSession.getSnapshot();
      const state = store.getState();
      const recognizedRows = importSnapshot.recognition?.status === "recognized"
        ? importSnapshot.recognition.rows
        : null;
      const scope = importSnapshot.recognition?.completeness === "full"
        ? "full"
        : importSnapshot.recognition?.completeness === "partial"
          ? "partial"
          : "unknown";
      const comparison = dependencies.importEngine.reconcile(state.positions, recognizedRows, { scope });
      const eligibility = global.InvestmentScreenshotImportPage.snapshotWriteEligibility(importSnapshot, comparison);
      if (!eligibility.ok) {
        snapshotWrite = Object.freeze({ status: "error", form: formValues, result: null, error: eligibility.reason });
        renderPage();
        return;
      }
      if (!formValues.broker || !formValues.source || formValues.idempotencyKey.length < 8) {
        snapshotWrite = Object.freeze({ status: "error", form: formValues, result: null, error: "請完整填寫 Broker、Source 與至少 8 碼 Idempotency Key。" });
        renderPage();
        return;
      }
      if (!skipStepUp && sensitiveWriteRequiresStepUp() && !currentSessionHasAal2()) {
        await beginSensitiveWriteStepUp(formValues);
        return;
      }
      let snapshotAt;
      try {
        snapshotAt = taipeiTimestamp(formValues.snapshotAt);
      } catch (error) {
        snapshotWrite = Object.freeze({ status: "error", form: formValues, result: null, error: error.message });
        renderPage();
        return;
      }
      snapshotWrite = Object.freeze({ status: "submitting", form: formValues, result: null, error: "", stepUp: null });
      renderPage();
      try {
        const result = await repository.createBrokerPositionSnapshot({
          broker: formValues.broker,
          snapshotAt,
          source: formValues.source,
          idempotencyKey: formValues.idempotencyKey,
          positions: eligibility.rows.map(snapshotPosition)
        });
        const portfolio = await repository.loadPortfolio();
        const readBack = await repository.loadLatestBrokerSnapshot(portfolio.id);
        if (!readBack || readBack.header.id !== result.snapshot_id || readBack.items.length !== Number(result.position_count)) {
          throw snapshotWriteError("INVESTMENT_SNAPSHOT_READBACK_FAILED", "Snapshot 寫入後的 Header／Items Read-back 無法驗證。", { snapshotId: result.snapshot_id });
        }
        const reconciliation = await repository.loadBrokerSnapshotReconciliation(result.snapshot_id, portfolio.id);
        if (!reconciliation || reconciliation.items.length !== Number(reconciliation.reconciliation.item_count)) {
          throw snapshotWriteError("INVESTMENT_RECONCILIATION_READBACK_FAILED", "Snapshot Reconciliation 寫入後的 Read-back 無法驗證。", { snapshotId: result.snapshot_id });
        }
        snapshotWrite = Object.freeze({
          status: "success",
          form: formValues,
          error: "",
          stepUp: null,
          result: Object.freeze({
            ...result,
            readBack: Object.freeze({
              snapshotId: readBack.header.id,
              positionCount: readBack.items.length,
              symbols: Object.freeze(readBack.items.map(item => `${item.market}:${item.symbol}`)),
              reconciliationId: reconciliation.reconciliation.id,
              reconciliationItemCount: reconciliation.items.length,
              reconciliationCounts: Object.freeze({
                unchanged: Number(reconciliation.reconciliation.unchanged_count || 0),
                changed: Number(reconciliation.reconciliation.changed_count || 0),
                new: Number(reconciliation.reconciliation.new_count || 0),
                missing: Number(reconciliation.reconciliation.missing_count || 0),
                unknown: Number(reconciliation.reconciliation.unknown_count || 0)
              })
            })
          })
        });
        await load();
      } catch (error) {
        snapshotWrite = Object.freeze({ status: "error", form: formValues, result: null, error: error?.message || "受控 Snapshot 寫入失敗。", stepUp: null });
        renderPage();
      }
    }

    function navigate(page, updateHash = true) {
      const canonical = canonicalPage(page);
      if (!global.InvestmentConfig.pages.includes(canonical)) return;
      if (updateHash && global.location.hash !== `#${canonical}`) global.location.hash = canonical;
      if (!updateHash && page === "watchlist" && global.history?.replaceState) {
        global.history.replaceState(null, "", `${global.location.pathname}${global.location.search}#portfolio`);
      }
      store.setActivePage(canonical);
      renderSharedHeader(canonical);
      renderPage();
    }

    async function runRecognition() {
      await importSession.startRecognition(recognitionProvider?.recognize
        ? (files, metadata) => recognitionProvider.recognize(files, metadata)
        : null);
      renderPage();
    }

    async function load() {
      store.update({
        status: "loading",
        identity,
        error: null,
        ivtk: Object.freeze({ status: "loading", board: null, projection: null, projectionStatus: "loading", error: null })
      });
      renderPage();
      const loadCurrentPositions = typeof repository.loadCurrentPositions === "function"
        ? repository.loadCurrentPositions
        : repository.loadPositions;
      const [portfolio, positions, transactions, watchlist, strategies, settings] = await Promise.all([
        repository.loadPortfolio(),
        loadCurrentPositions(),
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
        currentPositionSource: positions.some(position => position.sourceKind === "broker_snapshot_item")
          ? "broker_snapshot"
          : "opening_positions",
        loadedAt: new Date().toISOString()
      });

      let projection = null;
      let projectionError = null;
      if (typeof repository.repairIvtkIdentity === "function") {
        try {
          await repository.repairIvtkIdentity();
        } catch (error) {
          projectionError = error;
        }
      }
      if (!projectionError && typeof repository.syncIvtkProjection === "function") {
        try {
          projection = await repository.syncIvtkProjection();
        } catch (error) {
          projectionError = error;
        }
      }

      let board = null;
      let boardError = null;
      if (typeof repository.loadIvtkBoard === "function") {
        try {
          board = await repository.loadIvtkBoard();
        } catch (error) {
          boardError = error;
        }
      }
      store.update({
        ivtk: Object.freeze({
          status: board ? "ready" : "error",
          board,
          projection,
          projectionStatus: projectionError ? "blocked" : "ready",
          error: boardError || projectionError
        })
      });
      renderPage();
    }

    root.addEventListener("click", event => {
      const route = event.target.closest("[data-investment-route]");
      if (route) navigate(route.dataset.investmentRoute);
      if (event.target.closest("[data-investment-refresh]")) load().catch(handleError);
      if (event.target.closest("[data-investment-sensitive-write-enroll]")) {
        enrollSensitiveWriteTotp().catch(handleError);
        return;
      }
      if (event.target.closest("[data-investment-sensitive-write-retry]")) {
        beginSensitiveWriteStepUp(snapshotWrite.form || Object.freeze({})).catch(handleError);
        return;
      }
      const importAction = event.target.closest("[data-investment-import-action]");
      if (!importAction) return;
      const action = importAction.dataset.investmentImportAction;
      if (action === "choose") {
        root.querySelector("[data-investment-import-files]")?.click();
      } else if (action === "open-confirmed-input") {
        resetSnapshotWrite();
        importSession.openConfirmedInput();
        renderPage();
      } else if (action === "remove") {
        resetSnapshotWrite();
        importSession.removeFile(importAction.dataset.investmentImportFileId);
        renderPage();
      } else if (action === "clear") {
        resetSnapshotWrite();
        importSession.clear();
        renderPage();
      } else if (action === "start-recognition") {
        resetSnapshotWrite();
        runRecognition().catch(handleError);
      } else if (action === "ignore-row") {
        resetSnapshotWrite();
        importSession.ignoreRecognitionRow(importAction.dataset.investmentImportRowId);
        renderPage();
      } else if (action === "restore-recognition") {
        resetSnapshotWrite();
        importSession.restoreRecognitionResult();
        renderPage();
      } else if (action === "confirm-preview") {
        resetSnapshotWrite();
        importSession.confirmPreview();
        renderPage();
      }
    });
    root.addEventListener("submit", event => {
      const confirmedInputForm = event.target.closest("[data-investment-confirmed-input-form]");
      if (confirmedInputForm) {
        event.preventDefault();
        loadConfirmedInput(confirmedInputForm);
        return;
      }
      const sensitiveWriteStepUpForm = event.target.closest("[data-investment-sensitive-write-step-up]");
      if (sensitiveWriteStepUpForm) {
        event.preventDefault();
        verifySensitiveWrite(sensitiveWriteStepUpForm).catch(handleError);
        return;
      }
      const snapshotForm = event.target.closest("[data-investment-snapshot-write-form]");
      if (snapshotForm) {
        event.preventDefault();
        writeBrokerSnapshot(snapshotForm).catch(handleError);
        return;
      }
      const form = event.target.closest("[data-investment-import-edit]");
      if (!form) return;
      event.preventDefault();
      resetSnapshotWrite();
      const values = new FormData(form);
      importSession.updateRecognitionRow(form.dataset.investmentImportRowId, {
        symbol: values.get("symbol"),
        name: values.get("name"),
        quantity: values.get("quantity"),
        averageCost: values.get("averageCost"),
        investedCost: values.get("investedCost"),
        currency: values.get("currency")
      });
      renderPage();
    });
    root.addEventListener("change", event => {
      const input = event.target.closest("[data-investment-import-files]");
      if (!input) return;
      resetSnapshotWrite();
      importSession.addFiles(input.files);
      input.value = "";
      renderPage();
    });
    root.addEventListener("dragover", event => {
      const dropzone = event.target.closest("[data-investment-import-dropzone]");
      if (!dropzone) return;
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
    root.addEventListener("dragleave", event => {
      const dropzone = event.target.closest("[data-investment-import-dropzone]");
      if (dropzone && !dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-dragging");
    });
    root.addEventListener("drop", event => {
      const dropzone = event.target.closest("[data-investment-import-dropzone]");
      if (!dropzone) return;
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
      importSession.addFiles(event.dataTransfer?.files);
      renderPage();
    });
    root.addEventListener("keydown", event => {
      const dropzone = event.target.closest("[data-investment-import-dropzone]");
      if (!dropzone || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      root.querySelector("[data-investment-import-files]")?.click();
    });
    global.addEventListener("pagehide", () => importSession.dispose(), { once: true });
    global.addEventListener("hashchange", () => navigate(String(global.location.hash || "#overview").slice(1), false));

    function handleError(error) {
      console.error("Investment SIT runtime error", { message: error?.message || String(error) });
      store.update({ status: "error", error });
      global.ZhugeComponents.Summary.update(pageRoot, errorScreen(error));
    }

    try {
      await load();
      return Object.freeze({ status: "ready", context, repository, store, importSession, reload: load, navigate });
    } catch (error) {
      handleError(error);
      return Object.freeze({ status: "error", context, repository, store, importSession, reload: load, navigate });
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
