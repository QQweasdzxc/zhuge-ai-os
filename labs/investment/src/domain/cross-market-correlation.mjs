const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function datedCloses(history) {
  const rows = new Map();
  for (const item of Array.isArray(history?.bars) ? history.bars : []) {
    const date = String(item?.date || item?.asOf || item?.as_of || "").slice(0, 10);
    const close = finite(item?.close) ? Number(item.close) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0) continue;
    rows.set(date, close);
  }
  return rows;
}

function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = xs.reduce((sum, value, index) => sum + (value - xMean) * (ys[index] - yMean), 0);
  const xSum = xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  const ySum = ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const denominator = Math.sqrt(xSum * ySum);
  return denominator > 0 ? numerator / denominator : null;
}

/** Date-align real daily close returns; never pairs adjacent but nonmatching sessions. */
export function calculateCrossMarketCorrelation(targetHistory, referenceHistory, { window = 60, minimumPairs = 20 } = {}) {
  const target = datedCloses(targetHistory);
  const reference = datedCloses(referenceHistory);
  const dates = [...target.keys()].filter(date => reference.has(date)).sort();
  const targetReturns = [], referenceReturns = [], pairedDates = [];
  for (let index = 1; index < dates.length; index += 1) {
    const date = dates[index], previous = dates[index - 1];
    targetReturns.push(target.get(date) / target.get(previous) - 1);
    referenceReturns.push(reference.get(date) / reference.get(previous) - 1);
    pairedDates.push(date);
  }
  const limit = Math.max(2, Math.min(250, Math.floor(Number(window) || 60)));
  const xs = targetReturns.slice(-limit), ys = referenceReturns.slice(-limit), usedDates = pairedDates.slice(-limit);
  const value = xs.length >= minimumPairs ? correlation(xs, ys) : null;
  return Object.freeze({
    contract: "zhuge-cross-market-correlation-v1",
    status: value === null ? "INSUFFICIENT_EVIDENCE" : "AVAILABLE",
    correlation: value,
    pairedReturns: xs.length,
    startDate: usedDates[0] || null,
    endDate: usedDates.at(-1) || null,
    targetProvider: targetHistory?.provider || targetHistory?.source || null,
    referenceProvider: referenceHistory?.provider || referenceHistory?.source || null,
    note: value === null ? `共同有效日期不足 ${minimumPairs} 組報酬；不計算相關係數。` : "日收報酬以兩市場共同日期對齊；相關性是歷史描述，不代表因果或預測。",
  });
}
