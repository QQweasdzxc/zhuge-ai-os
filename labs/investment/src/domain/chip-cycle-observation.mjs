import { calculateIndicators } from "./indicators.mjs";

const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = value => finite(value) ? Number(value) : null;
const dateOf = row => String(row?.date || row?.asOf || row?.as_of || "").slice(0, 10);

function normalizeBars(input) {
  const byDate = new Map();
  for (const row of Array.isArray(input) ? input : []) {
    const date = dateOf(row);
    const open = number(row?.open), high = number(row?.high), low = number(row?.low);
    const close = number(row?.close), volume = number(row?.volume);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || [open, high, low, close, volume].some(value => value === null)) continue;
    if (volume < 0 || high < low || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    byDate.set(date, Object.freeze({ date, open, high, low, close, volume }));
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-60);
}

function stochasticSeries(bars) {
  let k = 50, d = 50;
  const result = [];
  for (let index = 8; index < bars.length; index += 1) {
    const window = bars.slice(index - 8, index + 1);
    const highest = Math.max(...window.map(item => item.high));
    const lowest = Math.min(...window.map(item => item.low));
    const rsv = highest === lowest ? 50 : ((bars[index].close - lowest) / (highest - lowest)) * 100;
    k = (2 * k + rsv) / 3;
    d = (2 * d + k) / 3;
    result.push(Object.freeze({ date: bars[index].date, k, d }));
  }
  return result;
}

function standardDeviation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
  return Math.sqrt(values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length);
}

function unavailable(missing, context = {}) {
  return Object.freeze({
    status: "INSUFFICIENT_EVIDENCE",
    phase: "INSUFFICIENT_EVIDENCE",
    phaseLabel: "資料不足",
    stage: "INSUFFICIENT_EVIDENCE",
    reason: "必要來源期間不足，未輸出 Wyckoff 條件階段。",
    confidence: Object.freeze({ score: null, level: "UNKNOWN", basis: "evidence_coverage_only_not_probability" }),
    sufficiency: Object.freeze({ status: "INSUFFICIENT_EVIDENCE", score: null, level: "UNKNOWN", factors: Object.freeze([]), missing: Object.freeze(missing), meaning: "資料不足時不產生階段標籤；證據覆蓋度不是階段機率。" }),
    ruleVersion: "zhuge-wyckoff-evidence-v2",
    asOf: context.asOf || null,
    evidence: Object.freeze([]),
    sourceObservations: Object.freeze([]),
    missing: Object.freeze(missing),
    stageScores: Object.freeze([]),
    note: "此為可解釋的量價／法人條件觀察，不是經典 Wyckoff 確認或買賣建議。",
    tdccHistory: "資料不足",
  });
}

