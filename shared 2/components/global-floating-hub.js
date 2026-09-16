/* Global Floating Hub.
 *
 * One small shared-shell component owns the compact floating menu.  Creator
 * actions are presentation-gated here for usability, but their RPCs remain
 * creator-only on the backend. Presence uses one ephemeral Realtime channel.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeGlobalFloatingHub = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const HUB_SELECTOR = "[data-global-floating-hub]";
  const PRESENCE_TOPIC = "zhuge-app-presence-v1";
  let state = null;

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function appRootPath() {
    const pathname = String(root?.location?.pathname || "/");
    const matches = [pathname.indexOf("/modules/"), pathname.indexOf("/app/")].filter(index => index >= 0);
    if (matches.length) return `${pathname.slice(0, Math.min(...matches))}/`;
    return pathname.endsWith("/") ? pathname : `${pathname}/`;
  }

  function href(path, query = {}) {
    const queryString = new URLSearchParams(query).toString();
    return `${appRootPath()}${String(path || "").replace(/^\//, "")}${queryString ? `?${queryString}` : ""}`;
  }

  function assistantEmbedHref() {
    return href("modules/worklog/chat/", { app: "1", hub: "1" });
  }

  function readStoredSession() {
    try {
      for (const key of ["zhuge_ai_os_google_auth_session_v1", "zhuge_ai_os_session_v1"]) {
        const row = JSON.parse(root.localStorage?.getItem(key) || "null");
        if (row && (row.user_uuid || row.uuid)) return row;
      }
    } catch { /* optional browser storage */ }
    return {};
  }

  function readUserId(options = {}) {
    if (typeof options.userId === "function") return String(options.userId() || "").trim();
    if (options.userId) return String(options.userId).trim();
    if (typeof root.currentUserUuid === "function") return String(root.currentUserUuid() || "").trim();
    const stored = readStoredSession();
    return String(stored.user_uuid || stored.uuid || stored.auth_user_id || "").trim();
  }

  function readUserLabel(options = {}, access = {}) {
    if (typeof options.userLabel === "function") {
      try {
        const value = options.userLabel();
        if (value) return String(value).trim();
      } catch { /* fall through to the stored/auth identity */ }
    } else if (options.userLabel) {
      return String(options.userLabel).trim();
    }
    if (typeof options.getUserLabel === "function") return String(options.getUserLabel() || "").trim();
    const stored = readStoredSession();
    return String(stored.name || stored.display_name || access.displayName || access.email || "Zhuge User").trim();
  }

  function normalizePresenceRows(snapshot) {
    const rows = [];
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    Object.entries(source).forEach(([key, metas]) => {
      const list = Array.isArray(metas) ? metas : [];
      const latest = list[list.length - 1] || {};
      const userId = String(latest.user_id || key || "").trim();
      if (!userId || rows.some(row => row.userId === userId)) return;
      rows.push({
        userId,
        label: String(latest.display_name || latest.email || userId).trim(),
        email: String(latest.email || "").trim()
      });
    });
    return rows.sort((left, right) => left.label.localeCompare(right.label, "zh-Hant"));
  }

  function renderMarkup({ creator = false, pendingCount = null } = {}) {
    const hoursHref = href("modules/worklog/", { app: "1", workspace: "worklog" });
    const accessHref = href("modules/worklog/", { app: "1", workspace: "management", management: "users" });
    const assistantHref = escape(assistantEmbedHref());
    const pendingBadge = Number.isFinite(pendingCount) && pendingCount > 0
      ? `<span class="zhuge-hub-badge" data-hub-pending-badge>${escape(pendingCount)}</span>` : "";
    const creatorMenu = creator ? `<div class="zhuge-hub-divider" role="separator"></div>
      <p class="zhuge-hub-section-label">Creator 快捷功能</p>
      <button class="zhuge-hub-item" type="button" data-hub-presence-toggle><span aria-hidden="true">👥</span><span>在線使用者</span><strong data-hub-online-count>—</strong></button>
      <div class="zhuge-hub-online-list" data-hub-online-list hidden></div>
      <a class="zhuge-hub-item" href="${escape(accessHref)}"><span aria-hidden="true">🔔</span><span>待審核使用者</span>${pendingBadge}</a>` : "";
    return `<div class="zhuge-floating-hub" data-global-floating-hub>
      <button class="zhuge-hub-trigger" type="button" data-hub-toggle aria-expanded="false" aria-controls="zhugeHubMenu" aria-label="開啟 Global Floating Hub">✦</button>
      <section class="zhuge-hub-menu" id="zhugeHubMenu" data-hub-menu hidden aria-label="Global Floating Hub 快捷功能">
        <div class="zhuge-hub-heading"><strong>Global Floating Hub</strong><span>全站懸浮快捷中心</span></div>
        ${creatorMenu}
        <p class="zhuge-hub-section-label">我的快捷功能</p>
        <button class="zhuge-hub-item" type="button" data-hub-assistant-open aria-expanded="false" aria-controls="zhugeHubChat"><span aria-hidden="true">💬</span><span>工時小幫手</span></button>
        <a class="zhuge-hub-item" href="${escape(hoursHref)}"><span aria-hidden="true">⏱️</span><span>工時／時數</span></a>
      </section>
      <section class="zhuge-hub-chat-overlay" data-hub-chat-overlay id="zhugeHubChat" role="dialog" aria-label="工時小幫手" hidden>
        <div class="zhuge-hub-chat-window">
          <div class="zhuge-hub-chat-heading"><strong>💬 工時小幫手</strong><button type="button" data-hub-chat-close aria-label="關閉工時小幫手">×</button></div>
          <iframe class="zhuge-hub-chat-frame" data-hub-chat-frame data-src="${assistantHref}" title="工時小幫手" loading="lazy"></iframe>
        </div>
      </section>
    </div>`;
  }

  function renderPresence(rows) {
    if (!state?.root) return;
    const count = state.root.querySelector("[data-hub-online-count]");
    const list = state.root.querySelector("[data-hub-online-list]");
    if (count) count.textContent = `${rows.length} 人在線`;
    if (list) {
      list.replaceChildren();
      if (!rows.length) {
        list.textContent = "目前沒有可顯示的在線使用者";
      } else {
        rows.forEach(row => {
          const item = document.createElement("span");
          item.className = "zhuge-hub-online-person";
          item.textContent = row.label;
          list.appendChild(item);
        });
      }
    }
  }

  function bindToggle(rootNode) {
    const toggle = rootNode.querySelector("[data-hub-toggle]");
    const menu = rootNode.querySelector("[data-hub-menu]");
    const assistantButton = rootNode.querySelector("[data-hub-assistant-open]");
    const chatOverlay = rootNode.querySelector("[data-hub-chat-overlay]");
    const chatFrame = rootNode.querySelector("[data-hub-chat-frame]");
    const chatClose = rootNode.querySelector("[data-hub-chat-close]");
    const setChatOpen = open => {
      if (!chatOverlay) return;
      chatOverlay.hidden = !open;
      assistantButton?.setAttribute("aria-expanded", String(open));
      if (open && chatFrame && !chatFrame.dataset.loaded) {
        chatFrame.src = chatFrame.dataset.src || assistantEmbedHref();
        chatFrame.dataset.loaded = "true";
      }
      if (open) chatFrame?.focus?.();
      else {
        if (chatFrame?.dataset.loaded) {
          chatFrame.src = "about:blank";
          delete chatFrame.dataset.loaded;
        }
        assistantButton?.focus?.();
      }
    };
    const onFrameMessage = event => {
      if (event.origin !== root.location?.origin
          || event.source !== chatFrame?.contentWindow
          || chatOverlay?.hidden
          || event.data?.type !== "zhuge-worklog-assistant-close") return;
      setChatOpen(false);
    };
    state.frameMessageHandler = onFrameMessage;
    root.addEventListener?.("message", onFrameMessage);

    toggle?.addEventListener("click", event => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    assistantButton?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (menu) menu.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
      setChatOpen(true);
    });
    chatClose?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      setChatOpen(false);
    });
    rootNode.addEventListener?.("keydown", event => {
      if (event.key === "Escape" && chatOverlay && !chatOverlay.hidden) setChatOpen(false);
    });
    rootNode.querySelector("[data-hub-presence-toggle]")?.addEventListener("click", event => {
      const list = rootNode.querySelector("[data-hub-online-list]");
      if (list) list.hidden = !list.hidden;
      event.stopPropagation();
    });
    document.addEventListener("click", event => {
      if (!event.target?.closest?.(HUB_SELECTOR)) {
        if (menu) menu.hidden = true;
        toggle?.setAttribute("aria-expanded", "false");
      }
    }, { passive: true });
  }

  async function startPresence(service, options, access) {
    if (!state || typeof service?.createPresenceChannel !== "function") return;
    const userId = readUserId(options);
    if (!userId) return;
    try {
      const channel = await service.createPresenceChannel({ topic: PRESENCE_TOPIC, key: userId });
      state.channel = channel;
      const sync = () => renderPresence(normalizePresenceRows(channel.presenceState?.()));
      channel.on("presence", { event: "sync" }, sync);
      channel.on("presence", { event: "join" }, sync);
      channel.on("presence", { event: "leave" }, sync);
      const status = await new Promise(resolve => channel.subscribe(value => resolve(value)));
      if (status !== "SUBSCRIBED") throw new Error(`Presence subscribe failed: ${status}`);
      await channel.track({ user_id: userId, display_name: readUserLabel(options, access), email: access.email || "" });
      sync();
    } catch (error) {
      state.presenceError = error;
      renderPresence([]);
    }
  }

  async function mount(options = {}) {
    if (typeof document === "undefined" || !document.body) return null;
    if (state?.root?.isConnected) return state;
    const service = options.service || root.ZhugeAppAccess;
    if (!service?.getCurrent) return null;
    let access;
    try { access = await service.getCurrent(); } catch { return null; }
    if (!service.isApproved ? String(access?.status || "").toUpperCase() !== "APPROVED" : !service.isApproved(access)) return null;
    const rootNode = document.querySelector(HUB_SELECTOR);
    if (rootNode) return state = { root: rootNode, service, access };

    const dataGateway = options.dataGateway || root.ZhugeSupabaseGateway?.createDataGateway?.();
    let creator = false;
    let pendingCount = null;
    try {
      const resolver = options.creatorResolver || root.ZhugeCreatorResolver?.create?.({ dataGateway, readUserId: () => readUserId(options) });
      const snapshot = await resolver?.resolve?.();
      creator = snapshot?.is_creator === true;
      if (creator && typeof service.listApplications === "function") {
        const applications = await service.listApplications();
        pendingCount = applications.filter(item => String(item?.status || "").toUpperCase() === "PENDING").length;
      }
    } catch { /* creator menu remains hidden on an inconclusive resolver */ }

    const hub = document.createElement("div");
    hub.innerHTML = renderMarkup({ creator, pendingCount });
    const mounted = hub.firstElementChild;
    document.body.appendChild(mounted);
    state = { root: mounted, service, access, creator, channel: null, presenceError: null };
    bindToggle(mounted);
    await startPresence(service, options, access);
    return state;
  }

  async function unmount() {
    if (!state) return;
    try { await state.channel?.untrack?.(); } catch { /* best effort presence cleanup */ }
    try { await state.channel?.remove?.(); } catch { /* best effort presence cleanup */ }
    if (state.frameMessageHandler) root.removeEventListener?.("message", state.frameMessageHandler);
    state.root?.remove?.();
    state = null;
  }

  function getState() { return state; }

  return Object.freeze({ mount, unmount, getState, normalizePresenceRows, href });
});
