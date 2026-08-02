/* OAuth metadata only. The existing auth-service owns the login flow. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.oauth = Object.freeze({
    provider: "google",
    driveScope: "https://www.googleapis.com/auth/drive.readonly",
    userSelectionRequired: true,
    backgroundScan: false
  });
  global.ZhugeFoundationConfig = config;
})(window);
