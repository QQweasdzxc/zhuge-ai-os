/* Sprint 5.5 Foundation Freeze: pure route contract. */
(function (global) {
  const validWorkspaces = new Set(["dashboard", "worklog", "library", "sync", "management", "settings"]);
  const validViews = new Set(["center", "capture", "library", "libraryIntelligence", "sync", "settings"]);

  function normalize(workspace = "dashboard", view = "center") {
    const nextWorkspace = validWorkspaces.has(workspace) ? workspace : "dashboard";
    const nextView = validViews.has(view) ? view : "center";
    return { workspace: nextWorkspace, view: nextView };
  }

  function serialize(route = {}) {
    const value = normalize(route.workspace, route.view);
    return `${value.workspace}:${value.view}`;
  }

  function parse(value = "") {
    const [workspace = "dashboard", view = "center"] = String(value || "").split(":");
    return normalize(workspace, view);
  }

  function resolve(workspace, view) { return normalize(workspace, view); }

  global.AppRouter = Object.freeze({ normalize, serialize, parse, resolve, validWorkspaces, validViews });
})(window);
