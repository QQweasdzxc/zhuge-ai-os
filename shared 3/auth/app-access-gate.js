/* Product access gate presentation and form binding.
 *
 * This is intentionally a small UI adapter.  The approval decision is always
 * returned by the canonical Cloud resolver; the browser never decides that a
 * user is approved by inspecting profile or Auth metadata.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeAppAccessGate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const STATUS = root?.ZhugeAppAccess?.STATUS || Object.freeze({
    unauthenticated: "UNAUTHENTICATED", checking: "CHECKING", unknown: "UNKNOWN",
    new: "NEW", pending: "PENDING", approved: "APPROVED", rejected: "REJECTED"
  });

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function normalize(access = {}) {
    const status = String(access.status || STATUS.unknown).trim().toUpperCase();
    return {
      ...access,
      status,
      email: String(access.email || "").trim(),
      display_name: String(access.display_name || access.displayName || "").trim(),
      reason: String(access.reason || "").trim(),
      reviewNote: String(access.review_note || access.reviewNote || "").trim()
    };
  }

  function titleFor(status) {
    return ({
      [STATUS.checking]: "正在確認 Zhuge AI OS 使用權",
      [STATUS.unknown]: "目前無法確認使用權",
      [STATUS.new]: "申請使用 Zhuge AI OS",
      [STATUS.pending]: "申請已送出，等待審核",
      [STATUS.rejected]: "這次申請尚未通過",
      [STATUS.unauthenticated]: "請先登入 Zhuge AI OS"
    })[status] || "Zhuge AI OS 使用權";
  }

  function messageFor(access) {
    const status = normalize(access).status;
    return ({
      [STATUS.checking]: "正在確認 Google 登入身份與產品使用權，完成前不會開啟受保護工作空間。",
      [STATUS.unknown]: "目前無法安全確認使用權。請重新檢查；不會以登入成功或前端狀態代替核准。",
      [STATUS.new]: "Google 登入成功後，還需要完成一次使用申請。",
      [STATUS.pending]: "管理者完成審核前，暫時不能進入 Zhuge AI OS 的正常工作空間。",
      [STATUS.rejected]: "這次申請未通過；您可以保留歷史紀錄並重新送出新的申請原因。",
      [STATUS.unauthenticated]: "請先以 Google 帳號登入，再確認 Zhuge AI OS 使用權。"
    })[status] || "請重新檢查目前的使用權狀態。";
  }

  function formMarkup(access, rejected = false) {
    const email = escape(access.email || "");
    const name = escape(access.display_name || access.displayName || "");
    const reason = rejected ? "" : escape(access.reason || "");
    return `<form class="app-access-application-form" data-app-access-form novalidate>
      <label for="appAccessEmail">Google Email</label>
      <input class="input" id="appAccessEmail" type="email" value="${email}" readonly aria-readonly="true">
      <small class="app-access-help">此 Email 由目前登入的 Google 身份取得，不能改填其他身份。</small>
      <label for="appAccessDisplayName">姓名／外號</label>
      <input class="input" id="appAccessDisplayName" name="displayName" maxlength="120" value="${name}" required autocomplete="name">
      <label for="appAccessReason">申請原因</label>
      <textarea class="input" id="appAccessReason" name="reason" maxlength="2000" rows="5" required placeholder="請簡單說明使用 Zhuge AI OS 的原因">${reason}</textarea>
      <div class="app-access-form-message" data-app-access-message role="status" aria-live="polite"></div>
      <button class="btn" type="submit" data-app-access-submit>${rejected ? "重新送出申請" : "送出使用申請"}</button>
    </form>`;
  }

  function render(access = {}, options = {}) {
    const normalized = normalize(access);
    const status = normalized.status;
    if (status === STATUS.approved) return "";
    const email = escape(options.email || normalized.email || "");
    let body = "";
    if (status === STATUS.new || status === STATUS.rejected) body = formMarkup({ ...normalized, email }, status === STATUS.rejected);
    if (status === STATUS.pending) {
      body = `<div class="app-access-status-card"><strong>等待 Creator／Owner 審核</strong><span>申請已保留；核准後重新整理即可進入工作空間。</span>${normalized.submitted_at ? `<time datetime="${escape(normalized.submitted_at)}">${escape(normalized.submitted_at)}</time>` : ""}</div>`;
    }
    if (status === STATUS.unknown || status === STATUS.checking) {
      body = `<button class="btn" type="button" data-app-access-retry>重新檢查</button>`;
    }
    if (status === STATUS.unauthenticated) body = `<a class="btn" href="${escape(options.loginHref || "./?app=1")}">前往登入</a>`;
    const review = status === STATUS.rejected && normalized.reviewNote
      ? `<div class="app-access-review-note"><strong>審核備註</strong><span>${escape(normalized.reviewNote)}</span></div>` : "";
    return `<section class="app-access-gate" data-app-access-status="${escape(status)}" aria-labelledby="app-access-title">
      <div class="app-access-panel">
        <p class="app-access-eyebrow">Zhuge AI OS · App Access</p>
        <h1 id="app-access-title">${escape(titleFor(status))}</h1>
        <p class="app-access-message">${escape(messageFor(normalized))}</p>
        ${email ? `<p class="app-access-identity"><span>目前登入身份</span><strong>${email}</strong></p>` : ""}
        ${review}${body}
      </div>
    </section>`;
  }

  function bind(rootNode, access = {}, options = {}) {
    const rootElement = rootNode || (typeof document !== "undefined" ? document : null);
    if (!rootElement) return;
    const form = rootElement.querySelector?.("[data-app-access-form]");
    const message = rootElement.querySelector?.("[data-app-access-message]");
    const submit = rootElement.querySelector?.("[data-app-access-submit]");
    const service = options.service || root?.ZhugeAppAccess;
    form?.addEventListener("submit", async event => {
      event.preventDefault();
      const displayName = String(form.querySelector("[name=displayName]")?.value || "").trim();
      const reason = String(form.querySelector("[name=reason]")?.value || "").trim();
      if (!displayName || !reason) {
        if (message) message.textContent = "請填寫姓名／外號與申請原因。";
        return;
      }
      if (!service?.submit) {
        if (message) message.textContent = "申請服務尚未載入，請稍後再試。";
        return;
      }
      if (submit) { submit.disabled = true; submit.textContent = "送出中…"; }
      if (message) message.textContent = "正在送出申請…";
      try {
        const next = await service.submit({
          displayName,
          reason,
          idempotencyKey: typeof root.crypto?.randomUUID === "function" ? root.crypto.randomUUID() : `app-${Date.now()}`
        });
        if (typeof options.onSubmitted === "function") await options.onSubmitted(next);
        else bind(rootElement, next, options);
      } catch (error) {
        if (message) message.textContent = String(error?.message || "申請送出失敗，請稍後再試。");
        if (submit) { submit.disabled = false; submit.textContent = "重新送出申請"; }
      }
    });
    rootElement.querySelector?.("[data-app-access-retry]")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      if (!service?.getCurrent) return;
      button.disabled = true;
      button.textContent = "檢查中…";
      try {
        const next = await service.getCurrent();
        if (typeof options.onRetry === "function") await options.onRetry(next);
      } catch (error) {
        if (typeof options.onError === "function") options.onError(error);
        button.disabled = false;
        button.textContent = "重新檢查";
      }
    });
  }

  function mount(rootNode, access = {}, options = {}) {
    const rootElement = rootNode || (typeof document !== "undefined" ? document : null);
    if (!rootElement) return;
    rootElement.innerHTML = render(access, options);
    bind(rootElement, access, options);
  }

  return Object.freeze({ STATUS, escape, normalize, render, bind, mount, isApproved: access => normalize(access).status === STATUS.approved });
});
