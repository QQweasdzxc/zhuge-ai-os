import test from "node:test";
import assert from "node:assert/strict";
import { buildWatchlistNotificationDigest, buildWatchlistNotificationSchedule, createWatchlistNotificationDelivery, normalizeWatchlistNotificationSettings } from "../src/watchlist/notifications.mjs";

const candidate = { market: "TW", symbol: "2330", name: "台積電", title: "官方公告候選", source: "MOPS", sourceUrl: "https://mops.twse.com.tw/notice/1", observedAt: "2026-10-07", freshness: "fresh", classification: "candidate_provider_search_result" };

test("notification settings and schedule preserve a timezone-bound cadence without pretending browser scheduling", () => {
  const settings = normalizeWatchlistNotificationSettings({ enabled: true, frequency: "WEEKLY", timeLocal: "07:45" });
  assert.equal(settings.frequency, "WEEKLY");
  assert.equal(settings.timezone, "Asia/Taipei");
  const schedule = buildWatchlistNotificationSchedule(settings);
  assert.equal(schedule.cadence, "WEEKLY");
  assert.equal(schedule.requiresServerScheduler, true);
  assert.equal(schedule.writesCanonicalWatchlist, false);
});

test("digest deduplicates exact source candidates and stays disabled by default", () => {
  assert.equal(buildWatchlistNotificationDigest([candidate]).status, "DISABLED");
  const result = buildWatchlistNotificationDigest([candidate, candidate, { ...candidate, sourceUrl: "javascript:alert(1)" }], { enabled: true });
  assert.equal(result.status, "READY");
  assert.equal(result.itemCount, 1);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.deliveryStatus, "SECRET_REQUIRED");
});

test("delivery adapter keeps authorization and external secret as distinct runtime outcomes", async () => {
  const digest = buildWatchlistNotificationDigest([candidate], { enabled: true });
  assert.equal((await createWatchlistNotificationDelivery().deliver(digest)).status, "ACCESS_REQUIRED");
  assert.equal((await createWatchlistNotificationDelivery({ authorize: async () => true }).deliver(digest)).status, "SECRET_REQUIRED");
  const sent = await createWatchlistNotificationDelivery({ authorize: async () => true, send: async payload => ({ sent: payload.items.length === 1, provider: "fixture" }) }).deliver(digest);
  assert.equal(sent.status, "SENT");
});
