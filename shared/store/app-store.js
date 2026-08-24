/* Store adapter for new modules. WorkLog continues to use the validated
 * AppState bindings while this compatibility facade is adopted incrementally. */
(function (global) {
  function snapshot() {
    return typeof AppState !== "undefined" && typeof AppState.snapshot === "function"
      ? AppState.snapshot()
      : {};
  }

  global.ZhugeAppStore = Object.freeze({ snapshot });
})(window);
