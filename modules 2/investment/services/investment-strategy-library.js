(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentStrategyLibrary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Strategy names are adapted as a product-learning reference from
  // ZhuLinsen/daily_stock_analysis (MIT). Zhuge owns the execution contract,
  // evidence model, UI and portfolio-aware interpretation.
  const catalog = Object.freeze([
    ["bull_trend", "多頭趨勢", "趨勢", "觀察均線排列、趨勢延續與乖離風險"],
    ["ma_golden_cross", "均線金叉", "技術", "觀察短中期均線交叉與後續確認"],
    ["volume_breakout", "放量突破", "量價", "觀察價格突破與成交量是否同步放大"],
    ["hot_theme", "熱門題材", "事件", "研究市場題材、產業熱度與延續性"],
    ["event_driven", "事件驅動", "事件", "分析重大事件、公告與催化因素"],
    ["growth_quality", "成長品質", "基本面", "研究成長來源、品質與可持續性"],
    ["expectation_repricing", "預期重估", "基本面", "觀察市場預期改變與估值重定價"],
    ["shrink_pullback", "縮量回踩", "量價", "觀察回踩支撐時量能是否收斂"],
    ["bottom_volume", "底部放量", "量價", "觀察低位區域量價變化與反轉證據"],
    ["dragon_head", "龍頭策略", "趨勢", "研究強勢領先標的與趨勢延續條件"],
    ["one_yang_three_yin", "一陽夾三陰", "型態", "觀察特定 K 線組合與後續確認"],
    ["box_oscillation", "箱體震盪", "型態", "研究區間支撐、壓力與突破條件"],
    ["chan_theory", "纏論", "結構", "以筆、線段、中樞等結構觀察市場"],
    ["wave_theory", "波浪理論", "結構", "以波浪結構提出情境與失效條件"],
    ["emotion_cycle", "情緒週期", "情緒", "觀察市場情緒階段與風險偏好變化"]
  ].map(([id, name, category, description]) => Object.freeze({ id, name, category, description, enabled: true })));

  function list() { return catalog.slice(); }
  function get(id) { return catalog.find(item => item.id === String(id || "")) || null; }
  function select(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    return catalog.filter(item => wanted.has(item.id));
  }

  return Object.freeze({ list, get, select });
});
