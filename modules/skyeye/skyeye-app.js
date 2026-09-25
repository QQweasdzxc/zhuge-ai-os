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
  const state = {
    access: null,
    gateway: null,
    map: null,
    layers: null,
    active: { weather: true, radar: true, earthquake: true, aqi: true, cctv: false },
    groups: {},
    selected: null,
    loading: false,
    cctvRequested: false
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
    const media = marker.image_url
      ? `<img class="skyeye-cctv-image" src="${esc(marker.image_url)}" alt="${esc(marker.label)} 即時影像" loading="lazy" referrerpolicy="no-referrer">`
      : "";
    const stream = marker.stream_url
      ? `<p><a href="${esc(marker.stream_url)}" target="_blank" rel="noopener noreferrer">開啟來源影像</a></p>`
      : "";
    host.innerHTML = `<strong>${esc(marker.label || "資料標記")}</strong><p>${esc(marker.detail || "此標記沒有更多可驗證描述。")}<br>${esc(marker.observed_at || "未提供觀測時間")}</p>${media}${stream}${renderLayerMeta(layer)}`;
    host.hidden = false;
    if (close) close.hidden = false;
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
