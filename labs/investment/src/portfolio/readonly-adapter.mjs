const PORTFOLIO_SOURCE = "Zhuge Investment Portfolio";

const POSITION_COLUMNS = [
  "source_kind", "realized_pnl", "symbol", "name", "market", "asset_type", "quantity", "avg_cost", "invested_cost",
  "last_price", "market_value", "unrealized_pnl", "unrealized_pct", "currency",
  "effective_at", "market_value_source", "position_status",
].join(",");

const MARKET_SOURCE_LABELS = Object.freeze({
  broker_supplied: "券商匯入快照",
  broker_reported: "券商匯入快照",
  legacy_opening_position: "Investment 初始持股基準",
  legacy_opening_positions: "Investment 初始持股基準",
  transaction_calculated: "依正式交易紀錄計算",
});

const MARKET_LABELS = Object.freeze({
  TW: "TW",
  TWSE: "TW",
  TWO: "TW",
  TPEX: "TW",
  US: "US",
  NASDAQ: "US",
  NYSE: "US",
  AMEX: "US",
});

const VENUE_LABELS = Object.freeze({
  TWSE: "TWSE",
  TPEX: "TPEX",
  TWO: "TPEX",
  US: "US",
  NASDAQ: "US",
  NYSE: "US",
  AMEX: "US",
});

export class PortfolioReadError extends Error {
  constructor(code) {
    super(code);
    this.name = "PortfolioReadError";
    this.code = code;
  }
}

function rowsOrFail(value) {
  if (!Array.isArray(value)) throw new PortfolioReadError("PORTFOLIO_RESPONSE_INVALID");
  return value;
}

