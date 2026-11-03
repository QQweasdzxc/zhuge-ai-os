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
  return { makeDeduper, decodeWithJsQR, matrixToRGBA };
});
