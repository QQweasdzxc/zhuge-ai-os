/* Supabase metadata adapter. It reads the existing runtime config instead of
 * duplicating credentials or creating a second client. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.supabase = Object.freeze({
    getRuntimeConfig() {
      return typeof AUTH_CONFIG === "undefined" ? null : AUTH_CONFIG;
    }
  });
  global.ZhugeFoundationConfig = config;
})(window);
