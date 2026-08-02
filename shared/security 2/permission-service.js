/* Capability evaluation for Zhuge AI OS modules. Permission checks are local
 * policy decisions; they never request OAuth scopes or start authentication. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugePermissions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeCapabilities(value) {
    if (value instanceof Set) return [...value];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.entries(value).filter(([, enabled]) => enabled === true).map(([name]) => name);
    }
    return [];
  }

  function createPermissionService(options = {}) {
    const readCapabilities = typeof options.readCapabilities === "function"
      ? options.readCapabilities
      : () => options.capabilities || [];

    function currentSet() {
      return new Set(normalizeCapabilities(readCapabilities()).map(String));
    }

    function can(capability) {
      return currentSet().has(String(capability || ""));
    }

    return Object.freeze({
      can,
      canAll: capabilities => normalizeCapabilities(capabilities).every(can),
      canAny: capabilities => normalizeCapabilities(capabilities).some(can),
      snapshot: () => Object.freeze([...currentSet()].sort())
    });
  }

  return Object.freeze({ createPermissionService });
});
