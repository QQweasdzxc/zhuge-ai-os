const STORAGE_KEY = "zhuge.lab-investment.tdcc-observations.v1";
const CONTRACT = "zhuge-tdcc-local-observations-v1";
const MAX_SNAPSHOTS = 104;
const MAX_IDENTITIES = 128;
const SOURCE_LEVELS = Object.freeze([13, 14, 15]);

const text = value => String(value ?? "").trim();
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function sourceLevel(value) {
  const match = /(?:第\s*)?(\d{1,2})\s*級/i.exec(text(value));
  if (!match || /差異|合計/.test(text(value))) return null;
  const level = Number(match[1]);
  return level >= 1 && level <= 15 ? level : null;
}

function validDate(value) {
  const date = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : "";
}

function snapshotFor(evidence) {
  if (evidence?.provider !== "TDCC" || !Array.isArray(evidence?.data)) return null;
  const date = validDate(evidence.dataTimestamp);
  if (!date) return null;
  const levels = new Map();
  for (const row of evidence.data) {
    const level = sourceLevel(row?.band);
    const percent = finite(row?.percent) ? Number(row.percent) : null;
    if (level && percent != null && percent >= 0 && percent <= 100) {
      if (levels.has(level)) return null;
      levels.set(level, percent);
    }
  }
  if (!SOURCE_LEVELS.every(level => levels.has(level))) return null;
  const levelShares = Object.fromEntries(SOURCE_LEVELS.map(level => [String(level), levels.get(level)]));
  const total = SOURCE_LEVELS.reduce((sum, level) => sum + levels.get(level), 0);
  if (total > 100.01) return null;
  return Object.freeze({
    date,
    levels: Object.freeze(levelShares),
    topThreeSourceLevelsPct: total,
    fetchedAt: validDateTime(evidence.fetchedAt),
  });
}

function validDateTime(value) {
  const input = text(value);
  return Number.isFinite(Date.parse(input)) ? new Date(input).toISOString() : "";
}

function identityKey(symbol, venue) {
  const code = text(symbol).toUpperCase();
  const marketVenue = text(venue).toUpperCase();
  if (!/^[A-Z0-9.-]{1,16}$/.test(code) || !["TWSE", "TPEX"].includes(marketVenue)) return "";
  return `${marketVenue}:${code}`;
}

function normalizeStoredSnapshot(value) {
  const date = validDate(value?.date);
  const levels = value?.levels && typeof value.levels === "object" ? value.levels : {};
  if (!date || !SOURCE_LEVELS.every(level => finite(levels[String(level)]) && Number(levels[String(level)]) >= 0 && Number(levels[String(level)]) <= 100)) return null;
  const total = SOURCE_LEVELS.reduce((sum, level) => sum + Number(levels[String(level)]), 0);
  if (total > 100.01 || !finite(value?.topThreeSourceLevelsPct) || Math.abs(total - Number(value.topThreeSourceLevelsPct)) > 0.01) return null;
  return Object.freeze({
    date,
    levels: Object.freeze(Object.fromEntries(SOURCE_LEVELS.map(level => [String(level), Number(levels[String(level)])]))),
    topThreeSourceLevelsPct: total,
    fetchedAt: validDateTime(value?.fetchedAt),
  });
}

function summary(snapshots, storageStatus) {
  const ordered = snapshots.slice().sort((a, b) => a.date.localeCompare(b.date));
  const current = ordered.at(-1) ?? null;
  const previous = ordered.length > 1 ? ordered.at(-2) : null;
  return Object.freeze({
    status: current ? previous ? "AVAILABLE" : "INSUFFICIENT_HISTORY" : "INSUFFICIENT_EVIDENCE",
    storageStatus,
    contract: CONTRACT,
    currentDate: current?.date ?? null,
    currentTopThreeSourceLevelsPct: current?.topThreeSourceLevelsPct ?? null,
    currentLevelShares: current?.levels ?? null,
    previousDate: previous?.date ?? null,
    previousTopThreeSourceLevelsPct: previous?.topThreeSourceLevelsPct ?? null,
    changePercentagePoints: current && previous ? current.topThreeSourceLevelsPct - previous.topThreeSourceLevelsPct : null,
    observedSnapshots: ordered.length,
    observations: Object.freeze(ordered.map(item => Object.freeze({
      date: item.date,
      levels: item.levels,
      topThreeSourceLevelsPct: item.topThreeSourceLevelsPct,
      source: "TDCC official weekly ownership distribution; browser-local observation",
    }))),
    source: "TDCC official weekly ownership distribution; browser-local observations only",
    note: previous
      ? "比較本瀏覽器曾讀取的兩個最近 TDCC 來源日期；不是完整官方歷史，也不推論大戶身分或交易方向。"
      : storageStatus && storageStatus !== "SAVED"
        ? "目前來源級距可供參考，但此瀏覽器無法保存跨次觀測，因此不顯示週變化。"
        : "已讀取目前 TDCC 最高三個來源級距；本機尚未累積第二個不同資料日期，因此不顯示週變化。",
  });
}

/** Persist only public, source-dated TDCC level percentages; never stores holdings or account identity. */
export function recordTdccLocalObservation({ storage: providedStorage, symbol, venue, evidence } = {}) {
  const key = identityKey(symbol, venue);
  const current = snapshotFor(evidence);
  if (!key || !current) return summary([], "NOT_RECORDED_SOURCE_INCOMPLETE");
  let storage = providedStorage;
  if (storage === undefined) {
    try { storage = globalThis.localStorage; }
    catch { return summary([current], "UNAVAILABLE"); }
  }
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") return summary([current], "UNAVAILABLE");

  let record;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    record = raw ? JSON.parse(raw) : { contract: CONTRACT, items: {} };
  } catch {
    return summary([current], "INVALID_OR_UNAVAILABLE");
  }
  if (!record || record.contract !== CONTRACT || !record.items || typeof record.items !== "object" || Array.isArray(record.items)) {
    return summary([current], "INVALID_OR_UNAVAILABLE");
  }

  const items = Object.create(null);
  for (const [storedKey, rawHistory] of Object.entries(record.items)) {
    if (!/^(?:TWSE|TPEX):[A-Z0-9.-]{1,16}$/.test(storedKey) || !Array.isArray(rawHistory)) continue;
    const history = rawHistory.slice(-MAX_SNAPSHOTS).map(normalizeStoredSnapshot).filter(Boolean);
    if (history.length) items[storedKey] = history;
  }
  const history = items[key] || [];
  const byDate = new Map(history.map(snapshot => [snapshot.date, snapshot]));
  byDate.set(current.date, current);
  const snapshots = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_SNAPSHOTS);
  items[key] = snapshots;
  const identityKeys = Object.keys(items).sort((left, right) => {
    const a = (items[left] || []).at(-1)?.date || "";
    const b = (items[right] || []).at(-1)?.date || "";
    return b.localeCompare(a);
  });
  for (const staleKey of identityKeys.slice(MAX_IDENTITIES)) delete items[staleKey];
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ contract: CONTRACT, items }));
  } catch {
    return summary(snapshots, "WRITE_UNAVAILABLE");
  }
  return summary(snapshots, "SAVED");
}

export const tdccLocalObservationContract = Object.freeze({ storageKey: STORAGE_KEY, contract: CONTRACT, sourceLevels: SOURCE_LEVELS });
