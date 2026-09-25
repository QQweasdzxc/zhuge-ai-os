/* Zhuge SkyEye mobile consumer.
 *
 * This module owns presentation and map interaction only. Auth/session and
 * Edge invocation remain the existing Shared Gateway contracts. No browser
 * provider call, credential, raw provider response, or Product Data write is
 * permitted here.
 */
(function (root) {
  "use strict";

  const FUNCTION_NAME = "zhuge-skyeye-read";
  const LAYERS = ["weather", "radar", "earthquake", "aqi", "cctv"];
  const LABELS = Object.freeze({ weather: "🌦️ 天氣", radar: "📡 雷達", earthquake: "🌋 地震", aqi: "🍃 空氣品質", cctv: "📹 CCTV" });
  const ICONS = Object.freeze({ weather: "☁", radar: "◌", earthquake: "!", aqi: "A", cctv: "▣" });
  const overlayContract = root.ZhugeSkyEyeOverlayContract;
  const state = {
    access: null,
    gateway: null,
    map: null,
    layers: null,
    active: { weather: true, radar: true, earthquake: true, aqi: true, cctv: false },
    groups: {},
    selected: null,
    loading: false,
    cctvRequested: false,
    overlayWindows: [],
    overlayViewportWired: false
  };

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const text = (value, fallback = "") => String(value == null ? fallback : value).trim() || fallback;

  function setStatus(message, stateName = "") {
    const node = $("[data-skyeye-status]");
    if (!node) return;
    node.textContent = message;
    node.dataset.state = stateName;
  }

  function setState(message, stateName = "") {
    const node = $("[data-skyeye-state]");
    if (!node) return;
    node.textContent = message;
    node.dataset.state = stateName;
  }

  function layerState(key) {
    return state.layers?.layers?.[key] || root.ZhugeSkyEyeContract.normalizeLayer(key, {});
  }

  function freshnessLabel(layer) {
    const value = text(layer.freshness, "unavailable");
    return ({ fresh: "新鮮", stale: "較舊", unknown: "時間未明", unavailable: "不可用" })[value] || value;
  }

  function renderLayerControls() {
    const host = $("[data-skyeye-layers]");
    if (!host) return;
    host.innerHTML = LAYERS.map(key => {
      const layer = layerState(key);
      const requested = key === "cctv" && !state.cctvRequested;
      const label = key === "cctv" && requested ? "📹 CCTV（點擊載入）" : LABELS[key];
      const stateLabel = layer.available ? freshnessLabel(layer) : (requested ? "尚未載入" : "資料不足");
      return `<button type="button" class="skyeye-layer-button" data-skyeye-layer="${key}" aria-pressed="${state.active[key] ? "true" : "false"}" data-state="${layer.available ? "available" : "unavailable"}"><span>${label}</span><small>${esc(stateLabel)}</small></button>`;
    }).join("");
    host.querySelectorAll("[data-skyeye-layer]").forEach(button => {
      button.addEventListener("click", () => toggleLayer(button.dataset.skyeyeLayer));
    });
  }

  function renderSummary() {
    const host = $("[data-skyeye-summary]");
    if (!host) return;
    const summary = root.ZhugeSkyEyeContract.summaryFromLoadedEvidence(state.layers || {}, Object.keys(state.active).filter(key => state.active[key]));
    host.innerHTML = `<strong>諸葛目前畫面摘要</strong><p>${esc(summary.text)}</p>`;
  }

  function renderLayerMeta(layer) {
    const source = text(layer.source, "未提供來源");
    const asOf = text(layer.as_of, "未提供時間");
    const freshness = freshnessLabel(layer);
    const status = layer.available ? "可用" : "資料不足，暫不判斷";
    return `<div class="skyeye-layer-meta"><span><b>來源</b> ${esc(source)}</span><span><b>更新</b> ${esc(asOf)}</span><span><b>新鮮度</b> ${esc(freshness)}</span><span><b>狀態</b> ${esc(status)}</span>${layer.error_code ? `<span><b>原因</b> ${esc(layer.error_code)}</span>` : ""}</div>`;
  }

  function stageBounds() {
    const stage = $("[data-skyeye-stage]");
    const rect = stage?.getBoundingClientRect?.();
    const visualWidth = Number(window.visualViewport?.width) || 0;
    const visualHeight = Number(window.visualViewport?.height) || 0;
    const stageWidth = Number(rect?.width) || visualWidth || window.innerWidth || 375;
    const stageHeight = Number(rect?.height) || visualHeight || window.innerHeight || 667;
    return {
      width: Math.max(1, visualWidth ? Math.min(stageWidth, visualWidth) : stageWidth),
      height: Math.max(1, visualHeight ? Math.min(stageHeight, visualHeight) : stageHeight)
    };
  }

  function overlaySafeTop() {
    const stage = $("[data-skyeye-stage]");
    const computed = stage ? getComputedStyle(stage) : null;
    const value = Number.parseFloat(computed?.getPropertyValue("--zhuge-safe-area-top") || "0");
    return Number.isFinite(value) ? Math.max(12, value) : 12;
  }

  function overlayCardWidth() {
    return Math.min(264, Math.max(236, stageBounds().width - 24));
  }

  function defaultOverlayPosition() {
    const bounds = stageBounds();
    return overlayContract.clampPosition({
      left: bounds.width - overlayCardWidth() - 12,
      top: overlaySafeTop() + 64
    }, bounds, { cardWidth: overlayCardWidth(), cardHeight: 260, safeTop: overlaySafeTop() });
  }

  function overlayItem(id) {
    return state.overlayWindows.find(item => item.id === id) || null;
  }

  function renderCctvMedia(item) {
    if (item.mode !== "primary" || item.layerKey !== "cctv") return "";
    const marker = item.marker || {};
    if (marker.image_url) {
      return `<img class="skyeye-cctv-image skyeye-overlay-media" src="${esc(marker.image_url)}" alt="${esc(marker.label || "CCTV")} 即時影像" loading="eager" referrerpolicy="no-referrer">`;
    }
    if (marker.stream_url) {
      return `<video class="skyeye-cctv-video skyeye-overlay-media" controls playsinline preload="metadata" src="${esc(marker.stream_url)}"><span>目前瀏覽器無法播放此影像。</span></video>`;
    }
    return `<p class="skyeye-overlay-unavailable">目前沒有可載入的影像來源。</p>`;
  }

  function renderOverlayCard(item) {
    const marker = item.marker || {};
    const label = text(marker.label, LABELS[item.layerKey] || "資料標記");
    const layer = layerState(item.layerKey);
    if (item.mode === "minimized") {
      return `<button type="button" class="skyeye-minimized-window" data-skyeye-overlay-expand="${esc(item.id)}" aria-label="展開 ${esc(label)} 浮窗"><span aria-hidden="true">${ICONS[item.layerKey] || "•"}</span><span>${esc(label)}</span><small>${esc(freshnessLabel(layer))}</small></button>`;
    }
    const position = item.position || defaultOverlayPosition();
    return `<article class="skyeye-floating-window" data-skyeye-overlay-window="${esc(item.id)}" data-window-state="primary" style="left:${Number(position.left) || 12}px;top:${Number(position.top) || overlaySafeTop()}px" aria-label="${esc(label)} 浮動資料視窗">
      <div class="skyeye-overlay-handle" data-skyeye-overlay-handle="${esc(item.id)}" role="group" tabindex="0" aria-label="拖曳 ${esc(label)} 浮窗">
        <span class="skyeye-overlay-title"><span aria-hidden="true">${ICONS[item.layerKey] || "•"}</span><strong>${esc(label)}</strong></span>
        <span class="skyeye-overlay-actions"><button type="button" data-skyeye-overlay-minimize="${esc(item.id)}" aria-label="縮小 ${esc(label)} 浮窗">−</button><button type="button" data-skyeye-overlay-close="${esc(item.id)}" aria-label="關閉 ${esc(label)} 浮窗">×</button></span>
      </div>
      <div class="skyeye-overlay-body">
        <p class="skyeye-overlay-detail">${esc(marker.detail || "此資料標記沒有更多可驗證描述。")}</p>
        ${marker.observed_at ? `<small class="skyeye-overlay-observed">觀測 ${esc(marker.observed_at)}</small>` : ""}
        ${renderCctvMedia(item)}
        ${renderLayerMeta(layer)}
        <button type="button" class="skyeye-overlay-detail-button" data-skyeye-overlay-detail="${esc(item.id)}">查看詳細資料</button>
      </div>
    </article>`;
  }

  function renderOverlayWindows() {
    const host = $("[data-skyeye-overlays]");
    if (!host || !overlayContract) return;
    if (!state.overlayWindows.length) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const primary = state.overlayWindows.filter(item => item.mode === "primary").map(renderOverlayCard).join("");
    const minimized = state.overlayWindows.filter(item => item.mode === "minimized").map(renderOverlayCard).join("");
    host.hidden = false;
    host.innerHTML = `${primary}${minimized ? `<div class="skyeye-minimized-stack" aria-label="已縮小的地圖資料視窗">${minimized}</div>` : ""}`;
    host.querySelectorAll("button").forEach(button => button.addEventListener("pointerdown", event => event.stopPropagation()));
    host.querySelectorAll("[data-skyeye-overlay-window], .skyeye-minimized-stack").forEach(node => {
      node.addEventListener("pointerdown", event => event.stopPropagation());
    });
    host.querySelectorAll("[data-skyeye-overlay-minimize]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      minimizeOverlay(button.dataset.skyeyeOverlayMinimize);
    }));
    host.querySelectorAll("[data-skyeye-overlay-close]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      closeOverlay(button.dataset.skyeyeOverlayClose);
    }));
    host.querySelectorAll("[data-skyeye-overlay-expand]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      expandOverlay(button.dataset.skyeyeOverlayExpand);
    }));
    host.querySelectorAll("[data-skyeye-overlay-detail]").forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      showOverlayDetail(button.dataset.skyeyeOverlayDetail);
    }));
    host.querySelectorAll("[data-skyeye-overlay-handle]").forEach(handle => {
      handle.addEventListener("pointerdown", event => startOverlayDrag(event, handle.dataset.skyeyeOverlayHandle, handle));
      handle.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showOverlayDetail(handle.dataset.skyeyeOverlayHandle);
        }
      });
    });
  }

  function openOverlay(marker, layerKey) {
    if (!overlayContract) return;
    const current = overlayItem(overlayContract.idFor(marker, layerKey));
    const outcome = overlayContract.open(state.overlayWindows, marker, layerKey, Date.now(), current?.position || defaultOverlayPosition());
    state.overlayWindows = outcome.windows;
    renderOverlayWindows();
  }

  function minimizeOverlay(id) {
    if (!overlayContract) return;
    state.overlayWindows = overlayContract.minimize(state.overlayWindows, id).windows;
    renderOverlayWindows();
  }

  function expandOverlay(id) {
    if (!overlayContract) return;
    state.overlayWindows = overlayContract.expand(state.overlayWindows, id).windows;
    renderOverlayWindows();
    clampOverlayPositions();
  }

  function closeOverlay(id) {
    if (!overlayContract) return;
    state.overlayWindows = overlayContract.close(state.overlayWindows, id);
    renderOverlayWindows();
  }

  function showOverlayDetail(id) {
    const item = overlayItem(id);
    if (!item) return;
    state.selected = { marker: item.marker, layerKey: item.layerKey };
    renderSelectedDetail();
    const sheet = $("[data-skyeye-sheet]");
    sheet?.scrollTo?.({ top: sheet.scrollHeight, behavior: "smooth" });
  }

  function startOverlayDrag(event, id, handle) {
    if (!overlayContract || event.button !== undefined && event.button !== 0) return;
    const item = overlayItem(id);
    const card = handle.closest("[data-skyeye-overlay-window]");
    if (!item || !card) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    const origin = { ...(item.position || defaultOverlayPosition()) };
    const move = nextEvent => {
      nextEvent.preventDefault();
      const next = overlayContract.snapPosition({ left: origin.left + nextEvent.clientX - start.x, top: origin.top + nextEvent.clientY - start.y }, stageBounds(), { cardWidth: card.offsetWidth || overlayCardWidth(), cardHeight: card.offsetHeight || 260, safeTop: overlaySafeTop(), snapDistance: 36 });
      card.style.left = `${next.left}px`;
      card.style.top = `${next.top}px`;
    };
    const end = nextEvent => {
      document.removeEventListener("pointermove", move);
      const next = overlayContract.clampPosition({ left: origin.left + nextEvent.clientX - start.x, top: origin.top + nextEvent.clientY - start.y }, stageBounds(), { cardWidth: card.offsetWidth || overlayCardWidth(), cardHeight: card.offsetHeight || 260, safeTop: overlaySafeTop() });
      state.overlayWindows = overlayContract.setPosition(state.overlayWindows, id, next);
      renderOverlayWindows();
    };
    handle.setPointerCapture?.(event.pointerId);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end, { once: true });
    document.addEventListener("pointercancel", end, { once: true });
  }

  function clampOverlayPositions() {
    if (!overlayContract || !state.overlayWindows.length) return;
    const bounds = stageBounds();
    state.overlayWindows = state.overlayWindows.map(item => item.mode === "primary"
      ? { ...item, position: overlayContract.clampPosition(item.position, bounds, { cardWidth: overlayCardWidth(), cardHeight: 260, safeTop: overlaySafeTop() }) }
      : item);
    renderOverlayWindows();
  }

  function wireOverlayViewport() {
    if (state.overlayViewportWired) return;
    state.overlayViewportWired = true;
    window.addEventListener("resize", clampOverlayPositions, { passive: true });
    window.addEventListener("orientationchange", clampOverlayPositions, { passive: true });
    window.visualViewport?.addEventListener("resize", clampOverlayPositions, { passive: true });
    window.visualViewport?.addEventListener("scroll", clampOverlayPositions, { passive: true });
  }

  function renderSelectedDetail() {
    const host = $("[data-skyeye-detail]");
    const close = $("[data-skyeye-detail-close]");
    if (!host) return;
    if (!state.selected) {
      host.hidden = true;
      if (close) close.hidden = true;
      return;
    }
    const { marker, layerKey } = state.selected;
    const layer = layerState(layerKey);
    const cctv = layerKey === "cctv";
    const action = `<button type="button" class="skyeye-cctv-cta" data-skyeye-open-overlay="${esc(overlayContract?.idFor(marker, layerKey) || "")}">${cctv ? "在地圖浮窗開啟影像" : "在地圖浮窗查看"}</button>`;
    host.innerHTML = `<strong>${esc(marker.label || "資料標記")}</strong><p>${esc(marker.detail || "此標記沒有更多可驗證描述。")}<br>${esc(marker.observed_at || "未提供觀測時間")}</p>${cctv ? "<p class=\"skyeye-overlay-note\">只有開啟浮窗時才載入 CCTV 影像；縮小或關閉會停止載入。</p>" : ""}${action}${renderLayerMeta(layer)}`;
    host.hidden = false;
    if (close) close.hidden = false;
    host.querySelector("[data-skyeye-open-overlay]")?.addEventListener("click", event => {
      event.stopPropagation();
      openOverlay(marker, layerKey);
    });
  }

  function markerIcon(layerKey) {
    return root.L.divIcon({
      className: "skyeye-marker-host",
      html: `<span class="skyeye-marker ${layerKey}" aria-hidden="true">${ICONS[layerKey] || "•"}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function refreshMap() {
    if (!state.map || !state.layers) return;
    Object.values(state.groups).forEach(group => group.remove?.());
    state.groups = {};
    LAYERS.forEach(layerKey => {
      if (!state.active[layerKey]) return;
      const layer = layerState(layerKey);
      if (!layer.available) return;
      const group = root.L.layerGroup();
      (layer.markers || []).forEach(marker => {
        const item = root.L.marker([marker.lat, marker.lng], { icon: markerIcon(layerKey), title: marker.label || layerKey });
        item.on("click", () => {
          state.selected = { marker, layerKey };
          renderSelectedDetail();
          openOverlay(marker, layerKey);
          const sheet = $("[data-skyeye-sheet]");
          sheet?.scrollTo?.({ top: sheet.scrollHeight, behavior: "smooth" });
        });
        item.addTo(group);
      });
      if (layer.overlay?.image_url && Array.isArray(layer.overlay.bounds)) {
        root.L.imageOverlay(layer.overlay.image_url, layer.overlay.bounds, { opacity: .42, interactive: false }).addTo(group);
      }
      group.addTo(state.map);
      state.groups[layerKey] = group;
    });
    renderSummary();
  }

  function initializeMap() {
    if (state.map || !root.L) return Boolean(state.map);
    state.map = root.L.map("skyeyeMap", { zoomControl: true, attributionControl: true }).setView([23.7, 121.0], 7);
    root.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap contributors"
    }).addTo(state.map);
    return true;
  }

  async function loadLayers(layers, includeCctv = false) {
    if (state.loading || !state.gateway) return;
    state.loading = true;
    setStatus("正在讀取資料 evidence…", "loading");
    setState("正在向受控唯讀資料服務請求；不會修改產品資料。", "loading");
    try {
      const response = await state.gateway.invokeFunction(FUNCTION_NAME, { layers, include_cctv: includeCctv });
      const normalized = root.ZhugeSkyEyeContract.normalizeResponse(response);
      const mergedLayers = { ...(state.layers?.layers || {}) };
      layers.forEach(key => { mergedLayers[key] = normalized.layers[key]; });
      state.layers = root.ZhugeSkyEyeContract.normalizeResponse({ ...normalized, layers: mergedLayers });
      renderLayerControls();
      refreshMap();
      const count = state.layers.loaded_layers.length;
      setStatus(count ? `已載入 ${count} 個資料層` : "目前沒有可用資料層", count ? "success" : "error");
      setState(count ? "資料已載入；請從圖層或標記查看來源與更新時間。" : "目前資料不足，諸葛暫不做判斷。", count ? "success" : "error");
    } catch (error) {
      setStatus("資料服務暫時無法讀取", "error");
      setState(`目前無法取得天眼資料（${text(error?.code, "READ_UNAVAILABLE")}），請稍後重試。`, "error");
    } finally {
      state.loading = false;
      renderLayerControls();
    }
  }

  function toggleLayer(key) {
    if (!LAYERS.includes(key)) return;
    const layer = layerState(key);
    if (key === "cctv" && !state.cctvRequested) {
      state.cctvRequested = true;
      state.active.cctv = true;
      void loadLayers(["cctv"], true);
      return;
    }
    if (!layer.available && key !== "cctv") {
      void loadLayers([key], false);
      return;
    }
    state.active[key] = !state.active[key];
    refreshMap();
    renderLayerControls();
  }

  function mountAccessGate(access) {
    const gate = $("#skyeyeAuthGate");
    const stage = $("[data-skyeye-stage]");
    if (!gate || !root.ZhugeAppAccessGate) return;
    gate.hidden = false;
    stage.hidden = true;
    root.ZhugeAppAccessGate.mount(gate, access, {
      loginHref: "../../?app=1&workspace=dashboard",
      service: root.ZhugeAppAccess,
      onSubmitted: next => String(next?.status || "").toUpperCase() === "APPROVED" ? mountApproved(next) : mountAccessGate(next),
      onRetry: next => String(next?.status || "").toUpperCase() === "APPROVED" ? mountApproved(next) : mountAccessGate(next)
    });
  }

  async function mountApproved(access) {
    state.access = access;
    const gate = $("#skyeyeAuthGate");
    const stage = $("[data-skyeye-stage]");
    if (gate) { gate.hidden = true; gate.replaceChildren(); }
    if (stage) stage.hidden = false;
    initializeMap();
    wireOverlayViewport();
    renderOverlayWindows();
    renderLayerControls();
    renderSummary();
    $("[data-skyeye-refresh]")?.addEventListener("click", () => {
      const requested = ["weather", "radar", "earthquake", "aqi"];
      if (state.cctvRequested) requested.push("cctv");
      void loadLayers(requested, state.cctvRequested);
    });
    $("[data-skyeye-detail-close]")?.addEventListener("click", () => {
      state.selected = null;
      renderSelectedDetail();
    });
    await loadLayers(["weather", "radar", "earthquake", "aqi"], false);
    void root.ZhugeGlobalFloatingHub?.mount?.({
      service: root.ZhugeAppAccess,
      dataGateway: state.gateway,
      userId: () => typeof root.currentUserUuid === "function" ? root.currentUserUuid() : "",
      userLabel: () => state.access?.displayName || state.access?.email || ""
    });
  }

  async function boot() {
    const stored = typeof root.getStoredAuthSession === "function" ? root.getStoredAuthSession() : null;
    if (stored) root.session = { ...stored, user_uuid: stored.user_uuid || stored.user?.id || "", uuid: stored.uuid || stored.user?.id || "" };
    if (!stored?.access_token) {
      mountAccessGate({ status: "UNAUTHENTICATED", email: "" });
      return;
    }
    try {
      if (typeof root.ensureFreshAuthSession === "function") await root.ensureFreshAuthSession(false);
      state.gateway = root.ZhugeSupabaseGateway?.createDataGateway?.();
      if (!state.gateway) throw Object.assign(new Error("Shared Data Gateway 尚未載入。"), { code: "GATEWAY_UNAVAILABLE" });
      const access = await root.ZhugeAppAccess?.getCurrent?.();
      if (String(access?.status || "").toUpperCase() !== "APPROVED") {
        mountAccessGate(access || { status: "UNKNOWN" });
        return;
      }
      await mountApproved(access);
    } catch (error) {
      mountAccessGate({ status: "UNKNOWN", email: stored.email || "", reason: text(error?.code, "SKYEYE_BOOT_FAILED") });
      setState("目前無法安全確認登入或資料服務，請重新整理後再試。", "error");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else void boot();
})(window);
