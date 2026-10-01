/* Non-secret environment metadata. Runtime credentials stay in the existing
 * app-config boundary and are not duplicated here. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.environment = Object.freeze({
    name: "production",
    locale: "zh-TW",
    timezone: "Asia/Taipei",
    repository: "zhuge-ai-os",
    appUrl: "https://qqweasdzxc.github.io/zhuge-ai-os/"
  });
  global.ZhugeFoundationConfig = config;
})(window);