const phaseDefinitions = Object.freeze([
  {
    id: "P1_ACCUMULATION", label: "累積區間候選", max: 100,
    rules: [
      ["十日法人淨流入", 25, m => m.flow10Pct === null ? null : m.flow10Pct > 0],
      ["法人連續買超至少三日", 15, m => m.buyStreak === null ? null : m.buyStreak >= 3],
      ["日報酬波動低於 3.5%", 20, m => m.volatilityPct === null ? null : m.volatilityPct < 3.5],
      ["近五日均量低於二十日均量的 90%", 15, m => m.volumeRatio === null ? null : m.volumeRatio < 0.9],
      ["RSI 位於 38–58", 15, m => m.rsi === null ? null : m.rsi >= 38 && m.rsi <= 58],
      ["收盤高於二十日均線", 10, m => m.aboveMa20 === null ? null : m.aboveMa20],
    ],
  },
  {
    id: "P2_SPRING", label: "回測／Spring 條件候選", max: 100,
    rules: [
      ["相對二十日高點回落至少 3%", 25, m => m.drawdownFromHighPct === null ? null : m.drawdownFromHighPct <= -3],
      ["近五日均量高於二十日均量的 120%", 15, m => m.volumeRatio === null ? null : m.volumeRatio > 1.2],
      ["五日法人淨流量不低於日均量的 -1%", 20, m => m.flow5Pct === null ? null : m.flow5Pct >= -1],
      ["RSI 低於 45", 15, m => m.rsi === null ? null : m.rsi < 45],
      ["收盤低於二十日均線", 15, m => m.aboveMa20 === null ? null : !m.aboveMa20],
      ["KD-K 低於 35", 10, m => m.k === null ? null : m.k < 35],
    ],
  },
  {
    id: "P3_MARKUP_IGNITION", label: "Markup 啟動條件候選", max: 100,
    rules: [
      ["近五日均量不高於二十日均量的 80%", 20, m => m.volumeRatio === null ? null : m.volumeRatio <= 0.8],
      ["法人連續買超至少五日", 25, m => m.buyStreak === null ? null : m.buyStreak >= 5],
      ["RSI 位於 35–55", 15, m => m.rsi === null ? null : m.rsi >= 35 && m.rsi <= 55],
      ["KD 低檔黃金交叉", 20, m => m.k === null || m.kdGoldenCross === null ? null : m.kdGoldenCross && m.k < 35],
      ["十日法人淨流入", 10, m => m.flow10Pct === null ? null : m.flow10Pct > 0],
      ["收盤高於二十日均線", 10, m => m.aboveMa20 === null ? null : m.aboveMa20],
    ],
  },
  {
    id: "P4_MARKUP", label: "Markup 趨勢條件候選", max: 100,
    rules: [
      ["放量且收紅", 25, m => m.volumeRatio === null ? null : m.volumeRatio >= 1.2 && m.latest.close > m.latest.open],
      ["RSI 高於 55", 20, m => m.rsi === null ? null : m.rsi > 55],
      ["KD-K 高於 50", 15, m => m.k === null ? null : m.k > 50],
      ["五日法人淨流入", 20, m => m.flow5Pct === null ? null : m.flow5Pct > 0],
      ["收盤高於二十日均線", 10, m => m.aboveMa20 === null ? null : m.aboveMa20],
      ["收盤高於五日及二十日均線", 10, m => m.aboveMa5 === null || m.aboveMa20 === null ? null : m.aboveMa5 && m.aboveMa20],
    ],
  },
  {
    id: "P5_DISTRIBUTION", label: "派發條件候選", max: 60,
    rules: [
      ["上影線占日高低幅度超過 35%", 20, m => m.upperShadowRatio === null ? null : m.upperShadowRatio > 0.35],
      ["五日法人淨流出", 25, m => m.flow5Pct === null ? null : m.flow5Pct < 0],
      ["均量放大超過 150% 且上影線超過 25%", 15, m => m.volumeRatio === null || m.upperShadowRatio === null ? null : m.volumeRatio > 1.5 && m.upperShadowRatio > 0.25],
    ],
  },
]);

function scorePhase(definition, metrics) {
  const factors = definition.rules.map(([label, points, predicate]) => {
    const result = predicate(metrics);
    const known = typeof result === "boolean";
    const passed = result === true;
    return Object.freeze({ label, points, known, passed, meaning: !known ? "來源不足" : passed ? `+${points}` : "未命中" });
  });
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    score: factors.reduce((sum, item) => sum + (item.passed ? item.points : 0), 0),
    maxScore: definition.max,
    eligible: factors.every(item => item.known),
    unknownFactors: Object.freeze(factors.filter(item => !item.known).map(item => item.label)),
    factors: Object.freeze(factors),
  });
}

/**
 * Explainable five-phase price/volume/institutional observation. The rule
 * thresholds are an independent Zhuge implementation inspired by the audited
 * upstream behavior; outputs are candidates and never a confirmed market phase.
 */
