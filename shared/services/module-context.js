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
    const creatorResolver = options.creatorResolver || null;

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
    const creator = Object.freeze({
      getSnapshot: () => creatorResolver?.getSnapshot?.() || Object.freeze({ status: "unknown", userId: "", is_creator: false, error: null }),
      isCreator: () => creatorResolver?.isCreator?.() === true,
      resolve: detail => creatorResolver?.resolve?.(detail) || Promise.resolve(Object.freeze({ status: "unknown", userId: "", is_creator: false, error: null }))
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
      getMfaPolicy: () => mfaService?.getPolicy?.(sessionService.getCurrentUserId()) || Object.freeze({ userId: "", is_creator: false, investment_mfa_required: true, ai_board_mfa_required: true, status: "default", error: null }),
      loadMfaPolicy: async ({ force = false } = {}) => {
        let userId = "";
        try { userId = sessionService.getCurrentUserId(); } catch { return Object.freeze({ userId, is_creator: false, investment_mfa_required: true, ai_board_mfa_required: true, status: "unknown", error: null }); }
        const creatorState = await creator.resolve();
        return mfaService?.loadPolicy?.({ userId, isCreator: creatorState.is_creator === true, force })
          || Object.freeze({ userId, is_creator: false, investment_mfa_required: true, ai_board_mfa_required: true, status: "default", error: null });
      },
      setMfaRequired: async (requiredOrDetail, maybeRequired) => {
        const userId = sessionService.getCurrentUserId();
        const creatorState = await creator.resolve();
        if (!mfaService?.setRequired) throw new Error("Shared MFA Settings Service 尚未載入。" );
        const detail = requiredOrDetail && typeof requiredOrDetail === "object"
          ? requiredOrDetail
          : { required: requiredOrDetail };
        return mfaService.setRequired({
          moduleId: detail.moduleId || moduleId,
          userId,
          isCreator: creatorState.is_creator === true,
          required: maybeRequired === undefined ? detail.required : maybeRequired
        });
      },
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

    return Object.freeze({ moduleId, identity, creator, session, security, data });
  }

  return Object.freeze({ createModuleContext });
});
