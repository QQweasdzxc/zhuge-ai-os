const PORTFOLIO_SOURCE = "Zhuge Investment Portfolio";

const POSITION_COLUMNS = [
  "symbol", "name", "market", "asset_type", "quantity", "avg_cost", "invested_cost",
  "last_price", "market_value", "unrealized_pnl", "unrealized_pct", "currency",
  "effective_at", "market_value_source", "position_status",
].join(",");

const SNAPSHOT_COLUMNS = "id,snapshot_at,position_count";

const SNAPSHOT_POSITION_COLUMNS = [
  "snapshot_id", "item_id", "symbol", "name", "market", "currency", "quantity",
  "avg_cost", "invested_cost", "last_price", "market_value", "unrealized_pnl",
  "unrealized_pct", "market_value_source",
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
    researchSymbol: researchSymbolFor({ symbol, market }),
    name: name || symbol || "未命名標的",
    market,
    marketLabel: market === "OTHER" ? "市場未提供" : market,
    assetType: textOrEmpty(row?.asset_type).toUpperCase() === "ETF" || symbol === "0050" ? "ETF" : "個股",
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

export function researchSymbolFor({ symbol, market } = {}) {
  const normalized = textOrEmpty(symbol).toUpperCase();
  if (!normalized) return "";
  if (/\.(TW|TWO)$/.test(normalized)) return normalized;
  if (market === "US") return normalized;
  const taiwanKnown = { "2330": "2330.TW", "0050": "0050.TW", "6488": "6488.TWO" };
  return taiwanKnown[normalized] || normalized;
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

  async function load() {
    const loadedAt = validTimestamp(now());
    try {
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
      const portfolioId = textOrEmpty(portfolios[0]?.id);
      if (!portfolioId) return Object.freeze({ status: "EMPTY", source: PORTFOLIO_SOURCE, loadedAt, positions: [] });

      const positionRows = rowsOrFail(await select(
        "investment_current_positions_view",
        `select=${POSITION_COLUMNS}&user_id=eq.${encodeFilter(ownerId)}&portfolio_id=eq.${encodeFilter(portfolioId)}&order=market.asc,symbol.asc,source_id.asc`,
      ));

      let positions;
      if (positionRows.length) {
        positions = onlyCurrent(positionRows);
      } else {
        positions = await loadConfirmedSnapshot({ ownerId, portfolioId });
      }
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

  async function loadConfirmedSnapshot({ ownerId, portfolioId }) {
    const headers = rowsOrFail(await select(
      "broker_position_snapshots",
      `select=${SNAPSHOT_COLUMNS}&user_id=eq.${encodeFilter(ownerId)}&portfolio_id=eq.${encodeFilter(portfolioId)}&verification=eq.pm_confirmed&order=snapshot_at.desc,created_at.desc,id.desc&limit=1`,
    ));
    const header = headers[0];
    const snapshotId = textOrEmpty(header?.id);
    if (!snapshotId) return [];

    const items = rowsOrFail(await select(
      "current_broker_positions_view",
      `select=${SNAPSHOT_POSITION_COLUMNS}&snapshot_id=eq.${encodeFilter(snapshotId)}&portfolio_id=eq.${encodeFilter(portfolioId)}&order=market.asc,symbol.asc`,
    ));
    const expectedCount = Number(header.position_count);
    if (!Number.isInteger(expectedCount) || expectedCount < 0 || items.length !== expectedCount) {
      throw new PortfolioReadError("SNAPSHOT_INCOMPLETE");
    }
    const snapshotAt = validTimestamp(header.snapshot_at);
    return items
      .map(row => normalizePosition(row, { effectiveAt: snapshotAt, snapshotKind: "confirmed_snapshot_fallback" }))
      .filter(position => position.symbol && position.quantity !== null && position.quantity > 0);
  }

  return Object.freeze({ load });
}

export const portfolioReadContract = Object.freeze({
  source: PORTFOLIO_SOURCE,
  primaryResource: "investment_current_positions_view",
  fallbackResource: "current_broker_positions_view",
  readMode: "authenticated select-only",
  writes: Object.freeze([]),
});
