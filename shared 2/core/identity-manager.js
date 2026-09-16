/* Compatibility facade. New modules receive identity through ModuleContext. */
(function (global) {
  if (!global.ZhugeIdentity) throw new Error("ZhugeIdentity must load before IdentityManager.");
  global.IdentityManager = Object.freeze({
    normalize: source => global.ZhugeIdentity.normalize(source),
    requireUserId: source => global.ZhugeIdentity.requireUserId(source)
  });
})(window);
