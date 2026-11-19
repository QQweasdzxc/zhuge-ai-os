(function (root, factory) {
  const dependencies = {
    Portfolio: root?.InvestmentPortfolio || (typeof require === "function" ? require("../models/portfolio.js") : null),
    Position: root?.InvestmentPosition || (typeof require === "function" ? require("../models/position.js") : null),
    Transaction: root?.InvestmentTransaction || (typeof require === "function" ? require("../models/transaction.js") : null),
    Watchlist: root?.InvestmentWatchlistItem || (typeof require === "function" ? require("../models/watchlist-item.js") : null),
    Strategy: root?.InvestmentStrategy || (typeof require === "function" ? require("../models/strategy.js") : null),
    Settings: root?.InvestmentSettings || (typeof require === "function" ? require("../models/settings.js") : null)
  };
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SupabaseInvestmentRepository = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Models) {
  "use strict";

  function first(rows = []) {
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  function jsonText(value, fallback = "") {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(item => typeof item === "string" ? item : JSON.stringify(item)).join("、");
    if (value && typeof value === "object") return value.summary || value.text || JSON.stringify(value);
    return fallback;
  }

  function importanceLabel(value) {
    const numeric = Number(value || 2);
    return `P${Math.min(4, Math.max(1, numeric))}`;
  }

  function normalizeAal(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "aal2") return "aal2";
    if (normalized === "aal1") return "aal1";
    return "unknown";
  }

  function investmentError(code, message, detail = {}, cause = null) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, detail);
    if (cause) error.cause = cause;
    return error;
  }

  function classifyDataError(error, { assuranceLevel = "unknown", resource = "Investment data" } = {}) {
    if (error?.code && String(error.code).startsWith("INVESTMENT_")) return error;
    if (error?.code === "AUTH_SESSION_EXPIRED" || Number(error?.status) === 401) {
      return investmentError("INVESTMENT_SESSION_EXPIRED", "登入工作階段已過期，請重新登入後再讀取投資資料。", { resource }, error);
    }
    if (Number(error?.status) === 403 && normalizeAal(assuranceLevel) !== "aal2") {
      return investmentError("INVESTMENT_ASSURANCE_REQUIRED", "投資資料受到額外安全保護，請完成安全驗證後繼續。", { resource, requiredAal: "aal2", currentAal: normalizeAal(assuranceLevel) }, error);
    }
    return investmentError("INVESTMENT_DATA_QUERY_ERROR", `無法讀取${resource}，請稍後再試。`, { resource }, error);
  }

  function create(options = {}) {
    const data = options.data;
    const authUserId = String(options.userId || "");
    // Board projection uses the same Shared Gateway facade as the module
    // context.  It never receives or creates a Supabase client of its own.
    const gateway = options.gateway || globalThis.ZhugeSupabaseGateway?.createDataGateway?.() || null;
    const sessionSnapshot = options.sessionSnapshot || {};
    const readSessionSnapshot = typeof options.getSessionSnapshot === "function"
      ? options.getSessionSnapshot
      : () => sessionSnapshot;
    const initialAssuranceLevel = normalizeAal(options.assuranceLevel || sessionSnapshot.aal);
    // The Creator-controlled MFA preference can permit AAL1 for Investment
    // read-only access during development. It must never relax the controlled
    // sensitive-write path below: its separate saved switch is checked by
    // assertSession({ write: true }) and independently enforced by the RPC.
    const allowAal1Read = options.allowAal1Read === true;
    const authenticated = options.isAuthenticated === undefined
      ? sessionSnapshot.isAuthenticated !== false
      : options.isAuthenticated === true;
    if (!data || typeof data.select !== "function") throw new TypeError("SupabaseInvestmentRepository requires Shared Data API.");
    if (!authUserId) throw new TypeError("SupabaseInvestmentRepository requires Shared Identity UUID.");
    let legacyUserPromise = null;
    let portfolioPromise = null;
    const emptyResources = new Set();
    let lastError = null;

    function currentSessionSnapshot() {
      try {
        return readSessionSnapshot() || {};
      } catch {
        return {};
      }
    }

    function currentAssuranceLevel() {
      return normalizeAal(currentSessionSnapshot().aal || (typeof options.getSessionSnapshot === "function" ? "unknown" : initialAssuranceLevel));
    }

    function currentIsAuthenticated() {
      const current = currentSessionSnapshot();
      if (typeof options.getSessionSnapshot === "function") return current.isAuthenticated === true && (!current.identity?.userId || current.identity.userId === authUserId);
      return options.isAuthenticated === undefined ? current.isAuthenticated !== false : authenticated;
    }

    function recordEmpty(resource, rows) {
      if (!Array.isArray(rows) || rows.length === 0) emptyResources.add(resource);
      return rows;
    }

    function recordError(error) {
      lastError = error;
      return error;
    }

    function assertSession({ write = false } = {}) {
      const current = currentSessionSnapshot();
      const assuranceLevel = currentAssuranceLevel();
      if (!currentIsAuthenticated()) {
        const code = current.isExpired ? "INVESTMENT_SESSION_EXPIRED" : "INVESTMENT_SESSION_REQUIRED";
        throw recordError(investmentError(
          code,
          code === "INVESTMENT_SESSION_EXPIRED" ? "登入工作階段已過期，請重新登入後再讀取投資資料。" : "請先登入後再讀取投資資料。"
        ));
      }
      // Writes follow the saved sensitive-write switch (same policy as the
      // receivable split): aal2, or aal1 with the server-saved boolean
      // preference investment_sensitive_write_mfa_required === false.
      // Unknown assurance is fail-closed; the entry switch never implies a
      // write bypass. Reads keep the existing entry behavior.
      const writeAllowed = assuranceLevel === "aal2" || (assuranceLevel === "aal1" && policyMfaBypassed(true));
      if (!["aal1", "aal2"].includes(assuranceLevel) || (write && !writeAllowed) || (!write && assuranceLevel === "aal1" && !allowAal1Read)) {
        throw recordError(investmentError(
          "INVESTMENT_ASSURANCE_REQUIRED",
          "投資資料受到額外安全保護，請完成安全驗證後繼續。",
          { requiredAal: "aal2", currentAal: assuranceLevel }
        ));
      }
    }

    async function legacyUser() {
      if (!legacyUserPromise) {
        legacyUserPromise = Promise.resolve().then(() => {
          assertSession();
          return data.select("app_users", `select=id,display_name,email&auth_user_id=eq.${encodeURIComponent(authUserId)}&limit=1`);
        }).then(rows => {
            recordEmpty("app_users", rows);
            const row = first(rows);
            if (!row?.id) {
              throw recordError(investmentError(
                "INVESTMENT_OWNER_MAPPING_REQUIRED",
                "目前帳號尚未完成 Investment Legacy Mapping，請聯絡系統管理員。"
              ));
            }
            return Object.freeze(row);
          })
          .catch(error => {
            const classified = classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: "Investment Owner Mapping" });
            legacyUserPromise = null;
            throw recordError(classified);
          })
      }
      return legacyUserPromise;
    }

    async function ownerSelect(table, select = "*", suffix = "", beforeSelect = null) {
      const owner = await legacyUser();
      assertSession();
      if (beforeSelect) beforeSelect();
      try {
        const rows = await data.select(table, `select=${select}&user_id=eq.${encodeURIComponent(owner.id)}${suffix}`);
        assertSession();
        return recordEmpty(table, rows);
      } catch (error) {
        throw recordError(classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: table }));
      }
    }

    async function loadPortfolio() {
      if (!portfolioPromise) {
        portfolioPromise = Promise.resolve().then(async () => {
          const row = first(await ownerSelect("portfolios", "id,name,base_currency,is_default,created_at,updated_at", "&order=is_default.desc,updated_at.desc&limit=1"));
          return row ? Models.Portfolio.normalize({
            id: row.id,
            userId: authUserId,
            name: row.name,
            baseCurrency: row.base_currency,
            isDefault: row.is_default
          }) : Models.Portfolio.normalize({ userId: authUserId, name: "尚未建立投資組合", baseCurrency: "TWD" });
        }).catch(error => {
          portfolioPromise = null;
          throw error;
        });
      }
      return portfolioPromise;
    }

    async function enrichRawPositions(rows) {
      if (typeof options.enrichRawPositions !== "function") return rows;
      const enriched = await options.enrichRawPositions(rows);
      if (!Array.isArray(enriched) || enriched.length !== rows.length) throw investmentError("INVESTMENT_RAW_OVERLAY_INVALID", "Read-only overlay row count mismatch");
      return enriched;
    }

    async function loadLatestBrokerSnapshot(portfolioId = "") {
      if (!portfolioId) return null;
      const headers = await ownerSelect(
        "broker_position_snapshots",
        "id,portfolio_id,broker,snapshot_at,verification,position_count,source,content_hash,idempotency_key,created_at",
        `&portfolio_id=eq.${encodeURIComponent(portfolioId)}&verification=eq.pm_confirmed&order=snapshot_at.desc,created_at.desc,id.desc&limit=1`
      );
      const header = first(headers);
      if (!header) return null;
      let items;
      try {
        items = await data.select(
          "current_broker_positions_view",
          `select=snapshot_id,item_id,symbol,name,market,currency,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,market_value_source,raw_broker_values&snapshot_id=eq.${encodeURIComponent(header.id)}&portfolio_id=eq.${encodeURIComponent(header.portfolio_id)}&order=market.asc,symbol.asc`
        );
      } catch (error) {
        throw recordError(classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: "Current Broker Positions" }));
      }
      if (!Array.isArray(items) || items.length !== Number(header.position_count)) {
        throw recordError(investmentError(
          "INVESTMENT_SNAPSHOT_INCOMPLETE",
          "最新 Broker Snapshot 的 Header 與 Items 數量不一致，已停止投影，未回退到舊資料。",
          { snapshotId: header.id, expected: Number(header.position_count), actual: Array.isArray(items) ? items.length : 0 }
        ));
      }
      return Object.freeze({
        header: Object.freeze(header),
        items: Object.freeze((await enrichRawPositions(items)).map(row => Models.Position.normalize({
          ...row,
          id: row.item_id,
          userId: authUserId,
          portfolioId: header.portfolio_id,
          sourceKind: "broker_snapshot_item",
          sourceId: row.item_id,
          sourceSnapshotId: header.id,
          effectiveAt: header.snapshot_at,
          snapshotId: header.id,
          snapshotAt: header.snapshot_at,
          source: header.source,
          marketValueSource: row.market_value_source,
          rawBrokerValues: row.raw_broker_values
        })))
      });
    }

    async function loadBrokerSnapshotReconciliation(snapshotId = "", portfolioId = "") {
      if (!snapshotId || !portfolioId) return null;
      const rows = await ownerSelect(
        "broker_position_reconciliations",
        "id,portfolio_id,previous_snapshot_id,previous_source,previous_snapshot_at,current_snapshot_id,item_count,unchanged_count,changed_count,new_count,missing_count,unknown_count,created_at",
        `&portfolio_id=eq.${encodeURIComponent(portfolioId)}&current_snapshot_id=eq.${encodeURIComponent(snapshotId)}&limit=1`
      );
      const reconciliation = first(rows);
      if (!reconciliation) return null;
      let items;
      try {
        // This child table is owner-scoped through its reconciliation parent;
        // RLS performs the final owner check. Do not add a guessed user_id
        // filter because the child table intentionally has no duplicate owner
        // column.
        items = await data.select(
          "broker_position_reconciliation_items",
          `select=id,reconciliation_id,market,symbol,status,quantity_delta,invested_cost_delta,differences,reason&reconciliation_id=eq.${encodeURIComponent(reconciliation.id)}&order=market.asc,symbol.asc`
        );
      } catch (error) {
        throw recordError(classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: "Broker Snapshot Reconciliation" }));
      }
      if (!Array.isArray(items) || items.length !== Number(reconciliation.item_count)) {
        throw recordError(investmentError(
          "INVESTMENT_RECONCILIATION_INCOMPLETE",
          "Snapshot Reconciliation 的 Header 與 Items 數量不一致，已停止回報。",
          { reconciliationId: reconciliation.id, expected: Number(reconciliation.item_count), actual: Array.isArray(items) ? items.length : 0 }
        ));
      }
      return Object.freeze({
        reconciliation: Object.freeze(reconciliation),
        items: Object.freeze(items.map(item => Object.freeze(item)))
      });
    }

    async function loadPositions() {
      const portfolio = await loadPortfolio();
      const brokerSnapshot = await loadLatestBrokerSnapshot(portfolio.id);
      const owner = await legacyUser();
      let rows;
      try {
        rows = await data.select(
          "investment_current_positions_view",
          `select=source_kind,source_id,source_snapshot_id,user_id,portfolio_id,effective_at,symbol,name,market,asset_type,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,currency,account,source,market_value_source,raw_broker_values,note,realized_pnl,ever_held,position_status,baseline_at,calculation_source&user_id=eq.${encodeURIComponent(owner.id)}&portfolio_id=eq.${encodeURIComponent(portfolio.id)}&order=market.asc,symbol.asc,source_id.asc`
        );
      } catch (error) {
        throw recordError(classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: "Investment Calculated Positions" }));
      }
      if (Array.isArray(rows) && rows.length) {
        return (await enrichRawPositions(rows)).map(row => Models.Position.normalize({
          ...row,
          userId: authUserId,
          portfolioId: row.portfolio_id
        }));
      }
      // The snapshot path remains a validation/read-back compatibility guard
      // for deployments while the canonical view is being rolled out.  Once
      // the view has rows, it is the only current-position result consumed.
      if (brokerSnapshot) return brokerSnapshot.items;
      return [];
    }

    async function loadCurrentPositions() {
      return loadPositions();
    }

    async function loadTransactions({before = null} = {}) {
      let cursor = "";
      if (before) {
        const date = String(before.tradeDate || "");
        const created = String(before.createdAt || "");
        const id = String(before.id || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(created) || !/^[a-zA-Z0-9-]+$/.test(id)) throw investmentError("INVESTMENT_TRANSACTION_CURSOR_INVALID", "交易分頁資訊無效，請重新整理。");
        cursor = `&or=${encodeURIComponent(`(trade_date.lt.${date},and(trade_date.eq.${date},created_at.lt.${created}),and(trade_date.eq.${date},created_at.eq.${created},id.lt.${id}))`)}`;
      }
      const rows = await ownerSelect("transactions", "id,portfolio_id,trade_date,trade_type,symbol,name,market,quantity,price,gross_amount,fee,tax,net_amount,currency,account,source,note,idempotency_key,created_at,updated_at", `&order=trade_date.desc,created_at.desc,id.desc&limit=201${cursor}`);
      return (rows || []).map(row => Models.Transaction.normalize({
        ...row,
        userId: authUserId,
        portfolioId: row.portfolio_id,
        idempotencyKey: row.idempotency_key
      }));
    }

    async function loadTransactionById(id) {
      if (!/^[a-zA-Z0-9-]+$/.test(String(id || ""))) throw investmentError("INVESTMENT_TRANSACTION_ID_INVALID", "交易識別無效。");
      const rows = await ownerSelect("transactions", "*", `&id=eq.${encodeURIComponent(id)}&limit=1`);
      return rows?.length ? Models.Transaction.normalize(rows[0]) : null;
    }

    async function loadTransactionByKey(key) {
      if(!/^[a-zA-Z0-9-]{8,160}$/.test(String(key||"")))throw investmentError("INVESTMENT_TRANSACTION_KEY_INVALID","交易核對代碼無效。");
      const rows=await ownerSelect("transactions","*",`&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`);
      return rows?.length?Models.Transaction.normalize(rows[0]):null;
    }
    async function recordTransaction(input = {}) {
      assertSession({ write: true });
      if (!gateway || typeof gateway.rpc !== "function") {
        throw recordError(investmentError("INVESTMENT_TRANSACTION_WRITE_UNAVAILABLE", "目前資料閘道不支援受控交易紀錄寫入。"));
      }
      const portfolio = await loadPortfolio();
      assertSession({ write: true });
      const result = await gateway.rpc("investment_record_transaction", {
        p_portfolio_id: input.portfolioId || portfolio.id,
        p_trade_date: input.tradeDate,
        p_trade_type: input.tradeType,
        p_symbol: input.symbol,
        p_name: input.name || null,
        p_market: input.market,
        p_quantity: input.quantity,
        p_price: input.price,
        p_fee: input.fee || 0,
        p_tax: input.tax || 0,
        p_currency: input.currency,
        p_account: input.account || null,
        p_note: input.note || null,
        p_idempotency_key: input.idempotencyKey
      });
      const row = first(result) || (result && !Array.isArray(result) ? result : null);
      if (!row?.transaction_id) throw recordError(investmentError("INVESTMENT_TRANSACTION_WRITE_INVALID", "交易紀錄寫入回傳格式無法驗證。", { resource: "Transaction Write" }));
      return Object.freeze({ ...row });
    }

    async function loadPendingActions() {
      const rows = await ownerSelect(
        "investment_pending_actions",
        "id,portfolio_id,action_type,status,source,source_ref,title,summary,transaction_payload,evidence,idempotency_key,created_at,last_error",
        "&status=eq.pending&order=created_at.asc,id.asc&limit=100"
      );
      return Object.freeze((rows || []).map(row => Object.freeze({
        id: String(row.id || ""),
        portfolioId: String(row.portfolio_id || ""),
        actionType: String(row.action_type || ""),
        status: String(row.status || ""),
        source: String(row.source || ""),
        sourceRef: String(row.source_ref || ""),
        title: String(row.title || ""),
        summary: String(row.summary || ""),
        transaction: Object.freeze({ ...(row.transaction_payload || {}) }),
        evidence: Object.freeze({ ...(row.evidence || {}) }),
        idempotencyKey: String(row.idempotency_key || ""),
        createdAt: row.created_at || null,
        lastError: String(row.last_error || "")
      })));
    }

    async function confirmPendingAction(actionId) {
      assertSession({ write: true });
      if (!gateway || typeof gateway.rpc !== "function") {
        throw recordError(investmentError("INVESTMENT_PENDING_WRITE_UNAVAILABLE", "目前資料閘道不支援待確認交易寫入。"));
      }
      const result = await gateway.rpc("investment_confirm_pending_action", { p_action_id: actionId });
      const row = first(result) || (result && !Array.isArray(result) ? result : null);
      if (!row?.action_id || !row?.transaction_id) {
        throw recordError(investmentError("INVESTMENT_PENDING_WRITE_INVALID", "待確認交易寫入回傳格式無法驗證。"));
      }
      return Object.freeze({ ...row });
    }

    async function dismissPendingAction(actionId) {
      assertSession();
      if (!gateway || typeof gateway.rpc !== "function") {
        throw recordError(investmentError("INVESTMENT_PENDING_DISMISS_UNAVAILABLE", "目前資料閘道不支援稍後處理。"));
      }
      const result = await gateway.rpc("investment_dismiss_pending_action", { p_action_id: actionId });
      const row = first(result) || (result && !Array.isArray(result) ? result : null);
      if (!row?.action_id) throw recordError(investmentError("INVESTMENT_PENDING_DISMISS_INVALID", "待確認交易狀態回傳格式無法驗證。"));
      return Object.freeze({ ...row });
    }

    function policyMfaBypassed(write) {
      let policy;try { policy=options.getMfaPolicy?.(); } catch { return false; }
      const key=write?'investment_sensitive_write_mfa_required':'investment_entry_mfa_required';
      return policy?.status==='resolved'&&policy.is_creator===true&&policy.userId===authUserId&&policy[key]===false;
    }
    function assertReceivableSession({write=false}={}) {
      let current;
      try { current = readSessionSnapshot(); } catch { current = null; }
      if (current?.isAuthenticated !== true || (current.identity?.userId && current.identity.userId!==authUserId)) {
        throw recordError(investmentError(current?.isExpired ? "INVESTMENT_SESSION_EXPIRED" : "INVESTMENT_SESSION_REQUIRED", "請重新登入後再讀寫應收款。"));
      }
      const aal=normalizeAal(current.aal);
      if (!(aal==='aal2'||(aal==='aal1'&&policyMfaBypassed(write)))) throw recordError(investmentError("INVESTMENT_ASSURANCE_REQUIRED", "請依投資安全設定完成驗證後再繼續。"));
    }

    async function loadReceivables() {
      assertReceivableSession();
      return ownerSelect("investment_receivables", "id,amount,currency,counterparty,reason,occurred_on,status,task_ref,visibility,note,created_at,updated_at", "&order=created_at.desc,id.desc", assertReceivableSession);
    }

    async function receivableRpc(name, payload) {
      assertReceivableSession({write:true});
      if (!gateway || typeof gateway.rpc !== "function") throw investmentError("RECEIVABLE_GATEWAY_UNAVAILABLE", "目前資料閘道不支援應收款登記。");
      const result = await gateway.rpc(name, payload);
      const row = first(result) || (result && !Array.isArray(result) ? result : null);
      if (!row?.receivable_id) throw investmentError("RECEIVABLE_RESPONSE_INVALID", "應收款回傳格式無法驗證，請先讀回清單確認。");
      return Object.freeze({ ...row });
    }

    async function createReceivable(input = {}) {
      return receivableRpc("create_investment_receivable", {
        p_amount: Number(input.amount), p_currency: input.currency || "TWD",
        p_counterparty: input.counterparty, p_reason: input.reason,
        p_occurred_on: input.occurred_on, p_task_ref: input.task_ref || "",
        p_visibility: input.visibility || "private", p_note: input.note || "",
        p_idempotency_key: input.idempotencyKey
      });
    }

    async function updateReceivableStatus(id, status) {
      return receivableRpc("update_investment_receivable_status", { p_receivable_id: id, p_status: status });
    }

    async function loadWatchlist() {
      const rows = await ownerSelect("watchlists", "id,portfolio_id,symbol,name,market,status,research_theme,reason,importance,updated_at", "&order=importance.asc,updated_at.desc");
      return (rows || []).map(row => Models.Watchlist.normalize({
        ...row,
        userId: authUserId,
        portfolioId: row.portfolio_id,
        theme: row.research_theme,
        importance: importanceLabel(row.importance)
      }));
    }

    async function loadStrategies() {
      const rows = await ownerSelect("strategies", "id,portfolio_id,symbol,name,strategy_type,decision_status,target_price,support_price,pressure_price,strategist_note,updated_at", "&order=updated_at.desc");
      if (rows?.length) {
        return rows.map(row => Models.Strategy.normalize({
          id: row.id,
          userId: authUserId,
          title: [row.symbol, row.name].filter(Boolean).join(" ") || row.strategy_type || "投資策略",
          evidence: [row.target_price ? `目標價 ${row.target_price}` : "", row.support_price ? `支撐價 ${row.support_price}` : "", row.pressure_price ? `壓力價 ${row.pressure_price}` : ""].filter(Boolean).join("｜") || "尚無價格依據",
          reason: row.strategist_note || row.strategy_type || "尚無策略說明",
          decision: row.decision_status || "觀察",
          updatedAt: row.updated_at
        }));
      }
      const logs = await ownerSelect("decision_logs", "id,title,advice,reason,confidence,evidence,created_at", "&order=created_at.desc&limit=20");
      return (logs || []).map(row => Models.Strategy.normalize({
        id: row.id,
        userId: authUserId,
        title: row.title || "投資決策",
        evidence: jsonText(row.evidence, "尚無依據"),
        reason: row.reason || "尚無說明",
        decision: row.advice || "觀察",
        updatedAt: row.created_at
      }));
    }

    function getStatus() {
      return Object.freeze({
        code: lastError?.code || (emptyResources.size ? "INVESTMENT_DATA_EMPTY" : "READY"),
        emptyResources: Object.freeze([...emptyResources]),
        lastError
      });
    }

    async function loadSettings() {
      const rows = await ownerSelect("user_settings", "setting_key,setting_value,updated_at", "&order=updated_at.desc");
      const values = Object.fromEntries((rows || []).map(row => [row.setting_key, row.setting_value]));
      return Models.Settings.normalize({
        userId: authUserId,
        baseCurrency: values.base_currency || values.currency || "TWD",
        privacyMode: values.privacy_mode !== false,
        dataMode: "cloud"
      });
    }

    async function loadIvtkBoard() {
      if (!gateway || typeof gateway.select !== "function") {
        const error = new Error("Shared Board Data Gateway 尚未就緒。");
        error.code = "INVESTMENT_IVTK_GATEWAY_REQUIRED";
        throw error;
      }
      const instances = await gateway.select(
        "board_instances",
        "?select=id,name,task_code_prefix,template_key,authorization_mode,is_template_instance,active,created_at,updated_at&active=eq.true&template_key=eq.c&task_code_prefix=eq.IVTK&is_template_instance=eq.false&legacy_application_scope=is.null&order=created_at.asc&limit=1"
      );
      const instance = first(instances);
      if (!instance?.id) {
        const error = new Error("Investment IVTK Board 尚未建立。");
        error.code = "INVESTMENT_IVTK_BOARD_REQUIRED";
        throw error;
      }
      const boardService = globalThis.ZhugeBoardReadService?.createInstanceService;
      if (typeof boardService !== "function") {
        const error = new Error("Shared C Board Read Service 尚未載入。");
        error.code = "INVESTMENT_IVTK_BOARD_SERVICE_REQUIRED";
        throw error;
      }
      const board = await boardService({
        gateway,
        boardInstanceId: instance.id,
        consumerId: "investment-ivtk",
        templateKey: "c"
      }).load();
      const owner = await legacyUser();
      const links = await data.select(
        "investment_ivtk_card_links",
        `select=id,board_instance_id,board_task_id,user_id,portfolio_id,source_kind,source_id,card_kind,active,created_at,updated_at&user_id=eq.${encodeURIComponent(owner.id)}&board_instance_id=eq.${encodeURIComponent(instance.id)}&active=eq.true&order=created_at.asc`
      );
      return Object.freeze({
        status: "ready",
        instance: Object.freeze({
          id: String(instance.id),
          name: String(instance.name || "投資戰情板"),
          taskCodePrefix: String(instance.task_code_prefix || "IVTK"),
          templateKey: String(instance.template_key || "c"),
          active: instance.active !== false
        }),
        ...board,
        links: (Array.isArray(links) ? links : []).map(link => Object.freeze({
          id: String(link.id || ""),
          boardInstanceId: String(link.board_instance_id || ""),
          boardTaskId: String(link.board_task_id || ""),
          userId: String(link.user_id || ""),
          portfolioId: String(link.portfolio_id || ""),
          sourceKind: String(link.source_kind || ""),
          sourceId: String(link.source_id || ""),
          cardKind: String(link.card_kind || ""),
          active: link.active !== false,
          createdAt: link.created_at || null,
          updatedAt: link.updated_at || null
        }))
      });
    }

    async function syncIvtkProjection() {
      if (!gateway || typeof gateway.rpc !== "function") {
        const error = new Error("Investment IVTK Controlled Write Gateway 尚未就緒。");
        error.code = "INVESTMENT_IVTK_RPC_REQUIRED";
        throw error;
      }
      return gateway.rpc("sync_investment_ivtk_projection", {});
    }

    async function repairIvtkIdentity() {
      if (!gateway || typeof gateway.rpc !== "function") {
        const error = new Error("Investment IVTK Identity Repair Gateway 尚未就緒。");
        error.code = "INVESTMENT_IVTK_RPC_REQUIRED";
        throw error;
      }
      return gateway.rpc("repair_investment_ivtk_identity", {});
    }

    async function createBrokerPositionSnapshot(input = {}) {
      assertSession({ write: true });
      if (typeof data.rpc !== "function") {
        throw recordError(investmentError("INVESTMENT_SNAPSHOT_WRITE_UNAVAILABLE", "目前資料閘道不支援受控 Snapshot 寫入。"));
      }
      const portfolio = await loadPortfolio();
      const portfolioId = String(input.portfolioId || portfolio.id || "");
      const positions = Array.isArray(input.positions) ? input.positions : [];
      const payload = positions.map(position => ({
        symbol: position.symbol,
        name: position.name,
        market: position.market,
        currency: position.currency,
        quantity: position.quantity,
        avg_cost: position.averageCost ?? position.avg_cost,
        invested_cost: position.investedCost ?? position.invested_cost ?? position.totalCost ?? position.total_cost,
        last_price: position.lastPrice ?? position.last_price ?? position.currentPrice ?? position.current_price,
        market_value: position.marketValue ?? position.market_value,
        unrealized_pnl: position.unrealizedPnl ?? position.unrealized_pnl,
        unrealized_pct: position.unrealizedPercent ?? position.unrealized_pct ?? position.returnRate ?? position.return_rate,
        raw_broker_values: position.rawBrokerValues ?? position.raw_broker_values
      }));
      try {
        const result = await data.rpc("create_broker_position_snapshot", {
          p_portfolio_id: portfolioId,
          p_broker: input.broker,
          p_snapshot_at: input.snapshotAt,
          p_verification: "pm_confirmed",
          p_source: input.source || "broker_position_snapshot",
          p_idempotency_key: input.idempotencyKey,
          p_positions: payload
        });
        const row = first(result) || (result && !Array.isArray(result) ? result : null);
        if (!row?.snapshot_id) throw investmentError("INVESTMENT_SNAPSHOT_WRITE_INVALID", "受控 Snapshot 寫入回傳格式無法驗證。", { resource: "Broker Snapshot Write" });
        return Object.freeze({ ...row });
      } catch (error) {
        if (String(error?.code || "").startsWith("INVESTMENT_") || String(error?.message || "").startsWith("BROKER_SNAPSHOT_")) throw error;
        throw recordError(classifyDataError(error, { assuranceLevel: currentAssuranceLevel(), resource: "Broker Snapshot Write" }));
      }
    }

    return Object.freeze({
      mode: "cloud",
      loadPortfolio,
      loadPositions,
      loadCurrentPositions,
      loadTransactions,
      loadTransactionById,
      loadTransactionByKey,
      recordTransaction,
      loadPendingActions,
      confirmPendingAction,
      dismissPendingAction,
      loadReceivables,
      createReceivable,
      updateReceivableStatus,
      loadWatchlist,
      loadStrategies,
      loadSettings,
      loadLatestBrokerSnapshot,
      loadBrokerSnapshotReconciliation,
      createBrokerPositionSnapshot,
      loadIvtkBoard,
      syncIvtkProjection,
      repairIvtkIdentity,
      getStatus
    });
  }

  return Object.freeze({ create });
});
