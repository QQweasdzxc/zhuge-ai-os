/* Sprint 5.5 Foundation Freeze: shared service registry. */
(function (global) {
  function lookup(name) {
    // Existing services are classic-script lexical bindings rather than
    // window properties. Resolve them lazily without creating a second copy.
    if (name === "DataService" && typeof DataService !== "undefined") return DataService;
    if (name === "AuthService" && typeof getGoogleAuthUser === "function") return { getSession: getGoogleAuthUser };
    return global[name];
  }
  const lazy = name => (...args) => {
    const service = lookup(name);
    if (!service) return Promise.reject(new Error(`${name} is not available`));
    const method = args.shift();
    if (method && typeof service[method] === "function") return service[method](...args);
    return service;
  };
  global.ZhugeServices = Object.freeze({
    AuthService: lazy("AuthService"),
    SupabaseService: lazy("DataService"),
    ConversationService: lazy("DataService"),
    KnowledgeService: lazy("DataService"),
    TaskService: lazy("DataService"),
    PriorityEngine: global.PriorityEngine,
    ControlCenterService: lazy("DataService"),
    SettingsService: lazy("DataService")
  });
})(window);
