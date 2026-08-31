/* Golden Master shared Board runtime: one Presentation/Interaction runtime for
 * AI Board and WorkTodo. Consumers inject scope data, permission, capability,
 * and callbacks; Cloud access remains behind the existing service boundary. */
(function (root) {
  "use strict";
  const defaultService = root.ZhugeBoardReadService;
  if (!defaultService) return;
  const state = { applicationScope: "ai_board", moduleId: "c", boardInstanceId: "", boardName: "", taskCodePrefix: "", boardIsTemplate: false, consumerId: "", service: defaultService, templateRelease: null, templateReleaseTimer: null, templateReleaseRefreshBound: false, templateAdoptionBusy: false, templateAdoptionError: "", templateParityReport: null, templateParityBusy: false, templateParityGuardBound: false, workspaces: [], tasks: [], principles: [], systemMaps: [], taskById: new Map(), workspaceById: new Map(), workTodoJournalByTask: new Map(), sharedActionContracts: new Map(), searchQuery: "", archiveSearch: "", archiveFilter: "all", stopRealtime: null, refreshPromise: null, realtimeTimer: null, boardView: "board", activeTaskId: "", pendingCreateWorkspaceId: "", taskChecklistWrites: new Set(), workspaceMenuDocumentBound: false, templateReleaseEventsBound: false };
  function moduleConsumerId(scope) {
    if (scope === "c") return state.consumerId || "c";
    if (scope === "worktodo") return "worktodo";
    return "ai-board";
  }
  function unpublishedModuleRelease(consumerId) {
    const releaseApi = root.ZhugeMotherTemplateRelease;
    const snapshot = releaseApi?.getSnapshot?.() || {};
    const product = releaseApi?.currentProductIdentity?.() || root.ZhugeFoundationConfig?.version || {};
    return {
      moduleId: state.moduleId,
      templateId: "c",
      consumerId,
      status: "unpublished",
      identityMatches: false,
      developmentVersion: String(snapshot.developmentVersion || product.version || ""),
      developmentBuild: String(snapshot.developmentBuild || product.build || ""),
      publishedVersion: "",
      publishedBuild: "",
      templateVersion: "",
      build: "",
    };
  }
  function loadedModuleSourceIdentity() {
    const snapshot = root.ZhugeMotherTemplateRelease?.getSnapshot?.() || {};
    return {
      sourceCommit: String(snapshot.sourceCommit || ""),
      sourceFingerprint: String(snapshot.sourceFingerprint || "")
    };
  }

  function releaseVersionLabel(version, build) {
    const normalizedVersion = String(version || "").trim();
    const normalizedBuild = String(build || "").trim();
    return normalizedVersion && normalizedBuild ? `${normalizedVersion} · Build ${normalizedBuild}` : "尚未記錄";
  }

  function moduleReleaseNoticeModel() {
    const release = state.templateRelease;
    const status = String(release?.status || "unavailable").trim().toLowerCase();
    const sourceIntegrity = String(document.body?.dataset?.templateSourceIntegrity || "unknown").trim().toLowerCase();
    if (state.applicationScope === "c" || !release?.publishedVersion || !release?.publishedBuild || status === "unpublished") {
      return { hidden: true };
    }
    const adoption = release.adoption || null;
    const currentVersion = adoption?.moduleVersion || adoption?.templateVersion || "";
    const currentBuild = adoption?.build || "";
    const integrityBlocked = sourceIntegrity === "mismatch";
    const adoptionFailed = Boolean(state.templateAdoptionError);
    const failed = status === "failed" || status === "error" || integrityBlocked || adoptionFailed;
    const adopted = status === "adopted" && release.identityMatches !== false && !integrityBlocked;
    if (adopted) return { hidden: true };
    return {
      hidden: false,
      state: failed ? "error" : "update",
      title: failed ? "C 母版更新暫停" : "C 母版有新版可採用",
      current: releaseVersionLabel(currentVersion, currentBuild),
      latest: releaseVersionLabel(release.publishedVersion, release.publishedBuild),
      detail: integrityBlocked
        ? "目前載入的程式碼來源與 Published C 不一致，先載入相符版本後才能採用。"
        : adoptionFailed || failed
          ? "Cloud Adoption 回報失敗；未顯示已套用，請重新整理後再試。"
          : "按下「採用新版 C 母版」後，系統會寫入 Cloud 並重新 Read-back。",
      buttonLabel: failed ? "目前無法採用" : state.templateAdoptionBusy ? "正在採用…" : "採用新版 C 母版",
      buttonDisabled: failed || state.templateAdoptionBusy,
    };
  }

  function ensureModuleReleaseNoticeHost() {
    const surface = document.querySelector("[data-golden-master-surface]");
    if (!surface) return null;
    let host = surface.querySelector("[data-module-release-notice-host]");
    if (!host) {
      host = document.createElement("div");
      host.dataset.moduleReleaseNoticeHost = "true";
      surface.insertBefore(host, surface.firstElementChild || null);
    }
    return host;
  }

  async function adoptCurrentModuleRelease() {
    const releaseService = root.ZhugeModulePublishService;
    const release = state.templateRelease;
    const consumerId = moduleConsumerId(state.applicationScope);
    if (state.applicationScope === "c" || !releaseService?.adopt || !release || state.templateAdoptionBusy) return;
    if (document.body?.dataset?.templateSourceIntegrity === "mismatch") {
      state.templateAdoptionError = "程式碼來源與 Published C 不一致，未執行採用。";
      renderModuleReleaseNotice();
      return;
    }
    state.templateAdoptionBusy = true;
    state.templateAdoptionError = "";
    renderModuleReleaseNotice();
    setBanner("正在採用新版 C 母版；等待 Cloud Read-back…", "loading");
    try {
      const adopted = await releaseService.adopt({ moduleId: state.moduleId, consumerId, release });
      if (!adopted) throw new Error("Cloud Read-back 未回傳 Adoption Record；未顯示成功。");
      applyModuleReleaseIdentity(adopted, { remote: true });
      if (state.templateRelease?.status !== "adopted" || state.templateRelease.identityMatches === false) {
        throw new Error("Cloud Read-back 未確認目前 Consumer 已採用 Published C；未顯示成功。");
      }
      await refreshBoard({ quiet: true });
      runTemplateParityCheck("adopt", { silent: true });
      setBanner(`${esc(workItemLabel())} 已採用 C 母版 ${esc(releaseVersionLabel(state.templateRelease.publishedVersion, state.templateRelease.publishedBuild))}；Cloud Read-back PASS。`, "success");
    } catch (error) {
      state.templateAdoptionError = error?.message || "C 母版採用失敗；未顯示成功。";
      setBanner("C 母版採用失敗：" + esc(state.templateAdoptionError), "error");
    } finally {
      state.templateAdoptionBusy = false;
      renderModuleReleaseNotice();
    }
  }

  function renderModuleReleaseNotice() {
    const host = ensureModuleReleaseNoticeHost();
    if (!host) return;
    const model = moduleReleaseNoticeModel();
    const errorMessage = state.templateAdoptionError ? ` ${esc(state.templateAdoptionError)}` : "";
    if (model.hidden) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    host.innerHTML = `<section class="template-release-notice is-${esc(model.state)}" data-module-release-notice data-state="${esc(model.state)}" role="status" aria-live="polite">
      <span class="template-release-notice-icon" aria-hidden="true">${model.state === "error" ? "!" : "↻"}</span>
      <div class="template-release-notice-copy"><strong>${esc(model.title)}</strong><span>目前採用：${esc(model.current)}　·　最新 Published C：${esc(model.latest)}</span><small>${esc(model.detail)}${errorMessage}</small></div>
      <button class="btn template-release-notice-action" type="button" data-template-adopt${model.buttonDisabled ? " disabled aria-disabled=\"true\"" : ""}>${esc(model.buttonLabel)}</button>
    </section>`;
    host.querySelector("[data-template-adopt]")?.addEventListener("click", adoptCurrentModuleRelease, { once: true });
  }

  function applyModuleReleaseIdentity(releaseOverride, options = {}) {
    const consumerId = moduleConsumerId(state.applicationScope);
    const releaseApi = root.ZhugeMotherTemplateRelease;
    const remote = options.remote === true;
    const release = remote
      ? (root.ZhugeModulePublishService?.forConsumer
        ? root.ZhugeModulePublishService.forConsumer(releaseOverride, consumerId)
        : { consumerId, status: "unavailable", identityMatches: false, publishedVersion: "", publishedBuild: "" })
      : releaseApi?.forConsumer
        ? releaseApi.forConsumer(consumerId)
        : unpublishedModuleRelease(consumerId);
    state.templateRelease = release;
    const body = document.body;
    if (!body) return release;
    const loadedSource = loadedModuleSourceIdentity();
    const publishedSource = {
      sourceCommit: String(release.sourceCommit || release.developmentSourceCommit || ""),
      sourceFingerprint: String(release.sourceFingerprint || release.developmentSourceFingerprint || "")
    };
    const sourceComparison = remote && root.ZhugeModulePublishService?.compareSourceIdentity
      ? root.ZhugeModulePublishService.compareSourceIdentity(loadedSource, publishedSource)
      : { status: remote ? "unknown" : "unverified", matches: false };
    body.dataset.moduleId = state.moduleId;
    body.dataset.templateId = state.moduleId;
    body.dataset.templateConsumer = consumerId;
    body.dataset.templateVersion = String(release.publishedVersion || release.templateVersion || "");
    body.dataset.templateBuild = String(release.publishedBuild || release.build || "");
    body.dataset.templateSourceCommit = publishedSource.sourceCommit;
    body.dataset.templateSourceFingerprint = publishedSource.sourceFingerprint;
    body.dataset.templateLoadedSourceCommit = loadedSource.sourceCommit;
    body.dataset.templateLoadedSourceFingerprint = loadedSource.sourceFingerprint;
    body.dataset.templatePublishedSourceCommit = publishedSource.sourceCommit;
    body.dataset.templatePublishedSourceFingerprint = publishedSource.sourceFingerprint;
    body.dataset.templateSourceIntegrity = sourceComparison.status;
    body.dataset.templateIdentitySource = remote ? "cloud" : "static-development";
    body.dataset.templateAdoption = String(release.status || "unavailable");
    body.dataset.templateReleaseState = String(release.status || "unavailable");
    document.querySelectorAll("[data-golden-master], [data-golden-master-surface], [data-c-operational-motherboard]").forEach(node => {
      node.dataset.moduleId = state.moduleId;
      node.dataset.templateId = state.moduleId;
      node.dataset.templateConsumer = consumerId;
      node.dataset.templateVersion = body.dataset.templateVersion;
      node.dataset.templateBuild = body.dataset.templateBuild;
      node.dataset.templateSourceCommit = body.dataset.templateSourceCommit;
      node.dataset.templateSourceFingerprint = body.dataset.templateSourceFingerprint;
      node.dataset.templateLoadedSourceCommit = body.dataset.templateLoadedSourceCommit;
      node.dataset.templateLoadedSourceFingerprint = body.dataset.templateLoadedSourceFingerprint;
      node.dataset.templatePublishedSourceCommit = body.dataset.templatePublishedSourceCommit;
      node.dataset.templatePublishedSourceFingerprint = body.dataset.templatePublishedSourceFingerprint;
      node.dataset.templateSourceIntegrity = body.dataset.templateSourceIntegrity;
      node.dataset.templateIdentitySource = body.dataset.templateIdentitySource;
      node.dataset.templateAdoption = body.dataset.templateAdoption;
      node.dataset.templateReleaseState = body.dataset.templateReleaseState;
    });
    renderModuleReleaseNotice();
    return release;
  }
  async function hydrateModuleRelease(options = {}) {
    const releaseService = root.ZhugeModulePublishService;
    if (!releaseService?.read) return null;
    try {
      const persisted = await releaseService.read(state.moduleId, { force: options.force === true });
      applyModuleReleaseIdentity(persisted, { remote: true });
      state.templateAdoptionError = "";
      renderModuleReleaseNotice();
      return persisted;
    } catch (error) {
      // The C release panel reports the user-facing error. Board boot remains
      // available so an authenticated session can recover on the next retry.
      return null;
    }
  }
  function bindModuleReleaseUpdates() {
    if (state.templateReleaseEventsBound || !document) return;
    state.templateReleaseEventsBound = true;
    document.addEventListener("zhuge-module-release-updated", event => {
      if (event.detail?.moduleId && event.detail.moduleId !== state.moduleId) return;
      if (event.detail?.release) {
        applyModuleReleaseIdentity(event.detail.release, { remote: true });
        hydrateModuleRelease({ force: true })
          .then(() => refreshBoard({ quiet: true }))
          .then(() => runTemplateParityCheck("publish", { silent: true }))
          .catch(() => {});
      }
    });
    if (!state.templateReleaseRefreshBound) {
      state.templateReleaseRefreshBound = true;
      const refreshRelease = () => {
        if (document.visibilityState === "hidden") return;
        hydrateModuleRelease({ force: true }).catch(() => {});
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshRelease();
      });
      root.addEventListener?.("focus", refreshRelease);
      state.templateReleaseTimer = root.setInterval?.(refreshRelease, 30000) || null;
    }
  }
  function mountCTemplateReleasePanel() {
    if (state.applicationScope !== "c") return;
    root.ZhugeCanonicalCTemplatePreview?.mountBanner?.(document.getElementById("canonicalCTemplatePreview"), {
      title: state.boardIsTemplate ? "C 唯一看板母版" : (state.boardName || "C Consumer 看板"),
      description: state.boardIsTemplate
        ? "MDTK canonical Cloud · 完整套用 Shared Board / Card / Drawer 操作"
        : `${state.taskCodePrefix || "C"} canonical Cloud · 採用 Published C Shared Board / Card / Drawer 操作`,
      consumerId: moduleConsumerId("c"),
      consumerOnly: !state.boardIsTemplate,
      consumerLabel: state.boardIsTemplate ? "C 母版" : (state.boardName || state.taskCodePrefix || "本看板")
    });
  }
  function activeService() {
    return state.service || defaultService;
  }
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
  const sharedActivityTextRenderer = root.ZhugeSharedActivityTextRenderer;
  const sharedActivityClassifier = root.ZhugeSharedActivityClassifier;
  const sharedActionContractFactory = root.ZhugeSharedTaskActionContract;
  const sharedActionAdapters = root.ZhugeSharedTaskActionAdapters;
  const renderActivityText = value => sharedActivityTextRenderer && typeof sharedActivityTextRenderer.render === "function"
    ? sharedActivityTextRenderer.render(value)
    : esc(value).replace(/\r?\n/g, "<br>");

  function sharedTaskActionContract(task) {
    if (!sharedActionContractFactory?.create || !sharedActionAdapters?.create) {
      const error = new Error("Template C Shared Action Contract 尚未載入。");
      error.code = "SHARED_ACTION_CONTRACT_UNAVAILABLE";
      throw error;
    }
    const cTemplate = state.applicationScope === "c";
    const workTodo = !cTemplate && (state.applicationScope === "worktodo" || isWorkTodoTask(task));
    const cacheKey = `${cTemplate ? "c" : workTodo ? "worktodo" : "ai_board"}:${task?.id || "global"}`;
    const cached = state.sharedActionContracts.get(cacheKey);
    if (cached) return cached;
    const dataService = typeof DataService !== "undefined" ? DataService : root.DataService;
    const repository = typeof SupabaseRepository !== "undefined" ? SupabaseRepository : root.SupabaseRepository;
    const adapter = sharedActionAdapters.create({
      task,
      workTodo,
      service: activeService(),
      dataService,
      repository,
      applicationScope: state.applicationScope,
      cTemplate
    });
    const contract = sharedActionContractFactory.create({
      consumer: cTemplate ? "c_mdtk" : workTodo ? "worktodo" : "ai_board",
      adapter
    });
    state.sharedActionContracts.set(cacheKey, contract);
    return contract;
  }

  async function executeSharedTaskAction(task, action, payload = {}, options = {}) {
    const contract = sharedTaskActionContract(task);
    return contract.execute(action, { taskId: task?.id, ...payload }, {
      key: options.key,
      onReadBack: options.onReadBack,
      onSuccess: async result => {
        if (options.refresh !== false) {
          await refreshBoard({ quiet: true });
          if (options.reopen !== false) {
            const freshTask = state.taskById.get(String(task?.id)) || task;
            await openTaskDetail(freshTask, { readOnly: isArchiveTask(freshTask) });
          }
        }
        await options.onSuccess?.(result);
      },
      onError: options.onError
    });
  }
  function dateLabel(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(value));
    } catch (error) { return String(value); }
  }
  function shortTimestampLabel(value) {
    if (!value) return "時間未提供";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Taipei"
      }).formatToParts(new Date(value)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
    } catch (error) { return String(value); }
  }
  function progressNoteMetaLabel(item) {
    return `${item?.actorLabel || "QJC"} · ${shortTimestampLabel(item?.timestamp)}`;
  }
  function statusLabel(status) {
    return activeService().statusDescriptorFor?.(status)?.label || "未知工程狀態";
  }
  const WORKTODO_STATUS_LABELS = Object.freeze({
    not_started: "待開始",
    in_progress: "進行中",
    waiting_reply: "等待回覆",
    waiting_acceptance: "等待驗收",
    blocked: "阻塞",
    completed: "完成"
  });
  const WORKTODO_STATUS_BY_WORKSPACE = Object.freeze({
    "worktodo-todo": "not_started",
    "worktodo-inprogress": "in_progress",
    "worktodo-waiting-reply": "waiting_reply",
    "worktodo-waiting-acceptance": "waiting_acceptance",
    "worktodo-blocked": "blocked",
    "worktodo-completed": "completed",
    "mdtk-todo": "not_started",
    "mdtk-in-progress": "in_progress",
    "mdtk-vendor-reply": "waiting_reply",
    "mdtk-qa": "waiting_acceptance",
    "mdtk-completed": "completed"
  });
  function isWorkTodoMode() {
    const path = String(root.location?.pathname || "");
    const consumer = queryParameter("consumer");
    return consumer === "worktodo-new" || /\/app\/Board\/worktodo\/(?:index\.html)?$/i.test(path);
  }
  function isCTemplateMode() {
    const path = String(root.location?.pathname || "");
    return String(document.body?.dataset?.templatePageId || "") === "template-c"
      || /\/app\/Board\/template-preview\/(?:index\.html)?$/i.test(path);
  }
  function isWorkTodoTask(task) {
    return state.applicationScope !== "c" && (state.applicationScope === "worktodo" || String(task?.applicationScope || "") === "worktodo");
  }
  function workItemLabel(task) {
    return state.applicationScope === "c" ? String(state.taskCodePrefix || (state.boardIsTemplate ? "MDTK" : "C")).toUpperCase() : isWorkTodoTask(task) ? "WLTK" : "TASK";
  }
  function boardTaskPrefix() {
    return workItemLabel().toLowerCase();
  }
  function defaultBoardWorkspaceKey() {
    if (state.applicationScope === "worktodo") return "worktodo-todo";
    if (state.applicationScope === "c") return `${boardTaskPrefix()}-todo`;
    return "todo";
  }
  function workTodoStatus(task) {
    const raw = String(task?.rawStatus || task?.status || "not_started").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return Object.prototype.hasOwnProperty.call(WORKTODO_STATUS_LABELS, raw) ? raw : "not_started";
  }
  function workTodoStatusForWorkspace(workspace) {
    const key = String(workspace?.key || "").trim().toLowerCase();
    return WORKTODO_STATUS_BY_WORKSPACE[key] || null;
  }
  function readableWorkStatus(task) {
    if (isWorkTodoTask(task)) return WORKTODO_STATUS_LABELS[workTodoStatus(task)] || "待開始";
    const status = activeService().normalizeStatus ? activeService().normalizeStatus(task?.status) : String(task?.status || "").trim().toLowerCase();
    const workspaceKey = String(task?.workspaceKey || task?.workspace || "").trim().toLowerCase();
    const workspaceName = String(task?.workspaceName || "").trim();
    if ((workspaceKey === "completed" || workspaceName === "已完成") && task?.completionAt && !task?.archivedAt) return "已完成";
    if (status === "ready") return "待開始";
    if (status === "inprogress") return "進行中";
    if (status === "qa") return "等待驗證";
    if (status === "done") return "已完成";
    if (status === "merged") return "已合併（封存）";
    if (status === "cancelled") return "已取消（封存）";
    return statusLabel(status);
  }
  function workspaceLabel(task) {
    return String(task?.workspaceName || task?.workspaceKey || "未分類工作區");
  }
  const stageLabels = Object.freeze({ co: "Co 開發驗證", gpt: "GPT 工程審查", qjc: "QJC PM 驗收" });
  const stageEvidenceLabels = Object.freeze({
    co: "開發測試結果、測試摘要、版本與打包資訊",
    gpt: "工程審查結論、範圍檢查與回歸測試結果",
    qjc: "瀏覽器實際操作結果、截圖／錄影或 PM 驗收說明"
  });
  const stateLabels = Object.freeze({ not_verified: "尚未驗證", pass: "已通過", fail: "需要修正", na: "不適用" });
  function setBanner(message, kind) {
    let banner = document.getElementById("boardReadStatus");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "boardReadStatus";
      banner.className = "board-read-status";
      const toolbar = document.querySelector(".workspace-canvas .toolbar, .toolbar");
      const parent = toolbar?.parentElement || document.querySelector(".main");
      if (parent) parent.insertBefore(banner, toolbar || parent.firstChild);
    }
    banner.dataset.state = kind || "info";
    banner.innerHTML = message;
  }
  function clearBanner() {
    document.getElementById("boardReadStatus")?.remove();
  }
  function isArchiveTask(task) {
    if (isWorkTodoTask(task)) return Boolean(task?.archivedAt);
    if (typeof activeService().isArchiveTask === "function") return activeService().isArchiveTask(task);
    const status = activeService().normalizeStatus ? activeService().normalizeStatus(task?.status) : String(task?.status || "").toLowerCase();
    return status === "done" || activeService().isGovernanceTerminal?.(task) === true;
  }
  function isCompletionWorkspace(workspace) {
    const key = String(workspace?.key || "").toLowerCase();
    const name = String(workspace?.name || "").trim();
    return key === "completed" || key === "worktodo-completed" || key === "mdtk-completed"
      || (state.applicationScope === "c" && key === `${boardTaskPrefix()}-completed`)
      || name === "已完成" || name === "完成";
  }
  function isCustomWorkspace(workspace) {
    const key = String(workspace?.key || "").trim().toLowerCase();
    if (state.applicationScope === "worktodo") return key.startsWith("worktodo-custom-");
    if (state.applicationScope === "c") return key.startsWith(`${boardTaskPrefix()}-custom-`);
    return key === "";
  }
  function workspaceTaskCount(workspace) {
    const workspaceId = String(workspace?.id || "");
    return state.tasks.filter(task => String(task?.workspaceId || task?.workspace_id || "") === workspaceId).length;
  }
  function workspaceDeleteTarget() {
    const targetKey = state.applicationScope === "worktodo" ? "worktodo-todo" : state.applicationScope === "c" ? defaultBoardWorkspaceKey() : "todo";
    return state.workspaces.find(workspace => workspace.active === true && String(workspace.key || "") === targetKey) || null;
  }
  function closeWorkspaceMenus() {
    document.querySelectorAll(".workspace-action-menu").forEach(menu => menu.remove());
    document.querySelectorAll("[data-workspace-menu]").forEach(button => button.setAttribute("aria-expanded", "false"));
  }
  function isMainBoardWorkspace(workspace) {
    const key = String(workspace?.key || "").toLowerCase();
    const name = String(workspace?.name || "").trim();
    if (state.applicationScope === "worktodo") {
      return workspace?.active === true && workspace?.applicationScope === "worktodo";
    }
    if (state.applicationScope === "c") {
      return workspace?.active === true && (
        (state.boardInstanceId && workspace?.boardInstanceId === state.boardInstanceId)
        || (!state.boardInstanceId && String(workspace?.key || "").toLowerCase().startsWith(`${boardTaskPrefix()}-`))
      );
    }
    // Keep the historical done/已完工 Cloud row intact but out of the active
    // Board. The canonical renamed workspace 已完成 remains visible for the
    // 48-hour post-acceptance lifecycle window. GPT區 is a legacy responsibility
    // column; the current workflow uses workspace position itself as the stage.
    return workspace?.active === true
      && key !== "done" && name !== "已完工"
      && key !== "gpt" && name !== "GPT區";
  }
  function workTodoJournalForTask(task) {
    if (!isWorkTodoTask(task)) return [];
    return state.workTodoJournalByTask.get(String(task?.id || "")) || [];
  }
  function workTodoCardViewModel(task) {
    const adapter = root.ZhugeWorkTodoTaskAdapter;
    if (!adapter?.normalizeCanonical) return task;
    return adapter.normalizeCanonical({
      ...task,
      note: task.note || task.summary || "",
      workContent: task.workContent || task.work_content || task.summary || task.note || ""
    }, workTodoJournalForTask(task));
  }
  function taskMarkup(task, options = {}) {
    const terminal = activeService().isGovernanceTerminal?.(task) || false;
    const archiveOnly = options.readOnly === true || isArchiveTask(task);
    const viewModel = workTodoCardViewModel(task);
    const governance = terminal
      ? `<div class="governance-history-note"><strong>${esc(statusLabel(task.status))}</strong>${task.resolutionReason ? `：${esc(task.resolutionReason)}` : ""}${task.mergedInto ? ` · 目標：${esc(task.mergedInto)}` : task.linkedTo ? ` · 關聯：${esc(task.linkedTo)}` : ""}</div>`
      : "";
    const draggable = !archiveOnly && !terminal;
    const archiveClass = archiveOnly ? " archive-taskcard" : "";
    const cardOptions = {
      className: "card taskcard shared-task-board-card board-cloud-card" + archiveClass,
      code: task.workCode || task.id || workItemLabel(task),
      title: task.title,
      summaryHtml: root.ZhugeSharedTaskCardSummary?.render({
        latestProgress: viewModel.latestProgress || task.latestProgress || task.latest_progress || task.progressNote || task.progress_note,
        workContent: viewModel.workContent || task.workContent || task.work_content || task.summary || task.note
      }) || "",
      agreementSchedule: (isWorkTodoTask(task) || state.applicationScope === "c") && viewModel?.agreementMode ? {
        mode: viewModel.agreementMode,
        startDate: viewModel.agreementStartDate,
        endDate: viewModel.agreementEndDate
      } : null,
      bodyHtml: governance,
      attributes: {
        "data-task-id": task.id,
        "data-shared-task-board-card-id": task.id,
        "data-work-code": task.workCode,
        "data-status": task.status,
        "data-workspace": task.workspace,
        tabindex: "0",
        draggable: String(draggable)
      }
    };
    if (root.ZhugeGoldenMaster?.renderCard) return root.ZhugeGoldenMaster.renderCard(cardOptions);
    if (root.ZhugeSharedTaskCard?.render) return root.ZhugeSharedTaskCard.render(cardOptions);
    return "<div class=\"board-empty\">Shared Task Card foundation 尚未載入。</div>";
  }
  function principleMarkup(principle) {
    return "<article class=\"principle-card board-cloud-card\" data-knowledge-code=\"" + esc(principle.code) + "\">" +
      "<div class=\"code\">" + esc(principle.code || "PRINCIPLE") + "</div><h3>" + esc(principle.title) + "</h3>" +
      (principle.summary ? "<p>" + esc(principle.summary) + "</p>" : "") +
      "<div class=\"meta\"><span class=\"tag rule-tag\">最高原則</span>" +
      (principle.version ? "<span class=\"tag\">v" + esc(principle.version) + "</span>" : "") + "</div></article>";
  }
  function renderPrinciples(principles) {
    const zone = document.getElementById("principlesCards");
    if (!zone) return;
    zone.replaceChildren();
    zone.innerHTML = principles.length ? principles.map(principleMarkup).join("") : "<div class=\"board-empty\">目前沒有可讀取的已核准最高原則。</div>";
  }
  function renderSystemMaps(systemMaps) {
    const zone = document.getElementById("systemMapCards");
    if (!zone) return;
    const fallback = [{ code: "CURRENT-SYSTEM-MAP", title: "Zhuge AI OS Current System Map", summary: "Shared Identity、Shared Navigation、Shared Supabase Gateway，以及 WorkLog、Investment、AI Board 的目前模組關係。", version: "目前資料尚待補充" }];
    zone.replaceChildren();
    const rows = systemMaps.length ? systemMaps : fallback;
    zone.innerHTML = rows.map(item => `<article class="system-map-card"><div class="code">${esc(item.code || "SYSTEM-MAP")}</div><h3>${esc(item.title)}</h3><p>${esc(item.summary || "尚未補充系統藍圖內容")}</p><div class="meta"><span class="tag">Current Architecture</span>${item.version ? `<span class="tag">v${esc(item.version)}</span>` : ""}</div></article>`).join("");
  }
  function taskCodeNumber(task) {
    const code = String(task?.workCode || task?.work_code || "").trim();
    const match = code.match(/^[A-Z][A-Z0-9]{1,15}[-_ ]?(\d+)$/i);
    return match ? Number(match[1]) : null;
  }
  function sortTasksByCode(tasks) {
    return (Array.isArray(tasks) ? tasks : []).map((task, index) => ({ task, index, number: taskCodeNumber(task) }))
      .sort((left, right) => {
        const leftValid = left.number !== null;
        const rightValid = right.number !== null;
        if (leftValid && rightValid && left.number !== right.number) return left.number - right.number;
        if (leftValid !== rightValid) return leftValid ? -1 : 1;
        return left.index - right.index;
      })
      .map(item => item.task);
  }
  function sortTasksForDisplay(tasks) {
    if (state.applicationScope !== "worktodo" || !root.ZhugeWorkTodoOrdering?.sortTasks) return sortTasksByCode(tasks);
    return root.ZhugeWorkTodoOrdering.sortTasks(tasks, {
      workspaceForTask: task => workTodoStatus(task),
      journalsForTask: task => workTodoJournalForTask(task)
    });
  }
  function renderWorkspaceColumns() {
    const boardMount = document.querySelector("[data-golden-master-board-mount]");
    const legacyBoard = document.getElementById("boardColumns") || document.querySelector(".board");
    if (!boardMount && !legacyBoard) return;
    closeWorkspaceMenus();
    const workspaces = state.workspaces.filter(isMainBoardWorkspace).sort((a, b) => a.sortOrder - b.sortOrder);
    const itemLabel = workItemLabel();
    const columns = workspaces.map(workspace => {
      const completion = isCompletionWorkspace(workspace);
      return {
        id: workspace.id,
        key: workspace.key,
        name: workspace.name,
        completion,
        reorderable: !completion,
        addHtml: !completion
          ? "<button class=\"add\" data-workspace-add=\"" + esc(workspace.id) + "\">＋ 新增 " + itemLabel + "</button>"
          : "",
        controlsHtml: completion
          ? "<span class=\"workspace-lifecycle-label\" title=\"由 PM Acceptance lifecycle 管理\">✓</span>"
          : "<button class=\"workspace-menu\" type=\"button\" data-workspace-menu=\"" + esc(workspace.id) + "\" title=\"工作區操作\" aria-label=\"工作區操作\" aria-haspopup=\"menu\" aria-expanded=\"false\">⋮</button>"
      };
    });
    if (boardMount && root.ZhugeGoldenMaster?.renderBoard) {
      boardMount.innerHTML = root.ZhugeGoldenMaster.renderBoard({
        id: "boardColumns",
        boardKey: state.applicationScope === "c" ? "c-motherboard" : "ai-board",
        className: "golden-master-board",
        ariaLabel: state.applicationScope === "c"
          ? `${workItemLabel()} 工作看板`
          : state.applicationScope === "worktodo" ? "工作待辦工作看板" : "AI Board 工作看板",
        columns
      });
    } else {
      legacyBoard.innerHTML = root.ZhugeGoldenMaster?.renderColumns
        ? root.ZhugeGoldenMaster.renderColumns(columns)
        : root.ZhugeSharedTaskBoard?.renderColumns
          ? root.ZhugeSharedTaskBoard.renderColumns(columns)
        : "<div class=\"board-empty\">Shared Task Board foundation 尚未載入。</div>";
    }
    const board = boardMount?.querySelector("#boardColumns") || legacyBoard;
    board?.style.setProperty("--board-workspace-count", String(Math.max(workspaces.length, 1)));
  }
  function renderTasks(tasks) {
    renderWorkspaceColumns();
    const groups = Object.fromEntries(state.workspaces.filter(isMainBoardWorkspace).map(workspace => [workspace.id, []]));
    const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(task => !isArchiveTask(task));
    sortTasksForDisplay(activeTasks).forEach(task => {
      const fallbackKey = defaultBoardWorkspaceKey();
      const fallback = state.workspaces.find(workspace => workspace.key === fallbackKey);
      const bucket = Object.prototype.hasOwnProperty.call(groups, task.workspaceId) ? task.workspaceId : fallback?.id;
      if (bucket && groups[bucket]) groups[bucket].push(task);
    });
    state.workspaces.filter(isMainBoardWorkspace).sort((a, b) => a.sortOrder - b.sortOrder).forEach(workspace => {
      const column = Array.from(document.querySelectorAll("[data-shared-task-board-column]")).find(item => item.dataset.workspaceId === workspace.id);
      if (!column) return;
      const cards = column.querySelector("[data-shared-task-board-cards]");
      const count = column.querySelector(".shared-task-board-column-count");
      if (!cards) return;
      cards.replaceChildren();
      const rows = groups[workspace.id] || [];
      cards.innerHTML = rows.length ? rows.map(taskMarkup).join("") : "<div class=\"board-empty\">目前沒有工作</div>";
      if (count) count.textContent = String(rows.length);
    });
    wireTaskCards();
  }
  function visibleTasks() {
    const query = state.searchQuery.trim().toLocaleLowerCase("zh-TW");
    const activeTasks = state.tasks.filter(task => !isArchiveTask(task));
    if (!query) return activeTasks;
    return activeTasks.filter(task => [task.workCode, task.title, task.summary, task.usageScenario, task.workspaceName, task.workspaceKey]
      .some(value => String(value || "").toLocaleLowerCase("zh-TW").includes(query)));
  }
  function applySearch(query) {
    state.searchQuery = String(query || "");
    renderTasks(visibleTasks());
    const count = visibleTasks().length;
    const result = document.getElementById("boardSearchCount");
    const itemLabel = workItemLabel();
    if (result) result.textContent = state.searchQuery.trim() ? "搜尋「" + state.searchQuery.trim() + "」：找到 " + count + " 筆 " + itemLabel : "顯示目前工作中的正式 " + itemLabel;
  }
  function renderGoldenMasterToolbar() {
    if (!root.ZhugeGoldenMaster?.renderToolbar) return;
    const itemLabel = workItemLabel();
    const toolbarMarkup = root.ZhugeGoldenMaster.renderToolbar({
      id: "goldenMasterToolbar",
      searchId: "boardSearch",
      searchLabel: "搜尋 " + itemLabel + "、使用情境或工作區",
      searchPlaceholder: "⌕ 搜尋目前工作中的 " + itemLabel + "、使用情境或工作區",
      // These controls were visible but intentionally disabled.  A formal
      // Product control must be usable; until the generic filter contract is
      // implemented, omit the unfinished controls rather than advertise a
      // dead-end interaction.
      filters: [],
      actions: [{ id: "healthCheckBtn", label: "檢查資料健康度" }, { id: "templateParityBtn", label: "與母版比對" }],
      statusHtml: '<span id="boardSearchCount" class="board-search-count golden-master-toolbar-status" aria-live="polite">顯示目前工作中的正式 ' + itemLabel + '</span>',
      legend: "工作區位置代表目前責任階段；工程狀態與治理紀錄仍保留"
    });
    const surface = document.querySelector("[data-golden-master-surface]");
    if (surface && !surface.querySelector("[data-golden-master-toolbar=\"true\"]")) {
      surface.innerHTML = `<div data-module-release-notice-host hidden></div>${toolbarMarkup}<div data-template-parity-result-host hidden></div><div data-golden-master-board-mount></div>`;
      return;
    }
    const mount = document.getElementById("goldenMasterToolbar");
    if (mount) mount.outerHTML = toolbarMarkup;
    const host = surface?.querySelector("[data-template-parity-result-host]");
    if (surface && !host) {
      const resultHost = document.createElement("div");
      resultHost.dataset.templateParityResultHost = "true";
      resultHost.hidden = true;
      surface.insertBefore(resultHost, surface.querySelector("[data-golden-master-board-mount]") || null);
    }
  }
  function wireSearch() {
    const input = document.getElementById("boardSearch");
    if (!input) return;
    input.oninput = event => applySearch(event.target.value);
    input.onkeydown = event => {
      if (event.key === "Escape") { input.value = ""; applySearch(""); }
    };
  }
  function syncRuntimeIdentityLabels() {
    if (state.applicationScope !== "c") return;
    const label = workItemLabel();
    const addModal = document.getElementById("addCardModal");
    const addTitle = addModal?.querySelector(".modalhead h2");
    const addFieldLabel = addModal?.querySelector("label[for='taskTitle']");
    const addClose = addModal?.querySelector("[data-golden-master-close='add-card']");
    if (addTitle) addTitle.textContent = `新增 ${label}`;
    if (addFieldLabel) addFieldLabel.textContent = `${label} 標題`;
    if (addClose) addClose.setAttribute("aria-label", `關閉新增 ${label}`);
    const archive = document.getElementById("archiveDrawer");
    const archiveSearch = archive?.querySelector("#archiveSearch");
    const archiveCount = archive?.querySelector("#archiveCount");
    const archiveList = archive?.querySelector("#archiveTaskList");
    if (archiveSearch) {
      archiveSearch.placeholder = `搜尋封存 ${label}、治理原因或工作區`;
      archiveSearch.setAttribute("aria-label", `搜尋封存 ${label}`);
    }
    if (archiveCount && !archive.classList.contains("is-open")) archiveCount.textContent = "";
    if (archiveList && !archiveList.dataset.runtimeIdentitySynced) {
      archiveList.dataset.runtimeIdentitySynced = "true";
      archiveList.innerHTML = `<div class="board-empty">目前沒有封存 ${esc(label)}。</div>`;
    }
    const header = document.querySelector("[data-zhuge-shared-header='true']");
    if (header && !state.boardIsTemplate && state.boardName) {
      const title = header.querySelector(".zhuge-shared-header-copy h1");
      const description = header.querySelector(".zhuge-shared-header-copy > p:last-child");
      if (title) title.textContent = state.boardName;
      if (description) description.textContent = `${label} · 採用 Published C 的共用看板`;
    }
  }
  function archiveTasks() {
    const filter = String(state.archiveFilter || "all").toLowerCase();
    const query = state.archiveSearch.trim().toLocaleLowerCase("zh-TW");
    return sortTasksByCode(state.tasks.filter(task => {
      if (!isArchiveTask(task)) return false;
      const status = activeService().normalizeStatus ? activeService().normalizeStatus(task.status) : String(task.status || "").toLowerCase();
      if (filter !== "all" && status !== filter) return false;
      if (!query) return true;
      return [task.workCode, task.title, task.summary, task.usageScenario, task.workspaceName, task.workspaceKey, task.status, task.resolutionReason, task.mergedInto, task.linkedTo]
        .some(value => String(value || "").toLocaleLowerCase("zh-TW").includes(query));
    }));
  }
  function renderArchive() {
    const list = document.getElementById("archiveTaskList");
    const count = document.getElementById("archiveCount");
    if (!list) return;
    const all = state.tasks.filter(task => isArchiveTask(task));
    const rows = archiveTasks();
    const itemLabel = workItemLabel();
    if (count) count.textContent = `顯示 ${rows.length} / ${all.length} 筆封存 ${itemLabel}（唯讀）`;
    list.innerHTML = rows.length
      ? rows.map(task => taskMarkup(task, { readOnly: true })).join("")
      : `<div class="board-empty">${all.length ? `找不到符合條件的封存 ${itemLabel}。` : `目前沒有封存 ${itemLabel}。`}</div>`;
    wireTaskCards();
  }
  function openArchiveDrawer() {
    const backdrop = document.getElementById("archiveDrawerBackdrop");
    const drawer = document.getElementById("archiveDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    renderArchive();
    window.setTimeout(() => document.getElementById("archiveSearch")?.focus(), 0);
  }
  function closeArchiveDrawer() {
    const backdrop = document.getElementById("archiveDrawerBackdrop");
    const drawer = document.getElementById("archiveDrawer");
    backdrop?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
  }
  function wireArchiveControls() {
    document.querySelectorAll("[data-archive-close]").forEach(button => {
      button.onclick = closeArchiveDrawer;
    });
    const input = document.getElementById("archiveSearch");
    if (input) {
      input.oninput = event => { state.archiveSearch = String(event.target.value || ""); renderArchive(); };
      input.onkeydown = event => {
        if (event.key === "Escape") { input.value = ""; state.archiveSearch = ""; renderArchive(); }
      };
    }
    const filter = document.getElementById("archiveFilter");
    if (filter) filter.onchange = event => { state.archiveFilter = String(event.target.value || "all"); renderArchive(); };
  }
  function setConnection(taskCount, principleCount, realtime) {
    const cTemplate = state.applicationScope === "c";
    const label = cTemplate
      ? (realtime ? "🟢 C 母版就緒" : "🟡 C 母版載入中")
      : (realtime ? "🟢 已同步" : "🟡 同步中");
    const time = cTemplate
      ? (realtime ? "MDTK canonical Cloud" : "Cloud 資料載入中")
      : (realtime ? dateLabel(new Date()) : "Cloud Read 完成，等待 Realtime");
    const updated = root.ZhugeSharedNavigation?.setSyncStatus?.({
      label,
      time,
      state: realtime ? "synced" : "syncing"
    });
    if (updated) return;
    // Compatibility fallback for older preview shells; the canonical shell
    // above is the only production path.
    const summary = document.getElementById("developerCloudSyncStatus");
    if (summary) {
      const status = summary.querySelector("strong");
      const syncTime = summary.querySelector("time");
      if (status) status.textContent = label;
      if (syncTime) syncTime.textContent = time;
    }
  }
  function completionGateStatus(items) {
    if (typeof activeService().completionGateStatus === "function") return activeService().completionGateStatus(items);
    const rows = (Array.isArray(items) ? items : []).filter(item => item && item.required && String(item.stage || "").toLowerCase() !== "gpt");
    const coItems = rows.filter(item => String(item.stage || "").toLowerCase() === "co");
    const qjcItems = rows.filter(item => String(item.stage || "").toLowerCase() === "qjc");
    const passed = rows.filter(item => item.state === "pass" && (item.evidenceNote || item.evidenceRef));
    const failed = rows.filter(item => item.state === "fail");
    const missingEvidence = rows.filter(item => item.state === "pass" && !(item.evidenceNote || item.evidenceRef));
    const missing = rows.filter(item => item.state !== "pass");
    return { required: rows, coItems, qjcItems, passed, failed, missingEvidence, missing, missingStages: [...(!coItems.length ? ["Co 開發驗證"] : []), ...(!qjcItems.length ? ["QJC PM 驗收"] : [])], hasRequired: rows.length > 0, allowed: rows.length > 0 && coItems.length > 0 && qjcItems.length > 0 && !missing.length && !missingEvidence.length };
  }
  function completionGateMessage(gate) {
    if (gate.missingStages?.length) return `尚未建立${esc(gate.missingStages.join("、"))}的必要驗收項目；請先補齊正式驗收清單。`;
    if (gate.failed?.length) return `有 ${gate.failed.length} 項驗收未通過；請查看失敗原因，退回負責角色修正。`;
    if (gate.missingEvidence?.length) return `有 ${gate.missingEvidence.length} 項驗收已通過但缺少 Evidence；請補充可追溯的驗收說明。`;
    if (gate.missing?.length) return `尚有 ${gate.missing.length} 項 Co／QJC 必要驗收未完成；請由負責角色完成驗證。`;
    return "目前尚未完成 Co 開發驗證與 QJC PM 驗收。";
  }
  async function moveTaskToWorkspace(task, targetWorkspaceId) {
    const target = state.workspaceById.get(String(targetWorkspaceId || ""));
    if (!task || !target || activeService().isGovernanceTerminal?.(task)) return;
    if (isWorkTodoTask(task)) {
      await moveWorkTodoTask(task, target);
      return;
    }
    if (String(task.workspaceId) === String(target.id)) {
      setBanner("這張卡片已在「" + esc(target.name) + "」，沒有需要保存的變更。", "info");
      return;
    }
    const current = state.workspaceById.get(String(task.workspaceId || ""));
    if (state.applicationScope === "ai_board" && isPmTurn(task) && isCompletionWorkspace(target)) {
      await acceptTaskByCardDrop(task, current, target);
      return;
    }
    setBanner("正在將 " + esc(task.workCode || task.title) + " 移動至「" + esc(target.name) + "」…", "loading");
    try {
      await executeSharedTaskAction(task, "moveWorkspace", { workspaceId: target.id, reason: "QJC workspace movement" }, { refresh: false, reopen: false });
      await refreshBoard({ quiet: true });
      const lifecycleMessage = isCompletionWorkspace(target)
        ? "已開始 48 小時 Cloud completion lifecycle。"
        : isCompletionWorkspace(current)
          ? "已取消原本的 48 小時 completion timer。"
          : "";
      setBanner("已移動「" + esc(task.workCode || task.title) + "」至「" + esc(target.name) + "」。" + lifecycleMessage + "工作區現在代表這張 TASK 的責任階段；治理紀錄已保留。", "success");
    } catch (error) {
      setBanner("工作區移動失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次移動；原資料未變更。" : "正式 Cloud 未接受這次移動；原資料未變更。")), "error");
    }
  }

  async function acceptTaskByCardDrop(task, current, target) {
    const fromLabel = current?.name || task.workspaceName || "QJC驗證";
    const targetLabel = target?.name || "已完成";
    setBanner("正在以卡片拖曳執行 PM Acceptance PASS…", "loading");
    try {
      const items = await activeService().loadChecklist(task.id);
      const item = (Array.isArray(items) ? items : []).find(isPmAcceptanceItem);
      if (!item) throw new Error("正式 PM Acceptance Record 尚未建立，未執行完成。");
      await executeSharedTaskAction(task, "updateGovernanceChecklist", {
        id: item.id,
        state: "pass",
        evidenceNote: `PM Acceptance PASS（卡片拖曳：${fromLabel} → ${targetLabel}）`
      }, { refresh: false, reopen: false });
      await refreshBoard({ quiet: true });
      setBanner("已透過卡片拖曳完成 PM Acceptance PASS；Cloud Lifecycle／Audit 已同步。", "success");
    } catch (error) {
      setBanner("PM Acceptance 拖曳驗收失敗：" + esc(error?.message || "正式 Cloud 未接受；原資料未變更。"), "error");
    }
  }

  async function moveWorkTodoTask(task, target) {
    if (!target) return;
    const nextStatus = workTodoStatusForWorkspace(target);
    if (String(task.workspaceId) === String(target.id)) {
      setBanner("這張卡片已在「" + esc(target.name) + "」，沒有需要保存的變更。", "info");
      return;
    }
    setBanner("正在將 " + esc(task.workCode || task.title) + " 移動至「" + esc(target.name) + "」…", "loading");
    try {
      await executeSharedTaskAction(task, "moveWorkspace", { workspaceId: target.id, status: nextStatus }, { refresh: false, reopen: false });
      await refreshBoard({ quiet: true });
      setBanner("已移動「" + esc(task.workCode || task.title) + "」至「" + esc(target.name) + "」。", "success");
    } catch (error) {
      setBanner("工作區移動失敗：" + esc(error?.message || "WorkTodo controlled RPC 未接受這次移動；原資料未變更。"), "error");
    }
  }

  function governanceTarget(task, reference) {
    const value = String(reference || "").trim().toLowerCase();
    return state.tasks.find(row => String(row.id).toLowerCase() === value || String(row.workCode).toLowerCase() === value) || null;
  }

  async function applyGovernanceAction(task, action) {
    const labels = { merged: "合併", cancelled: "取消", linked: "關聯", ignored: "忽略" };
    const label = labels[action] || action;
    const needsTarget = action === "merged" || action === "linked";
    const itemLabel = workItemLabel(task);
    const reference = needsTarget ? window.prompt(`請輸入要${label}到哪一張 ${itemLabel}（${itemLabel} 編號或 ID）`, "") : "";
    if (needsTarget && !reference) return;
    const target = needsTarget ? governanceTarget(task, reference) : null;
    if (needsTarget && !target) { setBanner(`找不到指定的目標 ${itemLabel}，治理動作未執行。`, "error"); return; }
    const reason = window.prompt(`請說明這次${label}決策的原因（至少 3 個字）`, "") || "";
    if (reason.trim().length < 3) { setBanner("治理決策必須留下清楚原因，未執行。", "error"); return; }
    try {
      await activeService().governanceAction(task.id, action, target?.id || null, reason.trim());
      document.getElementById("taskDetailModal").style.display = "none";
      await refreshBoard({ quiet: true });
      setBanner(`${esc(task.workCode || task.title)} 已完成「${esc(label)}」治理決策，Cloud 與 Audit 已同步。`, "success");
    } catch (error) {
      setBanner("治理決策未完成：" + esc(error?.message || "請確認 QJC 登入與權限。"), "error");
    }
  }
  function hasDragType(event, type) {
    return Array.from(event?.dataTransfer?.types || []).includes(type);
  }
  async function reorderWorkspace(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ordered = state.workspaces.filter(workspace => workspace.active).sort((a, b) => a.sortOrder - b.sortOrder);
    const visible = ordered.filter(isMainBoardWorkspace);
    const draggedIndex = visible.findIndex(workspace => workspace.id === draggedId);
    const targetIndex = visible.findIndex(workspace => workspace.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;
    const [dragged] = visible.splice(draggedIndex, 1);
    visible.splice(visible.findIndex(workspace => workspace.id === targetId), 0, dragged);
    let visibleIndex = 0;
    const fullOrder = ordered.map(workspace => isMainBoardWorkspace(workspace) ? visible[visibleIndex++] : workspace);
    try {
      setBanner("正在保存工作區排序…", "loading");
      const workspaceIds = fullOrder.map(workspace => workspace.id);
      await executeSharedTaskAction(null, "reorderWorkspace", { workspaceIds }, { refresh: false, reopen: false });
      await refreshBoard({ quiet: true });
      setBanner(state.applicationScope === "c" ? "工作區排序已保存至 C 母版 Cloud 資料。" : "工作區排序已保存至 Cloud。", "success");
    } catch (error) {
      setBanner("工作區排序失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次排序；原順序未變更。" : "正式 Cloud 未接受這次排序；原順序未變更。")), "error");
    }
  }
  async function deleteWorkspace(workspace) {
    if (!workspace || !isCustomWorkspace(workspace)) {
      setBanner("系統／Canonical 工作區不可刪除。", "error");
      return;
    }
    const taskCount = workspaceTaskCount(workspace);
    const targetWorkspace = workspaceDeleteTarget();
    if (taskCount > 0 && !targetWorkspace) {
      setBanner("找不到既有「待開始」工作區，未執行刪除；原資料未變更。", "error");
      return;
    }
    closeWorkspaceMenus();
    if (taskCount === 0) {
      if (!window.confirm(`確定刪除「${workspace.name}」工作區？此工作區目前沒有工作卡片，刪除後無法復原。`)) return;
    } else {
      const firstConfirmed = window.confirm(`此工作區目前有 ${taskCount} 張工作卡片，刪除前會先將全部工作卡片移至「待開始」，工作資料會保留。\n\n第一次確認：取消／繼續刪除`);
      if (!firstConfirmed) return;
      const secondConfirmed = window.confirm(`高風險操作：即將把「${workspace.name}」中的 ${taskCount} 張工作卡片移至「待開始」，再刪除工作區。Task、Checklist、Progress、Attachment 與 Storage Object 將全部保留。\n\n第二次確認：取消／確認刪除`);
      if (!secondConfirmed) return;
    }
    setBanner(taskCount > 0 ? "正在將工作卡片移至「待開始」，再刪除工作區…" : "正在刪除空工作區…", "loading");
    try {
      await executeSharedTaskAction(null, "deleteWorkspace", {
        workspaceId: workspace.id,
        targetWorkspaceId: targetWorkspace?.id || null
      }, { refresh: true, reopen: false });
      setBanner(taskCount > 0
        ? `工作區「${esc(workspace.name)}」已刪除；${taskCount} 張工作卡片已保留於「待開始」。`
        : `空工作區「${esc(workspace.name)}」已刪除。`, "success");
    } catch (error) {
      setBanner("工作區刪除失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次刪除；原資料未變更。" : "正式 Cloud 未接受這次刪除；原資料未變更。")), "error");
    }
  }
  function openWorkspaceMenu(button, workspace) {
    const header = button.closest("[data-workspace-header]");
    if (!header || !workspace) return;
    closeWorkspaceMenus();
    const menu = document.createElement("div");
    menu.className = "workspace-action-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = "<button type=\"button\" role=\"menuitem\" data-workspace-action=\"rename\">重新命名</button>"
      + "<button type=\"button\" role=\"menuitem\" data-workspace-action=\"delete\">刪除工作區</button>";
    header.appendChild(menu);
    button.setAttribute("aria-expanded", "true");
    const renameButton = menu.querySelector("[data-workspace-action=rename]");
    const deleteButton = menu.querySelector("[data-workspace-action=delete]");
    renameButton.onclick = event => {
      event.stopPropagation();
      closeWorkspaceMenus();
      beginWorkspaceRename(button, workspace);
    };
    if (!isCustomWorkspace(workspace)) {
      deleteButton.disabled = true;
      deleteButton.title = "系統／Canonical 工作區不可刪除";
      deleteButton.setAttribute("aria-disabled", "true");
    } else {
      deleteButton.onclick = event => {
        event.stopPropagation();
        deleteWorkspace(workspace);
      };
    }
    menu.onclick = event => event.stopPropagation();
    menu.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWorkspaceMenus();
        button.focus();
      }
    };
    renameButton.focus();
  }
  function restoreWorkspaceTitle(title, name) {
    if (!title) return;
    title.classList.remove("is-renaming");
    title.replaceChildren(document.createTextNode(String(name || "")));
  }
  function beginWorkspaceRename(button, workspace) {
    const title = button.closest("[data-workspace-header]")?.querySelector(".workspace-title");
    const originalName = String(workspace?.name || "").trim();
    if (!title || !originalName || title.querySelector(".workspace-rename-input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "workspace-rename-input";
    input.value = originalName;
    input.maxLength = 80;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "重新命名工作區");
    input.dataset.workspaceRenameInput = workspace.id;
    title.classList.add("is-renaming");
    title.replaceChildren(input);
    let phase = "editing";
    const cancel = () => {
      if (phase !== "editing") return;
      phase = "cancelled";
      restoreWorkspaceTitle(title, originalName);
    };
    const commit = async () => {
      if (phase !== "editing") return;
      const nextName = String(input.value || "").trim();
      if (!nextName) {
        input.classList.add("has-error");
        input.setAttribute("aria-invalid", "true");
        setBanner("請輸入工作區名稱。", "error");
        input.focus();
        return;
      }
      if (nextName === originalName) {
        cancel();
        return;
      }
      phase = "saving";
      input.disabled = true;
      button.disabled = true;
      setBanner("正在保存工作區名稱…", "loading");
      try {
        await executeSharedTaskAction(null, "renameWorkspace", { workspaceId: workspace.id, name: nextName }, { refresh: true, reopen: false });
        setBanner(state.applicationScope === "c" ? "工作區已重新命名並保存至 C 母版 Cloud 資料。" : "工作區已重新命名並保存至 Cloud。", "success");
      } catch (error) {
        phase = "editing";
        input.disabled = false;
        button.disabled = false;
        input.classList.add("has-error");
        input.setAttribute("aria-invalid", "true");
        setBanner("工作區重新命名失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次命名。" : "正式 Cloud 未接受這次命名。")), "error");
        input.focus();
        input.select();
      }
    };
    input.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
      }
    });
    input.addEventListener("input", () => {
      input.classList.remove("has-error");
      input.removeAttribute("aria-invalid");
    });
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (phase === "editing" && input.isConnected) commit();
      }, 0);
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }
  function wireWorkspaceControls() {
    document.querySelectorAll("[data-workspace-add]").forEach(button => {
      button.onclick = () => openQuickAdd(button.dataset.workspaceAdd);
    });
    document.querySelectorAll("[data-workspace-menu]").forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        const workspace = state.workspaceById.get(button.dataset.workspaceMenu);
        if (!workspace) return;
        openWorkspaceMenu(button, workspace);
      };
    });
    if (!state.workspaceMenuDocumentBound) {
      document.addEventListener("click", event => {
        if (!event.target?.closest?.("[data-workspace-menu], .workspace-action-menu")) closeWorkspaceMenus();
      });
      state.workspaceMenuDocumentBound = true;
    }
  }
  function wireTaskCards() {
    wireWorkspaceControls();
    document.querySelectorAll(".taskcard").forEach(card => {
      const task = state.taskById.get(card.dataset.taskId);
      if (!task) return;
      const archiveOnly = isArchiveTask(task);
      card.onclick = () => openTaskDetail(task, { readOnly: archiveOnly });
      card.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openTaskDetail(task, { readOnly: archiveOnly }); }
      };
    });
    const board = document.querySelector("[data-shared-task-board]");
    const workTodoMode = isWorkTodoMode();
    const cTemplateMode = state.applicationScope === "c";
    const boardHandlers = {
      canDragCard: id => {
        const task = state.taskById.get(String(id));
        return Boolean(task && !isArchiveTask(task) && !activeService().isGovernanceTerminal?.(task));
      },
      onCardDrop: async ({ cardId, id }) => {
        const task = state.taskById.get(String(cardId));
        if (!task) return;
        if (cTemplateMode) await moveTaskToWorkspace(task, id);
        else if (workTodoMode) await moveWorkTodoTask(task, state.workspaceById.get(String(id)));
        else await moveTaskToWorkspace(task, id);
      },
      canReorderColumn: id => {
        const workspace = state.workspaceById.get(String(id));
        return Boolean(workspace && isMainBoardWorkspace(workspace) && !isCompletionWorkspace(workspace));
      },
      onColumnDrop: async ({ sourceId, id }) => {
        return reorderWorkspace(sourceId, id);
      }
    };
    if (root.ZhugeGoldenMaster?.bindBoard) root.ZhugeGoldenMaster.bindBoard(board, boardHandlers);
    else root.ZhugeSharedTaskBoard?.bind(board, boardHandlers);
  }

  function wireNavigation() {
    const handlers = {
      board: () => showBoardView("board"),
      principles: () => showBoardView("principles"),
      "system-map": () => showBoardView("system-map"),
      security: () => showBoardView("security")
    };
    document.querySelectorAll("[data-board-nav]").forEach(item => {
      const activate = () => {
        document.querySelectorAll("[data-board-nav]").forEach(node => node.classList.toggle("active", node === item));
        handlers[item.dataset.boardNav]?.();
      };
      item.onclick = activate;
      item.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
      };
    });
  }
  function showBoardView(view) {
    state.boardView = view;
    document.querySelectorAll("[data-board-view]").forEach(node => { node.hidden = node.dataset.boardView !== view; });
    const canvas = document.querySelector(".workspace-canvas");
    const boardMain = document.querySelector("[data-board-main-view]");
    if (boardMain) boardMain.hidden = view !== "board";
    else if (canvas) canvas.hidden = view !== "board";
    else {
      const boardShell = document.querySelector(".board-shell");
      if (boardShell) boardShell.hidden = view !== "board";
      const toolbar = document.querySelector(".toolbar");
      if (toolbar) toolbar.hidden = view !== "board";
    }
    clearBanner();
  }

  function mountCreatorMfaSettings(context) {
    if (!context?.creator?.getSnapshot?.().is_creator) return;
    const tabs = document.querySelector(".workspace-subnav");
    const main = document.querySelector(".main");
    const content = document.querySelector(".workspace-canvas") || main;
    if (!tabs || !content || document.querySelector('[data-board-nav="security"]')) return;

    const tab = document.createElement("button");
    tab.className = "workspace-tab";
    tab.type = "button";
    tab.title = "敏感模組二次驗證";
    tab.dataset.boardNav = "security";
    tab.textContent = "🔐 安全設定";
    tabs.appendChild(tab);

    const section = document.createElement("section");
    section.className = "board-subview creator-mfa-settings-view";
    section.dataset.boardView = "security";
    section.hidden = true;
    section.innerHTML = `<header class="subview-header"><div><span class="subview-kicker">AI Board／Creator Control</span><h2>🔐 敏感模組二次驗證</h2><p>Google Login、Supabase Session、User UUID、RLS 與 Cloud Data 維持開啟；以下只控制指定模組是否略過 TOTP Challenge。</p></div><span class="subview-source">來源：Supabase Cloud Settings</span></header><div class="creator-mfa-settings-card"><div class="creator-mfa-settings-list" data-creator-mfa-list></div><p class="creator-mfa-settings-note" data-creator-mfa-note>設定只會保存於 Supabase Cloud。</p></div>`;
    content.appendChild(section);

    const moduleLabels = Object.freeze({
      investment: "Investment",
      "ai-board": "AI Board"
    });
    const requiredKey = moduleId => moduleId === "investment" ? "investment_mfa_required" : "ai_board_mfa_required";
    const render = () => {
      const policy = context.security.getMfaPolicy?.() || {};
      const list = section.querySelector("[data-creator-mfa-list]");
      const note = section.querySelector("[data-creator-mfa-note]");
      if (!list) return;
      list.innerHTML = ["investment", "ai-board"].map(moduleId => {
        const required = policy[requiredKey(moduleId)] !== false;
        const label = moduleLabels[moduleId];
        return `<div class="creator-mfa-row" data-mfa-row="${moduleId}"><div><strong>${label}｜Google Authenticator</strong><span class="creator-mfa-status ${required ? "is-on" : "is-off"}" data-mfa-status>${required ? "🟢 二次驗證 ON" : "🟡 二次驗證暫停"}</span></div><label class="creator-mfa-switch"><span class="sr-only">${label} Google Authenticator 二次驗證</span><input type="checkbox" data-mfa-module="${moduleId}" ${required ? "checked" : ""}><span class="creator-mfa-switch-track" aria-hidden="true"></span></label></div>`;
      }).join("");
      if (note) {
        note.textContent = policy.status === "error"
          ? "設定讀取失敗，已依安全預設保持兩個模組 ON。"
          : "設定只會保存於 Supabase Cloud。兩個開關互不連動。";
      }
      list.querySelectorAll("[data-mfa-module]").forEach(input => {
        input.addEventListener("change", async event => {
          const control = event.currentTarget;
          const moduleId = control.dataset.mfaModule;
          const required = control.checked;
          control.disabled = true;
          try {
            await context.security.setMfaRequired({ moduleId, required });
            await context.security.loadMfaPolicy({ force: true });
            render();
          } catch (error) {
            control.checked = !required;
            control.disabled = false;
            if (note) note.textContent = error?.message || "設定寫入失敗，已維持原本狀態。";
          }
        });
      });
    };
    render();
    tab.addEventListener("click", () => showBoardView("security"));
  }
  function ensureTaskDetailModal() {
    root.ZhugeGoldenMaster?.mountOperations?.(document.body, { applicationScope: state.applicationScope });
    const modal = document.getElementById("taskDetailModal");
    if (!modal || modal.dataset.goldenMasterWired === "true") return;
    modal.dataset.goldenMasterWired = "true";
    modal.setAttribute("aria-hidden", "true");
    modal.addEventListener("click", event => {
      if (event.target.matches?.("[data-shared-task-drawer-close]")) {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        state.activeTaskId = "";
      }
    });
  }
  function ensureHealthModal() {
    root.ZhugeGoldenMaster?.mountOperations?.(document.body, { applicationScope: state.applicationScope });
    const modal = document.getElementById("healthCheckModal");
    if (!modal || modal.dataset.goldenMasterWired === "true") return;
    modal.dataset.goldenMasterWired = "true";
    modal.setAttribute("aria-hidden", "true");
    modal.addEventListener("click", event => { if (event.target === modal) { modal.style.display = "none"; modal.setAttribute("aria-hidden", "true"); } });
    document.getElementById("closeHealthCheck")?.addEventListener("click", () => { modal.style.display = "none"; modal.setAttribute("aria-hidden", "true"); });
  }
  const healthSeverity = Object.freeze({ error: "需要處理", warning: "請檢查", info: "資訊" });
  function renderHealthReport(report) {
    ensureHealthModal();
    const body = document.getElementById("healthCheckBody");
    const rows = report.findings.map(item => `<article class="health-finding health-${esc(item.severity)}"><div class="meta"><span class="tag">${esc(healthSeverity[item.severity] || item.severity)}</span><span class="tag">${esc(item.type)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p>${item.records.length ? `<small>涉及資料：${esc(item.records.join("、"))}</small>` : ""}</article>`).join("");
    body.innerHTML = `<div class="health-summary"><strong>已掃描 ${report.taskCount} 張正式 Cloud ${workItemLabel()}，發現 ${report.findingCount} 項 Finding。</strong><p>本次只讀取資料，不會自動 Merge、Cancel、刪除或修改任何正式紀錄。</p></div>${rows || "<div class=\"board-empty\">目前沒有發現需要提示的資料問題。</div>"}<div class="health-boundary">Merge／Link／Cancel／Ignore 等整理動作需要既有 Schema、權限與 Audit 能力；目前先保留 Finding，交由 PM／GPT 決定。</div>`;
    document.getElementById("healthCheckModal").style.display = "grid";
    document.getElementById("healthCheckModal").setAttribute("aria-hidden", "false");
  }
  async function runHealthCheck() {
    const button = document.getElementById("healthCheckBtn");
    if (button) { button.disabled = true; button.textContent = "檢查中…"; }
    setBanner("正在檢查 " + workItemLabel() + "、Checklist、Knowledge 與系統藍圖的一致性…", "loading");
    try {
      const report = await activeService().runHealthCheck();
      renderHealthReport(report);
      setBanner(`資料健康度檢查完成：${report.findingCount} 項 Finding。結果為唯讀，未修改 Cloud。`, "success");
    } catch (error) { setBanner("資料健康度檢查失敗：" + esc(error?.message || "未知錯誤"), "error"); }
    finally { if (button) { button.disabled = false; button.textContent = "檢查資料健康度"; } }
  }
  function ensureTemplateParityResultHost() {
    const surface = document.querySelector("[data-golden-master-surface]");
    if (!surface) return null;
    let host = surface.querySelector("[data-template-parity-result-host]");
    if (!host) {
      host = document.createElement("div");
      host.dataset.templateParityResultHost = "true";
      host.hidden = true;
      surface.insertBefore(host, surface.querySelector("[data-golden-master-board-mount]") || null);
    }
    return host;
  }
  function parityTriggerLabel(trigger) {
    return ({ manual: "手動檢查", publish: "C Publish 後自動守門", adopt: "Consumer Adopt 後自動守門", regression: "Regression 自動守門", runtime: "Runtime 自動守門" }[trigger]) || "自動守門";
  }
  function renderTemplateParityReport(report) {
    const host = ensureTemplateParityResultHost();
    if (!host || !report) return;
    const engine = root.ZhugeTemplateParityEngine;
    const differences = Array.isArray(report.differences) ? report.differences : [];
    const details = differences.length
      ? `<div class="template-parity-differences"><strong>實際差異</strong>${differences.map(item => `<div class="template-parity-difference"><span>${esc(item.type || "gap")}｜${esc(item.label || item.id || "未命名能力")}</span><small>${esc(item.detail || "請依正式 Governance 決定修正方式。")}</small></div>`).join("")}</div>`
      : `<div class="template-parity-no-difference">目前沒有模板差異；資料、工作區、卡片內容與識別資料不列入 Gap。</div>`;
    const summary = engine?.summary?.(report) || (report.gapCount === 0 ? "🟢 C 母版一致" : "🔴 C 母版不一致");
    host.hidden = false;
    host.innerHTML = `<section class="template-parity-report is-${report.gapCount === 0 ? "match" : "gap"}" data-template-parity-report data-template-parity-status="${esc(report.status || "gap")}" role="status" aria-live="polite"><div class="template-parity-heading"><strong>${esc(summary)}</strong><span>${esc(parityTriggerLabel(report.trigger))}</span></div><div class="template-parity-counts"><span>C Mother Template：${Number(report.motherCount || 0)}</span><span>目前 Consumer：${Number(report.consumerCount || 0)}</span><span>MATCH：${Number(report.matchCount || 0)} / ${Number(report.motherCount || 0)}</span><span>Template Gap：${Number(report.gapCount || 0)}</span><span>Fingerprint：${esc(report.fingerprint || "MISMATCH")}</span></div>${details}</section>`;
  }
  function runTemplateParityCheck(trigger = "manual", options = {}) {
    const engine = root.ZhugeTemplateParityEngine;
    if (!engine?.run) {
      if (!options.silent) setBanner("C 母版 Parity Engine 尚未載入；未判定一致性。", "error");
      return null;
    }
    if (state.templateParityBusy) return state.templateParityReport;
    state.templateParityBusy = true;
    try {
      const engineOptions = { root, document, consumerId: moduleConsumerId(state.applicationScope), consumerLabel: state.applicationScope === "c" ? (state.boardIsTemplate ? "C Mother Template" : state.boardName || "C Consumer") : state.applicationScope === "worktodo" ? "WorkTodo" : "AI Board", trigger };
      const report = trigger === "manual"
        ? engine.runManual(engineOptions)
        : engine.runAutoGuard(engineOptions);
      state.templateParityReport = report;
      renderTemplateParityReport(report);
      if (!options.silent) setBanner(`${esc(engine.summary?.(report) || "C 母版一致性檢查完成")}；Parity Check 僅 Compare／Detect／Report，未修改 Cloud。`, report.gapCount === 0 ? "success" : "error");
      return report;
    } finally {
      state.templateParityBusy = false;
    }
  }
  function wireTemplateParityCheck() {
    const button = document.getElementById("templateParityBtn");
    if (!button || button.dataset.templateParityWired === "true") return;
    button.dataset.templateParityWired = "true";
    button.addEventListener("click", () => runTemplateParityCheck("manual"));
  }
  function isPmAcceptanceItem(item) {
    const identity = `${item?.itemKey || ""} ${item?.label || ""}`.toLowerCase();
    return String(item?.stage || "").toLowerCase() === "qjc" && (item?.itemKey === "pm-acceptance" || /pm[-_ ]?acceptance|pm[-_ ]?qa|驗收/.test(identity));
  }
  function checklistMarkup(item, options = {}) {
    const readOnly = options.readOnly === true;
    const checked = item.state === "pass" ? " checked" : "";
    const stage = stageLabels[item.stage] || item.stage.toUpperCase();
    const isEngineeringReview = String(item.stage || "").toLowerCase() === "gpt";
    const stateLabel = stateLabels[item.state] || item.state;
    const expectedEvidence = stageEvidenceLabels[item.stage] || "可追溯的操作結果、測試結果或交接說明";
    const evidence = item.evidenceNote || item.evidenceRef
      ? `<div class="checklist-evidence-detail"><strong>證據位置／說明：</strong>${item.evidenceNote ? esc(item.evidenceNote) : ""}${item.evidenceRef ? `${item.evidenceNote ? " · " : ""}參照：${esc(item.evidenceRef)}` : ""}</div><div class="checklist-audit-detail"><strong>驗證紀錄：</strong>${item.checkedBy ? `驗證者 ${esc(item.checkedBy)}` : "尚未記錄驗證者"}${item.checkedAt ? ` · 時間 ${esc(dateLabel(item.checkedAt))}` : " · 尚未記錄時間"}</div>`
      : `<div class="checklist-evidence-detail missing"><strong>證據現在在哪裡：</strong>尚待${esc(stage)}提供；目前沒有可供 QJC 核對的紀錄。</div><div class="checklist-audit-detail missing"><strong>驗證紀錄：</strong>尚未記錄驗證者與驗證時間。</div>`;
    const next = isEngineeringReview
      ? "此為 GPT 工程審查紀錄；QJC 不需在此勾選，請查看工程 Evidence。"
      : item.state === "pass" ? "已完成此驗證項目，可繼續下一個驗收階段。" : item.state === "fail" ? "請查看失敗原因，退回負責角色修正後再驗證。" : `請由${esc(stage)}完成驗證，並提供：${esc(expectedEvidence)}。`;
    const pmAcceptanceCanAct = options.allowAcceptanceAction === true && isPmAcceptanceItem(item);
    const controls = readOnly
      ? `<div class="checklist-readonly-note">${esc(options.readOnlyMessage || "封存資料僅供查閱；不可修改 Checklist 或 Evidence。")} </div>`
      : pmAcceptanceCanAct
      ? `<label class="checklist-checkline checklist-qjc-control"><input type="checkbox" class="checklist-check" data-id="${esc(item.id)}"${checked}><span>${item.state === "pass" ? "☑" : "☐"} PM 驗收通過</span></label><button class="btn checklist-evidence-btn" data-id="${esc(item.id)}">補充驗收說明</button><button class="btn checklist-fail-btn" data-id="${esc(item.id)}">退回修正</button>`
      : `<div class="checklist-readonly-note">${isPmAcceptanceItem(item) ? "PM Acceptance 只可透過正式控制路徑操作；" : "Engineering Evidence／系統狀態；"}目前唯讀呈現。</div>`;
    const isActionable = pmAcceptanceCanAct;
    const requirementLabel = isEngineeringReview ? " · 工程紀錄（不列入 QJC 完成 Gate）" : item.required ? " · 必要" : "";
    return `<div class="checklist-item ${isActionable ? "checklist-qjc-item" : "checklist-readonly-item"}" data-checklist-id="${esc(item.id)}"><div class="checklist-main"><div class="checklist-checkline"><span class="checklist-stage-mark" aria-hidden="true">${item.state === "pass" ? "✅" : item.state === "fail" ? "⚠️" : "○"}</span><span><b>${esc(item.label || "未命名驗收項目")}</b><small>負責階段：${esc(stage)} · 目前狀態：${esc(stateLabel)}${requirementLabel}</small></span></div><div class="checklist-question"><strong>我要驗證什麼：</strong>${esc(item.label || "請確認此項目符合需求")}</div><div class="checklist-question"><strong>需要什麼證據：</strong>${esc(expectedEvidence)}</div>${evidence}<div class="checklist-next"><strong>下一步：</strong>${next}</div></div><div class="checklist-actions">${controls}<div class="checklist-state ${item.state === "not_verified" ? "missing" : ""}">${esc(stateLabel)}</div></div></div>`;
  }
  function checklistSummary(items) {
    const gate = completionGateStatus(items);
    if (!gate.hasRequired) return items.some(item => String(item.stage || "").toLowerCase() === "gpt") ? "目前只有 GPT 工程審查紀錄，不列入 QJC 完成 Gate" : "尚未提供正式驗收清單";
    const remaining = gate.required.length - gate.passed.length;
    return "QJC 完成條件 " + gate.passed.length + "/" + gate.required.length + " 已通過" + (gate.failed.length ? " · " + gate.failed.length + " 項需要修正" : remaining ? " · 尚有 " + remaining + " 項待驗證" : "") + " · GPT 工程審查為獨立紀錄";
  }
  function checklistRowsBy(items, predicate) {
    return (Array.isArray(items) ? items : []).filter(item => predicate(item));
  }
  function checklistStatus(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { tone: "missing", label: "未建立正式紀錄", detail: "目前沒有可讀取的 Canonical checklist item。" };
    if (list.some(item => item.state === "fail")) return { tone: "fail", label: "需要修正", detail: "正式紀錄中有未通過項目。" };
    if (list.every(item => item.state === "pass" && (item.evidenceNote || item.evidenceRef))) return { tone: "pass", label: "已完成", detail: `${list.length} 項均已通過並附 Evidence。` };
    if (list.some(item => item.state === "pass")) return { tone: "partial", label: "部分完成", detail: "仍有待驗證項目或 Evidence 尚未補齊。" };
    return { tone: "pending", label: "待驗證", detail: "尚未完成正式驗證。" };
  }
  function isTaskChecklistItem(item) {
    const type = String(item?.checklistType || "").toLowerCase().replace(/_/g, "-");
    return type === "task-checklist" || type === "shared-task-checklist" || type === "general-task";
  }
  function taskChecklistMarkup(items, archiveOnly = false) {
    const rows = Array.isArray(items) ? items : [];
    const list = rows.length
      ? rows.map(item => `<div class="shared-task-checklist-item${item.completed ? " is-complete" : ""}" data-task-checklist-id="${esc(item.id)}"><button class="shared-task-checklist-toggle" type="button" data-task-checklist-toggle="${esc(item.id)}" aria-label="${item.completed ? "標記未完成" : "標記完成"}"${archiveOnly ? " disabled" : ""}>${item.completed ? "☑" : "☐"}</button><strong>${esc(item.label || "未命名項目")}</strong>${archiveOnly ? "" : `<button class="shared-task-checklist-delete" type="button" data-task-checklist-delete="${esc(item.id)}" aria-label="刪除${esc(item.label || "項目")}">×</button>`}</div>`).join("")
      : `<div class="shared-task-checklist-empty">目前沒有工作清單項目。</div>`;
    const add = archiveOnly ? "" : `<form class="shared-task-checklist-add" data-task-checklist-add><input type="text" name="label" placeholder="新增待辦項目…" maxlength="300" aria-label="新增待辦項目"><button class="btn2" type="submit">新增</button></form>`;
    return `<div class="shared-task-checklist-list" data-task-checklist>${list}<small class="shared-task-checklist-note">這是一般工作 Checklist，用來記錄還剩什麼要做；不會改變工程狀態或 PM Acceptance。</small>${add}</div>`;
  }
  function isRegressionEvidence(item) {
    // Classify by the checklist record itself. Evidence text may mention
    // regression while documenting a GPT Review, but that must not move the
    // review record into the separate Regression gate.
    const checklistType = String(item?.checklistType || "").toLowerCase();
    const itemKey = String(item?.itemKey || "").toLowerCase();
    const label = String(item?.label || "").trim().toLowerCase();
    return checklistType === "batch_regression"
      || itemKey === "regression-evidence"
      || /^(?:full\s+)?regression(?:\s+evidence)?\b|^回歸|^回归/.test(label);
  }

  function engineeringVerificationState(items) {
    const all = (Array.isArray(items) ? items : []).filter(item => !isTaskChecklistItem(item) && !isPmAcceptanceItem(item));
    const groups = [
      { label: "Co QA", rows: all.filter(item => String(item.stage || "").toLowerCase() === "co" && !isRegressionEvidence(item)), hint: "Developer QA" },
      { label: "GPT Review", rows: all.filter(item => String(item.stage || "").toLowerCase() === "gpt" && !isRegressionEvidence(item)), hint: "工程審查" },
      { label: "Regression", rows: all.filter(isRegressionEvidence), hint: "回歸驗證" }
    ].map(entry => ({ ...entry, status: checklistStatus(entry.rows) }));
    const completed = groups.filter(entry => entry.status.tone === "pass");
    const failed = groups.filter(entry => entry.status.tone === "fail");
    const incomplete = groups.filter(entry => entry.status.tone !== "pass");
    return Object.freeze({
      groups,
      completed,
      failed,
      incomplete,
      ready: groups.length === 3 && completed.length === 3
    });
  }

  function acceptanceCriteriaItems(task) {
    const raw = String(task?.acceptanceCriteria || "").trim();
    if (!raw) return [];
    return raw.split(/\r?\n+/).map(line => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);
  }

  function acceptanceCriteriaMarkup(task) {
    const criteria = acceptanceCriteriaItems(task);
    if (!criteria.length) return `<div class="pm-acceptance-criteria-missing" data-pm-acceptance-criteria-state="missing"><strong>正式 Acceptance Criteria 尚未提供</strong><span>Cloud 尚未提供逐項驗收標準；此處不會建立第二套驗收機制。PM 仍透過既有 PM Acceptance 入口輸入實際驗收 Evidence，由既有 Cloud Gate 決定是否接受。</span></div>`;
    return `<div class="pm-acceptance-criteria"><strong>PM Acceptance Criteria（PM 實際要驗證）</strong><ol>${criteria.map(item => `<li>${esc(item)}</li>`).join("")}</ol></div>`;
  }

  function isPmTurn(task) {
    const workspaceKey = String(task?.workspaceKey || task?.workspace || "").trim().toLowerCase();
    const workspaceName = String(task?.workspaceName || "").trim();
    return workspaceKey === "qjc" || workspaceName === "QJC驗證";
  }

  function pmAttentionMarkup(item, task, verification, reason) {
    const failed = verification?.failed || [];
    const failureSummary = failed.map(entry => entry.label).join("、");
    const action = item
      ? `<div class="pm-acceptance-support"><button class="btn checklist-fail-btn" data-pm-reject="${esc(item.id)}">退回修改</button></div>`
      : "";
    return `<div class="pm-attention-panel" data-pm-attention="true"><strong>⚠️ 需要你的確認</strong><ul><li>發生什麼事：${esc(reason || (failureSummary ? `${failureSummary} 有未通過的正式紀錄。` : "PM 驗收資料尚未完整。"))}</li><li>為什麼需要 PM：目前工程工作已經交到 QJC，需要決定是否退回修正或補正正式驗收資料。</li><li>PM 要決定什麼：${item ? "確認退回修改；完成修正後再重新驗收。" : "先補正正式 Acceptance Criteria／Acceptance Record，暫不進行盲目驗收。"}</li></ul>${action}</div>`;
  }

  function pmAcceptanceMarkup(item, archiveOnly, task, verification) {
    if (archiveOnly || !isPmTurn(task)) return "";
    if (verification?.failed?.length) return pmAttentionMarkup(item, task, verification);
    if (!verification?.ready) return "";
    if (!item) return pmAttentionMarkup(item, task, verification, "正式 PM Acceptance Record 尚未建立。");
    if (item.state === "pass") return "";
    const state = stateLabels[item.state] || item.state || "尚未驗證";
    return `<div class="pm-acceptance-panel" data-pm-action="acceptance"><div class="pm-acceptance-context"><strong>現在需要你操作 PM QA</strong><span>工程驗證已完成；請依下列項目完成實機驗證，再做最後決定。</span></div>${acceptanceCriteriaMarkup(task)}<div class="pm-acceptance-action" data-pm-acceptance-id="${esc(item.id)}"><span class="pm-acceptance-state">目前 Acceptance 狀態：${esc(state)}</span><div class="pm-acceptance-support"><button class="btn primary" type="button" data-pm-accept="${esc(item.id)}">驗收通過</button><button class="btn" type="button" data-pm-reject="${esc(item.id)}">退回修改</button></div></div></div>`;
  }
  function activityActionLabel(item) {
    if (isHumanProgressActivity(item)) return "工作進度";
    const labels = {
      task_created: "建立 TASK",
      workflow_transition: "工程狀態交接",
      workspace_moved: "工作區移動",
      governance_action: "治理決策",
      checklist_item_created: "建立驗收項目",
      checklist_item_updated: "更新驗收項目",
      pm_authorized_artifact_registered: "登記 Artifact",
      pm_authorization_issued: "發出 PM Authorization"
    };
    return labels[item.action] || item.action || "系統活動";
  }
  function activityDetail(item) {
    if (isHumanProgressActivity(item)) {
      return item.note || "（未提供進度內容）";
    }
    if (item.action === "workspace_moved") {
      const from = item.beforeData?.workspace_name || item.beforeData?.workspace_id || "未知工作區";
      const to = item.afterData?.workspace_name || item.afterData?.workspace_id || "未知工作區";
      return `${from} → ${to}`;
    }
    if (item.action === "workflow_transition") {
      const from = item.beforeData?.status || "未知";
      const to = item.afterData?.status || "未知";
      return `工程狀態：${from} → ${to}`;
    }
    return item.note || "保留於正式 Audit Trail。";
  }
  function isHumanProgressActivity(item) {
    return sharedActivityClassifier?.isHumanProgressActivity?.(item) === true;
  }
  function activityKind(item) {
    if (isHumanProgressActivity(item)) return "human";
    const identity = `${item?.action || ""} ${item?.note || ""}`.toLowerCase();
    if (/acceptance|accepted|驗收/.test(identity)) return "acceptance";
    if (item?.action === "workflow_transition") return "status";
    if (item?.action === "workspace_moved") return "workspace";
    if (item?.entityType === "engineering_checklist_item" || /checklist|evidence|回歸|regression/.test(identity)) return "evidence";
    return "system";
  }
  function activityKindLabel(kind) {
    return ({ status: "Status", workspace: "Workspace Move", evidence: "Evidence", acceptance: "PM Acceptance", system: "System Activity" })[kind] || "System Activity";
  }
  function progressAttachmentIcon(file) {
    const mime = String(file?.mimeType || file?.mime_type || "").toLowerCase();
    const filename = String(file?.filename || "").toLowerCase();
    if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)) return "🖼️";
    if (mime === "application/pdf" || filename.endsWith(".pdf")) return "📄";
    if (/wordprocessing|msword|\.docx?$/.test(`${mime} ${filename}`)) return "📝";
    if (/spreadsheet|excel|\.xlsx?$|\.csv$/.test(`${mime} ${filename}`)) return "📊";
    if (/presentation|powerpoint|\.pptx?$/.test(`${mime} ${filename}`)) return "📽️";
    if (/zip|compressed|archive|\.zip$/.test(`${mime} ${filename}`)) return "🗜️";
    if (mime.startsWith("text/") || /\.(txt|md|rtf)$/i.test(filename)) return "📃";
    return "📎";
  }
  function currentActorId() {
    try {
      if (typeof currentUserUuid === "function") return String(currentUserUuid() || "");
      const snapshot = root.ZhugeSharedPlatform?.getSessionSnapshot?.() || root.ZhugeSharedPlatform?.getSession?.() || {};
      return String(snapshot.identity?.userId || snapshot.identity?.uuid || snapshot.userId || "");
    } catch {
      return "";
    }
  }
  function visibleHumanProgressRows(activity) {
    const rows = (Array.isArray(activity) ? activity : []).slice().sort((left, right) => (Date.parse(right.timestamp || "") || 0) - (Date.parse(left.timestamp || "") || 0));
    const humanRows = rows.filter(item => activityKind(item) === "human");
    const superseded = new Set(rows.filter(item => item?.revisionOf != null).map(item => String(item.revisionOf)));
    const tombstoned = new Set(rows.filter(item => item?.tombstoneOf != null).map(item => String(item.tombstoneOf)));
    return humanRows.filter(item => !superseded.has(String(item.id))
      && !tombstoned.has(String(item.id))
      && item.action !== "progress_note_deleted");
  }
  function activityMarkup(activity, attachments = [], options = {}) {
    const rows = (Array.isArray(activity) ? activity : []).slice().sort((left, right) => (Date.parse(right.timestamp || "") || 0) - (Date.parse(left.timestamp || "") || 0));
    // The adapter still reads the complete canonical activity stream so that
    // Audit / Governance data is never discarded.  The general Task Drawer,
    // however, is a human work-progress surface: System Activity and
    // Workspace Move remain in the canonical source but are not rendered here.
    const humanRows = visibleHumanProgressRows(rows);
    if (!humanRows.length) return "<div class=\"board-empty\" data-human-progress-empty=\"true\">目前沒有工作進度紀錄。</div>";
    const attachmentRows = (Array.isArray(attachments) ? attachments : []).filter(item => item.attachmentScope === "progress_note");
    const attachmentsByActivity = new Map();
    attachmentRows.forEach(item => attachmentsByActivity.set(item.activityId, [...(attachmentsByActivity.get(item.activityId) || []), item]));
    return humanRows.map(item => {
      const noteAttachments = attachmentsByActivity.get(item.id) || [];
      const canManage = options.readOnly !== true && currentActorId() && String(item.actorId) === currentActorId();
      const attachmentBadge = noteAttachments.length
        ? `<span class="shared-task-progress-note-attachment-badge" title="此筆工作進度有 ${noteAttachments.length} 個附件">📎 ${noteAttachments.length}</span>`
        : "";
      const attachmentMarkupForNote = noteAttachments.length
        ? `<div class="shared-task-progress-attachment-list">${noteAttachments.map(file => `<div class="shared-task-progress-attachment-row" data-progress-attachment-id="${esc(file.attachmentId)}" data-progress-attachment-path="${esc(file.storagePath)}" data-progress-attachment-mime="${esc(file.mimeType)}"><span data-progress-attachment-preview title="${esc(file.filename || "附件")}">${progressAttachmentIcon(file)}</span><strong>${esc(file.filename)}</strong>${canManage ? `<button class="shared-task-icon-button shared-task-attachment-delete" type="button" data-shared-attachment-delete="${esc(file.attachmentId)}" data-shared-attachment-scope="progress_note" aria-label="刪除進度附件：${esc(file.filename || "未命名附件")}" title="刪除附件">🗑️</button>` : ""}</div>`).join("")}</div>`
        : "";
      const controls = canManage
        ? `<div class="shared-task-progress-note-actions"><button class="shared-task-icon-button" type="button" data-progress-note-edit="${esc(item.id)}" aria-label="編輯工作進度" title="編輯工作進度">✏️</button><button class="shared-task-icon-button shared-task-progress-note-delete" type="button" data-progress-note-delete="${esc(item.id)}" aria-label="刪除工作進度" title="刪除工作進度">🗑️</button></div>`
        : "";
      return `<article class="task-activity-row shared-task-drawer-activity-row" data-activity-id="${esc(item.id)}" data-activity-kind="human" data-activity-type="human_progress_note"><div class="task-activity-dot" aria-hidden="true"></div><div class="shared-task-progress-note-body"><header class="shared-task-progress-note-header"><div class="shared-task-progress-note-heading"><strong class="shared-task-progress-note-title">工作進度</strong>${attachmentBadge}</div>${controls}</header><p class="shared-task-progress-content" data-progress-note-content>${renderActivityText(activityDetail(item))}</p>${attachmentMarkupForNote}<small class="shared-task-progress-note-meta">${esc(progressNoteMetaLabel(item))}</small></div></article>`;
    }).join("");
  }
  function humanNotesMarkup(task) {
    // Legacy developer notes remain canonical data, but their engineering
    // wording is not part of the general Task UX. Only an explicit PM-facing
    // note is shown with neutral copy; an empty note has no presentation.
    const developerNote = String(task.developerNotes || "").trim();
    const note = String(task.pmNotes || "").trim();
    void developerNote;
    if (!note) return "";
    return `<section class="task-legacy-notes"><article class="task-human-note shared-task-drawer-activity-row" data-activity-kind="legacy-note"><strong>工作補充</strong><p>${renderActivityText(note)}</p><small>來源：工作資料</small></article></section>`;
  }
  function progressNoteComposerMarkup(archiveOnly, options = {}) {
    if (archiveOnly) return "";
    const attachment = `<label class="shared-task-progress-attachment" for="taskProgressAttachments" title="附加圖片或文件" aria-label="附加圖片或文件"><span class="shared-task-progress-attachment-icon" aria-hidden="true">＋</span><input id="taskProgressAttachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"></label><small class="shared-task-progress-file-hint" id="taskProgressAttachmentHint">可選擇圖片／文件附件</small>`;
    const persistenceHint = options.cTemplate
      ? "工作進度保存至 C 母版 Cloud 資料；工作進度內容不可為空白。"
      : "由目前登入的 QJC／owner 身分保存至正式 Cloud；工作進度內容不可為空白。";
    return `<section class="shared-task-drawer-progress-composer" data-progress-note-write="available" data-progress-note-composer data-progress-note-expanded="false"><button class="shared-task-progress-composer-trigger" type="button" data-progress-note-open aria-label="新增工作進度" title="新增工作進度">＋</button><div class="shared-task-progress-composer-body" data-progress-note-panel hidden><div class="shared-task-progress-composer-heading"><label for="taskProgressNote">新增工作進度...</label><button class="shared-task-progress-composer-close" type="button" data-progress-note-close aria-label="收合工作進度輸入">×</button></div><textarea id="taskProgressNote" placeholder="輸入本次工作進度..."></textarea><small>${persistenceHint}</small><div class="shared-task-progress-composer-actions">${attachment}<button class="shared-task-progress-submit" id="addTaskProgressNote" type="button" aria-label="新增工作進度" title="新增工作進度">新增</button></div></div></section>`;
  }
  function taskChecklistCountMarkup(items) {
    const rows = Array.isArray(items) ? items : [];
    const completed = rows.filter(item => item && (item.completed === true || item.completed === 1)).length;
    return `${completed} / ${rows.length}`;
  }
  function taskChecklistPanelMarkup() {
    return `<details class="shared-task-drawer-checklist-panel" data-task-checklist-panel><summary><span class="shared-task-drawer-checklist-title">☑ 一般工作 Checklist</span><span class="shared-task-drawer-checklist-count" data-task-checklist-count>0 / 0</span></summary><div class="shared-task-drawer-checklist-body"><div id="taskChecklistRows"><div class="board-empty">讀取中…</div></div></div></details>`;
  }
  function attachmentMarkup(attachments, artifacts, error, archiveOnly, options = {}) {
    // Progress-note attachments belong beside their Human Progress Note in
    // the right-hand timeline.  Only general TASK attachments belong in the
    // left-hand work-content section.
    const rows = (Array.isArray(attachments) ? attachments : []).filter(item => item?.attachmentScope !== "progress_note");
    const artifactRows = Array.isArray(artifacts) ? artifacts : [];
    const errorMarkup = error ? `<div class="task-read-warning">工作附件讀取失敗：${esc(error.message || "未知錯誤")}。</div>` : "";
    const attachmentRows = rows.map(item => {
      const isImage = String(item.mimeType || "").startsWith("image/");
      const attachmentId = item.attachmentId || item.id || "";
      const remove = archiveOnly ? "" : `<button class="shared-task-icon-button shared-task-attachment-delete" type="button" data-shared-attachment-delete="${esc(attachmentId)}" data-shared-attachment-scope="task" aria-label="刪除附件：${esc(item.filename || "未命名附件")}" title="刪除附件">🗑️</button>`;
      const metadata = `<small class="shared-task-attachment-meta">📎 附件 · ${esc(shortTimestampLabel(item.createdAt))}</small>`;
      return `<article class="shared-task-attachment" data-task-attachment-id="${esc(attachmentId)}" data-task-attachment-path="${esc(item.storagePath)}" data-task-attachment-mime="${esc(item.mimeType)}"><div class="shared-task-attachment-preview" data-task-attachment-preview>${isImage ? "載入預覽…" : "📄"}</div><span class="shared-task-attachment-copy"><strong>${esc(item.filename || "未命名附件")}</strong>${metadata}</span>${remove}</article>`;
    }).join("");
    const artifactsMarkup = artifactRows.map(item => `<article class="shared-task-attachment shared-task-attachment-artifact"><span class="shared-task-attachment-icon" aria-hidden="true">📦</span><span class="shared-task-attachment-copy"><strong>${esc(item.filename || item.artifactId || "未命名交付物")}</strong><small>${esc(item.artifactType || "交付物")} · ${esc(item.productVersion || "版本未提供")} · Build ${esc(item.runtimeBuild || "未提供")}</small></span></article>`).join("");
    const empty = !attachmentRows.length && !artifactsMarkup ? `<div class="shared-task-attachment-empty">目前沒有附件</div>` : "";
    const add = archiveOnly ? "" : `<label class="btn2 shared-task-attachment-add" for="taskAttachmentsInput">＋新增附件<input id="taskAttachmentsInput" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"></label><small id="taskAttachmentHint" class="shared-task-attachment-hint">圖片可預覽；文件顯示檔名與類型</small>`;
    return `<div class="shared-task-attachment-zone" data-task-attachments-zone aria-label="附件">${errorMarkup}${attachmentRows || artifactsMarkup ? `<div class="shared-task-attachment-list">${attachmentRows}${artifactsMarkup}</div>` : empty}${add}</div>`;
  }
  function formatByteSize(bytes) {
    const value = Number(bytes || 0);
    if (!value) return "大小未提供";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  function requirementContent(task) {
    const parts = [task.summary, task.problem && task.problem !== task.summary ? task.problem : "", task.objective && task.objective !== task.summary ? task.objective : ""]
      .map(value => String(value || "").trim()).filter(Boolean);
    return [...new Set(parts)].join("\n\n") || "尚未補充需求內容";
  }
  function editableTaskFieldValue(task, field) {
    if (field === "summary") return String(task?.summary || task?.problem || task?.objective || "");
    if (field === "usage_scenario") return String(task?.usageScenario || "");
    return "";
  }
  function editableTaskFieldMarkup(task, field, options = {}) {
    const archiveOnly = options.readOnly === true;
    const label = field === "summary" ? "工作內容" : "使用情境";
    const value = editableTaskFieldValue(task, field);
    const placeholder = field === "summary" ? "尚未補充工作內容" : "尚未補充使用情境";
    const editButton = archiveOnly ? "" : `<button class="btn2 task-inline-edit-button" type="button" data-task-inline-edit="${field}" aria-label="編輯${label}">✏️ 編輯</button>`;
    // Read mode owns the initial markup. The editor is created only after the
    // user explicitly enters edit mode, so a normal Task never renders both
    // display text and a textarea at the same time.
    return `<div class="task-inline-field" data-task-inline-field="${field}" data-task-inline-mode="read"><div class="task-inline-field-toolbar"><span class="task-inline-field-value" data-task-inline-value="${field}">${esc(value || placeholder).replace(/\n/g, "<br>")}</span>${editButton}</div></div>`;
  }
  function wireTaskInlineEditors(task, archiveOnly) {
    if (archiveOnly) return;
    const body = document.getElementById("taskDetailBody");
    if (!body) return;
    body.querySelectorAll("[data-task-inline-edit]").forEach(button => {
      button.onclick = () => {
        const field = button.dataset.taskInlineEdit;
        const fieldContainer = button.closest("[data-task-inline-field]");
        const value = fieldContainer?.querySelector(`[data-task-inline-value="${field}"]`);
        if (!fieldContainer || !value || fieldContainer.querySelector("[data-task-inline-editor]")) return;
        const label = field === "summary" ? "工作內容" : "使用情境";
        const editor = document.createElement("div");
        editor.className = "task-inline-editor";
        editor.dataset.taskInlineEditor = field;
        editor.innerHTML = `<textarea data-task-inline-input="${field}" aria-label="${label}"></textarea><div class="task-inline-editor-actions"><button class="btn2" type="button" data-task-inline-cancel="${field}">取消</button><button class="btn2 primary" type="button" data-task-inline-save="${field}">儲存</button></div><small>${state.applicationScope === "c" ? "一般內容會保存至 C 母版 Cloud 資料。" : "一般內容會經 authenticated controlled write path 保存至正式 Cloud，並留下 Audit；不需要再次 PM Governance Approval。"}</small>`;
        editor.querySelector("textarea").value = editableTaskFieldValue(task, field);
        fieldContainer.appendChild(editor);
        fieldContainer.dataset.taskInlineMode = "edit";
        value.hidden = true;
        button.hidden = true;
        editor.querySelector("textarea")?.focus();
        wireTaskInlineEditorActions(task, fieldContainer, field);
      };
    });
  }
  function leaveTaskInlineEdit(fieldContainer) {
    if (!fieldContainer) return;
    const editor = fieldContainer.querySelector("[data-task-inline-editor]");
    const value = fieldContainer.querySelector("[data-task-inline-value]");
    const edit = fieldContainer.querySelector("[data-task-inline-edit]");
    editor?.remove();
    if (value) value.hidden = false;
    if (edit) {
      edit.hidden = false;
      edit.disabled = false;
    }
    fieldContainer.dataset.taskInlineMode = "read";
  }
  function wireTaskInlineEditorActions(task, fieldContainer, field) {
    const editor = fieldContainer?.querySelector(`[data-task-inline-editor="${field}"]`);
    if (!editor) return;
    const label = field === "summary" ? "工作內容" : "使用情境";
    editor.querySelector("[data-task-inline-cancel]")?.addEventListener("click", () => leaveTaskInlineEdit(fieldContainer));
    editor.querySelector("[data-task-inline-save]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const input = editor.querySelector(`[data-task-inline-input="${field}"]`);
      if (!input) return;
      button.disabled = true;
      try {
        const summary = field === "summary" ? input.value : editableTaskFieldValue(task, "summary");
        const usageScenario = field === "usage_scenario" ? input.value : editableTaskFieldValue(task, "usage_scenario");
        await executeSharedTaskAction(task, "updateContent", { summary, usageScenario }, {
          onSuccess: () => {
            leaveTaskInlineEdit(fieldContainer);
            setBanner(state.applicationScope === "c" ? `${label}已保存至 C 母版 Cloud 資料。` : `${label}已保存至正式 Cloud，Audit 已記錄。`, "success");
          }
        });
      } catch (error) {
        button.disabled = false;
        setBanner(`${label}保存失敗：` + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次更新。" : "正式 controlled write 未接受這次更新。")), "error");
      }
    });
  }
  function wireTaskChecklist(task, items, archiveOnly) {
    const zone = document.querySelector("[data-task-checklist]");
    if (!zone) return;
    const workTodo = isWorkTodoTask(task);
    const cTemplate = state.applicationScope === "c";
    if (!archiveOnly) {
      const addForm = zone.querySelector("[data-task-checklist-add]");
      if (addForm) addForm.onsubmit = async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.querySelector("input[name=label]");
        const label = input?.value.trim();
        if (!label) return;
        const button = form.querySelector("button[type=submit]");
        const taskKey = String(task.id);
        if (state.taskChecklistWrites.has(taskKey) || form.dataset.taskChecklistSubmitting === "true") return;
        state.taskChecklistWrites.add(taskKey);
        form.dataset.taskChecklistSubmitting = "true";
        if (button) button.disabled = true;
        try {
          await executeSharedTaskAction(task, "addChecklist", { label, sortOrder: items.length * 10 }, {
            onSuccess: () => setBanner(cTemplate ? "工作 Checklist 已新增並保存至 C 母版 Cloud 資料。" : "工作 Checklist 已新增並保存至正式 Cloud。", "success")
          });
        } catch (error) {
          if (button) button.disabled = false;
          setBanner("工作 Checklist 新增失敗：" + esc(error?.message || (cTemplate ? "C 母版 Cloud 資料未接受這次更新。" : "正式 controlled write 未接受這次更新。")), "error");
        } finally {
          state.taskChecklistWrites = new Set(Array.from(state.taskChecklistWrites).filter(key => key !== taskKey));
          form.dataset.taskChecklistSubmitting = "false";
        }
      };
      zone.querySelectorAll("[data-task-checklist-toggle]").forEach(button => {
        button.onclick = async () => {
          const item = items.find(row => String(row.id) === String(button.dataset.taskChecklistToggle));
          if (!item) return;
          button.disabled = true;
          try {
            await executeSharedTaskAction(task, "updateChecklist", {
              id: item.id,
              completed: !item.completed,
              label: item.label,
              sortOrder: item.sortOrder
            });
          } catch (error) {
            button.disabled = false;
          setBanner("工作 Checklist 更新失敗：" + esc(error?.message || (cTemplate ? "C 母版 Cloud 資料未接受這次更新。" : "正式 controlled write 未接受這次更新。")), "error");
          }
        };
      });
      zone.querySelectorAll("[data-task-checklist-delete]").forEach(button => {
        button.onclick = async () => {
          const item = items.find(row => String(row.id) === String(button.dataset.taskChecklistDelete));
          if (!item || !window.confirm?.(`刪除工作 Checklist「${item.label}」？`)) return;
          button.disabled = true;
          try {
            await executeSharedTaskAction(task, "deleteChecklist", { id: item.id });
          } catch (error) {
            button.disabled = false;
          setBanner("工作 Checklist 刪除失敗：" + esc(error?.message || (cTemplate ? "C 母版 Cloud 資料未接受這次更新。" : "正式 controlled write 未接受這次更新。")), "error");
          }
        };
      });
    }
  }
  async function uploadAttachmentFiles(task, files, options = {}) {
    const selected = Array.from(files || []).filter(file => file && file.size > 0);
    for (const file of selected) {
      await executeSharedTaskAction(
        task,
        options.progressNote ? "addProgressAttachment" : "addGeneralAttachment",
        { taskId: task.id, activityId: options.activityId, file },
        { refresh: false, reopen: false, key: `attachment-upload:${task.id}:${options.activityId || "task"}:${file.name}` }
      );
    }
  }
  async function hydrateTaskAttachmentPreviews() {
    const rows = document.querySelectorAll("[data-task-attachment-preview], [data-progress-attachment-preview]");
    const activeTask = state.taskById.get(String(state.activeTaskId || ""));
    const workTodo = isWorkTodoTask(activeTask);
    let attachmentContract = null;
    try { attachmentContract = activeTask ? sharedTaskActionContract(activeTask) : null; } catch { attachmentContract = null; }
    await Promise.all(Array.from(rows).map(async preview => {
      const article = preview.closest("[data-task-attachment-path], [data-progress-attachment-path]");
      if (!article) return;
      try {
        const storagePath = article.dataset.taskAttachmentPath || article.dataset.progressAttachmentPath;
        const url = attachmentContract
          ? await attachmentContract.read("attachmentUrl", { attachment: {
            id: article.dataset.taskAttachmentId || article.dataset.progressAttachmentId,
            attachmentId: article.dataset.taskAttachmentId || article.dataset.progressAttachmentId,
            storagePath,
            storage_path: storagePath,
            storageBucket: article.dataset.taskAttachmentBucket || "board-task-attachments",
            storage_bucket: article.dataset.taskAttachmentBucket || "board-task-attachments"
          } })
          : "";
        if (!url) return;
        const mime = article.dataset.taskAttachmentMime || article.dataset.progressAttachmentMime || "";
        const openLink = document.createElement("a");
        openLink.className = "shared-task-attachment-open";
        openLink.href = url;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.setAttribute("aria-label", `開啟附件：${article.querySelector("strong")?.textContent || "未命名附件"}`);
        if (mime.startsWith("image/")) {
          const image = document.createElement("img");
          image.src = url;
          image.alt = article.querySelector("strong")?.textContent || "附件預覽";
          image.loading = "lazy";
          openLink.appendChild(image);
          preview.replaceChildren(openLink);
        } else {
          openLink.textContent = "開啟／下載";
          preview.replaceChildren(openLink);
        }
      } catch {
        preview.textContent = "預覽不可用";
      }
    }));
  }
  function wireTaskAttachments(task, archiveOnly, options = {}) {
    hydrateTaskAttachmentPreviews();
    if (archiveOnly) return;
    const input = document.getElementById("taskAttachmentsInput");
    const hint = document.getElementById("taskAttachmentHint");
    if (input) input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      input.disabled = true;
      if (hint) hint.textContent = `正在保存 ${files.length} 個附件…`;
      try {
        await uploadAttachmentFiles(task, files);
        await openTaskDetail(task, { readOnly: archiveOnly });
        setBanner(state.applicationScope === "c" ? "附件已保存至 C 母版 Cloud 資料。" : "附件已保存至正式 Cloud。", "success");
      } catch (error) {
        if (hint) hint.textContent = "附件保存失敗，請確認登入狀態與檔案大小。";
        setBanner("附件保存失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次上傳。" : "正式 Storage／controlled path 未接受這次上傳。")), "error");
      } finally {
        input.disabled = false;
      }
    };
    const actionContract = sharedTaskActionContract(task);
    document.querySelectorAll("[data-shared-attachment-delete]").forEach(button => {
      button.onclick = async () => {
        const scope = button.dataset.sharedAttachmentScope || (button.closest("[data-progress-attachment-id]") ? "progress_note" : "task");
        const isProgress = scope === "progress_note";
        const attachmentId = button.dataset.sharedAttachmentDelete;
        const row = button.closest("[data-task-attachment-id], [data-progress-attachment-id]");
        const filename = row?.querySelector(".shared-task-attachment-copy strong, strong")?.textContent || "這個附件";
        if (!attachmentId || !window.confirm?.(`刪除附件「${filename}」？刪除後會保留 Audit 紀錄，但檔案不再可查閱。`)) return;
        button.disabled = true;
        try {
          const item = (options.rawAttachments || []).find(candidate => String(candidate.id || candidate.attachmentId) === String(attachmentId)) || {};
          await actionContract.execute("deleteAttachment", {
            taskId: task.id,
            attachmentId,
            activityId: row?.dataset.progressAttachmentId || item.activityId || item.journalEntryUuid,
            scope,
            item: { ...item, id: item.id || attachmentId, attachmentId: attachmentId, storagePath: row?.dataset.progressAttachmentPath || item.storagePath || item.storage_path }
          }, {
            key: `attachment-delete:${task.id}:${attachmentId}`,
            onSuccess: async () => {
              await refreshBoard({ quiet: true });
              const freshTask = state.taskById.get(String(task.id)) || task;
              await openTaskDetail(freshTask, { readOnly: isArchiveTask(freshTask) });
              setBanner("附件已透過 Shared Attachment Delete Contract 移除。", "success");
            },
            onError: error => setBanner("附件刪除失敗：" + esc(error?.message || "正式 Storage／controlled delete 未接受這次操作。"), "error")
          });
        } catch (error) {
          button.disabled = false;
        }
      };
    });
  }
  function wireProgressNoteComposer(task, archiveOnly) {
    if (archiveOnly) return;
    const composer = document.querySelector("[data-progress-note-composer][data-progress-note-write=available]");
    const openButton = composer?.querySelector("[data-progress-note-open]");
    const closeButton = composer?.querySelector("[data-progress-note-close]");
    const panel = composer?.querySelector("[data-progress-note-panel]");
    const textarea = document.getElementById("taskProgressNote");
    const button = document.getElementById("addTaskProgressNote");
    const attachmentInput = document.getElementById("taskProgressAttachments");
    const attachmentHint = document.getElementById("taskProgressAttachmentHint");
    if (!textarea || !button) return;
    const setExpanded = expanded => {
      if (!composer || !panel) return;
      composer.dataset.progressNoteExpanded = expanded ? "true" : "false";
      const drawerRoot = composer.closest("[data-shared-task-drawer]");
      if (expanded) drawerRoot?.setAttribute("data-progress-note-composer-open", "true");
      else drawerRoot?.removeAttribute("data-progress-note-composer-open");
      panel.hidden = !expanded;
      openButton?.toggleAttribute("hidden", expanded);
      if (expanded) textarea.focus();
    };
    openButton?.addEventListener("click", () => setExpanded(true));
    closeButton?.addEventListener("click", () => setExpanded(false));
    const submit = async () => {
      if (button.dataset.submitting === "true") return;
      const note = textarea.value.trim();
      if (!note) {
        setBanner("請輸入工作進度內容。", "error");
        textarea.focus();
        return;
      }
      button.dataset.submitting = "true";
      button.disabled = true;
      try {
        const createdNote = await executeSharedTaskAction(task, "addProgressNote", { note }, { refresh: false, reopen: false });
        const files = Array.from(attachmentInput?.files || []);
        if (files.length) {
          if (attachmentHint) attachmentHint.textContent = `正在保存 ${files.length} 個進度附件…`;
          await uploadAttachmentFiles(task, files, { progressNote: true, activityId: createdNote.id });
        }
        await refreshBoard({ quiet: true });
        const freshTask = state.taskById.get(String(task.id)) || task;
        await openTaskDetail(freshTask, { readOnly: archiveOnly });
        setBanner(state.applicationScope === "c"
          ? (files.length ? "工作進度與附件已保存至 C 母版 Cloud 資料。" : "工作進度已保存至 C 母版 Cloud 資料。")
          : (files.length ? "工作進度與附件已保存至正式 Cloud。" : "工作進度已保存至正式 Cloud。"), "success");
      } catch (error) {
        setBanner("工作進度保存失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次寫入。" : "正式 Cloud 未接受這次寫入。")), "error");
        button.disabled = false;
        button.dataset.submitting = "false";
      }
    };
    button.onclick = submit;
    textarea.onkeydown = event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    attachmentInput?.addEventListener("change", () => {
      const count = attachmentInput.files?.length || 0;
      if (attachmentHint) attachmentHint.textContent = count ? `已選擇 ${count} 個進度附件` : "可選擇圖片／文件附件";
    });
  }
  function wireTaskTitleEditor(task, archiveOnly) {
    if (archiveOnly) return;
    const row = document.querySelector(".shared-task-drawer-title-row");
    const value = row?.querySelector("[data-shared-task-title]");
    const editButton = row?.querySelector("[data-task-title-edit]");
    if (!row || !value || !editButton) return;
    editButton.onclick = () => {
      if (row.querySelector("[data-task-title-editor]")) return;
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(task.title || "");
      input.maxLength = 300;
      input.className = "shared-task-drawer-title-input";
      input.dataset.taskTitleEditor = "true";
      input.setAttribute("aria-label", "TASK 主旨");
      const actions = document.createElement("span");
      actions.className = "shared-task-drawer-title-actions";
      actions.innerHTML = '<button class="btn2" type="button" data-task-title-cancel>取消</button><button class="btn2 primary" type="button" data-task-title-save>儲存</button>';
      value.hidden = true;
      editButton.hidden = true;
      row.querySelector("h2")?.append(input);
      row.querySelector("h2")?.append(actions);
      input.focus();
      input.select();
      const close = () => {
        input.remove();
        actions.remove();
        value.hidden = false;
        editButton.hidden = false;
      };
      actions.querySelector("[data-task-title-cancel]")?.addEventListener("click", close);
      actions.querySelector("[data-task-title-save]")?.addEventListener("click", async event => {
        const save = event.currentTarget;
        const title = input.value.trim();
        if (!title) {
          setBanner("TASK 主旨不可為空白。", "error");
          input.focus();
          return;
        }
        save.disabled = true;
        try {
          await executeSharedTaskAction(task, "updateTitle", { title }, {
            onSuccess: () => setBanner(state.applicationScope === "c" ? "工作主旨已保存至 C 母版 Cloud 資料。" : "工作主旨已保存至正式 Cloud，Audit 已記錄。", "success")
          });
        } catch (error) {
          save.disabled = false;
          setBanner("TASK 主旨保存失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次更新。" : "正式 controlled write 未接受這次更新。")), "error");
        }
      });
      input.addEventListener("keydown", event => {
        if (event.key === "Escape") close();
        if (event.key === "Enter") actions.querySelector("[data-task-title-save]")?.click();
      });
    };
  }
  function wireHumanProgressNoteActions(task, activity, archiveOnly) {
    if (archiveOnly) return;
    const rows = Array.isArray(activity) ? activity : [];
    document.querySelectorAll("[data-progress-note-edit], [data-progress-note-delete]").forEach(button => {
      const activityId = String(button.dataset.progressNoteEdit || button.dataset.progressNoteDelete || "");
      const source = rows.find(item => String(item.id) === activityId);
      const row = button.closest("[data-activity-id]");
      if (!source || !row) return;
      if (button.dataset.progressNoteEdit) {
        button.onclick = () => {
          if (row.querySelector("[data-progress-note-editor]")) return;
          const content = row.querySelector("[data-progress-note-content]");
          if (!content) return;
          const editor = document.createElement("div");
          editor.className = "shared-task-progress-note-editor";
          editor.dataset.progressNoteEditor = "true";
          editor.innerHTML = '<textarea data-progress-note-input aria-label="工作進度內容"></textarea><div class="shared-task-progress-note-editor-actions"><button class="btn2" type="button" data-progress-note-cancel>取消</button><button class="btn2 primary" type="button" data-progress-note-save>儲存</button></div>';
          editor.querySelector("textarea").value = activityDetail(source);
          content.hidden = true;
          row.querySelector(".shared-task-progress-note-actions")?.setAttribute("hidden", "true");
          content.after(editor);
          editor.querySelector("textarea")?.focus();
          const restore = () => {
            editor.remove();
            content.hidden = false;
            row.querySelector(".shared-task-progress-note-actions")?.removeAttribute("hidden");
          };
          editor.querySelector("[data-progress-note-cancel]")?.addEventListener("click", restore);
          editor.querySelector("[data-progress-note-save]")?.addEventListener("click", async event => {
            const save = event.currentTarget;
            const note = editor.querySelector("textarea")?.value.trim();
            if (!note) {
              setBanner("工作進度內容不可為空白。", "error");
              return;
            }
            save.disabled = true;
            try {
              await executeSharedTaskAction(task, "editProgressNote", { activityId: source.id, note }, {
                onSuccess: () => setBanner("工作進度已以 revision 保存，歷史 Audit 已保留。", "success")
              });
            } catch (error) {
              save.disabled = false;
              setBanner("工作進度修改失敗：" + esc(error?.message || "正式 revision path 未接受這次更新。"), "error");
            }
          });
        };
      } else {
        button.onclick = async () => {
          if (!window.confirm?.("撤回這筆工作進度？原始紀錄會保留於 Audit，但一般 Timeline 將不再顯示。")) return;
          button.disabled = true;
          try {
            await executeSharedTaskAction(task, "deleteProgressNote", { activityId: source.id }, {
              onSuccess: () => setBanner("工作進度已透過 Shared Progress Delete Contract 撤回，歷史 Audit 已保留。", "success")
            });
          } catch (error) {
            button.disabled = false;
            setBanner("工作進度撤回失敗：" + esc(error?.message || "正式 tombstone path 未接受這次操作。"), "error");
          }
        };
      }
    });
  }
  function taskAnalysisValue(task, fields) {
    for (const field of fields) {
      const value = String(task?.[field] || "").trim();
      if (value) return value;
    }
    return "";
  }
  function taskAnalysisViewMarkup(task) {
    const sections = [
      { key: "understanding", title: "需求理解", fields: ["summary", "problem", "objective"] },
      { key: "judgement", title: "分析與判斷", fields: ["problem", "objective"] },
      { key: "proposal", title: "建議做法", fields: ["proposedSolution"] },
      { key: "principles", title: "執行原則／Acceptance Criteria", fields: ["acceptanceCriteria"] },
      { key: "handoff", title: "交付 Co 的執行摘要", fields: ["developerNotes", "pmNotes"] }
    ].map(item => ({ ...item, value: taskAnalysisValue(task, item.fields) }));
    const blocks = sections.map(item => `<article class="shared-task-analysis-card" data-task-analysis-field="${esc(item.key)}"><h3>${esc(item.title)}</h3>${item.value ? `<p>${esc(item.value).replace(/\n/g, "<br>")}</p>` : `<div class="shared-task-analysis-empty">目前正式 Cloud 尚未提供這項分析內容。</div>`}</article>`).join("");
    return `<section class="shared-task-analysis-view" data-task-analysis-view aria-label="GPT 分析與建議"><header class="shared-task-analysis-header"><div><span class="shared-task-analysis-kicker">AI Analysis Layer · Read-only</span><h2>🤖 GPT 分析與建議</h2><p>此檢視只讀取既有 TASK canonical 內容；正式 Cloud 尚未提供的分析不以瀏覽器暫存、假資料或 hard-code 補寫。</p></div><button class="shared-task-analysis-close" type="button" data-task-analysis-close aria-label="返回 TASK 詳情" title="返回 TASK 詳情">×</button></header><div class="shared-task-analysis-grid">${blocks}</div></section>`;
  }
  function showTaskAnalysisView(task) {
    const root = document.querySelector("[data-shared-task-drawer]");
    const grid = root?.querySelector(".shared-task-drawer-grid");
    const panel = root?.querySelector(".shared-task-drawer-panel");
    if (!root || !grid || !panel) return;
    if (root.__taskAnalysisViewState) return;
    const view = document.createElement("section");
    view.innerHTML = taskAnalysisViewMarkup(task);
    const analysis = view.firstElementChild;
    if (!analysis) return;
    const gridParent = grid.parentElement;
    if (!gridParent) return;
    root.__taskAnalysisViewState = { grid, gridParent, analysis };
    gridParent.replaceChild(analysis, grid);
    const floating = root.querySelector("[data-shared-task-floating-action]");
    if (floating) floating.hidden = true;
    analysis.querySelector("[data-task-analysis-close]")?.addEventListener("click", () => restoreTaskDetailView());
    analysis.querySelector("[data-task-analysis-close]")?.focus();
  }
  function restoreTaskDetailView() {
    const root = document.querySelector("[data-shared-task-drawer]");
    const viewState = root?.__taskAnalysisViewState;
    if (viewState?.analysis?.parentNode === viewState.gridParent) {
      viewState.gridParent.replaceChild(viewState.grid, viewState.analysis);
      delete root.__taskAnalysisViewState;
    }
    const floating = root?.querySelector("[data-shared-task-floating-action]");
    if (floating) floating.hidden = false;
    root?.querySelector('[data-task-property-action="gpt-analysis"]')?.focus();
  }
  function wireTaskAnalysisView(task) {
    const property = document.querySelector('[data-task-property-action="gpt-analysis"]');
    if (!property) return;
    property.onclick = () => showTaskAnalysisView(task);
  }
  function hasHumanProgressActivity(rows = []) {
    return (Array.isArray(rows) ? rows : []).some(item => {
      return isHumanProgressActivity(item);
    });
  }
  async function loadWorkTodoDrawerData(task) {
    const adapter = root.ZhugeWorkTodoTaskAdapter;
    const actionContract = sharedTaskActionContract(task);
    let journal = workTodoJournalForTask(task);
    let journalError = null;
    let capabilityError = null;
    let canonicalActivity = null;
    if (task?.id) {
      try {
        // WorkTodo progress is canonical in engineering_activity_log. The
        // Shared Action Contract owns the read path; the legacy Work Journal
        // table is intentionally not a fallback for the formal route.
        canonicalActivity = await actionContract.read("activity", { taskId: task.id, options: { checklistItems: [] } });
        journal = Array.isArray(canonicalActivity) ? canonicalActivity : [];
        state.workTodoJournalByTask.set(String(task.id), journal);
      } catch (error) {
        journalError = error;
      }
    }
    let capabilityData = { checklist: [], attachments: [] };
    if (task?.id) {
      try {
        capabilityData = await actionContract.read("capabilities", { taskId: task.id }) || capabilityData;
      } catch (error) {
        capabilityError = error;
      }
    }
    const viewModel = adapter?.toSharedViewModel
      ? adapter.toSharedViewModel(task, journal, capabilityData)
      : adapter?.normalize?.(task, journal, capabilityData);
    return { actionContract, journal, capabilityData, viewModel, journalError, capabilityError };
  }
  function agreedDateParts(task = {}, viewModel = null) {
    const mode = String(viewModel?.agreementMode || task.agreementMode || task.agreement_mode || "").trim().toLowerCase();
    const start = String(viewModel?.agreementStartDate || viewModel?.agreedDateStart || task.agreementStartDate || task.agreement_start_date || "").slice(0, 10);
    const end = String(viewModel?.agreementEndDate || viewModel?.agreedDateEnd || task.agreementEndDate || task.agreement_end_date || "").slice(0, 10);
    // A period is only a period when both dates are present. This keeps an
    // empty or incomplete record in the compact single-date editor without
    // inferring meaning from due_date or from an activity note.
    const normalizedMode = mode === "period" && start && end ? "period" : (mode === "single" && start ? "single" : "");
    return { mode: normalizedMode, start, end };
  }
  function agreedDateLabel(task = {}, viewModel = null) {
    const { mode, start, end } = agreedDateParts(task, viewModel);
    if (!start) return "尚未設定";
    return mode === "period" && end ? `${formatAgreedDate(start)} → ${formatAgreedDate(end)}` : formatAgreedDate(start);
  }
  function formatAgreedDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(date);
  }
  function wireAgreedDateProperty(task, viewModel, archiveOnly) {
    const property = document.querySelector('[data-task-property-action="agreement-schedule"]');
    if (!property || archiveOnly) return;
    property.onclick = () => {
      const existing = document.querySelector("[data-shared-agreed-date-editor]");
      if (existing) {
        existing.remove();
        property.classList.remove("is-editing");
        return;
      }
      const { mode, start, end } = agreedDateParts(task, viewModel);
      const editor = document.createElement("div");
      editor.className = "shared-agreed-date-editor";
      editor.dataset.sharedAgreedDateEditor = "true";
      editor.dataset.agreementMode = mode === "period" ? "period" : "single";
      editor.setAttribute("role", "group");
      editor.setAttribute("aria-label", mode === "period" ? "編輯約定期間" : "編輯約定日期");
      const periodStartEditVisible = mode === "period" || !start;
      editor.innerHTML = `<div class="shared-agreement-date-editor-mode" data-agreement-single-fields${mode === "period" ? " hidden" : ""}><span class="shared-agreement-date-editor-label">約定日期</span><label class="shared-agreement-date-control"><input type="date" data-agreed-date-start value="${esc(start)}" aria-label="約定日期"></label><button class="btn2 shared-agreement-period-trigger" type="button" data-agreement-period>＋ 多日</button></div><div class="shared-agreement-date-period-fields" data-agreement-period-fields${mode === "period" ? "" : " hidden"}><div class="shared-agreement-period-control" data-agreement-period-start-control><span class="shared-agreement-date-editor-label">起日</span><div class="shared-agreement-period-start-summary" data-agreement-period-start-summary${periodStartEditVisible ? " hidden" : ""}><strong data-agreement-period-start-value>${start ? formatAgreedDate(start) : "尚未選擇"}</strong><button class="btn2" type="button" data-agreement-period-start-edit${periodStartEditVisible ? " hidden" : ""}>修改起日</button></div><label class="shared-agreement-date-control" data-agreement-period-start-input${periodStartEditVisible ? "" : " hidden"}><input type="date" data-agreed-date-start-period value="${esc(start)}" aria-label="約定期間開始日期"></label></div><span class="shared-agreement-date-range-arrow" aria-hidden="true">→</span><label class="shared-agreement-date-control"><span class="shared-agreement-date-editor-label">迄日</span><input type="date" data-agreed-date-end value="${esc(end)}" aria-label="約定期間結束日期"></label></div><small>選好日期後會收合；需要區間時再選擇「＋ 多日」。</small><div class="shared-agreed-date-editor-actions"><button class="btn2 shared-agreement-clear" type="button" data-agreed-date-clear>清除日期</button><span></span><button class="btn2" type="button" data-agreed-date-cancel>取消</button><button class="btn2 primary" type="button" data-agreed-date-save>套用</button></div>`;
      // Keep the metadata grid intact; the compact editor belongs below the
      // complete row instead of becoming a new grid item between properties.
      const propertiesGrid = property.closest(".shared-task-drawer-properties");
      const syncEditorPosition = () => {
        const offset = propertiesGrid
          ? Math.max(0, property.getBoundingClientRect().left - propertiesGrid.getBoundingClientRect().left)
          : 0;
        editor.style.setProperty("--shared-agreement-editor-offset", `${offset}px`);
      };
      if (propertiesGrid) propertiesGrid.after(editor);
      else property.after(editor);
      syncEditorPosition();
      if (propertiesGrid) window.addEventListener("resize", syncEditorPosition);
      property.classList.add("is-editing");
      const close = () => {
        if (propertiesGrid) window.removeEventListener("resize", syncEditorPosition);
        editor.remove();
        property.classList.remove("is-editing");
      };
      const singleFields = editor.querySelector("[data-agreement-single-fields]");
      const periodFields = editor.querySelector("[data-agreement-period-fields]");
      const periodTrigger = editor.querySelector("[data-agreement-period]");
      const singleStartInput = editor.querySelector("[data-agreed-date-start]");
      const periodStartInput = editor.querySelector("[data-agreed-date-start-period]");
      const periodEndInput = editor.querySelector("[data-agreed-date-end]");
      const periodStartSummary = editor.querySelector("[data-agreement-period-start-summary]");
      const periodStartSummaryValue = editor.querySelector("[data-agreement-period-start-value]");
      const periodStartInputWrap = editor.querySelector("[data-agreement-period-start-input]");
      const periodStartEdit = editor.querySelector("[data-agreement-period-start-edit]");
      const showPeriodStartInput = show => {
        if (!periodStartInputWrap || !periodStartSummary || !periodStartEdit) return;
        periodStartInputWrap.hidden = !show;
        periodStartSummary.hidden = show;
        periodStartEdit.hidden = show;
      };
      const syncPeriodStartSummary = () => {
        if (periodStartSummaryValue) periodStartSummaryValue.textContent = periodStartInput?.value ? formatAgreedDate(periodStartInput.value) : "尚未選擇";
      };
      const syncPeriodEndMin = () => {
        if (!periodEndInput) return;
        if (periodStartInput?.value) periodEndInput.min = periodStartInput.value;
        else periodEndInput.removeAttribute("min");
      };
      const focusActiveDateInput = () => {
        const input = editor.dataset.agreementMode === "period" ? periodStartInput : singleStartInput;
        input?.focus();
      };
      periodTrigger?.addEventListener("click", () => {
        editor.dataset.agreementMode = "period";
        editor.setAttribute("aria-label", "編輯約定期間");
        singleFields?.setAttribute("hidden", "true");
        periodFields?.removeAttribute("hidden");
        if (periodStartInput && !periodStartInput.value) periodStartInput.value = singleStartInput?.value || "";
        syncPeriodStartSummary();
        showPeriodStartInput(!periodStartInput?.value || !singleStartInput?.value);
        syncPeriodEndMin();
        (periodStartInput?.value && singleStartInput?.value ? periodEndInput : periodStartInput)?.focus();
      });
      periodStartEdit?.addEventListener("click", () => {
        showPeriodStartInput(true);
        periodStartInput?.focus();
      });
      editor.querySelector("[data-agreed-date-clear]")?.addEventListener("click", () => {
        editor.dataset.agreementMode = "single";
        editor.setAttribute("aria-label", "編輯約定日期");
        editor.querySelectorAll("input[type=date]").forEach(input => { input.value = ""; });
        periodFields?.setAttribute("hidden", "true");
        singleFields?.removeAttribute("hidden");
        syncPeriodStartSummary();
        showPeriodStartInput(true);
        syncPeriodEndMin();
        focusActiveDateInput();
      });
      periodStartInput?.addEventListener("input", syncPeriodEndMin);
      periodStartInput?.addEventListener("change", syncPeriodEndMin);
      periodStartInput?.addEventListener("input", syncPeriodStartSummary);
      periodStartInput?.addEventListener("change", syncPeriodStartSummary);
      syncPeriodStartSummary();
      syncPeriodEndMin();
      editor.querySelector("[data-agreed-date-cancel]")?.addEventListener("click", close);
      editor.querySelector("[data-agreed-date-save]")?.addEventListener("click", async event => {
        const save = event.currentTarget;
        const selectedMode = editor.dataset.agreementMode === "period" ? "period" : "single";
        const nextStart = selectedMode === "period"
          ? editor.querySelector("[data-agreed-date-start-period]")?.value || ""
          : editor.querySelector("[data-agreed-date-start]")?.value || "";
        const nextEnd = selectedMode === "period" ? editor.querySelector("[data-agreed-date-end]")?.value || "" : "";
        if (!nextStart && nextEnd) {
          setBanner("約定期間必須先選擇開始日期。", "error");
          return;
        }
        if (selectedMode === "period" && !nextEnd) {
          setBanner("請選擇約定期間的結束日期，或改用單日約定。", "error");
          return;
        }
        if (nextStart && nextEnd && nextEnd < nextStart) {
          setBanner("約定日期區間的結束日期不可早於開始日期。", "error");
          return;
        }
        save.disabled = true;
        try {
          await executeSharedTaskAction(task, "setAgreementSchedule", {
            mode: nextStart ? selectedMode : null,
            startDate: nextStart || null,
            endDate: nextEnd || null
          }, {
            onSuccess: () => {
              close();
              setBanner(state.applicationScope === "c" ? "約定排程已保存至 C 母版 Cloud 資料。" : "約定排程已保存至正式 Cloud。", "success");
            }
          });
        } catch (error) {
          save.disabled = false;
        setBanner("約定日期保存失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次更新。" : "正式 WorkTodo controlled write 未接受這次更新。")), "error");
        }
      });
      focusActiveDateInput();
    };
  }
  async function openTaskDetail(task, options = {}) {
    ensureTaskDetailModal();
    const modal = document.getElementById("taskDetailModal");
    const body = document.getElementById("taskDetailBody");
    const cTemplate = state.applicationScope === "c";
    const workTodoDomainMode = !cTemplate && isWorkTodoTask(task);
    const workTodo = workTodoDomainMode || cTemplate;
    const archiveOnly = options.readOnly === true || isArchiveTask(task);
    state.activeTaskId = String(task?.id || "");
    const drawer = root.ZhugeSharedTaskDrawer;
    const drawerRenderer = root.ZhugeGoldenMaster?.renderDrawer;
    const drawerContract = root.ZhugeGoldenMaster?.assertSharedDrawerContract?.({
      consumer: cTemplate ? "c_mdtk" : workTodo ? "worktodo" : "ai-board",
      adapter: cTemplate
        ? sharedActionAdapters?.create?.({ task, service: activeService(), applicationScope: "c", cTemplate: true })
        : workTodoDomainMode ? root.ZhugeWorkTodoTaskAdapter : null,
      drawer
    });
    if (drawerContract && !drawerContract.ok) {
      body.innerHTML = `<div class="board-empty" data-shared-drawer-contract-error="${esc(drawerContract.code)}">Shared Task Drawer contract 未通過；未執行任何 Cloud 寫入。</div>`;
      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
      return;
    }
    const workTodoDomain = workTodoDomainMode ? await loadWorkTodoDrawerData(task) : null;
    const workTodoViewModel = workTodoDomain?.viewModel || null;
    const drawerTask = workTodoViewModel
      ? { ...task, summary: task.summary || workTodoViewModel.workContent || "", usageScenario: task.usageScenario || workTodoViewModel.task?.usageScenario || "" }
      : task;
    const itemLabel = workItemLabel(task);
    const title = task.title || "未命名 " + itemLabel;
    const titleCode = task.workCode || itemLabel;
    const progressComposer = workTodo || cTemplate
      ? progressNoteComposerMarkup(archiveOnly, { workTodo: true, cTemplate })
      : progressNoteComposerMarkup(archiveOnly);
    const properties = [
      { key: "workspace", icon: "📍", label: "工作區", value: workspaceLabel(task) },
      { key: "status", icon: "◉", label: "目前狀態", value: readableWorkStatus(task) },
      ...((workTodo || cTemplate) ? [{ key: "agreement-schedule", action: "agreement-schedule", interactive: !archiveOnly, icon: "📅", label: agreedDateParts(task, workTodoViewModel).mode === "period" ? "約定期間" : "約定日期", value: agreedDateLabel(task, workTodoViewModel) }] : []),
      { key: "gpt-analysis", action: "gpt-analysis", interactive: true, icon: "🤖", label: "GPT 分析與建議", value: "開啟" }
    ];
    const sections = [
      { id: "requirements", title: "工作內容", className: "task-content-section", html: editableTaskFieldMarkup(drawerTask, "summary", { readOnly: archiveOnly }) },
      { id: "usage", title: "使用情境", className: "task-content-section", html: editableTaskFieldMarkup(drawerTask, "usage_scenario", { readOnly: archiveOnly }) },
      { id: "attachments", title: "📎 附件", hint: "圖片、文件與正式交付物", className: "task-attachments-section", html: `<div id="taskAttachments"><div class="board-empty">讀取中…</div></div>` },
      { id: "pm-acceptance", title: "🙋 需要你的操作", hint: "只在真正輪到 PM 時顯示", className: "pm-acceptance-section", hidden: true, html: `<div id="pmAcceptanceAction"></div>` }
    ];
    if (drawer?.render || drawerRenderer) {
      const drawerOptions = {
        title,
        titleCode,
        itemLabel,
        titleEditable: !archiveOnly,
          subtitle: cTemplate
            ? (archiveOnly ? "C 母版 · 📦 Read-only" : "C 母版 · Shared Task Drawer")
            : workTodo
            ? (archiveOnly ? "工作待辦 · 📦 Archive Read-only" : "工作待辦 · Shared Task Drawer")
            : (archiveOnly ? "AI Board · 📦 Archive Read-only" : "AI Board · Shared Task Drawer"),
        properties,
        sections,
        readOnly: archiveOnly,
        activity: {
          title: "💬 工作進度",
          hint: "只顯示工作進度；System Activity 與 Workspace Audit 保留於正式紀錄",
          topHtml: taskChecklistPanelMarkup(),
          composerHtml: "",
          bottomHtml: archiveOnly ? `<div class="shared-task-progress-readonly" data-progress-note-write="readonly">封存資料僅供查閱；工作進度不可新增、修改或刪除。</div>` : "",
          floatingHtml: progressComposer,
          notesHtml: `<div id="taskHumanNotes"><div class="board-empty">讀取中…</div></div>`,
          html: "<div class=\"board-empty\">讀取中…</div>"
        },
        footerHtml: ""
      };
      body.innerHTML = drawerRenderer ? drawerRenderer(drawerOptions) : drawer.render(drawerOptions);
    } else {
      body.innerHTML = "<div class=\"board-empty\">Shared Task Drawer foundation 尚未載入；未執行任何 Cloud 寫入。</div>";
    }
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    body.querySelectorAll("[data-governance]").forEach(button => { button.onclick = () => applyGovernanceAction(task, button.dataset.governance); });
    try {
      const [items, taskChecklistItems] = workTodoDomainMode
        ? [[], workTodoViewModel?.checklist || []]
        : cTemplate
        ? [[], await activeService().loadTaskChecklist(task.id)]
        : await Promise.all([
          activeService().loadChecklist(task.id),
          typeof activeService().loadTaskChecklist === "function" ? activeService().loadTaskChecklist(task.id) : Promise.resolve([])
        ]);
      const taskChecklistRows = document.getElementById("taskChecklistRows");
      // WorkTodo and AI Board both use the same Checklist presentation.  The
      // domain branch lives in wireTaskChecklist(), so WorkTodo must not be
      // made read-only merely because it uses its own controlled writer.
      if (taskChecklistRows) taskChecklistRows.innerHTML = taskChecklistMarkup(taskChecklistItems, archiveOnly);
      const taskChecklistPanel = body.querySelector("[data-task-checklist-panel]");
      const taskChecklistCount = taskChecklistPanel?.querySelector("[data-task-checklist-count]");
      if (taskChecklistCount) taskChecklistCount.textContent = taskChecklistCountMarkup(taskChecklistItems);
      // EP-039 / GM-D009: the Golden Master owns the initial interaction
      // state. Data presence must never auto-expand the shared Checklist.
      if (taskChecklistPanel) taskChecklistPanel.open = false;
      const verification = engineeringVerificationState(items);
      const pmAcceptanceItem = cTemplate ? null : items.find(isPmAcceptanceItem);
      const pmAcceptanceAction = document.getElementById("pmAcceptanceAction");
      const pmMarkup = pmAcceptanceMarkup(pmAcceptanceItem, archiveOnly, task, verification);
      const pmAcceptanceSection = body.querySelector('[data-shared-task-drawer-section="pm-acceptance"]');
      if (pmAcceptanceSection) pmAcceptanceSection.hidden = !pmMarkup;
      if (pmAcceptanceAction) pmAcceptanceAction.innerHTML = pmMarkup;
      let activity = [];
      let artifacts = [];
      let attachments = [];
      let attachmentError = null;
      if (workTodoDomainMode) {
        activity = workTodoViewModel?.activity || [];
        attachments = workTodoViewModel?.attachments || [];
        attachmentError = workTodoDomain?.capabilityError || null;
      } else {
        const [activityResult, artifactResult, attachmentResult] = await Promise.allSettled([
          typeof activeService().loadActivity === "function" ? activeService().loadActivity(task.id, { checklistItems: items }) : Promise.resolve([]),
          typeof activeService().loadArtifacts === "function" ? activeService().loadArtifacts(task) : Promise.resolve([]),
          typeof activeService().loadTaskAttachments === "function" ? activeService().loadTaskAttachments(task.id) : Promise.resolve([])
        ]);
        activity = activityResult.status === "fulfilled" ? activityResult.value : [];
        artifacts = artifactResult.status === "fulfilled" ? artifactResult.value : [];
        attachments = attachmentResult.status === "fulfilled" ? attachmentResult.value : [];
        attachmentError = attachmentResult.status === "rejected" ? attachmentResult.reason : null;
      }
      const attachmentSection = body.querySelector('[data-shared-task-drawer-section="attachments"]');
      const attachmentZone = document.getElementById("taskAttachments");
      const attachmentHtml = attachmentMarkup(attachments, artifacts, attachmentError, archiveOnly, { workTodo: workTodo || cTemplate });
      if (attachmentZone) attachmentZone.innerHTML = attachmentHtml;
      if (attachmentSection) attachmentSection.hidden = false;
      const humanNotes = humanNotesMarkup(drawerTask);
      const humanNotesZone = document.getElementById("taskHumanNotes");
      if (humanNotesZone) {
        humanNotesZone.innerHTML = humanNotes;
        humanNotesZone.hidden = !humanNotes;
      }
      document.getElementById("taskActivityList").innerHTML = activityMarkup(activity, attachments, { readOnly: archiveOnly, workTodo });
      wireTaskInlineEditors(task, archiveOnly);
      wireTaskTitleEditor(task, archiveOnly);
      wireTaskChecklist(task, taskChecklistItems, archiveOnly);
      wireTaskAttachments(task, archiveOnly, { rawAttachments: cTemplate ? attachments : workTodoDomain?.capabilityData?.attachments || [] });
      wireProgressNoteComposer(task, archiveOnly);
      wireHumanProgressNoteActions(task, activity, archiveOnly);
      wireAgreedDateProperty(task, workTodoViewModel, archiveOnly);
      wireTaskAnalysisView(task);
      const acceptance = document.getElementById("pmAcceptanceAction");
      if (!archiveOnly && acceptance) {
        acceptance.querySelectorAll("[data-pm-accept]").forEach(button => {
          button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.pmAccept), "pass");
        });
        acceptance.querySelectorAll("[data-pm-reject]").forEach(button => {
          button.onclick = () => updateChecklistItem(task, items.find(item => item.id === button.dataset.pmReject), "fail");
        });
      }
    } catch (error) {
      const pmAcceptanceSection = body.querySelector('[data-shared-task-drawer-section="pm-acceptance"]');
      if (pmAcceptanceSection) pmAcceptanceSection.hidden = true;
      document.getElementById("taskActivityList").innerHTML = "<div class=\"task-read-warning\">進度與治理讀取未完成；沒有寫入任何資料。</div>";
    }
  }
  async function updateChecklistItem(task, item, nextState) {
    if (!item) return;
    let note = item.evidenceNote || "";
    if (nextState === "pass" || nextState === "fail") {
      note = window.prompt("請輸入必要 Evidence／Note", note);
      if (!note || !note.trim()) { setBanner("通過或退回前必須填寫驗收說明。", "error"); await openTaskDetail(task); return; }
    }
    try {
      await executeSharedTaskAction(task, "updateGovernanceChecklist", { id: item.id, state: nextState, evidenceNote: note || "" }, { refresh: false, reopen: false });
      await openTaskDetail(task);
      setBanner("Checklist 狀態與 Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function updateChecklistEvidence(task, item) {
    if (!item) return;
    const note = window.prompt("請補充驗收證據或操作說明", item.evidenceNote || "");
    if (note === null) return;
    try {
      await executeSharedTaskAction(task, "updateGovernanceChecklist", { id: item.id, state: item.state, evidenceNote: note.trim() }, { refresh: false, reopen: false });
      await openTaskDetail(task);
      setBanner("Checklist Evidence 已更新。", "success");
    } catch (error) { setBanner("Checklist Evidence 更新失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  function openQuickAdd(workspace) {
    state.pendingCreateWorkspaceId = String(workspace || "");
    const modal = document.getElementById("addCardModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.style.display = "grid";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    drawer?.classList.add("is-open");
  }
  function closeQuickAdd() {
    state.pendingCreateWorkspaceId = "";
    const modal = document.getElementById("addCardModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    drawer?.classList.remove("is-open");
  }
  function openWorkspaceDrawer() {
    const backdrop = document.getElementById("workspaceCreateDrawerBackdrop");
    const drawer = document.getElementById("workspaceCreateDrawer");
    if (!backdrop || !drawer) return;
    backdrop.classList.add("is-open");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    const input = document.getElementById("workspaceName");
    if (input) {
      input.value = "";
      window.setTimeout(() => input.focus(), 0);
    }
  }
  function closeWorkspaceDrawer() {
    const backdrop = document.getElementById("workspaceCreateDrawerBackdrop");
    const drawer = document.getElementById("workspaceCreateDrawer");
    backdrop?.classList.remove("is-open");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
  }
  async function createWorkspace() {
    const input = document.getElementById("workspaceName");
    const name = input?.value?.trim() || "";
    if (!name) {
      setBanner("請輸入工作區名稱。", "error");
      input?.focus();
      return;
    }
    const button = document.querySelector("[data-workspace-create]");
    if (button) button.disabled = true;
    try {
      await executeSharedTaskAction(null, "createWorkspace", { name }, { refresh: false, reopen: false });
      closeWorkspaceDrawer();
      await refreshBoard({ quiet: true });
      setBanner(state.applicationScope === "c" ? "工作區「" + esc(name) + "」已建立並保存至 C 母版 Cloud 資料。" : "工作區「" + esc(name) + "」已建立並保存至 Cloud。", "success");
    } catch (error) {
      setBanner("工作區建立失敗：" + esc(error?.message || (state.applicationScope === "c" ? "C 母版 Cloud 資料未接受這次建立。" : "正式 Cloud 未接受這次建立。")), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }
  function closeConsumerCreate() {
    const modal = document.getElementById("consumerCreateModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    drawer?.classList.remove("is-open");
  }
  function openConsumerCreate() {
    if (state.applicationScope !== "c" || !state.boardIsTemplate) return;
    const modal = document.getElementById("consumerCreateModal");
    if (!modal) return;
    const drawer = modal.querySelector(".board-create-drawer");
    modal.style.display = "grid";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    drawer?.classList.add("is-open");
    const status = document.getElementById("consumerCreateStatus");
    if (status) { status.textContent = ""; status.removeAttribute("data-state"); }
    const open = document.querySelector("[data-consumer-create-open]");
    if (open) { open.hidden = true; open.removeAttribute("href"); }
    const button = document.querySelector("[data-consumer-create]");
    if (button) { button.hidden = false; button.disabled = false; button.textContent = "建立並套用 C 母版"; }
    window.setTimeout(() => document.getElementById("consumerBoardName")?.focus(), 0);
  }
  function consumerRuntimeHref(boardInstanceId) {
    const current = String(root.location?.pathname || "/app/Board/template-preview/") || "/app/Board/template-preview/";
    const url = new URL(current, root.location?.href || "http://127.0.0.1/");
    url.search = `?templateView=board&boardInstanceId=${encodeURIComponent(String(boardInstanceId || ""))}`;
    return `${url.pathname}${url.search}`;
  }
  async function createConsumer() {
    if (state.applicationScope !== "c" || !state.boardIsTemplate) return;
    const nameInput = document.getElementById("consumerBoardName");
    const prefixInput = document.getElementById("consumerBoardPrefix");
    const name = String(nameInput?.value || "").trim();
    const prefix = String(prefixInput?.value || "").trim().toUpperCase();
    const status = document.getElementById("consumerCreateStatus");
    const button = document.querySelector("[data-consumer-create]");
    if (!name) {
      if (status) { status.textContent = "請輸入看板名稱。"; status.dataset.state = "error"; }
      nameInput?.focus();
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,15}$/.test(prefix)) {
      if (status) { status.textContent = "看板代號需為 2–16 碼英文字母／數字，第一碼必須是英文字母。"; status.dataset.state = "error"; }
      prefixInput?.focus();
      return;
    }
    const confirmation = `建立並套用 C 母版？\n\n看板名稱：${name}\n看板代號：${prefix}\n\n系統將建立獨立資料範圍、四個預設工作區，並採用目前已發布的 C。\n不會搬移或修改 C、WorkTodo、AI Board 的資料。`;
    if (typeof root.confirm === "function" && !root.confirm(confirmation)) return;
    if (button) button.disabled = true;
    if (status) { status.textContent = "正在建立看板：Cloud Provisioning 處理中…"; status.dataset.state = "loading"; }
    try {
      const result = await defaultService.provisionConsumer({ name, taskCodePrefix: prefix, templateKey: "c" });
      const instance = result?.board_instance || result?.boardInstance || result?.instance;
      const instanceId = String(instance?.id || result?.board_instance_id || "").trim();
      if (!instanceId) throw new Error("Provisioning 未回傳可用的 Board Identity；未顯示成功。" );
      if (status) { status.textContent = `已建立「${name}」；預設工作區與 Published C 已完成套用。`; status.dataset.state = "success"; }
      const open = document.querySelector("[data-consumer-create-open]");
      if (open) { open.href = consumerRuntimeHref(instanceId); open.hidden = false; }
      if (button) { button.hidden = true; button.disabled = false; }
      root.ZhugeSharedNavigation?.refresh?.({ activeBoardInstanceId: instanceId });
    } catch (error) {
      if (status) { status.textContent = `建立看板失敗：${error?.message || "Cloud Provisioning 未完成；未建立可用 Consumer。"}`; status.dataset.state = "error"; }
      if (button) button.disabled = false;
    }
  }
  function renderBoardHeaderActions() {
    const actions = document.querySelector("[data-zhuge-shared-header='true'] .zhuge-shared-header-actions");
    if (!actions) return;
    actions.innerHTML = root.ZhugeGoldenMaster?.renderHeaderActions?.({ applicationScope: state.applicationScope, canCreateConsumer: state.boardIsTemplate }) || "";
    const defaultWorkspaceKey = state.applicationScope === "c"
      ? defaultBoardWorkspaceKey()
      : state.applicationScope === "worktodo" ? "worktodo-todo" : "todo";
    actions.querySelector("[data-board-create-consumer]")?.addEventListener("click", openConsumerCreate);
    actions.querySelector("[data-board-create-card]")?.addEventListener("click", () => openQuickAdd(defaultWorkspaceKey));
    actions.querySelector("[data-board-create-workspace]")?.addEventListener("click", openWorkspaceDrawer);
    actions.querySelector("[data-board-open-archive]")?.addEventListener("click", openArchiveDrawer);
    actions.querySelector("#refreshBoardBtn")?.addEventListener("click", () => refreshBoard());
  }
  async function createCard() {
    const modal = document.getElementById("addCardModal");
    const summary = modal?.querySelector("#taskSummary")?.value?.trim() || "";
    const usageScenario = modal?.querySelector("#taskUsageScenario")?.value?.trim() || "";
    const title = modal?.querySelector("#taskTitle")?.value?.trim() || summary.slice(0, 80);
    const itemLabel = workItemLabel();
    const workspace = state.workspaces.find(row => String(row.id) === state.pendingCreateWorkspaceId || String(row.key) === state.pendingCreateWorkspaceId);
    const workspaceId = workspace?.id || null;
    if (!title) { setBanner("請輸入 " + itemLabel + " 標題或內容。", "error"); return; }
    try {
      if (state.applicationScope === "worktodo") {
        await executeSharedTaskAction(null, "createTask", { title, summary, status: "not_started", usageScenario, workspaceId }, { refresh: false, reopen: false });
      } else {
        await executeSharedTaskAction(null, "createTask", { title, summary, status: state.applicationScope === "c" ? "not_started" : "ready", usageScenario, workspaceId }, { refresh: false, reopen: false });
      }
      closeQuickAdd();
      modal.querySelectorAll("input, textarea").forEach(field => { field.value = ""; });
      await refreshBoard({ quiet: true });
      setBanner(state.applicationScope === "c" ? `${esc(workItemLabel())} 已建立並進入「待開始」。` : state.applicationScope === "worktodo" ? "WLTK 已建立並進入「待開始」。" : "TASK 已建立並進入待辦，由 Co 接球。", "success");
    } catch (error) { setBanner(itemLabel + " 建立失敗：" + esc(error && error.message || "未知錯誤"), "error"); }
  }
  async function refreshBoard(options) {
    options = options || {};
    if (state.refreshPromise) return state.refreshPromise;
    if (!options.quiet) clearBanner();
    const service = activeService();
    const loadOptions = { applicationScope: state.applicationScope };
    if (state.applicationScope === "c" && state.boardInstanceId) loadOptions.boardInstanceId = state.boardInstanceId;
    state.refreshPromise = service.load(loadOptions).then(async result => {
      const previousIdentity = `${state.boardName}|${state.taskCodePrefix}|${state.boardIsTemplate}|${state.consumerId}`;
      state.boardInstanceId = result.boardInstanceId || state.boardInstanceId;
      state.boardName = String(result.boardName || state.boardName || "");
      state.taskCodePrefix = String(result.taskCodePrefix || state.taskCodePrefix || (state.applicationScope === "c" ? "MDTK" : "")).toUpperCase();
      state.boardIsTemplate = state.applicationScope === "c" && (result.isTemplateInstance === true || (!state.boardInstanceId && !result.consumerId));
      state.consumerId = String(result.consumerId || state.consumerId || moduleConsumerId(state.applicationScope));
      state.workspaces = result.workspaces || [];
      state.tasks = result.tasks;
      state.principles = result.principles;
      state.systemMaps = result.systemMaps || [];
      state.taskById = new Map(result.tasks.map(task => [task.id, task]));
      state.workspaceById = new Map(state.workspaces.map(workspace => [workspace.id, workspace]));
      renderPrinciples(result.principles);
      renderSystemMaps(state.systemMaps);
      if (state.applicationScope === "c" && previousIdentity !== `${state.boardName}|${state.taskCodePrefix}|${state.boardIsTemplate}|${state.consumerId}`) {
        renderGoldenMasterToolbar();
        wireSearch();
        renderBoardHeaderActions();
        mountCTemplateReleasePanel();
      }
      syncRuntimeIdentityLabels();
      renderTasks(visibleTasks());
      if (document.getElementById("archiveDrawer")?.classList.contains("is-open")) renderArchive();
      setConnection(result.tasks.length, result.principles.length, !!state.stopRealtime);
      root.ZhugeSharedNavigation?.refresh?.({ activeBoardInstanceId: state.boardInstanceId });
      if (result.engineeringMemoryFailures?.length) {
        const failures = result.engineeringMemoryFailures.map(item => `${esc(item.knowledgeCode || "Engineering Principle")} | ${esc(item.reason)}`).join("；");
        setBanner("Canonical Retrieval Failed：" + failures + "。未使用舊文件或舊 Context fallback。", "error");
      } else if (document.getElementById("boardReadStatus")?.dataset.state === "loading") {
        clearBanner();
      }
      return result;
    }).catch(error => {
      const loginLink = "../../../?app=1";
      const message = error && error.code === "BOARD_SESSION_REQUIRED" ? "請先登入 Zhuge AI OS，再開啟 AI Board。<a href=\"" + loginLink + "\">前往登入</a>" : "正式 Cloud Read 失敗：" + esc(error && error.message || "未知錯誤") + "。請重新整理或確認 Shared Session。";
      setBanner(message, "error");
      root.ZhugeSharedNavigation?.setSyncStatus?.({ label: "🔴 同步失敗", time: "請重新整理", state: "error" });
      throw error;
    }).finally(() => { state.refreshPromise = null; });
    return state.refreshPromise;
  }
  function initRealtime() {
    activeService().subscribe(() => {
      if (state.realtimeTimer) clearTimeout(state.realtimeTimer);
      state.realtimeTimer = setTimeout(() => {
        refreshBoard({ quiet: true }).then(() => {
          const modal = document.getElementById("taskDetailModal");
          const activeTask = state.activeTaskId ? state.taskById.get(state.activeTaskId) : null;
          if (modal?.style.display === "block" && activeTask) {
            return openTaskDetail(activeTask, { readOnly: isArchiveTask(activeTask) });
          }
          return null;
        }).catch(() => {});
      }, 160);
    }).then(stop => {
      state.stopRealtime = stop;
      setConnection(state.tasks.length, state.principles.length, true);
    }).catch(error => setBanner("Realtime 尚未連線：" + esc(error && error.message || "未知錯誤") + "。Refresh 可作為暫時 Recovery。", "error"));
  }
  function enableBoardActions() {
    root.ZhugeGoldenMaster?.mountOperations?.(document.body, { applicationScope: state.applicationScope, itemLabel: workItemLabel(), canCreateConsumer: state.boardIsTemplate });
    renderBoardHeaderActions();
    wireArchiveControls();
    document.querySelectorAll("[data-workspace-drawer-close]").forEach(button => button.addEventListener("click", closeWorkspaceDrawer));
    document.querySelector("[data-workspace-create]")?.addEventListener("click", createWorkspace);
    document.getElementById("workspaceName")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); createWorkspace(); }
    });
    document.querySelector("#addCardModal .x")?.addEventListener("click", closeQuickAdd);
    document.querySelector("#addCardModal .modalfoot .btn:not(.primary)")?.addEventListener("click", closeQuickAdd);
    document.querySelector("[data-golden-master-create-card]")?.addEventListener("click", createCard);
    document.querySelectorAll("[data-consumer-create-close]").forEach(button => button.addEventListener("click", closeConsumerCreate));
    document.querySelector("[data-consumer-create]")?.addEventListener("click", createConsumer);
    document.getElementById("consumerBoardPrefix")?.addEventListener("input", event => {
      event.target.value = String(event.target.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
    document.getElementById("consumerBoardName")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); document.getElementById("consumerBoardPrefix")?.focus(); }
    });
    document.getElementById("consumerBoardPrefix")?.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); createConsumer(); }
    });
    document.querySelectorAll(".add").forEach(button => { button.disabled = false; button.removeAttribute("aria-disabled"); });
  }
  function queryParameter(name) {
    const search = String(root.location?.search || "");
    const SearchParams = root.URLSearchParams || (typeof URLSearchParams === "function" ? URLSearchParams : null);
    if (SearchParams) return new SearchParams(search).get(name) || "";
    const match = search.match(new RegExp("(?:^|[?&])" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)"));
    return match ? decodeURIComponent(match[1].replace(/\+/g, " ")) : "";
  }
  function startBoardRuntime(options = {}) {
    const cTemplate = options.applicationScope === "c" || isCTemplateMode();
    state.applicationScope = cTemplate
      ? "c"
      : options.applicationScope === "worktodo" || isWorkTodoMode() ? "worktodo" : "ai_board";
    state.moduleId = String(options.moduleId || "c").trim().toLowerCase() || "c";
    const requestedBoardInstanceId = String(options.boardInstanceId || queryParameter("boardInstanceId") || "").trim();
    state.boardInstanceId = requestedBoardInstanceId;
    state.boardIsTemplate = state.applicationScope === "c" && !requestedBoardInstanceId;
    state.consumerId = state.applicationScope === "c"
      ? (state.boardIsTemplate ? "c" : requestedBoardInstanceId)
      : moduleConsumerId(state.applicationScope);
    state.boardName = state.boardIsTemplate ? "C 唯一看板母版" : "";
    state.taskCodePrefix = state.applicationScope === "c" ? "MDTK" : "";
    state.service = options.service || (state.applicationScope === "c"
      ? defaultService.createInstanceService({ templateKey: "c", boardInstanceId: requestedBoardInstanceId, consumerId: state.consumerId })
      : defaultService);
    if (state.applicationScope !== "worktodo" && state.applicationScope !== "c") {
      mountCreatorMfaSettings(accessContext);
    }
    renderGoldenMasterToolbar();
    applyModuleReleaseIdentity();
    bindModuleReleaseUpdates();
    mountCTemplateReleasePanel();
    enableBoardActions();
    ensureHealthModal();
    document.getElementById("healthCheckBtn")?.addEventListener("click", runHealthCheck);
    wireTemplateParityCheck();
    ensureTaskDetailModal();
    wireNavigation();
    wireSearch();
    renderPrinciples([]);
    renderSystemMaps([]);
    renderTasks([]);
    root.openQuickAdd = openQuickAdd;
    root.createCard = createCard;
    root.createWorkspace = createWorkspace;
    root.openArchiveDrawer = openArchiveDrawer;
    const initialView = new URLSearchParams(root.location.search).get("view");
    if (["principles", "system-map"].includes(initialView)) {
      const nav = document.querySelector(`[data-board-nav="${initialView}"]`);
      nav?.click();
    } else showBoardView("board");
    hydrateModuleRelease();
    refreshBoard().then(initRealtime).catch(() => {});
  }

  let originalMainMarkup = null;
  let accessContext = null;
  let boardSessionHydrationPromise = null;

  function captureBoardMarkup() {
    const main = document.querySelector(".main");
    if (main && originalMainMarkup === null) {
      // The shared shell may already have rendered the header by the time the
      // board gate runs. Mark it as mounted so restoring the board does not
      // remount it with the generic fallback title.
      main.querySelector("[data-zhuge-shared-header]")?.setAttribute("data-mounted", "true");
      originalMainMarkup = main.innerHTML;
    }
  }

  function sharedHeaderMarkup() {
    const header = document.querySelector(".main [data-zhuge-shared-header]");
    if (!header) return "";
    const clone = header.cloneNode(true);
    clone.setAttribute("data-mounted", "true");
    clone.querySelector(".zhuge-shared-header-actions")?.remove();
    return clone.outerHTML;
  }

  function renderAccessState({ title, message, kind = "info", body = "", panelClass = "" } = {}) {
    const main = document.querySelector(".main");
    if (!main) return;
    const workTodo = isWorkTodoMode();
    main.innerHTML = `${sharedHeaderMarkup()}<section class="board-access-state" data-state="${esc(kind)}">
      <div class="board-access-panel ${esc(panelClass)}">
        <div class="board-access-eyebrow">${workTodo ? "WORKTODO · 工作待辦" : "AI BOARD · 工程治理工作區"}</div>
        <h2>${esc(title || (workTodo ? "工作待辦" : "AI Board"))}</h2>
        <p class="board-access-message">${esc(message || "")}</p>
        ${body}
      </div>
    </section>`;
  }

  function renderLoginState() {
    const workTodo = isWorkTodoMode();
    renderAccessState({
      title: workTodo ? "請先登入工作待辦" : "請先登入 AI Board",
      message: workTodo ? "工作待辦需要目前登入的 UUID，才能只讀寫自己的正式資料。" : "AI Board 包含工程治理、GPT 審查與 Co 協作資料，請先登入 Zhuge AI OS。",
      kind: "login",
      body: `<div class="board-access-actions"><a class="btn primary" href="../../../?app=1">前往登入</a><a class="btn" href="../../../app/dashboard/">回到 Dashboard</a></div>`
    });
  }

  function renderSessionHydrationState() {
    const workTodo = isWorkTodoMode();
    renderAccessState({
      title: workTodo ? "正在恢復工作待辦" : "正在恢復 AI Board",
      message: "正在檢查登入工作階段，完成前不會判定為未登入。",
      kind: "loading",
      body: `<div class="board-access-progress" role="status">正在同步 Shared Session…</div>`
    });
  }

  function renderAccessError(message) {
    renderAccessState({
      title: isWorkTodoMode() ? "目前無法開啟工作待辦" : "目前無法開啟 AI Board",
      message,
      kind: "error",
      body: `<div class="board-access-actions"><a class="btn" href="../../../app/dashboard/">回到 Dashboard</a><button class="btn" type="button" id="boardAccessRetry">重新檢查</button></div>`
    });
    document.getElementById("boardAccessRetry")?.addEventListener("click", () => init());
  }

  function restoreCapturedBoardMarkup() {
    const main = document.querySelector(".main");
    if (!main || originalMainMarkup === null) return;
    main.innerHTML = originalMainMarkup;
  }

  function restoreBoardMarkup() {
    restoreCapturedBoardMarkup();
    startBoardRuntime();
  }

  function hydrateBoardSession() {
    if (boardSessionHydrationPromise) return boardSessionHydrationPromise;
    boardSessionHydrationPromise = (async () => {
      if (typeof getSupabaseAuthUser !== "function"
        || typeof supabaseSessionFromUser !== "function"
        || typeof persistAiOsSessionOnly !== "function") {
        throw new Error("Shared Auth hydration service 尚未準備完成。");
      }
      const result = await getSupabaseAuthUser();
      if (!result?.user || !result?.authSession?.access_token) return false;
      session = supabaseSessionFromUser(result.user, result.authSession, result.provider);
      persistAiOsSessionOnly();
      document.dispatchEvent(new CustomEvent("zhuge-template-adoption-updated", { detail: { reason: "session-hydrated" } }));
      return true;
    })().finally(() => { boardSessionHydrationPromise = null; });
    return boardSessionHydrationPromise;
  }

  function renderMfaUnlock(context, access) {
    const state = { mode: "loading", factorId: "", qrCode: "", secret: "", error: "", busy: false };
    const paint = () => {
      const error = state.error ? `<div class="board-access-error" role="alert">${esc(state.error)}</div>` : "";
      let body = `<div class="zhuge-mfa-info"><strong>AI Board 需要額外保護</strong><span>完成安全驗證後即可進入工程治理工作區；驗證只會解鎖目前帳號的 AI Board，不會變更登入身份。</span></div>${error}`;
      if (state.mode === "loading") {
        body += `<div class="board-access-progress" role="status">正在檢查安全驗證…</div>`;
      } else if (state.mode === "enrollment_required") {
        body += `<div class="board-access-actions"><button class="btn primary" type="button" id="boardMfaEnroll" ${state.busy ? "disabled" : ""}>開始設定驗證器</button></div>`;
      } else {
        const qr = state.qrCode ? `<div class="zhuge-mfa-qr"><img src="${esc(state.qrCode)}" alt="Google Authenticator 設定 QR Code"><p>用 Google Authenticator 掃描此 QR Code</p>${state.secret ? `<details class="board-access-secret zhuge-mfa-secret"><summary>無法掃描？查看設定金鑰</summary><code>${esc(state.secret)}</code></details>` : ""}</div>` : "";
        body += `<div class="zhuge-mfa-grid">${qr}<div class="zhuge-mfa-step"><div class="zhuge-mfa-info"><strong>完成安全驗證</strong><span>掃描後，輸入 App 顯示的 6 位數驗證碼。QR Code 只用於設定驗證器，不會取代 Google 登入。</span></div><form class="board-access-form zhuge-mfa-form" id="boardMfaForm">
          <label for="boardMfaCode">驗證碼</label>
          <input class="zhuge-mfa-code" id="boardMfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="輸入 6 位數驗證碼" required>
          <button class="btn primary" type="submit" ${state.busy ? "disabled" : ""}>驗證並進入</button>
        </form></div></div>`;
      }
      renderAccessState({ title: "安全驗證", message: "這是受保護的工程治理工作區。", kind: "mfa", body, panelClass: "zhuge-mfa-panel" });
      document.getElementById("boardMfaEnroll")?.addEventListener("click", async () => {
        state.busy = true; state.error = ""; paint();
        try {
          const result = await context.security.enrollTotp();
          state.mode = "enroll"; state.factorId = result.factorId || ""; state.qrCode = result.qrCode || ""; state.secret = result.secret || "";
        } catch (error) {
          state.error = error?.message || "無法開始設定驗證器，請稍後再試。";
        } finally { state.busy = false; paint(); }
      });
      document.getElementById("boardMfaForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const code = document.getElementById("boardMfaCode")?.value || "";
        state.busy = true; state.error = ""; paint();
        try {
          await context.security.verifyUnlock({ factorId: state.factorId, code });
          restoreBoardMarkup();
        } catch (error) {
          state.error = error?.message || "驗證失敗，請確認驗證碼後再試。";
          state.busy = false; paint();
        }
      });
    };
    paint();
    Promise.resolve().then(async () => {
      try {
        const prepared = await context.security.prepareUnlock();
        state.mode = prepared.mode || "enrollment_required";
        state.factorId = prepared.factorId || "";
        state.qrCode = prepared.qrCode || "";
        state.secret = prepared.secret || "";
      } catch (error) {
        state.mode = "enrollment_required";
        state.error = error?.message || "無法檢查驗證器狀態，請稍後再試。";
      }
      paint();
    });
  }

  async function init() {
    const workTodo = isWorkTodoMode();
    const cTemplate = isCTemplateMode();
    captureBoardMarkup();
    if (cTemplate) {
      renderSessionHydrationState();
      let hydrated = false;
      try {
        hydrated = await hydrateBoardSession();
      } catch (error) {
        if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
        renderAccessError("登入工作階段無法恢復，請重新檢查或登入。\n");
        return;
      }
      if (!hydrated) {
        if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
        renderLoginState();
        return;
      }
      restoreCapturedBoardMarkup();
      startBoardRuntime({ applicationScope: "c" });
      return;
    }
    renderSessionHydrationState();
    if (workTodo) {
      let hydrated = false;
      try {
        hydrated = await hydrateBoardSession();
      } catch (error) {
        if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
        renderAccessError("登入工作階段無法恢復，請重新檢查或登入。\n");
        return;
      }
      if (!hydrated) {
        if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
        renderLoginState();
        return;
      }
      restoreCapturedBoardMarkup();
      startBoardRuntime({ applicationScope: "worktodo" });
      return;
    }
    const provider = root.ZhugeRuntimeSessionProvider;
    if (!provider?.createPlatform) {
      renderAccessError("安全服務尚未準備完成，請重新整理後再試。\n");
      return;
    }
    let hydrated = false;
    try {
      hydrated = await hydrateBoardSession();
    } catch (error) {
      if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
      renderAccessError("登入工作階段無法恢復，請重新檢查或登入。\n");
      return;
    }
    if (!hydrated) {
      if (typeof clearStoredAuthSession === "function") clearStoredAuthSession();
      renderLoginState();
      return;
    }
    let context;
    try {
      const platform = provider.createPlatform();
      context = platform.forModule("ai-board");
      accessContext = context;
      await context.creator?.resolve?.();
      await context.security.loadMfaPolicy?.();
      await context.templates?.load?.();
    } catch (error) {
      renderAccessError(error?.message || "安全服務初始化失敗。\n");
      return;
    }
    const access = context.security.evaluate("view");
    if (access.allowed) {
      restoreCapturedBoardMarkup();
      startBoardRuntime();
      return;
    }
    const session = context.session.getSnapshot();
    if (!session.isAuthenticated || access.code === "SESSION_REQUIRED" || access.code === "SESSION_EXPIRED") {
      renderLoginState();
      return;
    }
    if (["STEP_UP_REQUIRED", "MODULE_LOCKED"].includes(access.code)) {
      renderMfaUnlock(context, access);
      return;
    }
    renderAccessError(access.code === "CAPABILITY_REQUIRED" ? "目前登入帳號沒有 AI Board 管理權限。" : "目前帳號尚未通過 AI Board 安全檢查。\n");
  }
  root.ZhugeBoardRuntime = Object.freeze({
    refresh: refreshBoard,
    openTaskDetail: openTaskDetail,
    moveTaskToWorkspace: moveTaskToWorkspace,
    sortTasksByCode: sortTasksByCode,
    completionGateStatus: completionGateStatus,
    completionGateMessage: completionGateMessage,
    runParityGuard: options => runTemplateParityCheck(options?.trigger || "regression", { silent: options?.silent === true }),
    start: startBoardRuntime,
    getSnapshot: () => ({
      applicationScope: state.applicationScope,
      templateRelease: state.templateRelease ? JSON.parse(JSON.stringify(state.templateRelease)) : null,
      workspaces: state.workspaces.slice(),
      tasks: state.tasks.slice(),
      templateParityReport: state.templateParityReport ? JSON.parse(JSON.stringify(state.templateParityReport)) : null
    })
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
