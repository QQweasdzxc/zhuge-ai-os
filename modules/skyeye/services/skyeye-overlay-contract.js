/* Zhuge SkyEye mobile overlay state contract.
 *
 * Presentation-only state. It deliberately contains no provider, auth, or
 * Product Data behavior. The contract keeps the map usable by bounding the
 * number of windows to one primary card and two minimized chips.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSkyEyeOverlayContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PRIMARY = 1;
  const MAX_MINIMIZED = 2;

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function idFor(marker, layerKey) {
    const markerId = String(marker?.id || marker?.label || "marker").trim().slice(0, 120) || "marker";
    return `${String(layerKey || "layer").trim().slice(0, 40) || "layer"}:${markerId}`;
  }

  function clone(value) {
    return {
      ...value,
      marker: value.marker && typeof value.marker === "object" ? { ...value.marker } : {},
      position: { ...(value.position || {}) }
    };
  }

  function trimMinimized(windows) {
    const minimized = windows
      .filter(item => item.mode === "minimized")
      .sort((a, b) => number(a.updatedAt) - number(b.updatedAt));
    const remove = minimized.slice(0, Math.max(0, minimized.length - MAX_MINIMIZED)).map(item => item.id);
    return windows.filter(item => !remove.includes(item.id));
  }

  function withPrimary(windows, id, now) {
    return windows.map(item => item.id === id
      ? { ...item, mode: "primary", updatedAt: now }
      : item.mode === "primary"
        ? { ...item, mode: "minimized", updatedAt: now }
        : item);
  }

  function open(windows = [], marker = {}, layerKey = "", now = Date.now(), position = { left: 12, top: 72 }) {
    const id = idFor(marker, layerKey);
    let next = windows.map(clone);
    const existing = next.find(item => item.id === id);
    if (existing) {
      next = next.map(item => item.id === id
        ? { ...item, marker: { ...marker }, layerKey, mode: "primary", updatedAt: now }
        : item);
    } else {
      next.push({
        id,
        layerKey,
        marker: { ...marker },
        mode: "primary",
        position: { left: number(position.left, 12), top: number(position.top, 72) },
        openedAt: now,
        updatedAt: now
      });
    }
    next = trimMinimized(withPrimary(next, id, now));
    return { windows: next, openedId: id };
  }

  function minimize(windows = [], id, now = Date.now()) {
    const next = windows.map(clone).map(item => item.id === id
      ? { ...item, mode: "minimized", updatedAt: now }
      : item);
    return { windows: trimMinimized(next), changed: next.some((item, index) => item.id === windows[index]?.id && item.mode !== windows[index]?.mode) };
  }

  function expand(windows = [], id, now = Date.now()) {
    const found = windows.some(item => item.id === id);
    if (!found) return { windows: windows.map(clone), expandedId: null };
    return { windows: trimMinimized(withPrimary(windows.map(clone), id, now)), expandedId: id };
  }

  function close(windows = [], id) {
    return windows.filter(item => item.id !== id).map(clone);
  }

  function setPosition(windows = [], id, position) {
    return windows.map(item => item.id === id
      ? { ...clone(item), position: { left: number(position?.left, item.position?.left), top: number(position?.top, item.position?.top) } }
      : clone(item));
  }

  function clampPosition(position = {}, viewport = {}, options = {}) {
    const cardWidth = Math.max(0, number(options.cardWidth, 264));
    const cardHeight = Math.max(0, number(options.cardHeight, 260));
    const margin = Math.max(0, number(options.margin, 12));
    const safeTop = Math.max(0, number(options.safeTop, 12));
    const safeBottom = Math.max(0, number(options.safeBottom, 12));
    const width = Math.max(cardWidth + margin * 2, number(viewport.width, cardWidth + margin * 2));
    const height = Math.max(cardHeight + safeTop + safeBottom, number(viewport.height, cardHeight + safeTop + safeBottom));
    return {
      left: Math.min(Math.max(margin, number(position.left, margin)), Math.max(margin, width - cardWidth - margin)),
      top: Math.min(Math.max(safeTop, number(position.top, safeTop)), Math.max(safeTop, height - cardHeight - safeBottom))
    };
  }

  function snapPosition(position = {}, viewport = {}, options = {}) {
    const cardWidth = Math.max(0, number(options.cardWidth, 264));
    const cardHeight = Math.max(0, number(options.cardHeight, 260));
    const margin = Math.max(0, number(options.margin, 12));
    const safeTop = Math.max(0, number(options.safeTop, 12));
    const safeBottom = Math.max(0, number(options.safeBottom, 12));
    const snapDistance = Math.max(0, number(options.snapDistance, 32));
    const clamped = clampPosition(position, viewport, { cardWidth, cardHeight, margin, safeTop, safeBottom });
    const width = Math.max(cardWidth + margin * 2, number(viewport.width, cardWidth + margin * 2));
    const height = Math.max(cardHeight + safeTop + safeBottom, number(viewport.height, cardHeight + safeTop + safeBottom));
    const right = Math.max(margin, width - cardWidth - margin);
    const bottom = Math.max(safeTop, height - cardHeight - safeBottom);
    const horizontal = Math.abs(clamped.left - margin) <= snapDistance || Math.abs(clamped.left - right) <= snapDistance
      ? (Math.abs(clamped.left - margin) <= Math.abs(clamped.left - right) ? margin : right)
      : clamped.left;
    const vertical = Math.abs(clamped.top - safeTop) <= snapDistance || Math.abs(clamped.top - bottom) <= snapDistance
      ? (Math.abs(clamped.top - safeTop) <= Math.abs(clamped.top - bottom) ? safeTop : bottom)
      : clamped.top;
    return { left: horizontal, top: vertical };
  }

  function counts(windows = []) {
    return {
      primary: windows.filter(item => item.mode === "primary").length,
      minimized: windows.filter(item => item.mode === "minimized").length,
      total: windows.length
    };
  }

  return Object.freeze({
    MAX_PRIMARY,
    MAX_MINIMIZED,
    idFor,
    open,
    minimize,
    expand,
    close,
    setPosition,
    clampPosition,
    snapPosition,
    counts
  });
});
