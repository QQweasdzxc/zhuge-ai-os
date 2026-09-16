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
    const templatePolicy = global.ZhugeTemplateAdoptionPolicy?.createService?.({ dataGateway }) || null;
    const mfaService = global.ZhugeMfa?.createMfaService?.({
      gateway: global.ZhugeSupabaseGateway,
      dataGateway,
      unlockDurationMs: 10 * 60 * 1000
    }) || null;
    const readSecurityState = request => {
      const external = typeof options.readSecurityState === "function" ? options.readSecurityState(request) : null;
      if (external?.locked) return external;
      const moduleId = String(request?.moduleId || "").trim().toLowerCase();
      if (!["investment", "ai-board"].includes(moduleId) || !mfaService) return external || { locked: false };
      const userId = typeof currentUserUuid === "function" ? currentUserUuid() : "";
      if (!mfaService.isModuleRequired?.(moduleId, userId)) return { locked: false, bypassed: true, bypassMfa: true, reason: `${moduleId}_mfa_bypassed` };
      const unlock = mfaService.getUnlockState(moduleId, userId);
      return unlock.unlocked ? { locked: false, expiresAt: unlock.expiresAt } : { locked: true, reason: `${moduleId}_unlock_required` };
    };
    return global.ZhugeSharedPlatform.createSharedPlatform({
      readSession: readExistingSession,
      capabilities: policy.capabilities,
      policies: policy.policies,
      readSecurityState,
      dataGateway,
      mfaService,
      templatePolicy
    });
  }

  global.ZhugeRuntimeSessionProvider = Object.freeze({ createPlatform });
})(window);
