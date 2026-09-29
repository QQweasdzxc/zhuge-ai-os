/* Root-owned Repository Bootstrap (TASK-004)
 *
 * Modules mount only after Session → Identity → Repository → Cloud are
 * resolved.  Each phase is observable and can fail explicitly.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeRepositoryBootstrap = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PHASES = Object.freeze(["session", "identity", "repository", "cloud", "module"]);

  function create(options = {}) {
    const timeoutMs = Math.max(100, Number(options.timeoutMs || 10000));
    let snapshot = Object.freeze({ phase: "idle", status: "idle", error: null });
    const listeners = new Set();
    function notify(next) { snapshot = Object.freeze(next); listeners.forEach(listener => listener(snapshot)); }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    async function phase(name, action) {
      if (!PHASES.includes(name)) throw new Error(`Unknown bootstrap phase: ${name}`);
      notify({ phase: name, status: "loading", error: null });
      const result = await Promise.race([
        Promise.resolve().then(() => action?.()),
        new Promise((_, reject) => setTimeout(() => { const e = new Error(`${name} 初始化逾時。`); e.code = "BOOTSTRAP_TIMEOUT"; reject(e); }, timeoutMs))
      ]);
      notify({ phase: name, status: "ready", error: null, result });
      return result;
    }
    async function run(actions = {}) {
      const results = {};
      try {
        for (const name of PHASES) results[name] = await phase(name, actions[name]);
        notify({ phase: "complete", status: "ready", error: null, results });
        return Object.freeze({ status: "ready", results });
      } catch (error) {
        notify({ phase: snapshot.phase, status: "error", error });
        error.bootstrap = snapshot;
        throw error;
      }
    }
    return Object.freeze({ run, phase, subscribe, getSnapshot: () => snapshot });
  }

  return Object.freeze({ PHASES, create });
});
