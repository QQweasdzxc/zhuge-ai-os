/* Feature flags are opt-in and default to the currently shipped Foundation. */
(function (global) {
  const config = global.ZhugeFoundationConfig || {};
  config.features = Object.freeze({
    dashboardPortal: true,
    worklog: true,
    investment: false,
    travel: false,
    hr: false,
    knowledge: true
  });
  global.ZhugeFoundationConfig = config;
})(window);
