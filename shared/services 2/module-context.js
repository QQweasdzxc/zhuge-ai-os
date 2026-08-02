/* The only Shared Platform surface passed into a product module. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeModuleContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createModuleContext(options = {}) {
    const moduleId = String(options.moduleId || "").trim().toLowerCase();
    const sessionService = options.sessionService;
    const securityGate = options.securityGate;
    const dataGateway = options.dataGateway || null;
    const mfaService = options.mfaService || null;

    if (!moduleId) throw new TypeError("ModuleContext requires moduleId.");
    if (!sessionService || typeof sessionService.getSnapshot !== "function") {
      throw new TypeError("ModuleContext requires a Shared Session service.");
    }
    if (!securityGate || typeof securityGate.evaluate !== "function") {
      throw new TypeError("ModuleContext requires a Shared Security Gate.");
    }

    const identity = Object.freeze({
      getCurrent: () => sessionService.getCurrentIdentity(),
      getUserId: () => sessionService.getCurrentUserId()
    });
    const session = Object.freeze({
      getSnapshot: () => sessionService.getSnapshot(),
      subscribe: listener => sessionService.subscribe(listener)
    });
    const security = Object.freeze({
      can: (action = "view", detail = {}) => securityGate.evaluate({ moduleId, action, ...detail }).allowed,
      evaluate: (action = "view", detail = {}) => securityGate.evaluate({ moduleId, action, ...detail }),
      require: (action = "view", detail = {}) => securityGate.requireAccess({ moduleId, action, ...detail }),
      providers: () => mfaService?.providers?.() || Object.freeze({}),
      getUnlockState: () => mfaService?.getUnlockState?.(moduleId, sessionService.getCurrentUserId()) || Object.freeze({ unlocked: false, expiresAt: null, remainingMs: 0 }),
      prepareUnlock: () => {
        if (!mfaService?.prepare) throw new Error("Shared MFA Service 尚未載入。" );
        return mfaService.prepare();
      },
      enrollTotp: () => {
        if (!mfaService?.enroll) throw new Error("Shared MFA Service 尚未載入。" );
        return mfaService.enroll();
      },
      verifyUnlock: detail => {
        if (!mfaService?.verify) throw new Error("Shared MFA Service 尚未載入。" );
        return mfaService.verify({ moduleId, userId: sessionService.getCurrentUserId(), ...(detail || {}) });
      },
      lock: () => mfaService?.lock?.(moduleId, sessionService.getCurrentUserId())
    });

    const data = Object.freeze({
      select: (resource, query = "") => {
        if (!dataGateway || typeof dataGateway.select !== "function") throw new Error("Shared Data Gateway 尚未載入。" );
        return dataGateway.select(resource, query);
      }
    });

    return Object.freeze({ moduleId, identity, session, security, data });
  }

  return Object.freeze({ createModuleContext });
});
