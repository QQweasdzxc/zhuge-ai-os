/* Zhuge AI OS Foundation v1.0: application shell contract.
 *
 * This file is intentionally a small, side-effect-free contract. The
 * validated WorkLog runtime remains the owner of its current DOM and event
 * wiring. New modules may use this model when they are mounted by the root
 * application shell.
 */
(function (global) {
  const SHELL_REGIONS = Object.freeze([
    "topBar",
    "sidebar",
    "notification",
    "avatar",
    "theme",
    "breadcrumb"
  ]);

  function createContext({ identity = null, module = "dashboard", route = "" } = {}) {
    return Object.freeze({ identity, module, route, regions: SHELL_REGIONS });
  }

  global.ZhugeAppShell = Object.freeze({
    regions: SHELL_REGIONS,
    createContext
  });
})(window);