export function buildChipCycleObservation({ bars = [], institutionalSummary = null, tdccHistory = null, historySource = "市場 OHLCV Provider", institutionalSource = "TWSE / TPEx 三大法人資料" } = {}) {
  const history = normalizeBars(bars);
  const missing = [];
  if (history.length < 20) missing.push(`有效 OHLCV 交易日 ${history.length}/20`);
  const five = institutionalSummary?.fiveSessions;
  const ten = institutionalSummary?.tenSessions;
  const flow5 = five?.complete === true && finite(five.allThreeNetShares) ? Number(five.allThreeNetShares) : null;
  const flow10 = ten?.complete === true && finite(ten.allThreeNetShares) ? Number(ten.allThreeNetShares) : null;
  if (flow5 === null) missing.push("完整五個來源交易日的三大法人淨流量");
  if (flow10 === null) missing.push("完整十個來源交易日的三大法人淨流量");
  if (missing.some(value => value.includes("OHLCV")) || flow5 === null) return unavailable(missing, { asOf: history.at(-1)?.date });

  const closes = history.map(item => item.close);
  const volumes = history.map(item => item.volume);
  const latest = history.at(-1);
  const averageVolume20 = volumes.slice(-20).reduce((sum, item) => sum + item, 0) / 20;
  const averageVolume5 = volumes.slice(-5).reduce((sum, item) => sum + item, 0) / 5;
  const volumeRatio = averageVolume20 > 0 ? averageVolume5 / averageVolume20 : null;
  const indicators = calculateIndicators(history);
  const kd = stochasticSeries(history);
  const currentKd = kd.at(-1), previousKd = kd.at(-2);
  const dailyReturns = history.slice(-20).slice(1).map((item, index) => (item.close / history.slice(-20)[index].close - 1) * 100);
  const volatilityPct = standardDeviation(dailyReturns);
  const averageClose20 = closes.slice(-20).reduce((sum, item) => sum + item, 0) / 20;
  const averageClose5 = closes.slice(-5).reduce((sum, item) => sum + item, 0) / 5;
  const highestClose20 = Math.max(...closes.slice(-20));
  const dailyTurnoverBase = averageVolume20;
  const flow5Pct = dailyTurnoverBase > 0 ? flow5 / (dailyTurnoverBase * 5) * 100 : null;
  const flow10Pct = flow10 !== null && dailyTurnoverBase > 0 ? flow10 / (dailyTurnoverBase * 10) * 100 : null;
  const streak = institutionalSummary?.streaks?.allThreeNetShares;
  const buyStreak = streak && Number.isFinite(Number(streak.sessions))
    ? streak.direction === "BUY" ? Number(streak.sessions) : 0
    : null;
  const candleRange = latest.high - latest.low;
  const upperShadowRatio = candleRange > 0 ? (latest.high - Math.max(latest.open, latest.close)) / candleRange : null;
  const metrics = Object.freeze({
    latest,
    volumeRatio,
    volatilityPct,
    rsi: number(indicators.rsi14),
    k: currentKd?.k ?? null,
    kdGoldenCross: Boolean(previousKd && currentKd && previousKd.k <= previousKd.d && currentKd.k > currentKd.d),
    aboveMa20: averageClose20 > 0 ? latest.close > averageClose20 : null,
    aboveMa5: averageClose5 > 0 ? latest.close > averageClose5 : null,
    drawdownFromHighPct: highestClose20 > 0 ? (latest.close / highestClose20 - 1) * 100 : null,
    flow5Pct,
    flow10Pct,
    buyStreak,
    upperShadowRatio,
  });
  const tdccObservations = Array.isArray(tdccHistory?.observations) ? tdccHistory.observations : [];
  const validTdccObservations = tdccObservations.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || ""))
    && finite(item?.topThreeSourceLevelsPct));
  const stageScores = phaseDefinitions.map(item => scorePhase(item, metrics)).sort((left, right) => right.score - left.score);
  const eligibleScores = stageScores.filter(item => item.eligible).sort((left, right) => right.score - left.score);
  const best = eligibleScores[0] || stageScores[0];
  const runnerUp = eligibleScores[1];
  const ambiguous = best.score >= 45 && runnerUp && best.score - runnerUp.score < 10;
  const insufficient = !eligibleScores.length || best.score < 45 || ambiguous;
  const phase = insufficient ? "INSUFFICIENT_EVIDENCE" : `${best.id}_CANDIDATE`;
  const phaseLabel = insufficient ? "證據不足或訊號混合" : best.label;
  const stage = insufficient ? "INSUFFICIENT_EVIDENCE" : best.id;
  const tdccCompleteDates = new Set(validTdccObservations.map(item => item.date)).size;
  const tdccStatus = tdccCompleteDates >= 2 ? "AVAILABLE" : "INSUFFICIENT_HISTORY";
  const coverageFactors = [
    Object.freeze({ id: "ohlcv", label: "至少 20 日有效 OHLCV", available: history.length >= 20 }),
    Object.freeze({ id: "institutional-5", label: "完整 5 日法人流量", available: flow5 !== null }),
    Object.freeze({ id: "institutional-10", label: "完整 10 日法人流量", available: flow10 !== null }),
    Object.freeze({ id: "tdcc-history", label: "至少兩個 TDCC source dates", available: tdccCompleteDates >= 2 }),
  ];
  const coverageScore = Math.round(coverageFactors.filter(item => item.available).length / coverageFactors.length * 100);
  const scoreEvidence = stageScores.map(item => Object.freeze({
    id: `stage-${item.id.toLowerCase()}`,
    label: item.label,
    value: `${item.score}/${item.maxScore} · ${item.factors.filter(factor => factor.passed).map(factor => factor.label).join("、") || "無命中條件"}`,
    source: `${historySource} + ${institutionalSource}`,
    asOf: latest.date,
  }));
  const sourceObservations = Object.freeze([
    Object.freeze({ id: "price-window", label: "價格區間", value: `${history[0].date} 至 ${latest.date} · 收盤 ${latest.close} · 距二十日高點 ${metrics.drawdownFromHighPct.toFixed(2)}%`, source: historySource, asOf: latest.date }),
    Object.freeze({ id: "technical-window", label: "技術／量能", value: `MA5 ${averageClose5.toFixed(2)} · MA20 ${averageClose20.toFixed(2)} · RSI14 ${metrics.rsi?.toFixed(2) ?? "—"} · KD ${currentKd?.k.toFixed(2) ?? "—"}/${currentKd?.d.toFixed(2) ?? "—"} · 五日／二十日均量比 ${volumeRatio?.toFixed(3) ?? "—"}`, source: historySource, asOf: latest.date }),
    Object.freeze({ id: "institutional-window", label: "法人流量", value: `5 日 ${flow5.toLocaleString("zh-TW")} 股 (${flow5Pct?.toFixed(3) ?? "—"}% 日均量基準) · 10 日 ${flow10?.toLocaleString("zh-TW") ?? "—"} 股 · 連買 ${buyStreak} 日`, source: institutionalSource, asOf: ten?.through || five?.through || null }),
    ...validTdccObservations.slice(-2).map(item => Object.freeze({ id: "tdcc-concentration", label: "TDCC 第 13–15 級占比", value: `${Number(item.topThreeSourceLevelsPct).toFixed(2)}%`, source: item.source || "TDCC official ownership distribution", asOf: item.date })),
    ...scoreEvidence,
  ]);
  const reason = insufficient
    ? `最高可計算階段條件分數 ${best.score}/${best.maxScore}${best.unknownFactors.length ? `；缺少 ${best.unknownFactors.join("、")}` : ""}${ambiguous ? `；與次高 ${runnerUp.score}/${runnerUp.maxScore} 接近` : "，未達 45 分門檻或可計算來源窗口不足"}；不產生階段標籤。`
    : `${best.label} 得分 ${best.score}/${best.maxScore}；命中條件：${best.factors.filter(item => item.passed).map(item => item.label).join("、")}。此為可檢查的規則候選，不代表已確認的市場階段。`;
  const evidence = Object.freeze([
    "獨立實作五階段候選：P1 累積、P2 Spring／回測、P3 啟動、P4 趨勢、P5 派發；規則以 OHLCV 與來源日期三大法人資料計算。",
    "流量門檻以法人淨股數相對來源日均成交量比例正規化，避免不同股票價格／股數尺度直接共用絕對股數門檻。",
    ...stageScores.map(item => `${item.id}: ${item.score}/${item.maxScore}; ${item.factors.map(factor => `${factor.passed ? "命中" : "未命中"} ${factor.label}`).join("；")}`),
    `波動度 ${volatilityPct?.toFixed(3) ?? "—"}%；上影線比例 ${upperShadowRatio?.toFixed(3) ?? "—"}；資料截至 ${latest.date}。`,
  ]);
  return Object.freeze({
    status: insufficient ? "INSUFFICIENT_EVIDENCE" : "AVAILABLE",
    phase,
    stage,
    phaseLabel,
    ruleVersion: "zhuge-wyckoff-evidence-v2",
    from: history[0].date,
    asOf: latest.date,
    returnPct: (latest.close / history.slice(-20)[0].close - 1) * 100,
    rangePct: (Math.max(...history.slice(-20).map(item => item.high)) / Math.min(...history.slice(-20).map(item => item.low)) - 1) * 100,
    upVolumeSharePct: (() => { const window = history.slice(-20); const directional = window.slice(1).reduce((sum, item, index) => sum + (item.close === window[index].close ? 0 : item.volume), 0); const up = window.slice(1).reduce((sum, item, index) => sum + (item.close > window[index].close ? item.volume : 0), 0); return directional > 0 ? up / directional * 100 : null; })(),
    downVolumeSharePct: (() => { const window = history.slice(-20); const directional = window.slice(1).reduce((sum, item, index) => sum + (item.close === window[index].close ? 0 : item.volume), 0); const down = window.slice(1).reduce((sum, item, index) => sum + (item.close < window[index].close ? item.volume : 0), 0); return directional > 0 ? down / directional * 100 : null; })(),
    institutionalNet5Sessions: flow5,
    institutionalThrough: five?.through || null,
    averageVolume20,
    averageVolume5,
    reason,
    sourceObservations,
    stageScores: Object.freeze(stageScores),
    confidence: Object.freeze({ score: coverageScore, level: coverageScore === 100 ? "HIGH" : "PARTIAL", basis: "evidence_coverage_only_not_probability" }),
    sufficiency: Object.freeze({
      status: insufficient ? "INSUFFICIENT_EVIDENCE" : tdccStatus === "AVAILABLE" ? "AVAILABLE" : "PARTIAL",
      score: coverageScore,
      level: coverageScore === 100 ? "HIGH" : "PARTIAL",
      factors: Object.freeze(coverageFactors),
      missing: Object.freeze([
        ...(flow10 === null ? ["完整 10 日三大法人窗口"] : []),
        ...(tdccStatus !== "AVAILABLE" ? ["至少兩個來源日期的 TDCC 歷史"] : []),
      ]),
      meaning: "證據覆蓋度，不是階段機率或預測命中率。",
    }),
    evidence,
    missing: Object.freeze(flow10 === null ? ["完整 10 日三大法人窗口"] : []),
    note: "Wyckoff 啟發的五階段規則候選；獨立計算、逐項列出命中證據，不是經典 Wyckoff 階段確認、報酬機率或買賣建議。",
    tdccHistory: tdccStatus === "AVAILABLE" ? `${tdccCompleteDates} 個官方來源日期` : `INSUFFICIENT_HISTORY: ${tdccCompleteDates} 個官方來源日期`,
  });
}
