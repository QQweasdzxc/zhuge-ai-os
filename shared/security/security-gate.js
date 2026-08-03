/* Zhuge AI OS Shared Security Gate
 *
 * Centralizes module level, session, assurance, lock, and capability checks.
 * It returns a decision only; MFA/OAuth challenges remain root responsibilities.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSecurity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SECURITY_LEVELS = Object.freeze({
    dashboard: 1,
    worklog: 2,
    investment: 3,
    hr: 4
  });

  const AAL_WEIGHT = Object.freeze({ aal0: 0, aal1: 1, aal2: 2 });

  function decision(allowed, code, detail = {}) {
    return Object.freeze({ allowed, code, ...detail });
  }

  function createSecurityGate(options = {}) {
    const sessionService = options.sessionService;
    const permissionService = options.permissionService || null;
    const requestedLevels = options.levels || {};
    for (const [moduleId, baseline] of Object.entries(SECURITY_LEVELS)) {
      if (requestedLevels[moduleId] !== undefined && Number(requestedLevels[moduleId]) !== baseline) {
        throw new TypeError(`Canonical security level cannot be overridden: ${moduleId}`);
      }
    }
    const levels = Object.freeze({ ...SECURITY_LEVELS, ...requestedLevels });
    const policies = Object.freeze({ ...(options.policies || {}) });
    const readSecurityState = typeof options.readSecurityState === "function"
      ? options.readSecurityState
      : () => ({ locked: false });

    if (!sessionService || typeof sessionService.getSnapshot !== "function") {
      throw new TypeError("SecurityGate requires a Shared Session service.");
    }

    function evaluate(request = {}) {
      const moduleId = String(request.moduleId || "").trim().toLowerCase();
      const action = String(request.action || "view").trim().toLowerCase();
      const level = levels[moduleId];
      const policy = policies[`${moduleId}.${action}`] || policies[moduleId] || {};

      if (!level) return decision(false, "MODULE_NOT_REGISTERED", { moduleId, action });

      const snapshot = sessionService.getSnapshot();
      if (!snapshot.isAuthenticated) {
        return decision(false, snapshot.isExpired ? "SESSION_EXPIRED" : "SESSION_REQUIRED", { moduleId, action, level });
      }

      const requiredAal = String(request.requiredAal || policy.requiredAal || "aal1").toLowerCase();
      if ((AAL_WEIGHT[snapshot.aal] || 0) < (AAL_WEIGHT[requiredAal] || 1)) {
        return decision(false, "STEP_UP_REQUIRED", {
          moduleId,
          action,
          level,
          currentAal: snapshot.aal,
          requiredAal
        });
      }

      const securityState = readSecurityState({ moduleId, action, level }) || {};
      if (securityState.locked) {
        return decision(false, "MODULE_LOCKED", {
          moduleId,
          action,
          level,
          reason: String(securityState.reason || "locked")
        });
      }

      const capability = String(request.capability || policy.capability || "").trim();
      if (capability && (!permissionService || !permissionService.can(capability))) {
        return decision(false, "CAPABILITY_REQUIRED", { moduleId, action, level, capability, requiredAal });
      }

      return decision(true, "ALLOWED", {
        moduleId,
        action,
        level,
        currentAal: snapshot.aal,
        requiredAal,
        capability: capability || null
      });
    }

    function requireAccess(request = {}) {
      const result = evaluate(request);
      if (result.allowed) return result;
      const error = new Error(`Shared Security Gate denied access: ${result.code}`);
      error.name = "SharedSecurityError";
      error.code = result.code;
      error.decision = result;
      throw error;
    }

    return Object.freeze({ evaluate, requireAccess, levels });
  }

  return Object.freeze({ SECURITY_LEVELS, createSecurityGate });
});
