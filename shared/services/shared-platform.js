/* Shared Platform composition root.
 *
 * The root shell creates one platform instance from its already validated
 * session provider. Modules receive a redacted ModuleContext only.
 */
(function (root, factory) {
  const Session = root?.ZhugeSession
    || (typeof require === "function" ? require("../auth/session-service.js") : null);
  const Permissions = root?.ZhugePermissions
    || (typeof require === "function" ? require("../security/permission-service.js") : null);
  const Security = root?.ZhugeSecurity
    || (typeof require === "function" ? require("../security/security-gate.js") : null);
  const ModuleContext = root?.ZhugeModuleContext
    || (typeof require === "function" ? require("./module-context.js") : null);
  const Creator = root?.ZhugeCreatorResolver
    || (typeof require === "function" ? require("../identity/creator-resolver.js") : null);
  const api = factory(Session, Permissions, Security, ModuleContext, Creator);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSharedPlatform = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Session, Permissions, Security, ModuleContext, Creator) {
  "use strict";

  if (!Session || !Permissions || !Security || !ModuleContext) {
    throw new Error("Shared Platform dependencies must load before shared-platform.js.");
  }

  function createSharedPlatform(options = {}) {
    const sessionService = Session.createSessionService({
      readSession: options.readSession,
      subscribe: options.subscribeSession,
      now: options.now
    });
    const permissionService = Permissions.createPermissionService({
      capabilities: options.capabilities,
      readCapabilities: options.readCapabilities
    });
    const securityGate = Security.createSecurityGate({
      sessionService,
      permissionService,
      levels: options.levels,
      policies: options.policies,
      readSecurityState: options.readSecurityState
    });

    const dataGateway = options.dataGateway || null;
    const mfaService = options.mfaService || null;
    const creatorResolver = options.creatorResolver || (Creator?.create?.({
      dataGateway,
      readUserId: () => sessionService.getCurrentUserId()
    }) || null);

    function forModule(moduleId) {
      return ModuleContext.createModuleContext({ moduleId, sessionService, securityGate, dataGateway, mfaService, creatorResolver });
    }

    return Object.freeze({
      forModule,
      getSessionSnapshot: () => sessionService.getSnapshot(),
      getCurrentIdentity: () => sessionService.getCurrentIdentity()
    });
  }

  return Object.freeze({ createSharedPlatform });
});
