/* Navigation contract. Modules receive routes from the root router and do not
 * mount a second Dashboard. */
(function (global) {
  function moduleRoute(module, path = "") {
    return Object.freeze({ module: String(module || "dashboard"), path: String(path || "") });
  }

  global.NavigationManager = Object.freeze({ moduleRoute });
})(window);
