const FIELDS = Object.freeze(["foreignNetShares", "trustNetShares", "dealerNetShares", "allThreeNetShares"]);

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value) {
  const date = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return parsed.toISOString().slice(0, 10) === date ? date : "";
}

function summarizeWindow(points, size) {
  const sample = points.slice(-size);
  const totals = Object.fromEntries(FIELDS.map((field) => {
    const values = sample.map((item) => finiteOrNull(item[field]));
    return [field, sample.length === size && values.every(value => value !== null)
      ? values.reduce((sum, value) => sum + value, 0)
      : null];
  }));
  return Object.freeze({
    sessions: sample.length,
    requiredSessions: size,
    complete: sample.length === size && FIELDS.every(field => totals[field] !== null),
    from: sample[0]?.date || null,
    through: sample.at(-1)?.date || null,
    ...totals,
  });
}

function summarizeStreak(points, field) {
  const latest = points.at(-1);
  const value = finiteOrNull(latest?.[field]);
  if (value === null || value === 0) return Object.freeze({ direction: value === 0 ? "NEUTRAL" : "UNAVAILABLE", sessions: 0, netShares: null, through: latest?.date || null });
  const direction = value > 0 ? "BUY" : "SELL";
  let sessions = 0;
  let netShares = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const itemValue = finiteOrNull(points[index]?.[field]);
    if (itemValue === null || itemValue === 0 || (itemValue > 0 ? "BUY" : "SELL") !== direction) break;
    sessions += 1;
    netShares += itemValue;
  }
  return Object.freeze({ direction, sessions, netShares, through: latest.date });
}

/** Summarize source-reported daily flow; no missing session is treated as zero. */
export function summarizeInstitutionalFlows(input = []) {
  const byDate = new Map();
  for (const row of Array.isArray(input) ? input : []) {
    const date = validDate(row?.date);
    if (!date) continue;
    byDate.set(date, Object.freeze({
      date,
      ...Object.fromEntries(FIELDS.map(field => [field, finiteOrNull(row?.[field])])),
    }));
  }
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  return Object.freeze({
    points: Object.freeze(points),
    fiveSessions: summarizeWindow(points, 5),
    tenSessions: summarizeWindow(points, 10),
    streaks: Object.freeze(Object.fromEntries(FIELDS.map(field => [field, summarizeStreak(points, field)]))),
  });
}
