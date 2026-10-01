// P6.2 Knowledge API: stable public facade over the Knowledge Repository service.
// Consumers must use this API instead of reaching into Supabase tables directly.
(function initializeKnowledgeApi(global) {
  "use strict";

  function service() {
    if (!global.KnowledgeRepositoryService) throw new Error("Knowledge Repository Service 尚未載入");
    return global.KnowledgeRepositoryService;
  }

  const KnowledgeAPI = Object.freeze({
    version: "p6.2-foundation-v1",
    search(query = "", options = {}) {
      return service().search(query, options);
    },
    listSources(options = {}) {
      return service().listSources(options);
    },
    listUnits(options = {}) {
      return service().listUnits(options);
    },
    createReference(record = {}, source = {}) {
      return service().createReference(record, source);
    },
    resolveReference(reference) {
      return service().resolveReference(reference);
    },
    health() {
      return service().health();
    }
  });

  global.KnowledgeAPI = KnowledgeAPI;
})(globalThis);
