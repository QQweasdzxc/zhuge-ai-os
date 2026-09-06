/* Sprint 5.5 Foundation Freeze: small, observable render boundary.
 * This module deliberately preserves the existing markup and bind functions.
 * It only makes the distinction between root replacement and local updates
 * explicit, and keeps a bounded trace for regression diagnostics.
 */
(function (global) {
  const trace = [];
  const maxTrace = 200;
  let active = false;

  function record(kind, reason, status = "complete") {
    const entry = {
      kind,
      reason: String(reason || "unspecified"),
      status,
      at: new Date().toISOString()
    };
    trace.push(entry);
    if (trace.length > maxTrace) trace.splice(0, trace.length - maxTrace);
    global.__ZHUGE_RENDER_TRACE = trace.slice();
    return entry;
  }

  function full(reason, updater) {
    if (typeof updater !== "function") return undefined;
    if (active) {
      record("full", reason, "coalesced");
      return updater();
    }
    active = true;
    record("full", reason, "start");
    try { return updater(); }
    finally { active = false; record("full", reason, "complete"); }
  }

  function partial(reason, updater) {
    if (typeof updater !== "function") return undefined;
    record("partial", reason, "start");
    try { return updater(); }
    finally { record("partial", reason, "complete"); }
  }

  function resetTrace() {
    trace.length = 0;
    global.__ZHUGE_RENDER_TRACE = [];
  }

  function snapshot() { return trace.slice(); }

  global.RenderEngine = Object.freeze({ full, partial, resetTrace, snapshot });
  global.__ZHUGE_RENDER_TRACE = [];
})(window);
