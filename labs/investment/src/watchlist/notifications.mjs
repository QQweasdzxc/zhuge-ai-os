const CONTRACT = "zhuge-watchlist-notification-v1";
const FREQUENCIES = new Set(["IMMEDIATE", "DAILY", "WEEKLY"]);
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const list = value => Array.isArray(value) ? value : [];

export function normalizeWatchlistNotificationSettings(value = {}) {
  const frequency = FREQUENCIES.has(text(value.frequency, 16).toUpperCase()) ? text(value.frequency, 16).toUpperCase() : "DAILY";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value.timeLocal, 5)) ? text(value.timeLocal, 5) : "08:30";
  const timezone = text(value.timezone, 80) || "Asia/Taipei";
  return Object.freeze({
    contract: CONTRACT,
    enabled: value.enabled === true,
    frequency,
    timeLocal: time,
    timezone,
    includeNewsCandidates: value.includeNewsCandidates !== false,
    requireSourceUrl: true,
    requireExactWatchlistIdentity: true,
    deliveryPreference: ["email", "push"].includes(text(value.deliveryPreference, 12)) ? text(value.deliveryPreference, 12) : "email",
    deliveryAddress: "",
  });
}

export function buildWatchlistNotificationSchedule(settings = {}) {
  const normalized = normalizeWatchlistNotificationSettings(settings);
  const [hour, minute] = normalized.timeLocal.split(":").map(Number);
  const cadence = normalized.frequency === "IMMEDIATE" ? "EVENT_TRIGGERED"
    : normalized.frequency === "WEEKLY" ? "WEEKLY" : "DAILY";
  return Object.freeze({
    contract: CONTRACT,
    enabled: normalized.enabled,
    cadence,
    timezone: normalized.timezone,
    localHour: hour,
    localMinute: minute,
    requiresServerScheduler: true,
    writesCanonicalWatchlist: false,
    note: "此為排程合約；實際執行需由受控 server scheduler 呼叫，瀏覽器不會在背景假裝定時寄送。",
  });
}

export function buildWatchlistNotificationDigest(events = [], settings = {}, { now = new Date().toISOString() } = {}) {
  const normalized = normalizeWatchlistNotificationSettings(settings);
  const sourceEvents = list(events).filter(item => item?.classification === "candidate_provider_search_result"
    && /^[A-Z]{2}$/.test(text(item.market, 8))
    && /^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(text(item.symbol, 24))
    && /^https:\/\//i.test(text(item.sourceUrl, 1000))
    && text(item.title, 300));
  const unique = new Map();
  for (const item of sourceEvents) {
    const key = `${text(item.market, 8)}:${text(item.symbol, 24)}|${text(item.sourceUrl, 1000)}|${text(item.observedAt, 40)}`;
    if (!unique.has(key)) unique.set(key, Object.freeze({
      market: text(item.market, 8), symbol: text(item.symbol, 24), name: text(item.name, 180),
      title: text(item.title, 300), summary: text(item.summary, 500), source: text(item.source, 120),
      sourceUrl: text(item.sourceUrl, 1000), observedAt: text(item.observedAt, 40),
      freshness: text(item.freshness, 24) || "unknown", stale: item.stale === true,
      classification: "candidate_provider_search_result",
    }));
  }
  const items = normalized.enabled && normalized.includeNewsCandidates ? [...unique.values()] : [];
  const stableIds = items.map(item => `${item.market}:${item.symbol}:${item.observedAt}:${item.sourceUrl}`).sort();
  return Object.freeze({
    contract: CONTRACT,
    status: !normalized.enabled ? "DISABLED" : items.length ? "READY" : "EMPTY",
    generatedAt: text(now, 40),
    schedule: buildWatchlistNotificationSchedule(normalized),
    itemCount: items.length,
    items: Object.freeze(items),
    digestKey: stableIds.length ? `${CONTRACT}:${stableIds.join("|")}` : null,
    requiresHumanReview: items.length > 0,
    deliveryStatus: "SECRET_REQUIRED",
    note: "事件為精確標的命中的來源候選，寄送前仍須保留原文連結；未將候選宣稱為已確認重大訊息。",
  });
}

/** Server delivery adapter seam. No token, address, or outbound request is accepted from the browser. */
export function createWatchlistNotificationDelivery({ send = null, authorize = async () => false } = {}) {
  return Object.freeze({
    async deliver(digest) {
      if (digest?.contract !== CONTRACT) return Object.freeze({ status: "CONTRACT_INVALID", sent: false });
      if (!(await authorize())) return Object.freeze({ status: "ACCESS_REQUIRED", sent: false });
      if (digest.status !== "READY" || !digest.itemCount) return Object.freeze({ status: digest.status, sent: false });
      if (typeof send !== "function") return Object.freeze({ status: "SECRET_REQUIRED", sent: false, provider: "AIOS notification delivery adapter" });
      const result = await send(Object.freeze({ contract: CONTRACT, digestKey: digest.digestKey, items: digest.items }));
      return Object.freeze({ status: result?.sent === true ? "SENT" : "FAILED", sent: result?.sent === true, provider: text(result?.provider, 120) });
    },
  });
}

export const watchlistNotificationContract = Object.freeze({ id: CONTRACT, frequencies: Object.freeze([...FREQUENCIES]) });
