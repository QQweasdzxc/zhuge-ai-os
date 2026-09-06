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

  const MODULE_ID = "c";

  function normalizeConsumerEntry(entry = {}) {
    const id = String(entry.id || entry.consumerId || "").trim();
    if (!id) return null;
    const label = String(entry.label || entry.name || entry.taskCodePrefix || id).trim() || id;
    return { id, label };
  }

  function mergeConsumerEntries(entries = []) {
    const byId = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const normalized = normalizeConsumerEntry(entry);
      if (!normalized) continue;
      const existing = byId.get(normalized.id);
      byId.set(normalized.id, existing ? { ...existing, ...normalized } : normalized);
    }
    return Array.from(byId.values());
  }

  function releaseConsumerEntries(release) {
    return Object.keys(release?.consumers || {}).map(id => ({ id }));
  }

  function consumerLabelMap(entries = []) {
    return Object.fromEntries((Array.isArray(entries) ? entries : [])
      .map(normalizeConsumerEntry)
      .filter(Boolean)
      .map(entry => [entry.id, entry.label]));
  }

  function publishedReleaseLabel() {
    const release = root?.ZhugeMotherTemplateRelease?.forConsumer?.("c");
    if (!release?.identityMatches) return "";
    const version = release.publishedVersion || release.templateVersion;
    const build = release.publishedBuild || release.build;
    return version && build ? ` · Published C ${escapeHtml(version)} · Build ${escapeHtml(build)}` : "";
  }

  function developmentIdentity() {
    const releaseApi = root?.ZhugeMotherTemplateRelease;
    const snapshot = releaseApi?.getSnapshot?.() || {};
    const product = releaseApi?.currentProductIdentity?.() || root?.ZhugeFoundationConfig?.version || {};
    return {
      version: String(snapshot.developmentVersion || product.version || ""),
      build: String(snapshot.developmentBuild || product.build || ""),
      sourceCommit: String(snapshot.sourceCommit || product.commit || ""),
      sourceFingerprint: String(snapshot.sourceFingerprint || product.sourceFingerprint || ""),
    };
  }

  function sourceIntegrityLabel(development, published, service) {
    if (!published) return "尚未發布";
    const comparison = service?.compareSourceIdentity?.(development, published);
    if (comparison?.status === "matched") return "完整性已核對";
    if (comparison?.status === "mismatch") return "程式碼來源不一致";
    return "來源身份待核對";
  }

  function formatPublishedAt(value) {
    if (!value) return "尚未發布";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  }

  function consumerStatus(release, consumerId) {
    const adoption = release?.consumers?.[consumerId];
    if (!release || !adoption) return "尚未發布／等待套用";
    if (adoption.identityMatches === false) return "版本不一致";
    if (adoption.status === "adopted") return "已採用";
    if (adoption.status === "failed") return "套用失敗";
    return "已發布／等待載入新版";
  }

  function publishProgressModel(release, development, service, busy = false, options = {}) {
    const consumerOnly = options.consumerOnly === true;
    const consumerEntries = consumerOnly
      ? [normalizeConsumerEntry({
        id: options.consumerId,
        label: options.consumerLabel || "本看板",
      })].filter(Boolean)
      : (Array.isArray(options.consumerEntries) && options.consumerEntries.length
        ? options.consumerEntries.map(normalizeConsumerEntry).filter(Boolean)
        : Array.isArray(options.consumerIds) && options.consumerIds.length
          ? options.consumerIds.map(id => normalizeConsumerEntry({ id })).filter(Boolean)
          : mergeConsumerEntries(releaseConsumerEntries(release)));
    const consumerIds = consumerEntries.map(entry => entry.id);
    const labels = {
      ...consumerLabelMap(mergeConsumerEntries()),
      ...consumerLabelMap(options.consumerLabels ? Object.entries(options.consumerLabels).map(([id, label]) => ({ id, label })) : []),
      ...consumerLabelMap(consumerEntries),
    };

    const stages = [{
      id: "published",
      label: "Published C",
      complete: Boolean(release),
      state: release ? "complete" : busy ? "active" : "pending",
      status: release ? "已建立" : busy ? "等待 Cloud 回應" : "尚未發布",
    }];

    consumerIds.forEach(consumerId => {
      const adoption = release?.consumers?.[consumerId];
      const status = consumerStatus(release, consumerId);
      const complete = Boolean(adoption?.status === "adopted" && adoption.identityMatches !== false);
      const error = status === "版本不一致" || status === "套用失敗";
      stages.push({
        id: consumerId,
        label: labels[consumerId] || consumerId,
        complete,
        state: complete ? "complete" : error ? "error" : release ? "waiting" : "pending",
        status,
      });
    });

    const integrity = sourceIntegrityLabel(development, release, service);
    stages.push({
      id: "integrity",
      label: "來源完整性",
      complete: integrity === "完整性已核對",
      state: integrity === "程式碼來源不一致" ? "error" : integrity === "完整性已核對" ? "complete" : release ? "waiting" : "pending",
      status: integrity,
    });

    const completed = stages.filter(stage => stage.complete).length;
    const total = stages.length;
    const hasError = stages.some(stage => stage.state === "error");
    const indeterminate = Boolean(busy);
    let summary = "尚未發布";
    if (indeterminate) summary = "正在等待 Cloud 回應…";
    else if (release && hasError) summary = "發布未完全完成";
    else if (release && completed === total) summary = "發布流程已完成";
    else if (release) summary = `已確認 ${completed}/${total} 步驟 · 等待 Consumer 載入`;

    return {
      stages,
      completed,
      total,
      percent: indeterminate ? null : Math.round((completed / total) * 100),
      indeterminate,
      summary,
      ariaValueText: indeterminate
        ? "發布進度處理中，正在等待 Cloud 回應"
        : `發布進度 ${completed}/${total} 步驟，${summary}`,
    };
  }

  function consumerProgressMarkup(progress) {
    const count = progress.indeterminate ? "處理中" : `${progress.completed}/${progress.total}`;
    const steps = progress.stages.map(stage => `<li class="c-template-release-step is-${escapeHtml(stage.state)}" data-module-publish-step="${escapeHtml(stage.id)}">
          <span class="c-template-release-step-dot" aria-hidden="true"></span>
          <span class="c-template-release-step-copy"><strong>${escapeHtml(stage.label)}</strong><small>${escapeHtml(stage.status)}</small></span>
        </li>`).join("");
    const fillStyle = progress.percent == null ? "" : ` style="width:${progress.percent}%"`;
    return `<div class="c-template-release-progress-header">
        <span class="c-template-release-progress-kicker">PUBLISH PIPELINE</span>
        <strong data-module-publish-progress-count>${escapeHtml(count)}</strong>
        <span data-module-publish-progress-summary>${escapeHtml(progress.summary)}</span>
      </div>
      <div class="c-template-release-progress-track" aria-hidden="true"><span class="c-template-release-progress-fill"${fillStyle}></span><span class="c-template-release-progress-scan"></span></div>
      <ol class="c-template-release-steps" aria-label="模組發布步驟">${steps}</ol>`;
  }

  function hasPendingDevelopment(release) {
    if (!release) return true;
    const development = developmentIdentity();
    return (
      release.publishedVersion !== development.version ||
      release.publishedBuild !== development.build ||
      (development.sourceFingerprint && release.sourceFingerprint !== development.sourceFingerprint)
    );
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
    if (target.__zhugeModulePublishMount?.destroy) target.__zhugeModulePublishMount.destroy();

    const title = escapeHtml(options.title || "C 唯一看板母版");
    const description = escapeHtml(options.description || "MDTK canonical Cloud · 完整套用 Shared Board / Card / Drawer 操作");
    const consumerOnly = options.consumerOnly === true;
    const consumerId = String(options.consumerId || "c").trim() || "c";
    const consumerLabel = String(options.consumerLabel || (consumerOnly ? "本看板" : "C 母版"));
    const state = {
      release: null,
      hydrating: false,
      publishing: false,
      adopting: false,
      feedback: "",
      error: "",
      adoptionError: "",
      registryError: "",
      consumerEntries: consumerOnly
        ? [normalizeConsumerEntry({ id: consumerId, label: consumerLabel })].filter(Boolean)
        : [],
    };
    const service = root?.ZhugeModulePublishService;

    async function hydrateConsumerRegistry() {
      if (consumerOnly) return;
      const listModuleConsumers = root?.ZhugeBoardReadService?.listModuleConsumers;
      if (typeof listModuleConsumers !== "function") {
        state.registryError = "Consumer Registry 尚未就緒";
        return;
      }
      try {
        const instances = await listModuleConsumers({ templateKey: MODULE_ID });
        state.consumerEntries = mergeConsumerEntries((Array.isArray(instances) ? instances : []).map(instance => ({
          id: instance.consumerId || instance.id,
          label: instance.consumerLabel || instance.name || instance.taskCodePrefix || instance.id,
        })));
        state.registryError = "";
      } catch (error) {
        state.registryError = error?.message || "Consumer 清單讀取失敗";
      }
    }

    function panelMarkup() {
      const development = developmentIdentity();
      const published = state.release;
      const currentPublished = published
        ? `${escapeHtml(published.publishedVersion)} · Build ${escapeHtml(published.publishedBuild)}`
        : "尚未發布";
      const pendingText = hasPendingDevelopment(published) ? "有待發布變更" : "目前已同步";
      const statusClass = hasPendingDevelopment(published) ? "is-pending" : "is-synced";
      const integrity = sourceIntegrityLabel(development, published, service);
      const feedback = state.error || state.adoptionError || state.registryError || state.feedback || (state.hydrating ? "正在讀取 Published C…" : "");
      const feedbackClass = state.error || state.adoptionError || state.registryError ? "is-error" : state.feedback ? "is-success" : "";
      const disabled = state.publishing || !service || (!consumerOnly && !state.consumerEntries.length) ? " disabled" : "";
      const currentConsumer = published?.consumers?.[consumerId];
      const consumerAdopted = currentConsumer?.status === "adopted" && currentConsumer.identityMatches !== false;
      const consumerAdoptionDisabled = !published || state.hydrating || state.adopting || consumerAdopted || !service ? " disabled" : "";
      const progress = publishProgressModel(published, development, service, state.publishing || state.hydrating, {
        consumerOnly,
        consumerId,
        consumerLabel,
        consumerEntries: state.consumerEntries,
      });
      const adoptionSummary = consumerOnly
        ? `${escapeHtml(consumerLabel)} ${consumerStatus(published, consumerId)}`
        : state.consumerEntries.length
          ? state.consumerEntries.map(entry => `${escapeHtml(entry.label)} ${consumerStatus(published, entry.id)}`).join(" · ")
          : "Consumer 狀態讀取中";
      const progressAttributes = [
        "data-module-publish-progress",
        `data-module-publish-completed="${progress.completed}"`,
        `data-module-publish-total="${progress.total}"`,
        progress.percent == null ? "" : `data-module-publish-percent="${progress.percent}"`,
        'role="progressbar"',
        'aria-valuemin="0"',
        'aria-valuemax="100"',
        progress.percent == null ? 'aria-busy="true"' : `aria-valuenow="${progress.percent}"`,
        `aria-valuetext="${escapeHtml(progress.ariaValueText)}"`,
      ].filter(Boolean).join(" ");
      return `<section class="c-template-motherboard-banner" data-c-operational-motherboard data-c-template-release-panel>
        <div class="c-template-release-heading"><span class="template-management-kicker">C OPERATIONAL MOTHERBOARD</span><strong>${title}</strong><span>${description}</span></div>
        <div class="c-template-release-details">
          <span>開發中 ${escapeHtml(development.version)} · Build ${escapeHtml(development.build)}</span>
          <span>Published C <b>${currentPublished}</b></span>
          <span class="c-template-release-state ${statusClass}">${pendingText}</span>
          <span>本次發布目標：${escapeHtml(development.version)} · Build ${escapeHtml(development.build)}</span>
          <span class="c-template-release-adoptions">${adoptionSummary}</span>
          <span>最後發布：${escapeHtml(formatPublishedAt(published?.publishedAt))}</span>
          <span>發布者：${escapeHtml(published?.publishedBy || "尚未發布")}</span>
          <span>完整性：${integrity}</span>
        </div>
        <div class="c-template-release-progress${progress.indeterminate ? " is-indeterminate" : ""}" ${progressAttributes} aria-label="模組發布進度">${consumerProgressMarkup(progress)}</div>
        <div class="c-template-release-actions">
          ${consumerOnly
            ? `<button type="button" class="c-template-publish-button c-template-adopt-button" data-module-adopt${consumerAdoptionDisabled}>${state.adopting ? "正在採用…" : consumerAdopted ? "已採用" : "採用新版 C 母版"}</button>`
            : `<button type="button" class="c-template-publish-button" data-module-publish${disabled}>🚀 發布更新</button>`}
          <span class="c-template-release-feedback ${feedbackClass}" data-c-template-release-feedback aria-live="polite">${escapeHtml(feedback)}</span>
        </div>
      </section>`;
    }

    function paint() {
      target.innerHTML = panelMarkup();
    }

    async function hydrate() {
      if (!service || state.hydrating || state.publishing) return;
      state.hydrating = true;
      state.error = "";
      state.adoptionError = "";
      state.registryError = "";
      paint();
      try {
        await hydrateConsumerRegistry();
        state.release = await service.read(MODULE_ID);
        if (!consumerOnly && state.release && typeof service.adopt === "function") {
          try {
            state.release = await service.adopt({ moduleId: MODULE_ID, consumerId, release: state.release }) || state.release;
          } catch (error) {
            state.adoptionError = error?.message || `${consumerLabel} 採用狀態尚待確認`;
          }
        }
        state.feedback = "";
      } catch (error) {
        state.error = error?.message || "Published C 讀取失敗";
      } finally {
        state.hydrating = false;
        paint();
      }
    }

    async function adoptConsumerRelease() {
      if (!consumerOnly || !service || state.adopting || !state.release) return;
      state.adopting = true;
      state.adoptionError = "";
      state.feedback = "正在採用新版 C 母版；等待 Cloud Read-back…";
      paint();
      try {
        const adopted = await service.adopt({ moduleId: MODULE_ID, consumerId, release: state.release });
        const current = service.forConsumer?.(adopted, consumerId);
        if (!adopted || (current && (current.status !== "adopted" || current.identityMatches === false))) {
          throw new Error("Cloud Read-back 未確認 Adoption Record；未顯示成功。");
        }
        state.release = adopted;
        state.feedback = `${consumerLabel} 已採用新版 C；Cloud Read-back PASS。`;
      } catch (error) {
        state.adoptionError = error?.message || `${consumerLabel} 採用失敗；未顯示成功。`;
        state.feedback = "";
      } finally {
        state.adopting = false;
        paint();
      }
    }

    async function publish() {
      if (consumerOnly || !service || state.publishing) return;
      const identity = service.getDevelopmentIdentity(MODULE_ID);
      const current = state.release
        ? `${state.release.publishedVersion} · Build ${state.release.publishedBuild}`
        : "尚未發布";
      const targetLabels = state.consumerEntries.map(entry => entry.label).join("、") || "目前已登錄 Consumer";
      const message = `發布模組 C 更新？\n\n目前正式版本：${current}\n本次發布版本：${identity.publishedVersion} · Build ${identity.publishedBuild}\n\n更新對象：${targetLabels}\nConsumer 自有資料不受影響。`;
      if (typeof root.confirm === "function" && !root.confirm(message)) return;
      state.publishing = true;
      state.error = "";
      state.adoptionError = "";
      state.feedback = "正在發布更新；先建立 Published C，再等待 Consumer 實際載入新版…";
      paint();
      try {
        state.release = await service.publish({
          ...identity,
          moduleId: MODULE_ID,
          consumerIds: state.consumerEntries.map(entry => entry.id),
        });
        if (typeof service.adopt === "function") {
          try {
            state.release = await service.adopt({ moduleId: MODULE_ID, consumerId: "c", release: state.release }) || state.release;
          } catch (error) {
            state.adoptionError = error?.message || "C 已發布，採用狀態尚待確認";
          }
        }
        state.feedback = "Published C 已更新；WorkTodo / AI Board 等待重新載入新版。";
      } catch (error) {
        state.error = error?.message || "發布失敗";
        state.feedback = "";
      } finally {
        state.publishing = false;
        paint();
      }
    }

    function onClick(event) {
      if (event.target.closest("[data-module-publish]")) publish();
      if (event.target.closest("[data-module-adopt]")) adoptConsumerRelease();
    }

    function onReleaseUpdated(event) {
      if (event.detail?.moduleId && event.detail.moduleId !== MODULE_ID) return;
      if (event.detail?.release) {
        state.release = event.detail.release;
        state.error = "";
        state.feedback = "Published C 狀態已更新；Consumer 狀態依實際載入結果顯示。";
        paint();
      }
    }

    function onAdoptionUpdated(event) {
      if (event.detail?.moduleId && event.detail.moduleId !== MODULE_ID) return;
      if (event.detail?.release) {
        state.release = event.detail.release;
        state.adoptionError = "";
        paint();
      }
    }

    function onSessionReady() {
      if (state.error) hydrate();
    }

    const mountState = {
      destroy() {
        target.removeEventListener("click", onClick);
        root?.document?.removeEventListener("zhuge-module-release-updated", onReleaseUpdated);
        root?.document?.removeEventListener("zhuge-module-adoption-updated", onAdoptionUpdated);
        root?.document?.removeEventListener("zhuge-template-adoption-updated", onSessionReady);
        if (target.__zhugeModulePublishMount === mountState) delete target.__zhugeModulePublishMount;
      },
    };
    target.__zhugeModulePublishMount = mountState;
    target.addEventListener("click", onClick);
    root?.document?.addEventListener("zhuge-module-release-updated", onReleaseUpdated);
    root?.document?.addEventListener("zhuge-module-adoption-updated", onAdoptionUpdated);
    root?.document?.addEventListener("zhuge-template-adoption-updated", onSessionReady);
    paint();
    hydrate();
    return target.querySelector("[data-c-operational-motherboard]");
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render(options);
    return target.querySelector("[data-golden-master]") || target.firstElementChild;
  }

  return Object.freeze({ neutralViewModel, render, mount, mountBanner, publishProgressModel });
});
