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
    return global.ZhugeSharedPlatform.createSharedPlatform({
      readSession: readExistingSession,
      capabilities: policy.capabilities,
      policies: policy.policies,
      readSecurityState: options.readSecurityState
    });
  }

  global.ZhugeRuntimeSessionProvider = Object.freeze({ createPlatform });
})(window);
