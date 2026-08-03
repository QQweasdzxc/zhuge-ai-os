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
    ${avatarMarkup}
    <div class="zhuge-root-identity-copy">
      <strong>${escapeHtml(identity.name || "Google 使用者")}</strong>
      <span>${escapeHtml(identity.email || "")}</span>
      <small>🟢 Google 已登入 · Supabase Session 共用中</small>
    </div>
  </div>`;
}

function zhugeRootModuleCard({ id, icon, title, description, enabled = false, note = "" } = {}) {
  const content = `<span class="zhuge-module-icon" aria-hidden="true">${icon}</span><span class="zhuge-module-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span>${note ? `<span class="zhuge-module-note">${escapeHtml(note)}</span>` : ""}`;
  if (!enabled) return `<article class="zhuge-module-card is-disabled" aria-disabled="true">${content}</article>`;
  return `<button class="zhuge-module-card" type="button" data-open-workspace="${escapeHtml(id)}" data-root-module-card="${escapeHtml(id)}">${content}<span class="zhuge-module-arrow" aria-hidden="true">→</span></button>`;
}

function zhugeRootDashboardMarkup(identity = null) {
  return `<section class="panel zhuge-root-dashboard" data-zhuge-root-dashboard>
    <div class="zhuge-root-hero">
      <div class="zhuge-root-brand-lockup">
        <div class="zhuge-root-mark" aria-hidden="true">🪶</div>
        <div><p class="zhuge-root-eyebrow">Zhuge AI OS</p><h2>你的 AI 工作作業系統</h2><p class="muted">一次登入，從同一個身分進入每個工作模組。</p></div>
      </div>
      ${zhugeRootIdentityMarkup(identity)}
    </div>
    <section class="zhuge-module-launcher" aria-labelledby="zhuge-module-launcher-title">
      <div class="zhuge-module-launcher-head"><div><h3 id="zhuge-module-launcher-title">Module Launcher</h3><p class="muted">選擇今天要使用的工作空間</p></div><span class="zhuge-session-badge">🔐 共用 Google Session</span></div>
      <div class="zhuge-module-grid">
        ${zhugeRootModuleCard({ id: "worklog", icon: "🪶", title: "WorkLog", description: "記錄、管理與回顧你的工作", enabled: true })}
        ${zhugeRootModuleCard({ id: "investment", icon: "📈", title: "Investment", description: "投資工作空間", note: "Coming Soon" })}
        ${zhugeRootModuleCard({ id: "hr", icon: "👥", title: "HR", description: "人資工作空間", note: "Coming Soon" })}
        ${zhugeRootModuleCard({ id: "travel", icon: "✈️", title: "Travel", description: "旅遊工作空間", note: "Coming Soon" })}
        ${zhugeRootModuleCard({ id: "settings", icon: "⚙️", title: "Settings", description: "帳號、同步與系統設定", enabled: true })}
      </div>
    </section>
    <div class="zhuge-root-principle"><span aria-hidden="true">🪶</span><span>Mr. KM、WorkLog 與藏書閣將在同一個 Zhuge AI OS 身分下持續陪你工作。</span></div>
  </section>`;
}