function textOrEmpty(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimestamp(value) {
  const text = textOrEmpty(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function safeMarketSource(value) {
  const key = textOrEmpty(value).toLowerCase();
  return MARKET_SOURCE_LABELS[key] || "來源未提供";
}

function normalizePosition(row, { effectiveAt = row?.effective_at, snapshotKind = "canonical_view" } = {}) {
  const symbol = textOrEmpty(row?.symbol).toUpperCase();
  const marketCode = textOrEmpty(row?.market).toUpperCase();
  const market = MARKET_LABELS[marketCode] || "OTHER";
  const venue = VENUE_LABELS[marketCode] || (market === "US" ? "US" : "");
  const quantity = numberOrNull(row?.quantity);
  const averageCost = numberOrNull(row?.avg_cost);
  const investedCost = numberOrNull(row?.invested_cost);
  const lastPrice = numberOrNull(row?.last_price);
  const marketValue = numberOrNull(row?.market_value);
  const unrealizedPnl = numberOrNull(row?.unrealized_pnl);
  const unrealizedPct = numberOrNull(row?.unrealized_pct);
  const name = textOrEmpty(row?.name);
  const currencyValue = textOrEmpty(row?.currency).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(currencyValue) ? currencyValue : "";
  const required = [quantity, averageCost, investedCost, lastPrice, marketValue, unrealizedPnl, unrealizedPct];
  const status = name && symbol && market !== "OTHER" && required.every(value => value !== null)
    ? "AVAILABLE"
    : "PARTIAL";

  return Object.freeze({
    symbol,
    researchSymbol: researchSymbolFor({ symbol, market, venue }),
    name: name || symbol || "未命名標的",
    market,
    marketLabel: market === "OTHER" ? "市場未提供" : market,
    assetType: textOrEmpty(row?.asset_type).toUpperCase() === "ETF" ? "ETF" : "個股",
    venue,
    currency,
    quantity,
    averageCost,
    investedCost,
    lastPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    asOf: validTimestamp(effectiveAt),
    portfolioSource: PORTFOLIO_SOURCE,
    marketValueSource: safeMarketSource(row?.market_value_source),
    status,
    snapshotKind,
  });
}

export function researchSymbolFor({ symbol, market, venue } = {}) {
  const normalized = textOrEmpty(symbol).toUpperCase();
  if (!normalized) return "";
  if (/\.(TW|TWO)$/.test(normalized)) return normalized;
  if (market === "US") return normalized;
  if (venue === "TWSE") return `${normalized}.TW`;
  if (venue === "TPEX") return `${normalized}.TWO`;
  // A bare Taiwan code can be listed on either exchange. Leave it unresolved;
  // the authenticated catalog resolver must supply a unique venue.
  return normalized;
}

function onlyCurrent(rows) {
  return rows
    .filter(row => textOrEmpty(row?.position_status).toLowerCase() === "current")
    .map(row => normalizePosition(row))
    .filter(position => position.symbol && position.quantity !== null && position.quantity > 0);
}

function encodeFilter(value) {
  return encodeURIComponent(String(value));
}

export function createReadOnlyPortfolioAdapter({ context, appAccess, appAccessGate, now = () => new Date() } = {}) {
  if (typeof context?.data?.select !== "function") {
    throw new TypeError("Read-only Portfolio adapter requires Shared ModuleContext.data.select.");
  }
  const select = (resource, query) => context.data.select(resource, query);

  async function authorize() {
    const session = context.session?.getSnapshot?.();
    if (session?.isAuthenticated !== true) throw new PortfolioReadError("SESSION_REQUIRED");
    if (typeof appAccess?.getCurrent !== "function" || typeof appAccessGate?.isApproved !== "function") {
      throw new PortfolioReadError("ACCESS_GATE_UNAVAILABLE");
    }

    let access;
    try { access = await appAccess.getCurrent(); }
    catch { throw new PortfolioReadError("ACCESS_CHECK_UNAVAILABLE"); }
    if (!appAccessGate.isApproved(access)) throw new PortfolioReadError("APP_ACCESS_REQUIRED");

    try {
      await context.creator?.resolve?.();
      await context.security?.loadMfaPolicy?.();
    } catch {
      throw new PortfolioReadError("SECURITY_CHECK_UNAVAILABLE");
    }
    let permission;
    try { permission = context.security?.evaluate?.("view"); }
    catch { throw new PortfolioReadError("SECURITY_CHECK_UNAVAILABLE"); }
    if (permission?.allowed !== true) {
      const code = ["STEP_UP_REQUIRED", "MODULE_LOCKED"].includes(permission?.code)
        ? "MFA_REQUIRED"
        : "PORTFOLIO_ACCESS_DENIED";
      throw new PortfolioReadError(code);
    }

    let userId = "";
    try { userId = textOrEmpty(context.identity?.getUserId?.()); } catch {}
    if (!userId) throw new PortfolioReadError("SESSION_REQUIRED");
    return userId;
  }

  async function resolveOwnerContext() {
    const authUserId = await authorize();
    const mapping = rowsOrFail(await select(
      "app_users",
      `select=id&auth_user_id=eq.${encodeFilter(authUserId)}&limit=1`,
    ));
    const ownerId = textOrEmpty(mapping[0]?.id);
    if (!ownerId) throw new PortfolioReadError("OWNER_MAPPING_REQUIRED");

    const portfolios = rowsOrFail(await select(
      "portfolios",
      `select=id,is_default,updated_at&user_id=eq.${encodeFilter(ownerId)}&order=is_default.desc,updated_at.desc&limit=1`,
    ));
    return Object.freeze({ authUserId, ownerId, portfolioId: textOrEmpty(portfolios[0]?.id) });
  }

  async function loadCurrentPositions() {
    const loadedAt = validTimestamp(now());
    try {
      const { ownerId, portfolioId } = await resolveOwnerContext();
      if (!portfolioId) return Object.freeze({ status: "EMPTY", source: PORTFOLIO_SOURCE, loadedAt, positions: [] });

      const positionRows = rowsOrFail(await select(
        "investment_current_positions_view",
        `select=${POSITION_COLUMNS}&user_id=eq.${encodeFilter(ownerId)}&portfolio_id=eq.${encodeFilter(portfolioId)}&position_status=eq.current&quantity=gt.0&order=market.asc,symbol.asc,source_id.asc`,
      ));

      const positions = onlyCurrent(positionRows);
      return Object.freeze({
        status: positions.length ? "AVAILABLE" : "EMPTY",
        source: PORTFOLIO_SOURCE,
        loadedAt,
        positions: Object.freeze(positions),
      });
    } catch (error) {
      if (error instanceof PortfolioReadError) throw error;
      throw new PortfolioReadError("PORTFOLIO_READ_UNAVAILABLE");
    }
  }

  async function loadWatchlist() {
    const loadedAt = validTimestamp(now());
    try {
      const { ownerId } = await resolveOwnerContext();
      const rows = rowsOrFail(await select(
        "watchlists",
        `select=id,symbol,name,market,status,research_theme,reason,importance,updated_at&user_id=eq.${encodeFilter(ownerId)}&order=importance.asc,updated_at.desc`,
      ));
      const items = rows.map(row => Object.freeze({
        id: textOrEmpty(row.id),
        symbol: textOrEmpty(row.symbol).toUpperCase(),
        name: textOrEmpty(row.name),
        market: textOrEmpty(row.market).toUpperCase(),
        status: textOrEmpty(row.status),
        researchTheme: textOrEmpty(row.research_theme),
        reason: textOrEmpty(row.reason),
        importance: numberOrNull(row.importance),
        updatedAt: validTimestamp(row.updated_at),
      }));
      return Object.freeze({ status: items.length ? "AVAILABLE" : "EMPTY", source: "watchlists", loadedAt, items: Object.freeze(items) });
    } catch (error) {
      if (error instanceof PortfolioReadError) throw error;
      throw new PortfolioReadError("WATCHLIST_READ_UNAVAILABLE");
    }
  }

  async function loadClosedPositions() {
    const loadedAt = validTimestamp(now());
    try {
      const { ownerId, portfolioId } = await resolveOwnerContext();
      if (!portfolioId) return Object.freeze({ status: "EMPTY", source: "investment_current_positions_view", loadedAt, items: [] });
      const rows = rowsOrFail(await select(
        "investment_current_positions_view",
        `select=source_kind,source_id,symbol,name,market,currency,realized_pnl,effective_at,position_status&user_id=eq.${encodeFilter(ownerId)}&portfolio_id=eq.${encodeFilter(portfolioId)}&position_status=eq.history&order=effective_at.desc,symbol.asc`,
      ));
      const items = rows
        .filter(row => textOrEmpty(row.position_status).toLowerCase() === "history")
        .map(row => Object.freeze({
          symbol: textOrEmpty(row.symbol).toUpperCase(),
          name: textOrEmpty(row.name),
          market: MARKET_LABELS[textOrEmpty(row.market).toUpperCase()] || textOrEmpty(row.market).toUpperCase() || "—",
          currency: textOrEmpty(row.currency).toUpperCase(),
          realizedPnl: numberOrNull(row.realized_pnl),
          effectiveAt: validTimestamp(row.effective_at),
          sourceKind: textOrEmpty(row.source_kind),
          sourceId: textOrEmpty(row.source_id),
        }));
      return Object.freeze({ status: items.length ? "AVAILABLE" : "EMPTY", source: "investment_current_positions_view", loadedAt, items: Object.freeze(items) });
    } catch (error) {
      if (error instanceof PortfolioReadError) throw error;
      throw new PortfolioReadError("CLOSED_HISTORY_READ_UNAVAILABLE");
    }
  }

  async function loadTransactions({ symbol, market, limit = 100 } = {}) {
    const loadedAt = validTimestamp(now());
    const inputSymbol = textOrEmpty(symbol).toUpperCase();
    const suffixMarket = /\.(TW|TWO)$/.test(inputSymbol) ? "TW" : "";
    const providedMarket = textOrEmpty(market).toUpperCase();
    const normalizedMarket = providedMarket === "US" || providedMarket === "TW" ? providedMarket : suffixMarket;
    if (!normalizedMarket) throw new PortfolioReadError("MARKET_IDENTITY_REQUIRED");
    try {
      const { ownerId, portfolioId } = await resolveOwnerContext();
      if (!portfolioId) return Object.freeze({ status: "EMPTY", source: "transactions", loadedAt, items: [] });
      const normalizedSymbol = inputSymbol.replace(/\.(TW|TWO)$/, "");
      const clauses = [
        `user_id=eq.${encodeFilter(ownerId)}`,
        `portfolio_id=eq.${encodeFilter(portfolioId)}`,
        ...(normalizedSymbol ? [`symbol=eq.${encodeFilter(normalizedSymbol)}`] : []),
        `market=eq.${encodeFilter(normalizedMarket)}`,
        "order=trade_date.desc,created_at.desc",
        `limit=${Math.min(200, Math.max(1, Math.floor(Number(limit) || 100)))}`,
      ];
      const rows = rowsOrFail(await select(
        "transactions",
        `select=id,portfolio_id,trade_date,trade_type,symbol,name,market,quantity,price,gross_amount,fee,tax,net_amount,currency,source,note,created_at&${clauses.join("&")}`,
      ));
      const items = rows.map(row => Object.freeze({
        id: textOrEmpty(row.id),
        tradeDate: validTimestamp(row.trade_date),
        tradeType: textOrEmpty(row.trade_type),
        symbol: textOrEmpty(row.symbol).toUpperCase(),
        name: textOrEmpty(row.name),
        market: MARKET_LABELS[textOrEmpty(row.market).toUpperCase()] || textOrEmpty(row.market).toUpperCase() || "—",
        quantity: numberOrNull(row.quantity),
        price: numberOrNull(row.price),
        grossAmount: numberOrNull(row.gross_amount),
        fee: numberOrNull(row.fee),
        tax: numberOrNull(row.tax),
        netAmount: numberOrNull(row.net_amount),
        currency: textOrEmpty(row.currency).toUpperCase(),
        source: textOrEmpty(row.source),
        note: textOrEmpty(row.note),
        createdAt: validTimestamp(row.created_at),
      }));
      return Object.freeze({ status: items.length ? "AVAILABLE" : "EMPTY", source: "transactions", loadedAt, items: Object.freeze(items) });
    } catch (error) {
      if (error instanceof PortfolioReadError) throw error;
      throw new PortfolioReadError("TRANSACTION_READ_UNAVAILABLE");
    }
  }

  async function assertReadAccess() {
    await resolveOwnerContext();
    return true;
  }

  // The explicit names document this adapter's product contract. Keep the
  // earlier method names as aliases for callers already shipped in the Lab.
  return Object.freeze({
    loadCurrentPositions,
    loadWatchlist,
    loadClosedPositions,
    loadTransactions,
    assertReadAccess,
    load: loadCurrentPositions,
    loadClosedHistory: loadClosedPositions,
  });
}

export const portfolioReadContract = Object.freeze({
  source: PORTFOLIO_SOURCE,
  primaryResource: "investment_current_positions_view",
  watchlistResource: "watchlists",
  closedHistoryResource: "investment_current_positions_view",
  transactionsResource: "transactions",
  readMode: "authenticated select-only",
  writes: Object.freeze([]),
});
