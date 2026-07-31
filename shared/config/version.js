/* Product release identity. Keep this aligned with the repository version.json. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.version = Object.freeze({
    version: "0.9.0-alpha.8.4",
    build: "20260731-0833",
    foundation: "1.0",
    module: "WorkLog",
    moduleVersion: "0.9",
    shared: "1.0",
    api: "v1"
  });
  global.ZhugeFoundationConfig = config;
})(window);
