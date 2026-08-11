/* Central module security policy used by the Shared Platform composition root.
 * This implements the approved framework only; it does not start MFA. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugePlatformPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const capabilities = Object.freeze([
    "dashboard.view",
    "worklog.view",
    "investment.view"
  ]);

  const policies = Object.freeze({
    "dashboard.view": Object.freeze({ capability: "dashboard.view", requiredAal: "aal1" }),
    "worklog.view": Object.freeze({ capability: "worklog.view", requiredAal: "aal1" }),
    "investment.view": Object.freeze({ capability: "investment.view", requiredAal: "aal2" })
  });

  return Object.freeze({ capabilities, policies });
});
