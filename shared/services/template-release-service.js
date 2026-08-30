(function (root, factory) {
  "use strict";

  const api = factory(root);
  if (root) root.ZhugeModulePublishService = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  /*
   * Shared Module Publish / Update Framework.
   *
   * The service is module-agnostic. A module supplies its identity and its
   * consumer ids; the persistent Cloud contract records publication and each
   * consumer acknowledges adoption after it has actually loaded the release.
   */
  const cache = new Map();
  const pendingReads = new Map();
  const pendingAdoptions = new Map();

  function text(value) {
    return value == null ? "" : String(value);
  }

  function normalizeModuleId(value) {
    return text(value).trim().toLowerCase() || "c";
  }

  function normalizeConsumerId(value) {
    const id = text(value).trim().toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-");
    if (id === "aiboard") return "ai-board";
    return id || "unknown";
  }

  function normalizeConsumerIds(values) {
    const list = Array.isArray(values) ? values : [];
    return Array.from(new Set(list.map(normalizeConsumerId).filter(id => id !== "unknown")));
  }

  function compareSourceIdentity(loaded, published) {
    const loadedCommit = text(loaded?.sourceCommit || loaded?.commit).trim().toLowerCase();
    const loadedFingerprint = text(loaded?.sourceFingerprint || loaded?.fingerprint).trim().toLowerCase();
    const publishedCommit = text(published?.sourceCommit || published?.commit).trim().toLowerCase();
    const publishedFingerprint = text(published?.sourceFingerprint || published?.fingerprint).trim().toLowerCase();
    if (!loadedCommit || !loadedFingerprint || !publishedCommit || !publishedFingerprint) {
      return { status: "unknown", matches: false };
    }
    const matches = loadedCommit === publishedCommit && loadedFingerprint === publishedFingerprint;
    return { status: matches ? "matched" : "mismatch", matches };
  }

  function getGateway() {
    const gatewayApi = root && root.ZhugeSupabaseGateway;
    if (!gatewayApi || typeof gatewayApi.createDataGateway !== "function") {
      throw new Error("Module publish service is not available before Supabase bootstrap.");
    }
    return gatewayApi.createDataGateway();
  }

  function normalizeAdoption(value, fallbackRelease) {
    const adoption = value && typeof value === "object" ? value : {};
    const moduleVersion = text(
      adoption.module_version || adoption.moduleVersion || adoption.template_version || adoption.templateVersion || fallbackRelease.publishedVersion
    );
    const build = text(adoption.build || fallbackRelease.publishedBuild);
    const status = text(adoption.status || "published_pending_reload").toLowerCase();
    return {
      status: status || "published_pending_reload",
      moduleVersion,
      templateVersion: moduleVersion,
      build,
      publishedAt: adoption.published_at || adoption.publishedAt || fallbackRelease.publishedAt || null,
      adoptedAt: adoption.adopted_at || adoption.adoptedAt || null,
      adoptedBy: text(adoption.adopted_by || adoption.adoptedBy),
      identityMatches: moduleVersion === fallbackRelease.publishedVersion && build === fallbackRelease.publishedBuild,
    };
  }

  function normalize(payload, moduleId) {
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || typeof row !== "object") return null;

    const consumers = row.consumer_adoptions || row.consumerAdoptions || row.consumers || {};
    const release = {
      schemaVersion: Number(row.schema_version || row.schemaVersion || 1),
      moduleId: normalizeModuleId(row.module_id || row.moduleId || row.template_id || row.templateId || moduleId),
      developmentVersion: text(row.development_version || row.developmentVersion || row.published_version || row.publishedVersion),
      developmentBuild: text(row.development_build || row.developmentBuild || row.published_build || row.publishedBuild),
      developmentSourceCommit: text(row.development_source_commit || row.developmentSourceCommit || row.source_commit || row.sourceCommit),
      developmentSourceFingerprint: text(row.development_source_fingerprint || row.developmentSourceFingerprint || row.source_fingerprint || row.sourceFingerprint),
      publishedVersion: text(row.published_version || row.publishedVersion || row.module_version || row.moduleVersion || row.template_version),
      publishedBuild: text(row.published_build || row.publishedBuild || row.build),
      moduleVersion: text(row.module_version || row.moduleVersion || row.published_version),
      templateVersion: text(row.template_version || row.templateVersion || row.module_version || row.published_version),
      build: text(row.build || row.published_build || row.publishedBuild),
      sourceCommit: text(row.source_commit || row.sourceCommit),
      sourceFingerprint: text(row.source_fingerprint || row.sourceFingerprint),
      publishedAt: row.published_at || row.publishedAt || null,
      publishedBy: text(row.published_by || row.publishedBy),
      persistent: true,
      source: "cloud",
      consumers: {},
    };

    Object.keys(consumers).forEach(function (rawConsumerId) {
      const consumerId = normalizeConsumerId(rawConsumerId);
      if (consumerId !== "unknown") release.consumers[consumerId] = normalizeAdoption(consumers[rawConsumerId], release);
    });
    return release;
  }

  function validateIdentity(identity) {
    const input = identity || {};
    const developmentVersion = text(input.developmentVersion || input.version || input.publishedVersion).trim();
    const developmentBuild = text(input.developmentBuild || input.build || input.publishedBuild).trim();
    const developmentCommit = text(input.developmentSourceCommit || input.sourceCommit || input.commit).trim();
    const developmentFingerprint = text(input.developmentSourceFingerprint || input.sourceFingerprint || input.fingerprint).trim();
    const version = text(input.publishedVersion || input.version || developmentVersion).trim();
    const build = text(input.publishedBuild || input.build || developmentBuild).trim();
    const commit = text(input.sourceCommit || input.commit || developmentCommit).trim();
    const fingerprint = text(input.sourceFingerprint || input.fingerprint || developmentFingerprint).trim();
    if (!developmentVersion || !developmentBuild || !developmentCommit || !developmentFingerprint || !version || !build || !commit || !fingerprint) {
      throw new Error("Current module identity is incomplete; publish was not sent.");
    }
    if (!/^\d{8}-\d{4}$/.test(build)) throw new Error("Module build identity is invalid.");
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("Module source commit is invalid.");
    if (!/^[0-9a-f]{64}$/i.test(fingerprint)) throw new Error("Module source fingerprint is invalid.");
    if (!/^\d{8}-\d{4}$/.test(developmentBuild)) throw new Error("Development module build identity is invalid.");
    if (!/^[0-9a-f]{40}$/i.test(developmentCommit)) throw new Error("Development module source commit is invalid.");
    if (!/^[0-9a-f]{64}$/i.test(developmentFingerprint)) throw new Error("Development module source fingerprint is invalid.");
    return {
      version,
      build,
      commit: commit.toLowerCase(),
      fingerprint: fingerprint.toLowerCase(),
      developmentVersion,
      developmentBuild,
      developmentCommit: developmentCommit.toLowerCase(),
      developmentFingerprint: developmentFingerprint.toLowerCase(),
    };
  }

  function dispatch(name, detail) {
    if (!root || !root.document) return;
    let event;
    if (typeof root.CustomEvent === "function") {
      event = new root.CustomEvent(name, { detail });
    } else {
      event = root.document.createEvent("CustomEvent");
      event.initCustomEvent(name, false, false, detail);
    }
    root.document.dispatchEvent(event);
  }

  async function read(moduleId, options) {
    const id = normalizeModuleId(moduleId);
    const force = Boolean(options && options.force);
    if (!force && cache.has(id)) return cache.get(id);
    if (!force && pendingReads.has(id)) return pendingReads.get(id);

    const request = getGateway()
      .rpc("get_published_module_release", { p_module_id: id })
      .then(function (payload) {
        const release = normalize(payload, id);
        cache.set(id, release);
        return release;
      })
      .finally(function () {
        pendingReads.delete(id);
      });
    pendingReads.set(id, request);
    return request;
  }

  async function publish(options) {
    const input = options || {};
    const moduleId = normalizeModuleId(input.moduleId || input.templateId);
    const identity = validateIdentity(input);
    const consumerIds = normalizeConsumerIds(input.consumerIds || input.consumers);
    if (!consumerIds.length) throw new Error("At least one module consumer is required to publish.");
    const payload = await getGateway().rpc("publish_module_release", {
      p_module_id: moduleId,
      p_published_version: identity.version,
      p_published_build: identity.build,
      p_source_commit: identity.commit,
      p_source_fingerprint: identity.fingerprint,
      p_consumer_ids: consumerIds,
      p_development_version: identity.developmentVersion,
      p_development_build: identity.developmentBuild,
      p_development_source_commit: identity.developmentCommit,
      p_development_source_fingerprint: identity.developmentFingerprint,
    });
    const release = normalize(payload, moduleId);
    if (!release) throw new Error("Publish RPC returned no persistent module release state.");
    cache.set(moduleId, release);
    dispatch("zhuge-module-release-updated", { moduleId, release });
    return release;
  }

  async function adopt(options) {
    const input = options || {};
    const moduleId = normalizeModuleId(input.moduleId || input.templateId);
    const consumerId = normalizeConsumerId(input.consumerId);
    const release = input.release || cache.get(moduleId);
    const version = text(input.publishedVersion || release?.publishedVersion).trim();
    const build = text(input.publishedBuild || release?.publishedBuild).trim();
    if (!version || !build || consumerId === "unknown") return null;
    const key = `${moduleId}:${consumerId}:${version}:${build}`;
    if (pendingAdoptions.has(key)) return pendingAdoptions.get(key);
    const request = getGateway()
      .rpc("record_module_adoption", {
        p_module_id: moduleId,
        p_consumer_id: consumerId,
        p_published_version: version,
        p_published_build: build,
      })
      .then(function (payload) {
        const updated = normalize(payload, moduleId);
        if (updated) {
          cache.set(moduleId, updated);
          dispatch("zhuge-module-adoption-updated", { moduleId, consumerId, release: updated });
          dispatch("zhuge-module-release-updated", { moduleId, release: updated });
        }
        return updated;
      })
      .finally(function () {
        pendingAdoptions.delete(key);
      });
    pendingAdoptions.set(key, request);
    return request;
  }

  function invalidate(moduleId) {
    if (moduleId) cache.delete(normalizeModuleId(moduleId));
    else cache.clear();
  }

  function getDevelopmentIdentity(moduleId) {
    const id = normalizeModuleId(moduleId);
    const registry = root && root.ZhugeModuleDevelopmentIdentity;
    const registered = registry && typeof registry.getSnapshot === "function" ? registry.getSnapshot(id) : null;
    const releaseApi = root && root.ZhugeMotherTemplateRelease;
    const snapshot = id === "c" && releaseApi && typeof releaseApi.getSnapshot === "function" ? releaseApi.getSnapshot() : {};
    const product =
      releaseApi && id === "c" && typeof releaseApi.currentProductIdentity === "function"
        ? releaseApi.currentProductIdentity()
        : (root && root.ZhugeFoundationConfig && root.ZhugeFoundationConfig.version) || {};
    return {
      moduleId: id,
      developmentVersion: text(registered?.developmentVersion || snapshot.developmentVersion || product.version),
      developmentBuild: text(registered?.developmentBuild || snapshot.developmentBuild || product.build),
      developmentSourceCommit: text(registered?.sourceCommit || snapshot.sourceCommit || product.commit),
      developmentSourceFingerprint: text(registered?.sourceFingerprint || snapshot.sourceFingerprint || product.sourceFingerprint),
      version: text(registered?.developmentVersion || snapshot.developmentVersion || product.version),
      build: text(registered?.developmentBuild || snapshot.developmentBuild || product.build),
      publishedVersion: text(registered?.developmentVersion || snapshot.developmentVersion || product.version),
      publishedBuild: text(registered?.developmentBuild || snapshot.developmentBuild || product.build),
      sourceCommit: text(registered?.sourceCommit || snapshot.sourceCommit || product.commit),
      sourceFingerprint: text(registered?.sourceFingerprint || snapshot.sourceFingerprint || product.sourceFingerprint),
    };
  }

  function forConsumer(release, consumerId) {
    const id = normalizeConsumerId(consumerId);
    if (!release) {
      return {
        moduleId: "",
        consumerId: id,
        status: "unpublished",
        publishedVersion: "",
        publishedBuild: "",
        moduleVersion: "",
        build: "",
        identityMatches: false,
        adoption: null,
      };
    }
    const adoption = release.consumers && release.consumers[id] ? release.consumers[id] : null;
    const identityMatches = Boolean(adoption && adoption.identityMatches !== false);
    let status = "not_adopted";
    if (adoption && !identityMatches) status = "stale";
    else if (adoption) status = adoption.status || "published_pending_reload";
    return Object.assign({}, release, {
      consumerId: id,
      status,
      identityMatches,
      adoption,
    });
  }

  return Object.freeze({
    read,
    publish,
    adopt,
    invalidate,
    normalize,
    normalizeConsumerId,
    normalizeConsumerIds,
    compareSourceIdentity,
    getDevelopmentIdentity,
    forConsumer,
  });
});
