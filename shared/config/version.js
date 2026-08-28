/* Product release identity. Keep this aligned with the repository version.json. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.version = Object.freeze({
    version: "0.9.0-alpha.9.13",
    build: "20260829-0536",
    foundation: "1.0",
    module: "Zhuge AI OS",
    moduleVersion: "0.9",
    modules: Object.freeze({ worklog: "0.9", investment: "0.2.0-sit.2" }),
    shared: "1.0",
    api: "v1"
  });
  global.ZhugeFoundationConfig = config;
})(window);
