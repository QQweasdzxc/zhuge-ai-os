import assert from "node:assert/strict";
import test from "node:test";
import { recordTdccLocalObservation, tdccLocalObservationContract } from "../src/domain/tdcc-local-observations.mjs";

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) { assert.equal(key, tdccLocalObservationContract.storageKey); return value; },
    setItem(key, next) { assert.equal(key, tdccLocalObservationContract.storageKey); value = next; },
    read() { return value; },
  };
}

function evidence(date, overrides = {}) {
  return {
    provider: "TDCC",
    dataTimestamp: date,
    fetchedAt: `${date}T12:00:00.000Z`,
    data: [
      { band: "第 13 級", percent: 10 },
      { band: "第 14 級", percent: 15 },
      { band: "第 15 級", percent: 25 },
      { band: "第 16 級差異數", percent: null },
      { band: "第 17 級合計", percent: 100 },
    ],
    ...overrides,
  };
}

test("TDCC observation stores dated public source levels locally and waits for two source dates", () => {
  const storage = memoryStorage();
  const first = recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02"), storage });
  assert.equal(first.status, "INSUFFICIENT_HISTORY");
  assert.equal(first.storageStatus, "SAVED");
  assert.equal(first.currentTopThreeSourceLevelsPct, 50);
  assert.equal(first.changePercentagePoints, null);
  assert.equal(first.observedSnapshots, 1);

  const stored = JSON.parse(storage.read());
  assert.equal(stored.contract, "zhuge-tdcc-local-observations-v1");
  assert.deepEqual(Object.keys(stored.items), ["TWSE:2330"]);
  assert.doesNotMatch(storage.read(), /auth_user|owner_uuid|portfolio_id|account_id/i);
  assert.doesNotMatch(storage.read(), /第 16 級差異數|第 17 級合計/);
});

test("TDCC history compares latest distinct source dates and replaces repeated date reads", () => {
  const storage = memoryStorage();
  const firstDate = recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02"), storage });
  const repeatedDate = recordTdccLocalObservation({
    symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02", { data: evidence("2026-10-02").data.map(row => row.band === "第 15 級" ? { ...row, percent: 26 } : row) }), storage,
  });
  assert.equal(repeatedDate.observedSnapshots, 1);
  assert.equal(repeatedDate.currentTopThreeSourceLevelsPct, 51);

  const secondDate = recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-09", { data: evidence("2026-10-09").data.map(row => row.band === "第 15 級" ? { ...row, percent: 26.5 } : row) }), storage });
  assert.equal(firstDate.status, "INSUFFICIENT_HISTORY");
  assert.equal(secondDate.status, "AVAILABLE");
  assert.equal(secondDate.previousDate, "2026-10-02");
  assert.equal(secondDate.currentDate, "2026-10-09");
  assert.equal(secondDate.currentTopThreeSourceLevelsPct, 51.5);
  assert.equal(secondDate.changePercentagePoints, 0.5);
  assert.equal(secondDate.observedSnapshots, 2);
});

test("TDCC observations are separated by listing venue and do not merge same-symbol histories", () => {
  const storage = memoryStorage();
  recordTdccLocalObservation({ symbol: "6488", venue: "TWSE", evidence: evidence("2026-10-02"), storage });
  const tpex = recordTdccLocalObservation({ symbol: "6488", venue: "TPEX", evidence: evidence("2026-10-09"), storage });
  assert.equal(tpex.status, "INSUFFICIENT_HISTORY");
  assert.equal(tpex.observedSnapshots, 1);
  assert.deepEqual(Object.keys(JSON.parse(storage.read()).items).sort(), ["TPEX:6488", "TWSE:6488"]);
});

test("TDCC observation rejects wrong source, bad dates, incomplete levels, and impossible shares", () => {
  const storage = memoryStorage();
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02", { provider: "OTHER" }), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-99-99"), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-02-30"), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02", { data: evidence("2026-10-02").data.filter(row => row.band !== "第 14 級") }), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02", { data: [...evidence("2026-10-02").data, { band: "第 13 級", percent: 1 }] }), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02", { data: evidence("2026-10-02").data.map(row => row.band === "第 13 級" ? { ...row, percent: 101 } : row) }), storage }).storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(storage.read(), null);
});

test("TDCC observation fails closed when browser storage is unavailable", () => {
  const storage = { getItem() { throw new Error("storage disabled"); }, setItem() {} };
  const result = recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02"), storage });
  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.storageStatus, "INVALID_OR_UNAVAILABLE");
  assert.equal(result.currentTopThreeSourceLevelsPct, 50);
  assert.match(result.note, /無法保存跨次觀測/);
});

test("invalid venue and identity are not stored", () => {
  const storage = memoryStorage();
  const result = recordTdccLocalObservation({ symbol: "<script>", venue: "UNKNOWN", evidence: evidence("2026-10-02"), storage });
  assert.equal(result.storageStatus, "NOT_RECORDED_SOURCE_INCOMPLETE");
  assert.equal(storage.read(), null);
});

test("malformed unrelated local histories are ignored without crashing observation", () => {
  const storage = memoryStorage(JSON.stringify({
    contract: "zhuge-tdcc-local-observations-v1",
    items: { "TPEX:6488": { invalid: true }, "garbage": ["private text"] },
  }));
  const result = recordTdccLocalObservation({ symbol: "2330", venue: "TWSE", evidence: evidence("2026-10-02"), storage });
  assert.equal(result.currentTopThreeSourceLevelsPct, 50);
  assert.deepEqual(Object.keys(JSON.parse(storage.read()).items), ["TWSE:2330"]);
});
