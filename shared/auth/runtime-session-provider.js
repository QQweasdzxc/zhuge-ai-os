/* Adapter from the validated legacy root session binding to Shared Platform.
 * Product modules never receive the raw session or this adapter. */
(function (global) {
  "use strict";

  function readExistingSession() {
    return typeof session === "undefined" ? null : session;
  }

  function createPlatform(options = {}) {
    if (!global.ZhugeSharedPlatform) throw new Error("ZhugeSharedPlatform is not available.");
    const policy = global.ZhugePlatformPolicy || { capabilities: [], policies: {} };
    const dataGateway = global.ZhugeSupabaseGateway?.createDataGateway?.() || null;
    const mfaService = global.ZhugeMfa?.createMfaService?.({ gateway: global.ZhugeSupabaseGateway, unlockDurationMs: 10 * 60 * 1000 }) || null;
    const readSecurityState = request => {
      const external = typeof options.readSecurityState === "function" ? options.readSecurityState(request) : null;
      if (external?.locked) return external;
      if (request?.moduleId !== "investment" || !mfaService) return external || { locked: false };
      const userId = typeof currentUserUuid === "function" ? currentUserUuid() : "";
      const unlock = mfaService.getUnlockState("investment", userId);
      return unlock.unlocked ? { locked: false, expiresAt: unlock.expiresAt } : { locked: true, reason: "investment_unlock_required" };
    };
    return global.ZhugeSharedPlatform.createSharedPlatform({
      readSession: readExistingSession,
      capabilities: policy.capabilities,
      policies: policy.policies,
      readSecurityState,
      dataGateway,
      mfaService
    });
  }

  global.ZhugeRuntimeSessionProvider = Object.freeze({ createPlatform });
})(window);
