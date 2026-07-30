/* Sprint 5.5 Foundation Freeze: workspace contract. */
(function (global) {
  const normalize = (id = "dashboard") => ({
    id,
    kind: id === "dashboard" ? "dashboard" : "module",
    layout: id === "dashboard" ? "RootDashboardLayout" : "WorkspaceLayout"
  });
  global.ZhugeWorkspaces = Object.freeze({
    resolve: normalize,
    Dashboard: normalize("dashboard"),
    WorkLog: normalize("worklog"),
    Investment: normalize("investment"),
    HR: normalize("hr"),
    Travel: normalize("travel")
  });
})(window);
