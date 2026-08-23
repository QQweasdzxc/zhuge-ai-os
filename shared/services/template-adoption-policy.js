/* Shared System Template adoption policy.
 *
 * A/B/C are canonical presentation frameworks.  This service only stores
 * which formal page adopts which framework; it never owns auth, MFA, RLS, or
 * domain data.  The initial UI exposes A (navigation) because that is the
 * current requested switch.  B and C remain registered here for future page
 * adoption without creating another template implementation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeTemplateAdoptionPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TEMPLATE_IDS = Object.freeze(["navigation", "workspace", "board"]);
  const TEMPLATES = Object.freeze({
    navigation: Object.freeze({ id: "navigation", code: "A", label: "導航欄", description: "只有導航欄" }),
    workspace: Object.freeze({ id: "workspace", code: "B", label: "工作區", description: "三欄工作區" }),
    board: Object.freeze({ id: "board", code: "C", label: "看板區", description: "只有看板區" })
  });

  const PAGE_REGISTRY = Object.freeze({
    dashboard: Object.freeze({ id: "dashboard", label: "Dashboard", supportedTemplates: Object.freeze(["navigation"]) }),
    worklog: Object.freeze({ id: "worklog", label: "WorkLog", supportedTemplates: Object.freeze(["navigation", "workspace"]) }),
    library: Object.freeze({ id: "library", label: "Knowledge", supportedTemplates: Object.freeze(["navigation", "workspace"]) }),
    sync: Object.freeze({ id: "sync", label: "控制台", supportedTemplates: Object.freeze(["navigation", "workspace"]) }),
    settings: Object.freeze({ id: "settings", label: "設定", supportedTemplates: Object.freeze(["navigation", "workspace"]) }),
    investment: Object.freeze({ id: "investment", label: "Investment", supportedTemplates: Object.freeze(["navigation", "workspace"]) }),
    "ai-board": Object.freeze({ id: "ai-board", label: "AI Board", supportedTemplates: Object.freeze(["navigation", "board"]) }),
    "tasks-new": Object.freeze({ id: "tasks-new", label: "工作待辦", supportedTemplates: Object.freeze(["navigation", "board"]) })
  });

  const DEFAULT_POLICY = Object.freeze({
    version: 1,
    pages: Object.freeze({})
  });

  function normalizeId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function pageDefinition(pageId) {
    return PAGE_REGISTRY[normalizeId(pageId)] || null;
  }

  function templateDefinition(templateId) {
    return TEMPLATES[normalizeId(templateId)] || null;
  }

  function normalizePages(value) {
    const pages = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.keys(PAGE_REGISTRY).reduce((result, pageId) => {
      const raw = pages[pageId];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
      const normalized = TEMPLATE_IDS.reduce((templates, templateId) => {
        if (typeof raw[templateId] === "boolean") templates[templateId] = raw[templateId];
        return templates;
      }, {});
      if (Object.keys(normalized).length) result[pageId] = Object.freeze(normalized);
      return result;
    }, {});
  }

  function normalizePolicy(payload, userId, status = "resolved", error = null) {
    const row = Array.isArray(payload) ? payload[0] : payload;
    const rawPolicy = row?.template_adoption || row?.templateAdoption || row?.policy || {};
    const pages = normalizePages(rawPolicy.pages || rawPolicy);
    return Object.freeze({
      userId: String(userId || ""),
      is_creator: row?.is_creator !== false,
      version: Number(rawPolicy.version || row?.version || 1),
      pages: Object.freeze(pages),
      status,
      error: error ? String(error?.message || error) : null
    });
  }

  function defaultPolicy(userId, isCreator = false, status = "default", error = null) {
    return Object.freeze({
      userId: String(userId || ""),
      is_creator: isCreator === true,
      version: DEFAULT_POLICY.version,
      pages: Object.freeze({}),
      status,
      error: error ? String(error?.message || error) : null
    });
  }

  function createService(options = {}) {
    const dataGateway = options.dataGateway || null;
    const policyCache = new Map();
    const pending = new Map();

    function getPolicy(userId = "") {
      return policyCache.get(String(userId || "")) || defaultPolicy(userId);
    }

    function isTemplateEnabled({ pageId, templateId, userId = "" } = {}) {
      const page = pageDefinition(pageId);
      const template = templateDefinition(templateId);
      if (!page || !template || !page.supportedTemplates.includes(template.id)) return false;
      return getPolicy(userId).pages?.[page.id]?.[template.id] === true;
    }

    async function load({ userId = "", isCreator = false, force = false } = {}) {
      const normalizedUserId = String(userId || "");
      if (!isCreator) {
        const policy = defaultPolicy(normalizedUserId, false, "non_creator");
        policyCache.set(normalizedUserId, policy);
        return policy;
      }
      if (!force && policyCache.get(normalizedUserId)?.status === "resolved") return policyCache.get(normalizedUserId);
      if (!force && pending.has(normalizedUserId)) return pending.get(normalizedUserId);
      const request = (async () => {
        try {
          if (!dataGateway || typeof dataGateway.rpc !== "function") throw new Error("Template Adoption Cloud RPC 尚未載入。");
          const payload = await dataGateway.rpc("get_creator_template_adoption_preferences", {});
          const policy = normalizePolicy(payload, normalizedUserId, "resolved");
          policyCache.set(normalizedUserId, policy);
          return policy;
        } catch (error) {
          const policy = defaultPolicy(normalizedUserId, true, "error", error);
          policyCache.set(normalizedUserId, policy);
          return policy;
        } finally {
          pending.delete(normalizedUserId);
        }
      })();
      pending.set(normalizedUserId, request);
      return request;
    }

    async function setEnabled({ pageId, templateId, userId = "", isCreator = false, enabled = false } = {}) {
      const page = pageDefinition(pageId);
      const template = templateDefinition(templateId);
      if (!page || !template || !page.supportedTemplates.includes(template.id)) throw new Error("不支援的系統模板套用設定。");
      if (!isCreator) {
        const error = new Error("只有 Creator 可以變更系統模板套用設定。");
        error.code = "CREATOR_CAPABILITY_REQUIRED";
        throw error;
      }
      if (!dataGateway || typeof dataGateway.rpc !== "function") throw new Error("Template Adoption Cloud RPC 尚未載入。");
      const normalizedUserId = String(userId || "");
      const value = enabled === true;
      await dataGateway.rpc("set_creator_template_adoption_preference", {
        p_page_id: page.id,
        p_template_id: template.id,
        p_enabled: value
      });
      const previous = getPolicy(normalizedUserId);
      const nextPages = { ...(previous.pages || {}) };
      nextPages[page.id] = { ...(nextPages[page.id] || {}), [template.id]: value };
      const next = Object.freeze({
        ...previous,
        userId: normalizedUserId,
        is_creator: true,
        pages: Object.freeze(nextPages),
        status: "resolved",
        error: null
      });
      policyCache.set(normalizedUserId, next);
      return next;
    }

    return Object.freeze({
      templates: TEMPLATES,
      pages: PAGE_REGISTRY,
      getPolicy,
      isTemplateEnabled,
      load,
      setEnabled
    });
  }

  return Object.freeze({
    TEMPLATE_IDS,
    TEMPLATES,
    PAGE_REGISTRY,
    DEFAULT_POLICY,
    createService,
    normalizePolicy
  });
});
