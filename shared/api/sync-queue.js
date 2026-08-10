/* Cloud Sync Queue + Idempotency (TASK-006)
 *
 * This queue is an operational delivery mechanism.  Supabase remains the
 * source of truth; every mutation handler must enforce its own RLS/RPC rules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSyncQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(options = {}) {
    const execute = typeof options.execute === "function" ? options.execute : async item => item;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
    const backoffMs = Math.max(0, Number(options.backoffMs ?? 250));
    const queue = [];
    const completed = new Set();
    const conflicts = [];
    const failed = [];
    let flushing = false;

    function enqueue(operation = {}) {
      const idempotencyKey = String(operation.idempotencyKey || operation.clientId || "").trim();
      if (!idempotencyKey) throw new Error("Sync operation requires an idempotencyKey.");
      if (completed.has(idempotencyKey) || queue.some(item => item.idempotencyKey === idempotencyKey)) return false;
      queue.push({ ...operation, idempotencyKey, attempts: 0, queuedAt: now(), state: "pending" });
      return true;
    }
    async function flush() {
      if (flushing) return { status: "busy", remaining: queue.length };
      flushing = true;
      try {
        while (queue.length) {
          const item = queue.shift();
          let delivered = false;
          while (!delivered && item.attempts <= maxRetries) {
            try {
              item.attempts += 1;
              const result = await execute(Object.freeze({ ...item }));
              if (result?.conflict === true || result?.state === "conflict") {
                const conflict = { item: { ...item, state: "conflict" }, result, detectedAt: now() };
                conflicts.push(conflict);
                item.state = "conflict";
                delivered = true;
                continue;
              }
              completed.add(item.idempotencyKey);
              item.state = "synced";
              delivered = true;
            } catch (error) {
              if (error?.code === "CONFLICT" || error?.conflict === true) {
                conflicts.push({ item: { ...item, state: "conflict" }, error, detectedAt: now() });
                item.state = "conflict";
                delivered = true;
                continue;
              }
              if (item.attempts > maxRetries) failed.push({ item, error });
              else if (backoffMs) await new Promise(resolve => setTimeout(resolve, backoffMs * item.attempts));
            }
          }
        }
      } finally { flushing = false; }
      failed.forEach(({ item }) => { item.state = "failed"; queue.push(item); });
      return Object.freeze({ status: failed.length || conflicts.length ? "degraded" : "synced", delivered: completed.size, failed: failed.length, conflicts: conflicts.length, remaining: queue.length });
    }
    return Object.freeze({
      enqueue,
      flush,
      pending: () => queue.map(item => Object.freeze({ ...item })),
      failed: () => failed.map(entry => Object.freeze({ ...entry.item, error: entry.error })),
      conflicts: () => conflicts.map(entry => Object.freeze({ ...entry })),
      has: key => queue.some(item => item.idempotencyKey === key),
      isFlushing: () => flushing
    });
  }

  return Object.freeze({ create });
});
