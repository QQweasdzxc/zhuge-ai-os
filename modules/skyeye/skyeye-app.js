/* Zhuge SkyEye location-centric consumer.
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
    active: { weather: true, radar: true, earthquake: true, aqi: true, cctv: true },
    groups: {},
    selected: null,
    loading: false,
    location: null,
    myLocation: null,
    locationPermission: "unknown",
    searchResults: [],
    mapChangedSinceQuery: false,
    mapEventsWired: false,
    sheetState: "collapsed",
    requestSequence: 0,
    activeRequestController: null,
    searchRequestController: null,
    areaSearchTimer: null,
    suppressMapEvents: false,
    overlayWindows: [],
    overlayViewportWired: false,
    visualViewportWired: false
  };

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  const text = (value, fallback = "") => String(value == null ? fallback : value).trim() || fallback;

  const STATE_LABELS = Object.freeze({
    loading: "載入中",
    not_requested: "尚未載入",
    available: "可用",
    empty: "此區域沒有資料",
    provider_not_configured: "資料來源尚未設定",
    provider_unavailable: "資料來源暫時無法連線",
    stale: "資料較舊",
    error: "讀取失敗"
  });

  const LAYER_LABELS = Object.freeze({ weather: "天氣", radar: "雷達", earthquake: "地震", aqi: "空氣品質", cctv: "CCTV" });

  function stateLabel(layer) {
    return STATE_LABELS[text(layer?.state, "empty")] || "狀態未明";
  }

  function locationLabel(location = state.location) {
    return text(location?.label, "尚未選定地點");
  }

  function locationRadiusForZoom() {
    const zoom = Number(state.map?.getZoom?.() || 13);
    return Math.min(50000, Math.max(500, Math.round(140000 / Math.pow(2, Math.max(0, zoom - 7)))));
  }

  function currentMapLocation(source = "map") {
    const center = state.map?.getCenter?.();
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
    return {
      label: source === "map" ? "目前地圖範圍" : text(state.location?.label, "目前視角"),
      source,
      center: { lat: Number(center.lat), lng: Number(center.lng) },
      accuracy_m: 0,
      radius_m: locationRadiusForZoom(),
      bbox: null
    };
  }

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
    return state.layers?.layers?.[key] || root.ZhugeSkyEyeContract.normalizeLayer(key, { error_code: "NOT_REQUESTED" });
  }

  function freshnessLabel(layer) {
    const value = text(layer.freshness, "unavailable");
    return ({ fresh: "新鮮", stale: "較舊", unknown: "時間未明", unavailable: "不可用" })[value] || value;
  }

  function qualityLabel(layer) {
    const value = text(layer.data_quality, "unavailable");
    return ({ usable: "可用", stale: "較舊", unverified: "資料待核實", metadata_only: "僅有來源資料", insufficient: "資料不足", unavailable: "不可用" })[value] || value;
  }

  function renderLocationHeader() {
    const label = $("[data-skyeye-location-label]");
    if (label) label.textContent = `📍 ${locationLabel()}`;
    const sheetLabel = $("[data-skyeye-sheet-location]");
    if (sheetLabel) sheetLabel.textContent = `｜${locationLabel()}`;
    const accuracy = $("[data-skyeye-location-accuracy]");
    if (accuracy) {
      accuracy.textContent = state.myLocation?.accuracy_m
        ? `定位精度約 ${Math.round(state.myLocation.accuracy_m)}m`
        : state.location?.source === "search" ? "地點搜尋結果" : "由目前視角查詢";
      accuracy.hidden = !state.location;
    }
    const areaButton = $("[data-skyeye-search-area]");
    if (areaButton) areaButton.hidden = !state.mapChangedSinceQuery;
  }

  function renderSearchResults() {
    const host = $("[data-skyeye-search-results]");
    if (!host) return;
    host.hidden = !state.searchResults.length;
    host.innerHTML = state.searchResults.map((result, index) => `<button type="button" class="skyeye-search-result" data-skyeye-search-result="${index}"><strong>${esc(result.label)}</strong><small>${esc(result.source || "公開地理編碼")}</small></button>`).join("");
    host.querySelectorAll("[data-skyeye-search-result]").forEach(button => button.addEventListener("click", () => {
      const result = state.searchResults[Number(button.dataset.skyeyeSearchResult)];
      if (result) selectSearchResult(result);
    }));
  }

  function renderLayerControls() {
    const host = $("[data-skyeye-layers]");
    if (!host) return;
    host.innerHTML = LAYERS.map(key => {
      const layer = layerState(key);
      const count = Number(layer.count || layer.markers?.length || 0);
      const label = key === "cctv" ? `📹 CCTV｜附近 ${count} 支` : LABELS[key];
      return `<button type="button" class="skyeye-layer-button" data-skyeye-layer="${key}" aria-pressed="${state.active[key] ? "true" : "false"}" data-state="${esc(layer.state || "empty")}"><span>${label}</span><small>${esc(stateLabel(layer))}${layer.error_code ? ` · ${esc(layer.error_code)}` : ""}</small></button>`;
    }).join("");
    host.querySelectorAll("[data-skyeye-layer]").forEach(button => {
      button.addEventListener("click", () => toggleLayer(button.dataset.skyeyeLayer));
    });
  }

  function renderSummary() {
    const host = $("[data-skyeye-summary]");
    if (!host) return;
    if (!state.layers) {
      host.innerHTML = `<strong>尚未選定地點</strong><p>允許瀏覽器定位，或搜尋地名／地址後，天眼才會查詢附近公開資料。</p><small class="skyeye-summary-note">精確位置只留在本次瀏覽器工作階段。</small>`;
      renderLocationHeader();
      return;
    }
    const summary = root.ZhugeSkyEyeContract.summaryFromLoadedEvidence(state.layers || {}, Object.keys(state.active).filter(key => state.active[key]));
    const cctv = layerState("cctv");
    const available = Object.keys(state.active).filter(key => state.active[key] && layerState(key).available);
    const unavailable = Object.keys(state.active).filter(key => state.active[key] && !layerState(key).available && layerState(key).state !== "not_requested");
    const nearest = Array.isArray(cctv.markers) ? cctv.markers.find(marker => Number.isFinite(Number(marker.distance_m))) : null;
    const nearestText = nearest ? `，最近 ${Number(nearest.distance_m) < 1000 ? `${Math.round(nearest.distance_m)}m` : `${(Number(nearest.distance_m) / 1000).toFixed(1)}km`}` : "";
    const cctvText = cctv.state === "empty"
      ? "此區域目前沒有可用 CCTV"
      : cctv.available
        ? `可用 CCTV ${Number(cctv.count || cctv.markers?.length || 0)} 支${nearestText}`
        : `CCTV ${stateLabel(cctv)}`;
    const availableWithoutCctv = available.filter(key => key !== "cctv");
    const loadedDetails = availableWithoutCctv.map(key => `${LAYER_LABELS[key]} ✓`);
    const detail = available.length || unavailable.length
      ? `${cctvText}${loadedDetails.length ? `｜${loadedDetails.join("、")}` : ""}${unavailable.length ? `｜${unavailable.map(key => `${LAYER_LABELS[key]} ${stateLabel(layerState(key))}`).join("、")}` : ""}`
      : summary.text;
    host.innerHTML = `<strong>${esc(locationLabel())}</strong><p>${esc(detail)}</p><small class="skyeye-summary-note">只根據已載入 evidence；來源與時間請展開查看。</small>`;
    renderLocationHeader();
  }

  function renderLayerMeta(layer) {
    const source = text(layer.source, "未提供來源");
    const asOf = text(layer.as_of, "未提供時間");
    const freshness = freshnessLabel(layer);
    const status = stateLabel(layer);
    return `<div class="skyeye-layer-meta"><span><b>來源</b> ${esc(source)}</span><span><b>更新</b> ${esc(asOf)}</span><span><b>新鮮度</b> ${esc(freshness)}</span><span><b>資料品質</b> ${esc(qualityLabel(layer))}</span><span><b>空間策略</b> ${esc(layer.spatial_strategy || "provider_defined")}</span><span><b>狀態</b> ${esc(status)}</span>${layer.error_code ? `<span><b>原因</b> ${esc(layer.error_code)}</span>` : ""}</div>`;
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
    const distance = marker.distance_m === null || marker.distance_m === undefined ? "" : `<span>距離 ${Number(marker.distance_m) < 1000 ? `${Math.round(marker.distance_m)}m` : `${(Number(marker.distance_m) / 1000).toFixed(1)}km`}</span>`;
    const road = marker.intersection_label || marker.road_label || "";
    const direction = marker.direction ? `<span>方向 ${esc(marker.direction)}</span>` : "";
    host.innerHTML = `<strong>${esc(marker.label || "資料標記")}</strong><p>${esc(marker.detail || "此標記沒有更多可驗證描述。")}<br>${esc(marker.observed_at || "未提供觀測時間")}</p>${road ? `<p class="skyeye-marker-context"><b>${esc(road)}</b> ${distance} ${direction}</p>` : distance || direction ? `<p class="skyeye-marker-context">${distance} ${direction}</p>` : ""}${cctv ? "<p class=\"skyeye-overlay-note\">只有開啟浮窗時才載入 CCTV 影像；縮小或關閉會停止載入。</p>" : ""}${action}${renderLayerMeta(layer)}`;
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

  function renderUserLocation() {
    if (!state.map || !state.myLocation?.center) return;
    const point = state.myLocation.center;
    const group = root.L.layerGroup();
    root.L.circleMarker([point.lat, point.lng], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1,
      interactive: false
    }).bindTooltip("我的位置", { direction: "top", offset: [0, -8] }).addTo(group);
    if (Number(state.myLocation.accuracy_m) > 0) {
      root.L.circle([point.lat, point.lng], {
        radius: Math.min(10000, Math.max(10, Number(state.myLocation.accuracy_m))),
        color: "#2563eb",
        weight: 1,
        fillColor: "#60a5fa",
        fillOpacity: .16,
        interactive: false
      }).addTo(group);
    }
    group.addTo(state.map);
    state.groups.__userLocation = group;
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
    renderUserLocation();
    renderSummary();
  }

  function initializeMap() {
    if (state.map || !root.L) return Boolean(state.map);
    state.map = root.L.map("skyeyeMap", { zoomControl: true, attributionControl: true }).setView([23.7, 121.0], 7);
    root.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap contributors"
    }).addTo(state.map);
    wireMapEvents();
    return true;
  }

  function wireMapEvents() {
    if (!state.map || state.mapEventsWired) return;
    state.mapEventsWired = true;
    const markMoved = () => {
      if (state.suppressMapEvents) return;
      state.mapChangedSinceQuery = true;
      renderLocationHeader();
      window.clearTimeout(state.areaSearchTimer);
      state.areaSearchTimer = window.setTimeout(() => renderLocationHeader(), 280);
    };
    state.map.on("moveend zoomend", markMoved);
  }

  function abortActiveRequest(kind = "data") {
    if (kind === "search") state.searchRequestController?.abort?.();
    else state.activeRequestController?.abort?.();
  }

  function requestPayload(layers, includeCctv, requestId) {
    return {
      layers,
      include_cctv: includeCctv,
      request_id: requestId,
      location_context: state.location ? {
        label: state.location.label,
        source: state.location.source,
        center: state.location.center,
        accuracy_m: state.location.accuracy_m,
        radius_m: state.location.radius_m,
        bbox: state.location.bbox,
        provider_context: state.location.provider_context || {}
      } : null
    };
  }

  async function loadLayers(layers, includeCctv = true) {
    if (!state.gateway) return;
    abortActiveRequest();
    const sequence = ++state.requestSequence;
    const controller = new AbortController();
    state.activeRequestController = controller;
    state.loading = true;
    setStatus("正在讀取目前地點的公開資料…", "loading");
    setState("正在向受控唯讀資料服務請求；精確位置只留在本次瀏覽器工作階段。", "loading");
    const requestId = `skyeye-${Date.now()}-${sequence}`;
    try {
      const response = await state.gateway.invokeFunction(FUNCTION_NAME, requestPayload(layers, includeCctv, requestId), { signal: controller.signal });
      if (sequence !== state.requestSequence) return;
      const normalized = root.ZhugeSkyEyeContract.normalizeResponse(response);
      state.layers = normalized;
      if (normalized.location_context) state.location = normalized.location_context;
      state.mapChangedSinceQuery = false;
      renderLayerControls();
      refreshMap();
      const count = state.layers.loaded_layers.length;
      const hasError = layers.some(key => ["error", "provider_unavailable"].includes(layerState(key).state));
      setStatus(count ? `${locationLabel()}已載入 ${count} 個資料層` : `${locationLabel()}目前沒有可用資料`, hasError ? "warning" : count ? "success" : "error");
      setState(count ? "資料已載入；請從圖層或標記查看來源、更新時間與狀態。" : "目前沒有可用 evidence，諸葛暫不做判斷。", hasError ? "warning" : count ? "success" : "error");
    } catch (error) {
      if (error?.name === "AbortError" || sequence !== state.requestSequence) return;
      setStatus("資料服務暫時無法讀取", "error");
      setState(`目前無法取得天眼資料（${text(error?.code, "READ_UNAVAILABLE")}），請稍後重試。`, "error");
    } finally {
      if (sequence === state.requestSequence) {
        state.loading = false;
        state.activeRequestController = null;
        renderLayerControls();
      }
    }
  }

  async function loadGeocode(query) {
    if (!state.gateway) return;
    abortActiveRequest("search");
    const controller = new AbortController();
    state.searchRequestController = controller;
    const input = text(query, "");
    if (!input) {
      setState("請輸入地名、地址或景點。", "warning");
      return;
    }
    setStatus("正在搜尋地點…", "loading");
    try {
      const response = await state.gateway.invokeFunction(FUNCTION_NAME, { operation: "geocode", query: input }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      state.searchResults = Array.isArray(response?.results) ? response.results : [];
      renderSearchResults();
      if (!state.searchResults.length) {
        setStatus("找不到這個地點", "warning");
        setState(`找不到「${input}」，請換一個地名或較完整的地址。`, "warning");
      } else {
        setStatus(`找到 ${state.searchResults.length} 個地點`, "success");
        setState("請選擇搜尋結果，天眼會重新查詢該位置附近的資料。", "success");
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStatus("地點搜尋暫時無法使用", "error");
      setState(`目前無法完成地點搜尋（${text(error?.code, "GEOCODE_UNAVAILABLE")}）。`, "error");
    } finally {
      if (state.searchRequestController === controller) state.searchRequestController = null;
    }
  }

  function setLocationContext(location, options = {}) {
    if (!location?.center) return;
    state.location = {
      label: text(location.label, "目前地點"),
      source: text(location.source, "search"),
      center: { lat: Number(location.center.lat), lng: Number(location.center.lng) },
      accuracy_m: Number(location.accuracy_m || 0),
      radius_m: Number(location.radius_m || 5000),
      bbox: Array.isArray(location.bbox) ? location.bbox : null,
      provider_context: location.provider_context && typeof location.provider_context === "object"
        ? { tdx_city: text(location.provider_context.tdx_city, 80) }
        : { tdx_city: text(location.tdx_city, 80) }
    };
    state.searchResults = [];
    renderSearchResults();
    renderLocationHeader();
    if (state.map) {
      state.suppressMapEvents = true;
      state.map.setView([state.location.center.lat, state.location.center.lng], Number(options.zoom || 14), { animate: false });
      window.setTimeout(() => { state.suppressMapEvents = false; }, 320);
    }
    void loadLayers(LAYERS.slice(), true);
  }

  function selectSearchResult(result) {
    setLocationContext({
      label: result.label,
      source: "search",
      center: result.center,
      accuracy_m: 0,
      radius_m: 5000,
      bbox: result.bbox,
      provider_context: result.provider_context || {}
    });
  }

  function onGeolocationFailure(error) {
    state.locationPermission = error?.code === 1 ? "denied" : "unavailable";
    state.myLocation = null;
    state.location = null;
    renderLocationHeader();
    const reason = error?.code === 1 ? "你未允許定位" : error?.code === 3 ? "定位逾時" : "目前無法取得定位";
    setStatus("請搜尋地點", "warning");
    setState(`${reason}；不影響天眼使用。請搜尋地名、地址或景點後開始查詢附近資料。`, "warning");
  }

  function requestBrowserLocation() {
    if (!navigator.geolocation) {
      onGeolocationFailure({ code: 2 });
      return;
    }
    state.locationPermission = "requesting";
    setStatus("正在取得目前位置…", "loading");
    setState("請允許瀏覽器定位；精確位置不會寫入產品資料、analytics 或 log。", "loading");
    navigator.geolocation.getCurrentPosition(position => {
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      const accuracy = Number(position.coords.accuracy || 0);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        onGeolocationFailure({ code: 2 });
        return;
      }
      state.locationPermission = "granted";
      state.myLocation = { center: { lat: latitude, lng: longitude }, accuracy_m: accuracy };
      setLocationContext({
        label: "我的位置附近",
        source: "browser_geolocation",
        center: { lat: latitude, lng: longitude },
        accuracy_m: accuracy,
        radius_m: Math.max(500, Math.min(10000, accuracy * 6 || 5000))
      }, { zoom: 15 });
    }, onGeolocationFailure, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function searchThisArea() {
    const location = currentMapLocation("map");
    if (!location) return;
    state.myLocation = null;
    setLocationContext(location, { zoom: state.map?.getZoom?.() || 13 });
  }

  function goToMyLocation() {
    if (state.myLocation?.center) {
      setLocationContext({ ...state.location, label: "我的位置附近", source: "browser_geolocation", center: state.myLocation.center, accuracy_m: state.myLocation.accuracy_m }, { zoom: 15 });
      return;
    }
    requestBrowserLocation();
  }

  function toggleLayer(key) {
    if (!LAYERS.includes(key)) return;
    state.active[key] = !state.active[key];
    refreshMap();
    renderLayerControls();
  }

  function setSheetState(next) {
    const allowed = ["collapsed", "half", "expanded"];
    const mode = allowed.includes(next) ? next : "collapsed";
    state.sheetState = mode;
    const sheet = $("[data-skyeye-sheet]");
    if (sheet) {
      sheet.dataset.sheetState = mode;
      sheet.setAttribute("aria-expanded", mode === "expanded" ? "true" : "false");
    }
    $("[data-skyeye-sheet-state]")?.replaceChildren(document.createTextNode(mode === "collapsed" ? "摘要" : mode === "half" ? "圖層" : "完整資料"));
  }

  function wireSheetGestures() {
    const sheet = $("[data-skyeye-sheet]");
    const handle = $("[data-skyeye-sheet-handle]");
    if (!sheet || !handle || sheet.dataset.gestureWired === "true") return;
    sheet.dataset.gestureWired = "true";
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const startMode = state.sheetState;
      const onUp = nextEvent => {
        const delta = nextEvent.clientY - startY;
        document.removeEventListener("pointerup", onUp);
        if (delta < -28) setSheetState(startMode === "collapsed" ? "half" : "expanded");
        else if (delta > 28) setSheetState(startMode === "expanded" ? "half" : "collapsed");
      };
      document.addEventListener("pointerup", onUp, { once: true });
    });
    sheet.querySelectorAll("[data-skyeye-sheet-to]").forEach(button => button.addEventListener("click", () => setSheetState(button.dataset.skyeyeSheetTo)));
    setSheetState(state.sheetState);
  }

  function wireLocationControls() {
    const form = $("[data-skyeye-search-form]");
    if (form && form.dataset.wired !== "true") {
      form.dataset.wired = "true";
      form.addEventListener("submit", event => {
        event.preventDefault();
        const input = form.querySelector("input");
        void loadGeocode(input?.value || "");
      });
    }
    $("[data-skyeye-my-location]")?.addEventListener("click", goToMyLocation);
    $("[data-skyeye-search-area]")?.addEventListener("click", searchThisArea);
    $("[data-skyeye-search-again]")?.addEventListener("click", () => $("[data-skyeye-search-input]")?.focus());
  }

  function wireVisualViewport() {
    if (state.visualViewportWired) return;
    state.visualViewportWired = true;
    const update = () => {
      const viewportHeight = Number(window.visualViewport?.height) || window.innerHeight;
      document.documentElement.style.setProperty("--skyeye-visual-height", `${Math.max(240, viewportHeight)}px`);
      window.requestAnimationFrame?.(() => state.map?.invalidateSize?.({ animate: false }));
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    window.visualViewport?.addEventListener("scroll", update, { passive: true });
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
    wireVisualViewport();
    wireSheetGestures();
    wireLocationControls();
    renderOverlayWindows();
    renderLayerControls();
    renderSummary();
    $("[data-skyeye-refresh]")?.addEventListener("click", () => void loadLayers(LAYERS.slice(), true));
    $("[data-skyeye-detail-close]")?.addEventListener("click", () => {
      state.selected = null;
      renderSelectedDetail();
    });
    requestBrowserLocation();
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
