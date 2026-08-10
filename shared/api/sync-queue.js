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
    let flushing = false;

    function enqueue(operation = {}) {
      const idempotencyKey = String(operation.idempotencyKey || operation.clientId || "").trim();
      if (!idempotencyKey) throw new Error("Sync operation requires an idempotencyKey.");
      if (completed.has(idempotencyKey) || queue.some(item => item.idempotencyKey === idempotencyKey)) return false;
      queue.push({ ...operation, idempotencyKey, attempts: 0, queuedAt: now() });
      return true;
    }
    async function flush() {
      if (flushing) return { status: "busy", remaining: queue.length };
      flushing = true;
      const failed = [];
      try {
        while (queue.length) {
          const item = queue.shift();
          let delivered = false;
          while (!delivered && item.attempts <= maxRetries) {
            try {
              item.attempts += 1;
              await execute(Object.freeze({ ...item }));
              completed.add(item.idempotencyKey);
              delivered = true;
            } catch (error) {
              if (item.attempts > maxRetries) failed.push({ item, error });
              else if (backoffMs) await new Promise(resolve => setTimeout(resolve, backoffMs * item.attempts));
            }
          }
        }
      } finally { flushing = false; }
      failed.forEach(({ item }) => queue.push(item));
      return Object.freeze({ status: failed.length ? "degraded" : "synced", delivered: completed.size, failed: failed.length, remaining: queue.length });
    }
    return Object.freeze({ enqueue, flush, pending: () => queue.map(item => Object.freeze({ ...item })), has: key => queue.some(item => item.idempotencyKey === key), isFlushing: () => flushing });
  }

  return Object.freeze({ create });
});
