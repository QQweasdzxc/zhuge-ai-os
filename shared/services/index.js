/* Shared service registry. Implementations remain in their compatibility
 * directories until each service is migrated without changing behavior. */
(function (global) {
  function get(name) {
    const services = {
      auth: global.AuthService,
      googleDrive: global.GoogleDriveService,
      data: global.DataService,
      realtime: global.RealtimeService,
      knowledge: global.KnowledgeAPI
    };
    return services[name] || null;
  }

  global.ZhugeServices = Object.freeze({ get });
})(window);
