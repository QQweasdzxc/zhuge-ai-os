/* Compatibility facade. It creates redacted read-only session adapters and
 * never reads AppState, browser storage, or Supabase directly. */
(function (global) {
  if (!global.ZhugeSession) throw new Error("ZhugeSession must load before SessionManager.");
  global.SessionManager = Object.freeze({
    create: options => global.ZhugeSession.createSessionService(options),
    read: service => service?.getSnapshot?.() || global.ZhugeSession.EMPTY_SESSION
  });
})(window);
