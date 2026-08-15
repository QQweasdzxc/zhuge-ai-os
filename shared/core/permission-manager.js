/* Compatibility facade. New modules use ModuleContext.security. */
(function (global) {
  if (!global.ZhugePermissions) throw new Error("ZhugePermissions must load before PermissionManager.");
  global.PermissionManager = Object.freeze({
    create: options => global.ZhugePermissions.createPermissionService(options),
    can: (service, capability) => Boolean(service?.can?.(capability))
  });
})(window);
