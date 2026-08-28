/*
 * C Operational Motherboard host helper.
 *
 * The actual board data and actions are provided by the canonical Supabase
 * board service plus the Shared Golden Master runtime. This small helper keeps the
 * historical neutralViewModel/render/mount API available for catalog and
 * contract checks, but it does not create fixture cards or pretend to be a
 * Consumer domain.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeCanonicalCTemplatePreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function publishedReleaseLabel() {
    const release = root?.ZhugeMotherTemplateRelease?.forConsumer?.("c");
    if (!release?.identityMatches) return "";
    const version = release.publishedVersion || release.templateVersion;
    const build = release.publishedBuild || release.build;
    return version && build ? ` · Published C ${escapeHtml(version)} · Build ${escapeHtml(build)}` : "";
  }

  function neutralViewModel() {
    return {
      header: {
        title: "C 唯一看板母版",
        description: "Operational Shared Board · MDTK canonical Cloud 母版資料",
        identityHint: "C Operational Motherboard"
      },
      toolbar: {
        searchId: "cMotherboardSearch",
        searchLabel: "搜尋 MDTK 工作",
        searchPlaceholder: "搜尋 MDTK 工作、使用情境或工作區",
        disabled: false,
        filters: [],
        statusHtml: `<span class="golden-master-toolbar-status">MDTK canonical Cloud · C 母版測試資料${publishedReleaseLabel()}</span>`,
        legend: "共同看板操作由 C 母版提供；MDTK 僅供母版驗收。"
      },
      columns: [],
      drawer: null
    };
  }

  function render(options = {}) {
    const goldenMaster = options.goldenMaster || root?.ZhugeGoldenMaster;
    if (!goldenMaster?.render) return '<div class="board-empty">C 母版 Shared Runtime 尚未載入。</div>';
    const model = neutralViewModel();
    return goldenMaster.render({
      ...model,
      mode: "operational-motherboard",
      data: "c-mdtk-cloud",
      className: "c-motherboard-runtime",
      components: options.components || {}
    });
  }

  function mountBanner(target, options = {}) {
    if (!target) return null;
    const title = escapeHtml(options.title || "C 唯一看板母版");
    const description = escapeHtml(options.description || "MDTK canonical Cloud · 完整套用 Shared Board / Card / Drawer 操作") + publishedReleaseLabel();
    target.innerHTML = `<section class="c-template-motherboard-banner" data-c-operational-motherboard><div><span class="template-management-kicker">C OPERATIONAL MOTHERBOARD</span><strong>${title}</strong></div><span>${description}</span></section>`;
    return target.querySelector("[data-c-operational-motherboard]");
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render(options);
    return target.querySelector("[data-golden-master]") || target.firstElementChild;
  }

  return Object.freeze({ neutralViewModel, render, mount, mountBanner });
});
