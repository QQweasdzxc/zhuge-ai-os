const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export function normalizeBrokerBranchEvidence({ market = "TW", symbol = "", evidence = null } = {}) {
  const normalizedMarket = text(market, 8).toUpperCase();
  if (normalizedMarket === "US") return Object.freeze({ contract: "zhuge-broker-branch-evidence-v1", status: "NOT_APPLICABLE", market: "US", symbol: text(symbol, 24).toUpperCase(), provider: null, dataTimestamp: null, rows: Object.freeze([]), note: "台灣券商分點資料不適用美股。" });
  const item = evidence && typeof evidence === "object" ? evidence : {};
  const status = ["AVAILABLE", "PARTIAL", "NOT_APPLICABLE", "UNAVAILABLE", "SECRET_REQUIRED"].includes(item.status) ? item.status : "UNAVAILABLE";
  const rows = (Array.isArray(item.data?.rows) ? item.data.rows : []).flatMap(row => {
    const branch = text(row?.branchName || row?.branch_name || row?.branch, 160);
    const branchId = text(row?.branchId || row?.branch_id, 40);
    const buy = number(row?.buy ?? row?.buyValue);
    const sell = number(row?.sell ?? row?.sellValue);
    const net = number(row?.netBuy ?? row?.net_buy ?? row?.netValue) ?? (buy !== null && sell !== null ? buy - sell : null);
    if (!branch && !branchId) return [];
    return [Object.freeze({ date: text(row?.date, 10) || null, branch: branch || branchId, buy, sell, net, unit: text(row?.unit, 24) || null })];
  });
  const completeRows = rows.every(row => row.buy !== null && row.sell !== null);
  const sourceSummaryComplete = item.data?.summary && typeof item.data.summary === "object"
    ? item.data.summary.complete === true
    : true;
  const summary = rows.length && completeRows && sourceSummaryComplete && rows.every(row => row.unit === rows[0].unit)
    ? Object.freeze({ buy: rows.reduce((sum, row) => sum + row.buy, 0), sell: rows.reduce((sum, row) => sum + row.sell, 0), net: rows.reduce((sum, row) => sum + row.net, 0), unit: rows[0].unit })
    : null;
  return Object.freeze({
    contract: "zhuge-broker-branch-evidence-v1",
    status: rows.length ? (status === "AVAILABLE" && completeRows ? "AVAILABLE" : "PARTIAL") : status,
    market: "TW",
    symbol: text(symbol || item.symbol, 24).toUpperCase(),
    provider: text(item.provider, 160) || null,
    dataTimestamp: text(item.dataTimestamp || item.data?.date, 40) || null,
    fetchedAt: text(item.fetchedAt, 40) || null,
    source: text(Array.isArray(item.source) ? item.source[0] : item.source, 1000) || null,
    rows: Object.freeze(rows),
    summary,
    note: text(item.note, 500) || (status === "SECRET_REQUIRED" ? "分點歷史資料需要已授權的付費／API provider；沒有用法人資料冒充分點資料。" : "分點原始資料保持來源口徑，不推定券商買賣方向。"),
  });
}
