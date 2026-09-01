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
    const sessionSnapshot = options.sessionSnapshot || {};
    const assuranceLevel = normalizeAal(options.assuranceLevel || sessionSnapshot.aal);
    const authenticated = options.isAuthenticated === undefined
      ? sessionSnapshot.isAuthenticated !== false
      : options.isAuthenticated === true;
    if (!data || typeof data.select !== "function") throw new TypeError("SupabaseInvestmentRepository requires Shared Data API.");
    if (!authUserId) throw new TypeError("SupabaseInvestmentRepository requires Shared Identity UUID.");
    let legacyUserPromise = null;
    const emptyResources = new Set();
    let lastError = null;

    function recordEmpty(resource, rows) {
      if (!Array.isArray(rows) || rows.length === 0) emptyResources.add(resource);
      return rows;
    }

    function recordError(error) {
      lastError = error;
      return error;
    }

    function assertSession() {
      if (!authenticated) {
        const code = sessionSnapshot.isExpired ? "INVESTMENT_SESSION_EXPIRED" : "INVESTMENT_SESSION_REQUIRED";
        throw recordError(investmentError(
          code,
          code === "INVESTMENT_SESSION_EXPIRED" ? "登入工作階段已過期，請重新登入後再讀取投資資料。" : "請先登入後再讀取投資資料。"
        ));
      }
      if (assuranceLevel === "aal1") {
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
            const classified = classifyDataError(error, { assuranceLevel, resource: "Investment Owner Mapping" });
            legacyUserPromise = null;
            throw recordError(classified);
          })
      }
      return legacyUserPromise;
    }

    async function ownerSelect(table, select = "*", suffix = "") {
      const owner = await legacyUser();
      try {
        const rows = await data.select(table, `select=${select}&user_id=eq.${encodeURIComponent(owner.id)}${suffix}`);
        return recordEmpty(table, rows);
      } catch (error) {
        throw recordError(classifyDataError(error, { assuranceLevel, resource: table }));
      }
    }

    async function loadPortfolio() {
      const row = first(await ownerSelect("portfolios", "id,name,base_currency,is_default,created_at,updated_at", "&order=is_default.desc,updated_at.desc&limit=1"));
      return row ? Models.Portfolio.normalize({
        id: row.id,
        userId: authUserId,
        name: row.name,
        baseCurrency: row.base_currency,
        isDefault: row.is_default
      }) : Models.Portfolio.normalize({ userId: authUserId, name: "尚未建立投資組合", baseCurrency: "TWD" });
    }

    async function loadPositions() {
      const rows = await ownerSelect("opening_positions", "id,portfolio_id,symbol,name,market,asset_type,quantity,avg_cost,invested_cost,last_price,market_value,unrealized_pnl,unrealized_pct,currency,account,note,updated_at", "&order=market.asc,symbol.asc");
      return (rows || []).map(row => Models.Position.normalize({
        ...row,
        userId: authUserId,
        portfolioId: row.portfolio_id
      }));
    }

    async function loadTransactions() {
      const rows = await ownerSelect("transactions", "id,portfolio_id,trade_date,trade_type,symbol,name,market,quantity,price,net_amount,currency,note,updated_at", "&order=trade_date.desc,created_at.desc&limit=50");
      return (rows || []).map(row => Models.Transaction.normalize({
        ...row,
        userId: authUserId,
        portfolioId: row.portfolio_id
      }));
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

    return Object.freeze({
      mode: "cloud",
      loadPortfolio,
      loadPositions,
      loadTransactions,
      loadWatchlist,
      loadStrategies,
      loadSettings,
      getStatus
    });
  }

  return Object.freeze({ create });
});
