/* Sprint 5.0: root Zhuge AI OS dashboard presentation only.
 * Authentication and module state remain owned by the existing WorkLog shell.
 */
function zhugeRootInitials(identity = {}) {
  const name = String(identity.name || identity.email || "Z").trim();
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "Z";
}

function zhugeRootIdentityMarkup(identity = null) {
  if (!identity) return "";
  const avatar = String(identity.avatarUrl || identity.avatar || "").trim();
  const avatarMarkup = avatar
    ? `<img class="zhuge-root-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(identity.name || "Google 使用者")}">`
    : `<span class="zhuge-root-avatar zhuge-root-avatar-fallback" aria-hidden="true">${escapeHtml(zhugeRootInitials(identity))}</span>`;
  return `<div class="zhuge-root-identity" data-root-identity>
    <button class="zhuge-root-account-button" type="button" data-root-account-toggle aria-haspopup="menu" aria-expanded="false">
      ${avatarMarkup}
      <span class="zhuge-root-identity-copy">
        <strong>${escapeHtml(identity.name || "Google 使用者")}</strong>
        <span>${escapeHtml(identity.email || "")}</span>
      </span>
      <span class="zhuge-root-account-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="zhuge-root-account-menu" data-root-account-menu role="menu" hidden>
      <div class="zhuge-root-account-summary"><strong>${escapeHtml(identity.name || "Google 使用者")}</strong><span>${escapeHtml(identity.email || "")}</span></div>
      <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" role="menuitem">Google 帳號</a>
      <button type="button" data-open-workspace="settings" role="menuitem">設定</button>
      <button type="button" data-logout="1" role="menuitem">登出</button>
    </div>
  </div>`;
}

function zhugeRootModuleCard({ id, icon, title, description, enabled = false, note = "" } = {}) {
  const content = `<span class="zhuge-module-icon" aria-hidden="true">${icon}</span><span class="zhuge-module-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>${note ? `<span class="zhuge-module-note">${escapeHtml(note)}</span>` : ""}`;
  if (!enabled) return `<article class="zhuge-module-card is-disabled" aria-disabled="true">${content}</article>`;
  return `<button class="zhuge-module-card" type="button" data-open-workspace="${escapeHtml(id)}" data-root-module-card="${escapeHtml(id)}">${content}<span class="zhuge-module-arrow" aria-hidden="true">→</span></button>`;
}

function zhugeRootReleaseMeta() {
  const version = typeof VERSION !== "undefined" ? VERSION : "0.9.0-alpha.9.2";
  const build = typeof BUILD_TIME !== "undefined" ? BUILD_TIME : "20260802-2126";
  return `<div class="zhuge-root-release-meta" aria-label="版本資訊"><div><span>版本</span><strong>v${escapeHtml(version)}</strong></div><div><span>Build</span><strong>${escapeHtml(build)}</strong></div><div><span>環境</span><strong>Production</strong></div><div><span>Repository</span><strong>zhuge-ai-os</strong></div></div>`;
}

function zhugeRootDashboardMarkup(identity = null) {
  return `<section class="panel zhuge-root-dashboard" data-zhuge-root-dashboard>
    <div class="zhuge-root-hero">
      <div class="zhuge-root-brand-lockup">
        <div class="zhuge-root-mark" aria-hidden="true">🪶</div>
        <div><p class="zhuge-root-eyebrow">Zhuge AI OS</p><h2>AI 工作管理平台</h2><p class="muted">一個身分，進入所有工作模組</p><p class="muted">使用 Google 帳號管理待辦事項、工時紀錄、工作知識，並安全存取已授權的 Google Drive 文件。</p></div>
      </div>
      ${zhugeRootIdentityMarkup(identity)}
    </div>
    <section class="zhuge-root-section" aria-labelledby="zhuge-daily-brief-title"><div class="zhuge-root-section-heading"><p class="zhuge-root-eyebrow">AI DAILY BRIEF</p><h3 id="zhuge-daily-brief-title">Mr. KM 今日工作簡報</h3></div>${typeof aiDailyBriefMarkup === "function" ? aiDailyBriefMarkup() : `<div class="zhuge-root-empty">登入後即可查看今日待辦、工時與 AI 建議。</div>`}</section>
    <section class="zhuge-module-launcher" aria-labelledby="zhuge-module-launcher-title">
      <div class="zhuge-module-launcher-head"><div><p class="zhuge-root-eyebrow">MODULE LAUNCHER</p><h3 id="zhuge-module-launcher-title">工作模組入口</h3><p class="muted">請選擇要進入的工作模組</p></div><span class="zhuge-session-badge">🔐 共用 Google Session</span></div>
      <div class="zhuge-module-grid">
        ${zhugeRootModuleCard({ id: "worklog", icon: "🪶", title: "WorkLog", description: "工作管理、工時紀錄、待辦事項", enabled: true })}
        <a class="zhuge-module-card" href="../investment/" data-root-module-card="investment" style="text-decoration:none"><span class="zhuge-module-icon" aria-hidden="true">📈</span><span class="zhuge-module-copy"><strong>Investment</strong><small>投資組合、觀察清單與策略</small></span><span class="zhuge-module-note">SIT</span><span class="zhuge-module-arrow" aria-hidden="true">→</span></a>
        ${zhugeRootModuleCard({ id: "hr", icon: "👥", title: "HR", description: "人員、制度與工作協作", note: "開發中" })}
        ${zhugeRootModuleCard({ id: "travel", icon: "✈️", title: "Travel", description: "旅遊規劃、天氣、景點", note: "開發中" })}
        ${zhugeRootModuleCard({ id: "settings", icon: "⚙️", title: "設定", description: "帳號、同步與系統設定", enabled: true })}
      </div>
    </section>
    <section class="zhuge-root-section zhuge-recent-activity" aria-labelledby="zhuge-recent-title"><div class="zhuge-root-section-heading"><p class="zhuge-root-eyebrow">RECENT ACTIVITY</p><h3 id="zhuge-recent-title">最近使用</h3></div><button class="zhuge-activity-row" type="button" data-open-workspace="worklog"><span class="zhuge-activity-icon">🪶</span><span><strong>WorkLog</strong><small>工作管理與每日工時</small></span><span class="zhuge-activity-arrow" aria-hidden="true">→</span></button></section>
    <section class="zhuge-root-section zhuge-ai-notice" aria-labelledby="zhuge-notice-title"><p class="zhuge-root-eyebrow">AI NOTICE</p><h3 id="zhuge-notice-title">Mr. KM 已準備好陪你開始工作</h3><p class="muted">先完成登入，再由 AI OS 首頁帶你進入今天需要的工作模組。</p></section>
    ${zhugeRootReleaseMeta()}
    <div class="zhuge-root-principle"><span aria-hidden="true">🪶</span><span>單一身分 · 單一首頁 · 獨立模組 · 共用基礎層</span></div>
  </section>`;
}
