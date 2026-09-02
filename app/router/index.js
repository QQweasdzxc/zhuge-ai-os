/* Zhuge AI OS root router contract.
 * The root shell owns application-level destinations; modules own their
 * internal pages and may depend on shared/* only.
 */
(function (global) {
  const routes = Object.freeze({
    dashboard: "app/dashboard/",
    worklog: "modules/worklog/",
    investment: "modules/investment/",
    leisure: "modules/leisure/"
  });

  function resolve(name = "dashboard") {
    return routes[name] || routes.dashboard;
  }

  function href(name = "dashboard") {
    return `../../${resolve(name)}`;
  }

  global.ZhugeRootRouter = Object.freeze({ routes, resolve, href });
})(window);
