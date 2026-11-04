/* ZG-ERP 掃描核心：去重複與 jsQR 幀解碼的純邏輯（瀏覽器 window.ErpScanCore / Node module 兩用） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ErpScanCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // 同一張碼在 windowMs 毫秒內不重複入帳
  function makeDeduper(windowMs) {
    let last = "", lastAt = 0;
    return {
      accept(val, now) {
        val = String(val || "").trim();
        if (!val) return false;
        now = now || Date.now();
        if (val === last && now - lastAt < windowMs) return false;
        last = val; lastAt = now;
        return true;
      },
      reset() { last = ""; lastAt = 0; }
    };
  }
  // A held label counts once. Rearm only after continuously seeing no label.
  function makePresenceDeduper(absenceMs) {
    let last = "", absentAt = null;
    return {
      accept(val, now) {
        now = now == null ? Date.now() : now;
        val = String(val || "").trim();
        if (!val) {
          if (absentAt == null) absentAt = now;
          if (now - absentAt >= absenceMs) last = "";
          return false;
        }
        if (absentAt != null && now - absentAt >= absenceMs) last = "";
        absentAt = null;
        if (val === last) return false;
        last = val;
        return true;
      },
      reset() { last = ""; absentAt = null; }
    };
  }
  function qrDetection(result, width, height) {
    if (!result) return { value: "", points: null, width, height };
    const value = String(result.rawValue || result.data || "").trim();
    let points = result.cornerPoints;
    if ((!points || points.length !== 4) && result.location) {
      const l = result.location;
      points = [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner];
    }
    if ((!points || points.length !== 4) && result.boundingBox) {
      const b = result.boundingBox;
      points = [{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}];
    }
    const valid = value && width > 0 && height > 0 && Array.isArray(points) && points.length === 4 && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    return { value, width, height, points: valid ? points.map((p) => ({x:p.x,y:p.y})) : null };
  }
  function decodeDetectionWithJsQR(jsQR, rgba, width, height) {
    return qrDetection(jsQR && rgba && width && height ? jsQR(rgba, width, height) : null, width, height);
  }
  // 用 jsQR 解一幀 RGBA 像素；回傳字串或空字串
  function decodeWithJsQR(jsQR, rgba, width, height) {
    if (!jsQR || !rgba || !width || !height) return "";
    const r = jsQR(rgba, width, height);
    return r && r.data ? String(r.data) : "";
  }
  // 測試用：把 0/1 模組陣列渲染成 RGBA（含靜區）
  function matrixToRGBA(modules, scale, quiet) {
    scale = scale || 10; quiet = quiet == null ? 4 : quiet;
    const size = modules.length, W = (size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(W * W * 4).fill(255);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (modules[y][x] !== "1") continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = ((y + quiet) * scale + dy) * W + (x + quiet) * scale + dx;
        data[px * 4] = data[px * 4 + 1] = data[px * 4 + 2] = 0;
      }
    }
    return { data, width: W, height: W };
  }
  return { makeDeduper, makePresenceDeduper, qrDetection, decodeDetectionWithJsQR, decodeWithJsQR, matrixToRGBA };
});
