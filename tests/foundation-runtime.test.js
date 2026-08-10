const test = require("node:test");
const assert = require("node:assert/strict");

const Storage = require("../shared/storage/storage-migration.js");
const DataResult = require("../shared/api/data-result.js");
const IdentityHealth = require("../shared/identity/identity-health.js");
const SessionLifecycle = require("../shared/auth/session-lifecycle.js");
const Bootstrap = require("../shared/core/repository-bootstrap.js");
const SyncQueue = require("../shared/api/sync-queue.js");

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), key: index => [...map.keys()][index] || null, get length() { return map.size; }, values: () => Object.fromEntries(map) };
}

test("Storage migration is versioned and never clears unrelated keys", () => {
  const storage = memoryStorage({ "zhuge.preference": "dark", "legacy.unrelated": "keep" });
  const result = Storage.run({ storage, targetVersion: 2, allowedPrefixes: ["zhuge."], migrations: {
    1: ({ storage: adapter, allowedPrefixes }) => Storage.migrateLegacyKey({ storage, from: "zhuge.old", to: "zhuge.new", allowedPrefixes }),
    2: ({ storage: adapter }) => adapter.set("zhuge.migrated", "1")
  } });
  assert.deepEqual(result.applied, [1, 2]);
  assert.equal(storage.getItem("legacy.unrelated"), "keep");
  assert.equal(storage.getItem("zhuge_storage_schema_version"), "2");
});

test("Data Result distinguishes empty from failure and unauthorized", () => {
  assert.equal(DataResult.fromRows([]).state, "empty");
  assert.equal(DataResult.fromRows([{ id: 1 }]).state, "success");
  assert.equal(DataResult.fromError({ status: 401 }).state, "unauthorized");
  assert.equal(DataResult.fromError({ code: "OFFLINE" }).state, "offline");
});

test("Identity Health rejects mismatched UUIDs without mutating data", () => {
  const healthy = IdentityHealth.inspect({ identity: { id: "a", userId: "a", isAuthenticated: true }, session: { user_id: "a" } });
  assert.equal(healthy.healthy, true);
  const mismatch = IdentityHealth.inspect({ identity: { id: "a", userId: "a", isAuthenticated: true }, session: { user_id: "b" } });
  assert.equal(mismatch.reason, "identity_mismatch");
  assert.throws(() => IdentityHealth.assertHealthy(mismatch), error => error.code === "IDENTITY_MISMATCH");
});

test("Session Lifecycle performs one refresh and one retry for 401", async () => {
  let current = { access_token: "expired", expires_at: 1 };
  let refreshes = 0;
  let requests = 0;
  const service = SessionLifecycle.create({ now: () => 1000, readSession: () => current, refreshSession: async () => { refreshes += 1; current = { access_token: "fresh", expires_at: 100000 }; return current; }, clearSession: () => { current = null; } });
  const response = await service.request(async () => { requests += 1; return requests === 1 ? { status: 401 } : { status: 200 }; });
  assert.equal(response.status, 200);
  assert.equal(refreshes, 1);
  assert.equal(requests, 2);
});

test("Repository Bootstrap exposes phases and fails explicitly", async () => {
  const phases = [];
  const boot = Bootstrap.create({ timeoutMs: 500 });
  boot.subscribe(snapshot => phases.push(snapshot.phase + ":" + snapshot.status));
  const result = await boot.run({ session: () => "session", identity: () => "identity", repository: () => "repository", cloud: () => "cloud", module: () => "module" });
  assert.equal(result.status, "ready");
  assert.ok(phases.includes("complete:ready"));
});

test("Sync Queue deduplicates operations and retries transient failures", async () => {
  let attempts = 0;
  const queue = SyncQueue.create({ backoffMs: 0, maxRetries: 2, execute: async item => { attempts += 1; if (attempts < 2) throw new Error("transient"); return item; } });
  assert.equal(queue.enqueue({ idempotencyKey: "op-1", payload: { value: 1 } }), true);
  assert.equal(queue.enqueue({ idempotencyKey: "op-1", payload: { value: 1 } }), false);
  const result = await queue.flush();
  assert.equal(result.status, "synced");
  assert.equal(attempts, 2);
  assert.equal(queue.pending().length, 0);
});
