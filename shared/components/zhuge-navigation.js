/* Zhuge AI OS canonical Shared App Shell navigation.
 *
 * Every Workspace mounts this component.  The hierarchy is intentionally
 * defined here (rather than copied by a module) so the shell, labels, active
 * state and collapse behaviour remain one product-wide contract.
 */
(function (global) {
  "use strict";

  const COLLAPSED_KEY = "zhuge_shared_nav_collapsed_v1";
  const CONTROL_GROUP_KEY = "zhuge_shared_nav_control_expanded_v1";
  const DEFAULT_REGISTRY = Object.freeze({
    dashboard: { icon: "🪶", label: "Zhuge AI OS", group: "root", enabled: true, hidden: true, root: true },
    worklog: { icon: "✏️", label: "WorkLog", group: "camp", enabled: true, visible: true },
    // The new WorkTodo consumer is the sole WorkTodo presentation entry.
    "tasks-new": { icon: "✅", label: "工作待辦", group: "camp-child", enabled: true, visible: true },
    // Status badges belong to workspace content, not the canonical global rail.
    // Keeping this entry label-only prevents one module from looking different
    // from the rest of the shared navigation.
    investment: { icon: "📈", label: "Investment", group: "camp", enabled: true, visible: true },
    leisure: { icon: "🎮", label: "休閒小站", group: "system", enabled: true, visible: true },
    "ai-board": { icon: "🤖", label: "AI Board", group: "ai-board", enabled: true, visible: true },
    "ai-board-board": { icon: "📋", label: "工作看板", group: "ai-board-child", enabled: true, visible: true },
    "ai-board-principles": { icon: "📘", label: "工程準則", group: "ai-board-child", enabled: true, visible: true },
    "ai-board-system-map": { icon: "🗺️", label: "系統藍圖", group: "ai-board-child", enabled: true, visible: true },
    procurement: { icon: "🚧", label: "施工中", group: "construction", enabled: false, visible: false, comingSoon: true },
    hr: { icon: "🚧", label: "施工中", group: "construction", enabled: false, visible: false, comingSoon: true },
    travel: { icon: "🚧", label: "施工中", group: "construction", enabled: false, visible: false, comingSoon: true },
    library: { icon: "📚", label: "Knowledge", group: "system", enabled: true, visible: true },
    sync: { icon: "🔗", label: "控制台", group: "system", enabled: true, visible: true },
    settings: { icon: "⚙️", label: "設定", group: "system", enabled: true, visible: true }
  });

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function destination(id, root = "") {
    const base = String(root || "").replace(/\/?$/, "/");
    const paths = {
      dashboard: "app/dashboard/",
      worklog: "modules/worklog/?app=1&workspace=worklog",
      "tasks-new": "app/Board/worktodo/",
      investment: "modules/investment/",
      leisure: "modules/leisure/",
      "ai-board": "app/Board/ai/",
      "ai-board-board": "app/Board/ai/?view=board",
      "ai-board-principles": "app/Board/ai/?view=principles",
      "ai-board-system-map": "app/Board/ai/?view=system-map",
      library: "modules/worklog/?app=1&workspace=library",
      sync: "modules/worklog/?app=1&workspace=sync",
      settings: "modules/worklog/?app=1&workspace=settings"
    };
    return paths[id] ? `${base}${paths[id]}` : "#";
  }

  function registryFor(options) {
    return Object.keys(DEFAULT_REGISTRY).reduce((result, id) => {
      result[id] = { ...DEFAULT_REGISTRY[id], ...(options.workspaceRegistry?.[id] || {}) };
      return result;
    }, {});
  }

  function consumerBoardItems(boardInstances, root) {
    const base = String(root || "").replace(/\/?$/, "/");
    return (Array.isArray(boardInstances) ? boardInstances : [])
      .filter(instance => instance?.id && instance.active !== false)
      .map(instance => {
        const id = `consumer-board:${instance.id}`;
        const prefix = String(instance.taskCodePrefix || "").trim().toUpperCase();
        const name = String(instance.name || "").trim() || prefix || "未命名看板";
        return {
          id,
          boardInstanceId: String(instance.id),
          icon: "▦",
          label: name,
          navLabel: prefix ? `${name}（${prefix}）` : name,
          navTitle: `${name}${prefix ? ` · ${prefix}` : ""}`,
          group: "consumer-boards",
          enabled: true,
          visible: true,
          externalHref: `${base}app/Board/template-preview/?templateView=board&boardInstanceId=${encodeURIComponent(String(instance.id))}`
        };
      });
  }

  function isVisible(item) {
    return Boolean(item && item.enabled !== false && item.visible !== false && !item.comingSoon);
  }

  function itemMarkup(id, item, options, esc, depth = 0) {
    const active = options.activeBoardInstanceId && item.boardInstanceId
      ? String(options.activeBoardInstanceId) === String(item.boardInstanceId)
      : options.activeWorkspace === id || (id === "ai-board" && String(options.activeWorkspace || "").startsWith("ai-board"));
    const label = `<span class="side-item-icon" aria-hidden="true">${esc(item.icon || "□")}</span><span class="side-item-label">${esc(item.navLabel || item.label)}</span>`;
    const attrs = `data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}" title="${esc(item.navTitle || item.navLabel || item.label)}"`;
    const cls = `side-item ${active ? "on" : ""} ${depth ? "side-item-child" : ""}`;
    if (!item.enabled || item.comingSoon) {
      return `<div class="${cls} disabled" ${attrs} aria-disabled="true">${label}${item.comingSoon ? "<small>施工中</small>" : ""}</div>`;
    }
    const href = item.externalHref || (options.externalRoot ? destination(id, options.externalRoot) : "#");
    if (options.externalRoot || item.externalHref) {
      return `<a class="${cls}" ${attrs} href="${esc(href)}">${label}${item.status ? `<small>${esc(item.status)}</small>` : ""}</a>`;
    }
    return `<button type="button" class="${cls}" ${attrs}>${label}${item.status ? `<small>${esc(item.status)}</small>` : ""}</button>`;
  }

  function sectionHeadingMarkup(title, icon, id, registry, options, esc) {
    const item = registry[id];
    if (!item) return `<h3><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></h3>`;
    const active = options.activeWorkspace === id || String(options.activeWorkspace || "").startsWith(`${id}-`);
    const href = options.externalRoot ? destination(id, options.externalRoot) : (item.externalHref || "#");
    return `<a class="side-section-heading ${active ? "on" : ""}" data-shared-nav-item="${esc(id)}" data-open-workspace="${esc(id)}" href="${esc(href)}" title="${esc(title)}"><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></a>`;
  }

  function sectionMarkup(title, icon, ids, registry, options, esc, group, childIndexes = [], headingId = null) {
    const visibleIds = ids.filter(id => isVisible(registry[id]));
    if (!visibleIds.length && (!headingId || !isVisible(registry[headingId]))) return "";
    const items = visibleIds.map(id => itemMarkup(id, registry[id], options, esc, childIndexes.includes(ids.indexOf(id)) ? 1 : 0)).join("");
    const heading = headingId ? sectionHeadingMarkup(title, icon, headingId, registry, options, esc) : `<h3><span class="nav-section-icon" aria-hidden="true">${esc(icon)}</span><span class="nav-section-label">${esc(title)}</span></h3>`;
    return `<div class="side-section" data-nav-group="${esc(group)}">${heading}${items}</div>`;
  }

  function controlGroupMarkup(registry, options, esc, root, board) {
    // Engineering destinations live inside the Control Console workspace.  The
    // global rail exposes one compact entry only; the console owns its own
    // second-level tabs so AI Board does not permanently expand in every view.
    const control = itemMarkup("sync", registry.sync, { ...options, externalRoot: root }, esc);
    return `<div class="side-control-group" data-sidebar-control-group="1">${control}</div>`;
  }

  function render(options = {}) {
    const esc = options.escapeHtml || escape;
    const foundation = global.ZhugeFoundationConfig || {};
    const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
    const registry = registryFor(options);
    const syncLabel = typeof options.sidebarSyncStatusLabel === "function" ? options.sidebarSyncStatusLabel() : (options.sidebarSyncStatusLabel || "🟢 已同步");
    const syncTime = options.syncTime || "尚未同步";
    const version = options.version || release.version || "";
    const build = options.build || release.build || "";
    const root = options.externalRoot || "";
    const consumerItems = consumerBoardItems(options.boardInstances, root);
    consumerItems.forEach(item => { registry[item.id] = item; });
    const collapsed = (() => { try { return global.localStorage?.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } })();
    const brand = root
      ? `<a class="brand-stack" href="${destination("dashboard", root)}" data-shared-nav-item="dashboard" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span><span class="brand-name"> Zhuge AI OS</span></h1><span class="brand-companion">by Mr. KM</span></a>`
      : `<div class="brand-stack" data-open-workspace="dashboard" role="button" tabindex="0" aria-label="返回 Zhuge AI OS 首頁"><h1><span class="brand-mark" aria-hidden="true">🪶</span><span class="brand-name"> Zhuge AI OS</span></h1><span class="brand-companion">by Mr. KM</span></div>`;
    const camp = sectionMarkup("工作空間", "⛺", ["worklog", "tasks-new", "investment"], registry, { ...options, externalRoot: root }, esc, "camp", [1]);
    const consumerBoards = sectionMarkup("套用的看板", "▦", consumerItems.map(item => item.id), registry, { ...options, externalRoot: root }, esc, "consumer-boards");
    const board = sectionMarkup("AI Board", "🤖", ["ai-board-board", "ai-board-principles", "ai-board-system-map"], registry, { ...options, externalRoot: root }, esc, "ai-board", [0, 1, 2], "ai-board");
    // The sidebar structure must be identical for every Workspace. Governance
    // destinations are rendered by the Control Console's second-level tabs;
    // keeping the source definition here preserves one canonical registry.
    const showGovernance = options.adminVisible !== false;
    const control = showGovernance ? controlGroupMarkup(registry, options, esc, root, board) : itemMarkup("sync", registry.sync, { ...options, externalRoot: root }, esc);
    const systemItems = ["library", "settings", "leisure"].map(id => itemMarkup(id, registry[id], { ...options, externalRoot: root }, esc));
    const system = `<div class="side-section" data-nav-group="system"><h3><span class="nav-section-icon" aria-hidden="true">⚙️</span><span class="nav-section-label">系統</span></h3>${systemItems[0]}${control}${systemItems[1]}${systemItems[2]}</div>`;
    return `<aside class="os-sidebar ${collapsed ? "zhuge-nav-is-collapsed" : ""}" data-zhuge-shared-navigation="true"><div class="sidebar-brand"><div class="brand-row">${brand}</div><button class="mini sidebar-close" data-close-sidebar="1" aria-label="關閉選單">×</button><button class="mini sidebar-menu-mark" type="button" data-toggle-sidebar="1" aria-label="開啟選單">☰</button><button class="mini shared-nav-collapse" type="button" data-shared-nav-collapse="1" aria-label="收合導覽" title="收合導覽">‹</button></div><div class="sidebar-scroll">${camp}${consumerBoards}${system}</div><div class="developer-build-info"><div class="sidebar-sync-summary" id="developerCloudSyncStatus" data-retry-cloud-sync="1"><strong>${esc(syncLabel)}</strong><span>最後同步</span><time>${esc(syncTime)}</time></div><div class="sidebar-version-summary"><span>Version</span><strong>v${esc(version)}</strong></div><div class="sidebar-build-summary"><span>Build</span><strong>${esc(build)}</strong></div></div></aside>`;
  }

  function shellFor(node) { return node?.closest(".os-shell,.zhuge-module-shell") || document.querySelector(".os-shell,.zhuge-module-shell"); }
  function ensureMobileLauncher(shell) {
    const host = shell?.querySelector(".zhuge-shared-header-main, .workspace-context-inner");
    if (!host || host.querySelector("[data-toggle-sidebar]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mini adaptive-menu zhuge-shared-menu";
    button.dataset.toggleSidebar = "1";
    button.setAttribute("aria-label", "開啟 Zhuge AI OS 導覽");
    button.textContent = "☰";
    host.insertBefore(button, host.firstChild);
  }
  function placeholderFromMountedNode(node) {
    const target = document.createElement("div");
    target.id = "zhugeSharedNavigation";
    ["externalRoot", "activeWorkspace", "activeBoardInstanceId", "templatePageId", "sharedNavigationDisabled", "version", "build", "syncTime"].forEach(key => {
      const value = node?.dataset?.[key];
      if (value != null && value !== "") target.dataset[key] = value;
    });
    node?.replaceWith(target);
    return target;
  }
  function unmount(node) {
    if (!node) return null;
    const shell = shellFor(node);
    if (shell?.dataset.sharedNavigationMode === "template-only") delete shell.dataset.sharedNavigationActive;
    return placeholderFromMountedNode(node);
  }
  function setCollapsed(shell, collapsed) {
    if (!shell) return;
    shell.classList.toggle("zhuge-nav-collapsed", collapsed);
    shell.querySelector("[data-shared-nav-collapse]")?.setAttribute("aria-label", collapsed ? "展開導覽" : "收合導覽");
    shell.querySelector("[data-shared-nav-collapse]")?.setAttribute("title", collapsed ? "展開導覽" : "收合導覽");
    shell.querySelector("[data-shared-nav-collapse]").textContent = collapsed ? "›" : "‹";
    try { global.localStorage?.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* cache preference is optional */ }
  }
  function setSyncStatus({ label = "🟢 已同步", time = "尚未同步", state = "" } = {}) {
    const summary = document.getElementById("developerCloudSyncStatus");
    if (!summary) return false;
    const status = summary.querySelector("strong");
    const syncLabel = summary.querySelector("span");
    const syncTime = summary.querySelector("time");
    if (!status || !syncLabel || !syncTime) return false;
    status.textContent = String(label);
    syncLabel.textContent = "最後同步";
    syncTime.textContent = String(time);
    if (state) summary.dataset.syncState = state;
    else delete summary.dataset.syncState;
    return true;
  }
  function wireSidebar() {
    if (document.documentElement.dataset.zhugeSharedNavSidebarWired) return;
    document.documentElement.dataset.zhugeSharedNavSidebarWired = "1";
    document.addEventListener("click", event => {
      const toggle = event.target?.closest?.("[data-toggle-sidebar]");
      const close = event.target?.closest?.("[data-close-sidebar]");
      if (!toggle && !close) return;
      const shell = shellFor(toggle || close);
      if (!shell) return;
      event.preventDefault();
      shell.classList.toggle("sidebar-open", Boolean(toggle) && !shell.classList.contains("sidebar-open"));
    });
  }
  function wireCollapse() {
    wireSidebar();
    if (document.documentElement.dataset.zhugeSharedNavWired) return;
    document.documentElement.dataset.zhugeSharedNavWired = "1";
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-shared-nav-collapse]");
      if (!button) return;
      event.preventDefault();
      const shell = shellFor(button);
      setCollapsed(shell, !shell?.classList.contains("zhuge-nav-collapsed"));
    });
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-shared-nav-group-toggle='control']");
      if (!button) return;
      event.preventDefault();
      const content = document.getElementById(button.getAttribute("aria-controls") || "shared-nav-control-content");
      if (!content) return;
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", expanded ? "false" : "true");
      button.setAttribute("title", expanded ? "展開控制台" : "收合控制台");
      button.textContent = expanded ? "⌄" : "⌃";
      content.hidden = expanded;
      content.classList.toggle("is-expanded", !expanded);
      content.classList.toggle("is-collapsed", expanded);
      try { global.localStorage?.setItem(CONTROL_GROUP_KEY, expanded ? "0" : "1"); } catch { /* preference is optional */ }
    });
  }
  function mount(target, options = {}) {
    if (!target) return null;
    const shellTarget = shellFor(target);
    if (shellTarget?.dataset.sharedNavigationMode === "template-only") {
      shellTarget.dataset.sharedNavigationActive = "true";
    }
    const targetDataset = {};
    ["externalRoot", "activeWorkspace", "activeBoardInstanceId", "templatePageId", "sharedNavigationDisabled", "version", "build", "syncTime"].forEach(key => {
      const value = target.dataset?.[key];
      if (value != null && value !== "") targetDataset[key] = value;
    });
    const targetVersion = target.dataset.version || "";
    const targetBuild = target.dataset.build || "";
    target.outerHTML = render({ ...options, version: options.version || targetVersion, build: options.build || targetBuild, activeWorkspace: options.activeWorkspace || target.dataset.activeWorkspace || "", activeBoardInstanceId: options.activeBoardInstanceId || target.dataset.activeBoardInstanceId || "", externalRoot: target.dataset.externalRoot || options.externalRoot || "" });
    const node = shellTarget?.querySelector("[data-zhuge-shared-navigation='true']") || document.querySelector("[data-zhuge-shared-navigation='true']");
    Object.entries(targetDataset).forEach(([key, value]) => { node.dataset[key] = value; });
    const shell = shellFor(node);
    if (shell) {
      let stored = null;
      try { stored = global.localStorage?.getItem(COLLAPSED_KEY); } catch { /* preference is optional */ }
      const tabletViewport = Boolean(global.matchMedia?.("(min-width: 768px) and (max-width: 1180px)")?.matches);
      const shouldCollapse = shell.classList.contains("zhuge-nav-collapsed") || stored === "1" || (stored == null && tabletViewport);
      setCollapsed(shell, shouldCollapse);
      ensureMobileLauncher(shell);
    }
    wireCollapse();
    return node;
  }
  let policyBootstrapPromise = null;
  let policyBootstrapGeneration = 0;
  function policyRuntime() {
    return global.ZhugeTemplateAdoptionRuntime || null;
  }
  function policyDependenciesReady() {
    return Boolean(
      global.ZhugeTemplateAdoptionPolicy?.createService
      && global.ZhugeSupabaseGateway?.createDataGateway
      && global.ZhugeCreatorResolver?.create
    );
  }
  function sharedNavigationMountOptions(target) {
    const foundation = global.ZhugeFoundationConfig || {};
    const release = foundation.version && typeof foundation.version === "object" ? foundation.version : foundation;
    return {
      activeWorkspace: target?.dataset.activeWorkspace || "",
      activeBoardInstanceId: target?.dataset.activeBoardInstanceId || "",
      externalRoot: target?.dataset.externalRoot || "",
      version: target?.dataset.version || release.version || "",
      build: target?.dataset.build || release.build || "",
      syncTime: target?.dataset.syncTime || ""
    };
  }
  async function readBoardInstances(options = {}) {
    if (Array.isArray(options.boardInstances)) return options.boardInstances;
    const service = global.ZhugeBoardReadService;
    if (typeof service?.listBoardInstances === "function") {
      try { return await service.listBoardInstances(); } catch { return []; }
    }
    const gateway = global.ZhugeSupabaseGateway?.createDataGateway?.();
    if (!gateway || typeof gateway.select !== "function") return [];
    try {
      const rows = await gateway.select(
        "board_instances",
        "?select=id,name,task_code_prefix,template_key,authorization_mode,owner_uuid,legacy_application_scope,is_template_instance,active,created_at,updated_at&active=eq.true&is_template_instance=eq.false&legacy_application_scope=is.null&template_key=eq.c&order=created_at.asc"
      );
      return (Array.isArray(rows) ? rows : []).map(row => ({
        id: String(row?.id || ""),
        name: String(row?.name || ""),
        taskCodePrefix: String(row?.task_code_prefix || ""),
        templateKey: String(row?.template_key || "").toLowerCase(),
        authorizationMode: String(row?.authorization_mode || ""),
        ownerUuid: String(row?.owner_uuid || ""),
        legacyApplicationScope: String(row?.legacy_application_scope || ""),
        isTemplateInstance: row?.is_template_instance === true,
        active: row?.active !== false,
        createdAt: row?.created_at || null,
        updatedAt: row?.updated_at || null
      })).filter(row => (
        row.id &&
        row.active !== false &&
        row.isTemplateInstance !== true &&
        !row.legacyApplicationScope &&
        row.templateKey === "c"
      ));
    } catch { return []; }
  }
  function readTemplatePolicyUserId() {
    try {
      if (typeof global.currentUserUuid === "function") return String(global.currentUserUuid() || "").trim();
    } catch { /* the current page may not have hydrated its session yet */ }
    for (const key of ["zhuge_ai_os_google_auth_session_v1", "zhuge_ai_os_session_v1"]) {
      try {
        const value = JSON.parse(global.localStorage?.getItem(key) || "null");
        const userId = value?.user_uuid || value?.user?.id || value?.auth_user_id || "";
        if (userId) return String(userId).trim();
      } catch { /* session storage is optional */ }
    }
    return "";
  }
  async function bootstrapTemplatePolicy({ force = false } = {}) {
    if (policyBootstrapPromise && !force) return policyBootstrapPromise;
    const marker = document.querySelector("[data-template-page-id]");
    const pageId = String(marker?.dataset.templatePageId || "").trim().toLowerCase();
    if (!pageId || !policyDependenciesReady()) return null;
    const generation = ++policyBootstrapGeneration;
    const run = (async () => {
      const dataGateway = global.ZhugeSupabaseGateway?.createDataGateway?.() || null;
      const service = global.ZhugeTemplateAdoptionPolicy.createService({ dataGateway });
      const userId = readTemplatePolicyUserId();
      const resolver = global.ZhugeCreatorResolver?.create?.({ dataGateway, readUserId: () => userId }) || null;
      const creator = await resolver?.resolve?.() || { is_creator: false };
      const policy = await service.load({ userId, isCreator: creator.is_creator === true, force });
      if (generation !== policyBootstrapGeneration) return policy;
      global.ZhugeTemplateAdoptionRuntime = Object.freeze({ service, policy, pageId });
      document.dispatchEvent(new CustomEvent("zhuge-template-adoption-ready", { detail: { pageId, status: policy.status } }));
      return policy;
    })().finally(() => { policyBootstrapPromise = null; });
    policyBootstrapPromise = run;
    return run;
  }
  function pageIdForTarget(target) {
    return String(target?.dataset.templatePageId || target?.closest?.("[data-template-page-id]")?.dataset.templatePageId || "").trim().toLowerCase();
  }
  function isNavigationAdopted(target) {
    const pageId = pageIdForTarget(target);
    if (!pageId) return target?.dataset.sharedNavigationDisabled !== "true";
    const runtime = policyRuntime();
    return Boolean(runtime?.service?.isTemplateEnabled?.({
      pageId,
      templateId: "navigation",
      userId: runtime.policy?.userId || ""
    }));
  }
  function bootstrapAndMount() {
    if (policyRuntime() || !policyDependenciesReady()) return;
    bootstrapTemplatePolicy().then(() => autoMount()).catch(() => {
      // Cloud errors remain fail-closed; the page keeps the safe default.
    });
  }
  async function mountWithRegistry(target, options = {}) {
    if (!target || !target.isConnected) return null;
    const boardInstances = await readBoardInstances(options);
    if (!target.isConnected || target.dataset.zhugeNavigationMounting !== "true") return null;
    const mounted = mount(target, { ...options, boardInstances });
    if (mounted) mounted.dataset.zhugeNavigationMounted = "true";
    return mounted;
  }
  function autoMount(options = {}) {
    wireCollapse();
    const mounted = document.querySelector("[data-zhuge-shared-navigation='true']");
    if (mounted) {
      ensureMobileLauncher(shellFor(mounted));
      const mountedPageTarget = Boolean(pageIdForTarget(mounted));
      if (mountedPageTarget && policyRuntime() && !isNavigationAdopted(mounted)) unmount(mounted);
      return;
    }
    const target = document.getElementById("zhugeSharedNavigation");
    if (!target || target.dataset.zhugeNavigationMounting === "true") return;
    const pageTarget = Boolean(target?.dataset.templatePageId || target?.closest?.("[data-template-page-id]"));
    const legacyTargetEnabled = target && target.dataset.sharedNavigationDisabled !== "true";
    if (!(legacyTargetEnabled || pageTarget) || target.dataset.worklogManaged) return;
    if (pageTarget && !policyRuntime()) {
      bootstrapAndMount();
      return;
    }
    if (!isNavigationAdopted(target)) return;
    target.dataset.zhugeNavigationMounting = "true";
    mountWithRegistry(target, { ...sharedNavigationMountOptions(target), ...options }).catch(() => {
      delete target.dataset.zhugeNavigationMounting;
    });
  }
  function refresh(options = {}) {
    const mounted = document.querySelector("[data-zhuge-shared-navigation='true']");
    if (mounted) {
      const target = placeholderFromMountedNode(mounted);
      target.dataset.zhugeNavigationMounting = "true";
      mountWithRegistry(target, { ...sharedNavigationMountOptions(target), ...options }).catch(() => {
        delete target.dataset.zhugeNavigationMounting;
      });
      return;
    }
    autoMount(options);
  }
  global.ZhugeSharedNavigation = Object.freeze({ DEFAULT_REGISTRY, destination, render, mount, unmount, autoMount, refresh, bootstrapTemplatePolicy, setCollapsed, setSyncStatus });
  document.addEventListener("zhuge-template-adoption-ready", autoMount);
  document.addEventListener("zhuge-template-adoption-updated", autoMount);
  document.addEventListener("zhuge-template-adoption-updated", () => bootstrapTemplatePolicy({ force: true }));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
  if (typeof MutationObserver === "function" && document.body) {
    const observer = new MutationObserver(() => {
      const target = document.getElementById("zhugeSharedNavigation");
      if (target && !target.dataset.zhugeNavigationMounted) autoMount();
      const mounted = document.querySelector("[data-zhuge-shared-navigation='true']");
      if (mounted) ensureMobileLauncher(shellFor(mounted));
      if (!policyRuntime() && document.querySelector("[data-template-page-id]")) bootstrapTemplatePolicy();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => bootstrapTemplatePolicy(), { once: true });
  else bootstrapTemplatePolicy();
})(window);
