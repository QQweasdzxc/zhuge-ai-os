(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentSettingsPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">偏好設定</p><h1>投資顯示設定</h1><p>管理投資資料的顯示方式與個人偏好。</p></div></div><div class="investment-settings-grid"><article><small>基準幣別</small><strong>${escape(state.settings?.baseCurrency || "TWD")}</strong><span>投資組合的主要計價幣別</span></article><article><small>損益顏色</small><strong>獲利紅／虧損綠</strong><span>符合台灣投資市場習慣</span></article><article><small>隱私顯示</small><strong>${state.settings?.privacyMode ? "已啟用" : "未啟用"}</strong><span>敏感金額僅供登入者查看</span></article><article><small>資料同步</small><strong>已連線</strong><span>投資資料由 Zhuge AI OS 雲端提供</span></article></div></section>`;
  }

  return Object.freeze({ render });
});
