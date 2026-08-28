/* Canonical Template Management Center presentation.
 *
 * This component owns only the management presentation. Template capability,
 * adoption state, authorization and persistence remain owned by the existing
 * Template Adoption Registry/Service and Shared Navigation runtime.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeTemplateManagementCenter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const TEMPLATE_ORDER_FALLBACK = ["navigation", "workspace", "board"];
  let policyEventsBound = false;
  let refreshCallback = null;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[ch]));
  }

  function policyApi() {
    return root?.ZhugeTemplateAdoptionPolicy || null;
  }

  function runtimeSnapshot() {
    const runtime = root?.ZhugeTemplateAdoptionRuntime || null;
    const policy = runtime?.policy || null;
    const service = runtime?.service || null;
    const registry = policyApi();
    const templates = registry?.TEMPLATES || {};
    const pages = registry?.PAGE_REGISTRY || {};
    return {
      runtime,
      policy,
      service,
      templates,
      pages,
      userId: String(policy?.userId || ""),
      status: String(policy?.status || "loading"),
      isCreator: policy?.is_creator === true
    };
  }

  function templateOrder(templates = {}) {
    const registryOrder = policyApi()?.TEMPLATE_IDS;
    const ids = Array.isArray(registryOrder) && registryOrder.length ? registryOrder : TEMPLATE_ORDER_FALLBACK;
    return ids.map(id => templates[id]).filter(Boolean);
  }

  function isReady(snapshot) {
    return snapshot.status === "resolved" && Boolean(snapshot.service);
  }

  function enabledFor(snapshot, pageId, templateId) {
    if (!isReady(snapshot)) return false;
    return snapshot.service.isTemplateEnabled?.({
      pageId,
      templateId,
      userId: snapshot.userId
    }) === true;
  }

  function buildTemplateModel(snapshot = runtimeSnapshot()) {
    const ready = isReady(snapshot);
    return templateOrder(snapshot.templates).map(template => {
      const consumers = Object.values(snapshot.pages).filter(page => Array.isArray(page?.supportedTemplates) && page.supportedTemplates.includes(template.id));
      const rows = consumers.map(page => ({
        page,
        enabled: enabledFor(snapshot, page.id, template.id)
      }));
      return {
        template,
        consumers,
        rows,
        enabledCount: ready ? rows.filter(row => row.enabled).length : null
      };
    });
  }

  function statusMessage(snapshot) {
    if (snapshot.status === "loading") return "正在讀取 Supabase Cloud Adoption State…";
    if (snapshot.status === "error") return "設定讀取失敗；所有模板維持 OFF 安全預設。";
    if (!snapshot.isCreator) return "此區域僅 Creator 可修改；目前為唯讀狀態。";
    return "Capability 由 Registry 決定；Adoption 由 Supabase Cloud 決定。";
  }

  function adoptionLabel(snapshot, enabled) {
    if (!isReady(snapshot)) return "🟡 待讀取 Cloud 狀態";
    return enabled ? "🟢 已套用 (ON)" : "⚪ 未套用 (OFF)";
  }

  function publishedMotherRelease() {
    return root?.ZhugeMotherTemplateRelease?.getSnapshot?.() || null;
  }

  function releaseStatusMarkup() {
    const release = publishedMotherRelease();
    if (!release) {
      return `<div class="template-management-release" data-template-release-summary role="status"><strong>C 母版發布身份尚未載入</strong><span>請先載入 Published Template metadata，才能核對 Consumer 採用版本。</span></div>`;
    }
    const consumers = [
      ["c", "C 母版"],
      ["worktodo", "工作待辦"],
      ["ai-board", "AI Board"]
    ].map(([id, label]) => {
      const adoption = release.consumers?.[id];
      const version = adoption?.templateVersion || "—";
      const build = adoption?.build || "—";
      const state = adoption?.status === "adopted" && version === release.publishedVersion && build === release.publishedBuild ? "🟢 已採用" : "🟡 待核對";
      return `<span class="template-management-release-consumer"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(state)} · ${escapeHtml(version)} / ${escapeHtml(build)}</span></span>`;
    }).join("");
    return `<div class="template-management-release" data-template-release-summary role="status"><div><strong>C 母版已發布</strong><span>開發版：${escapeHtml(release.developmentVersion)} / ${escapeHtml(release.developmentBuild)} · 已發布版：${escapeHtml(release.publishedVersion)} / ${escapeHtml(release.publishedBuild)}</span></div><div class="template-management-release-consumers">${consumers}</div></div>`;
  }

  function renderConsumerRows(model, snapshot) {
    if (!model.rows.length) return `<div class="template-management-empty">目前沒有正式支援此 Template 的 Consumer。</div>`;
    const canModify = isReady(snapshot) && snapshot.isCreator;
    return `<div class="template-management-table" role="table" aria-label="${escapeHtml(model.template.label)} Consumer 清單"><div class="template-management-table-head" role="row"><span role="columnheader">頁面 (Consumer)</span><span role="columnheader">Capability</span><span role="columnheader">Adoption State</span><span role="columnheader">操作</span></div>${model.rows.map(({ page, enabled }) => `<div class="template-management-row" role="row" data-template-management-row="${escapeHtml(page.id)}-${escapeHtml(model.template.id)}"><span class="template-management-consumer" role="cell">${escapeHtml(page.label)}</span><span class="template-management-capability" role="cell">🟢 正式支援</span><span role="cell"><span class="template-management-adoption ${enabled ? "is-on" : "is-off"}" data-template-management-adoption>${adoptionLabel(snapshot, enabled)}</span></span><span role="cell"><label class="template-management-switch"><span class="sr-only">${escapeHtml(page.label)} 套用 ${escapeHtml(model.template.code)}｜${escapeHtml(model.template.label)}</span><input type="checkbox" data-template-management-switch data-page-id="${escapeHtml(page.id)}" data-template-id="${escapeHtml(model.template.id)}" ${enabled ? "checked" : ""} ${canModify ? "" : "disabled"}><span class="template-management-switch-track" aria-hidden="true"></span></label></span></div>`).join("")}</div>`;
  }

  function render(options = {}) {
    const snapshot = runtimeSnapshot();
    const models = buildTemplateModel(snapshot);
    const cards = models.map(model => {
      const template = model.template;
      const count = model.enabledCount == null ? "—" : `${model.enabledCount} 頁`;
      const supportCount = model.consumers.length;
      const panelId = `template-management-panel-${template.id}`;
      return `<section class="template-management-card" data-template-management-template="${escapeHtml(template.id)}"><button class="template-management-card-header" type="button" data-template-management-toggle aria-expanded="false" aria-controls="${escapeHtml(panelId)}"><span class="template-management-code" aria-hidden="true">${escapeHtml(template.code)}</span><span class="template-management-card-title"><strong>${escapeHtml(template.code)} 區｜${escapeHtml(template.label)}</strong><small>${escapeHtml(template.description)}</small></span><span class="template-management-card-summary"><strong>已套用 ${escapeHtml(count)}</strong><small>正式支援 ${supportCount} 頁</small></span><span class="template-management-card-chevron" aria-hidden="true">⌄</span></button><div class="template-management-card-body" id="${escapeHtml(panelId)}" data-template-management-panel hidden><div class="template-management-card-actions"><button class="btn2" type="button" data-template-management-preview data-template-id="${escapeHtml(template.id)}">查看模板</button></div>${renderConsumerRows(model, snapshot)}</div></section>`;
    }).join("");
    return `<section class="control-center-entry-group template-management-center" data-template-management-center><div class="template-management-heading"><div><span class="template-management-kicker">Creator Control／Template Adoption</span><h3>🧩 系統模板管理中心</h3><p class="muted">集中管理 A／B／C Template、正式 Consumer Capability 與 Cloud Adoption State。</p></div><span class="template-management-source">來源：Supabase Cloud Settings</span></div><div class="template-management-status" data-template-management-status role="status">${escapeHtml(statusMessage(snapshot))}</div>${releaseStatusMarkup()}<div class="template-management-cards">${cards || `<div class="template-management-empty">Template Registry 尚未載入。</div>`}</div></section>`;
  }

  async function reloadPolicy() {
    const runtime = root?.ZhugeTemplateAdoptionRuntime;
    if (!runtime?.service) throw new Error("Template Adoption Runtime 尚未準備完成。");
    if (root?.ZhugeSharedNavigation?.bootstrapTemplatePolicy) {
      return root.ZhugeSharedNavigation.bootstrapTemplatePolicy({ force: true });
    }
    return runtime.service.load({ userId: runtime.policy?.userId || "", isCreator: runtime.policy?.is_creator === true, force: true });
  }

  function ensurePolicyEvents(onUpdated) {
    refreshCallback = typeof onUpdated === "function" ? onUpdated : refreshCallback;
    if (policyEventsBound || !root?.document?.addEventListener) return;
    policyEventsBound = true;
    ["zhuge-template-adoption-ready", "zhuge-template-management-updated"].forEach(eventName => {
      root.document.addEventListener(eventName, () => refreshCallback?.());
    });
  }

  function bind(container, options = {}) {
    if (!container) return;
    ensurePolicyEvents(options.onUpdated);
    container.querySelectorAll("[data-template-management-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const panel = root.document?.getElementById(button.getAttribute("aria-controls"));
        if (!panel) return;
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", expanded ? "false" : "true");
        panel.hidden = expanded;
        button.querySelector(".template-management-card-chevron")?.replaceChildren(root.document.createTextNode(expanded ? "⌄" : "⌃"));
      });
    });
    container.querySelectorAll("[data-template-management-preview]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        options.onPreview?.(button.dataset.templateId || "");
      });
    });
    container.querySelectorAll("[data-template-management-switch]").forEach(input => {
      input.addEventListener("change", async event => {
        const control = event.currentTarget;
        const pageId = control.dataset.pageId;
        const templateId = control.dataset.templateId;
        const enabled = control.checked;
        const status = container.querySelector("[data-template-management-status]");
        control.disabled = true;
        try {
          const runtime = root?.ZhugeTemplateAdoptionRuntime;
          if (!runtime?.service || runtime.policy?.is_creator !== true) throw new Error("只有 Creator 可以變更系統模板套用設定。");
          await runtime.service.setEnabled({ pageId, templateId, userId: runtime.policy.userId, isCreator: true, enabled });
          const usesSharedPolicyBootstrap = Boolean(root?.ZhugeSharedNavigation?.bootstrapTemplatePolicy);
          await reloadPolicy();
          root?.ZhugeSharedNavigation?.autoMount?.();
          if (!usesSharedPolicyBootstrap) options.onUpdated?.();
        } catch (error) {
          control.checked = !enabled;
          control.disabled = false;
          if (status) status.textContent = error?.message || "模板套用設定寫入失敗，已維持原本狀態。";
        }
      });
    });
  }

  return Object.freeze({ render, bind, buildTemplateModel });
});
