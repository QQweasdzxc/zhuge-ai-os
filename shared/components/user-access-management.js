/* Management Center User Access Management surface.
 *
 * This component is deliberately a consumer of the canonical app-access
 * service.  It does not infer access from Auth/profile fields and it has no
 * second role or approval authority.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeUserAccessManagement = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function statusLabel(status) {
    return ({ PENDING: "待審核", APPROVED: "已核准", REJECTED: "已駁回", NEW: "新申請", UNKNOWN: "未知" })[status] || status || "未知";
  }

  function renderShell() {
    return `<section class="user-access-management" data-user-access-management aria-labelledby="user-access-management-title">
      <div class="user-access-management-heading"><div><p class="eyebrow">Creator / Owner</p><h2 id="user-access-management-title">👥 使用者存取管理</h2><p class="muted">查看申請、核准或駁回使用權；申請歷史會完整保留。</p></div><button class="btn2 zhuge-core-button" type="button" data-access-refresh>重新整理</button></div>
      <div class="user-access-management-status" data-access-management-status data-zhuge-state="loading" role="status" aria-live="polite">正在讀取申請紀錄…</div>
      <div class="user-access-application-list" data-access-application-list></div>
    </section>`;
  }

  function rowMarkup(item, note = "") {
    const id = escape(item.application_id || "");
    const status = String(item.status || "UNKNOWN").toUpperCase();
    const reviewActions = status === "PENDING" ? `<div class="user-access-review-actions"><textarea class="input" rows="2" maxlength="2000" data-review-note placeholder="審核備註（選填）"></textarea><div class="form-actions"><button class="btn zhuge-core-button" data-variant="primary" type="button" data-review-decision="approve" data-application-id="${id}">核准</button><button class="btn2 zhuge-core-button" data-variant="danger" type="button" data-review-decision="reject" data-application-id="${id}">駁回</button></div></div>` : "";
    return `<article class="user-access-application" data-application-id="${id}">
      <div class="user-access-application-main"><div><strong>${escape(item.display_name || "未提供名稱")}</strong><span class="user-access-email">${escape(item.email || "")}</span></div><span class="user-access-status user-access-status-${escape(status.toLowerCase())}">${escape(statusLabel(status))}</span></div>
      <dl class="user-access-application-meta"><div><dt>申請原因</dt><dd>${escape(item.reason || "—")}</dd></div><div><dt>申請時間</dt><dd>${escape(item.submitted_at || "—")}</dd></div>${item.decided_at ? `<div><dt>決定時間</dt><dd>${escape(item.decided_at)}</dd></div>` : ""}${item.review_note ? `<div><dt>審核備註</dt><dd>${escape(item.review_note)}</dd></div>` : ""}</dl>
      <div class="user-access-note-row"><label>Creator 私人備註<input class="input" type="text" maxlength="1000" value="${escape(note)}" data-creator-note></label><button class="btn2 zhuge-core-button" type="button" data-save-creator-note="${id}">儲存備註</button></div>
      <div class="user-access-application-actions"><button class="btn2 zhuge-core-button" type="button" data-view-application-history="${id}">查看歷史</button></div>
      ${reviewActions}<div class="user-access-history" data-application-history hidden></div>
    </article>`;
  }

  function historyMarkup(rows) {
    if (!rows.length) return "沒有可顯示的歷史紀錄。";
    return rows.map(row => `<div class="user-access-history-event"><strong>${escape(row.event_type || "event")}</strong><time>${escape(row.created_at || "")}</time><span>${escape(row.review_note || row.reason || "")}</span></div>`).join("");
  }

  async function mount(rootNode, options = {}) {
    const host = rootNode || (typeof document !== "undefined" ? document.querySelector("[data-user-access-management]") : null);
    if (!host) return null;
    const service = options.service || root?.ZhugeAppAccess;
    const dataGateway = options.dataGateway || root?.ZhugeSupabaseGateway?.createDataGateway?.();
    const creatorResolver = options.creatorResolver || root?.ZhugeCreatorResolver?.create?.({
      dataGateway,
      readUserId: () => typeof root?.currentUserUuid === "function" ? root.currentUserUuid() : ""
    });
    try {
      const creator = await creatorResolver?.resolve?.();
      if (creator?.is_creator !== true) {
        host.remove?.();
        return null;
      }
    } catch {
      host.remove?.();
      return null;
    }
    if (!service?.listApplications) {
      host.innerHTML = renderShell();
      host.querySelector("[data-access-management-status]").textContent = "App Access service 尚未載入。";
      return null;
    }
    const state = { applications: [], notes: new Map(), loading: false };
    host.innerHTML = renderShell();
    const statusNode = host.querySelector("[data-access-management-status]");
    const listNode = host.querySelector("[data-access-application-list]");
    const setStatus = (message, error = false, state = "") => {
      if (!statusNode) return;
      statusNode.textContent = message;
      statusNode.dataset.state = error ? "error" : "ready";
      if (state) statusNode.dataset.zhugeState = state;
      else delete statusNode.dataset.zhugeState;
    };
    const draw = () => {
      if (!state.applications.length) {
        listNode.innerHTML = '<div class="user-access-empty">目前沒有申請紀錄。</div>';
        return;
      }
      listNode.innerHTML = state.applications.map(item => rowMarkup(item, state.notes.get(String(item.applicant_user_id || "")) || "")).join("");
    };
    const load = async () => {
      if (state.loading) return;
      state.loading = true;
      setStatus("正在讀取申請紀錄…");
      try {
        const [applications, notes] = await Promise.all([
          service.listApplications(),
          typeof service.getCreatorNotes === "function" ? service.getCreatorNotes() : []
        ]);
        state.applications = Array.isArray(applications) ? applications : [];
        state.notes = new Map((Array.isArray(notes) ? notes : []).map(note => [String(note.subject_user_id || ""), String(note.note || "")]));
        draw();
        const pending = state.applications.filter(item => String(item.status || "").toUpperCase() === "PENDING").length;
        setStatus(`${state.applications.length} 筆申請紀錄；${pending} 筆待審核。`, false, state.applications.length ? "" : "empty");
      } catch (error) {
        listNode.innerHTML = "";
        setStatus(String(error?.message || "只有已核准的 Creator／Owner 可以查看申請紀錄。"), true);
      } finally {
        state.loading = false;
      }
    };
    host.querySelector("[data-access-refresh]")?.addEventListener("click", load);
    host.addEventListener("click", async event => {
      const reviewButton = event.target.closest?.("[data-review-decision]");
      if (reviewButton) {
        const applicationId = reviewButton.dataset.applicationId;
        const card = reviewButton.closest("[data-application-id]");
        const reviewNote = card?.querySelector("[data-review-note]")?.value || "";
        const decision = reviewButton.dataset.reviewDecision;
        reviewButton.disabled = true;
        try {
          await service.review({
            applicationId,
            decision,
            reviewNote,
            idempotencyKey: typeof root.crypto?.randomUUID === "function" ? root.crypto.randomUUID() : `review-${Date.now()}`
          });
          await load();
        } catch (error) {
          setStatus(String(error?.message || "審核操作失敗。"), true);
          reviewButton.disabled = false;
        }
        return;
      }
      const noteButton = event.target.closest?.("[data-save-creator-note]");
      if (noteButton) {
        const card = noteButton.closest("[data-application-id]");
        const item = state.applications.find(row => String(row.application_id || "") === String(noteButton.dataset.saveCreatorNote || ""));
        const subjectUserId = item?.applicant_user_id;
        if (!subjectUserId) return;
        noteButton.disabled = true;
        try {
          await service.saveCreatorNote(subjectUserId, card?.querySelector("[data-creator-note]")?.value || "");
          setStatus("Creator 私人備註已儲存。");
          await load();
        } catch (error) {
          setStatus(String(error?.message || "Creator 私人備註儲存失敗。"), true);
        } finally { noteButton.disabled = false; }
        return;
      }
      const historyButton = event.target.closest?.("[data-view-application-history]");
      if (historyButton) {
        const card = historyButton.closest("[data-application-id]");
        const historyNode = card?.querySelector("[data-application-history]");
        if (!historyNode || typeof service.history !== "function") return;
        if (!historyNode.hidden) { historyNode.hidden = true; return; }
        historyButton.disabled = true;
        try {
          const rows = await service.history(historyButton.dataset.viewApplicationHistory);
          historyNode.innerHTML = historyMarkup(Array.isArray(rows) ? rows : []);
          historyNode.hidden = false;
        } catch (error) {
          historyNode.textContent = String(error?.message || "歷史紀錄讀取失敗。");
          historyNode.hidden = false;
        } finally { historyButton.disabled = false; }
      }
    });
    await load();
    if (new URLSearchParams(root.location?.search || "").get("management") === "users") host.scrollIntoView?.({ block: "start" });
    return Object.freeze({ reload: load, getApplications: () => state.applications.slice() });
  }

  return Object.freeze({ render: renderShell, mount });
});
