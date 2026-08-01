(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentSettingsPage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function render(state, dependencies = {}) {
    const escape = dependencies.escape;
    const identity = state.identity || {};
    return `<section><div class="investment-page-heading"><div><p class="investment-eyebrow">SETTINGS</p><h1>Module 設定</h1><p>身份與 Security 由 Shared Platform 管理；Investment 不維護登入狀態。</p></div></div><div class="investment-settings-grid"><article><small>Shared Identity</small><strong>${escape(identity.email || "—")}</strong><span>UUID：${escape(identity.userId || "—")}</span></article><article><small>Session</small><strong>Authenticated</strong><span>由 Shared Session 提供</span></article><article><small>Security</small><strong>Level 3 Framework</strong><span>MFA 留待下一 Sprint</span></article><article><small>資料來源</small><strong>Mock Repository</strong><span>Production Database 零變更</span></article><article><small>基準幣別</small><strong>${escape(state.settings?.baseCurrency || "TWD")}</strong><span>Locale：zh-TW</span></article><article><small>損益顏色</small><strong>獲利紅／虧損綠</strong><span>符合台灣投資習慣</span></article></div></section>`;
  }

  return Object.freeze({ render });
});
