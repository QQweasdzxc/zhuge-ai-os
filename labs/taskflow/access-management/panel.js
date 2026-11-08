/* Existing Pages session only. All PII is rendered after both creator checks. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const message = $("message"), controls = $("controls"), login = $("login"), toggle = $("paused"), reload = $("reload"), cards = $("cards"), dialog = $("confirmation");
  let status = "unknown", paused = null, busy = false, generation = 0, userId = null, rows = [], filter = "all", selected = null;
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (cls) el.className = cls; return el; };
  function deny(text, next = "denied") {
    status = next; paused = null; rows = []; cards.replaceChildren(); controls.hidden = true; login.hidden = next !== "login";
    if (dialog.open) dialog.close(); selected = null; message.textContent = text;
  }
  async function rpc(name, args) {
    const auth = await getAuthSession();
    if (!auth?.access_token) throw Object.assign(new Error("請先登入"), { status: 401 });
    const response = await fetch(`${AUTH_CONFIG.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST", headers: authHeaders(auth.access_token), body: JSON.stringify(args), cache: "no-store"
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.message || `請求失敗 (${response.status})`), { status: response.status, code: data?.code });
    return data;
  }
  async function creator() {
    const auth = await getSupabaseAuthUser();
    if (!auth?.user?.id) throw Object.assign(new Error("請先登入"), { status: 401 });
    const capability = await rpc("resolve_creator_capability", {});
    if (capability?.is_creator !== true || capability.user_id !== auth.user.id || (userId && userId !== auth.user.id)) throw Object.assign(new Error("無權限"), { status: 403 });
    userId = auth.user.id;
  }
  function showState(value) {
    if (typeof value !== "boolean") throw new Error("狀態回應格式錯誤，請重新確認。");
    paused = value; toggle.checked = value; toggle.setAttribute("aria-checked", String(value));
    $("state").textContent = `人工審核：${value ? "已暫停" : "啟用"}`;
    $("pause-note").textContent = value ? "暫停中，已登入者可直接進入，不會產生新的等待審核申請；個別設為 Off 的人仍會被擋" : "人工審核啟用中，尚未通過的人需提出申請並等待管理者審核。";
  }
  function failure(error) {
    if (error.status === 401) deny("請先使用既有 Google 帳號登入 TRQN OS。", "login");
    else if (error.status === 403 || error.code === "42501") deny("無權限");
    else deny(`無法載入：${error.message}。請重新確認。`, "error");
  }
  const pending = row => !row.access_disabled && ["PENDING", "NEW"].includes(row.status);
  const category = row => pending(row) ? "pending" : row.enabled ? "enabled" : "disabled";
  const time = value => value ? new Date(value).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "";
  function render() {
    cards.replaceChildren();
    for (const button of $("filters").children) {
      const key = button.dataset.filter;
      button.textContent = `${({ all: "全部", pending: "待審核", enabled: "已允許", disabled: "已禁止" })[key]} (${rows.filter(r => key === "all" || category(r) === key).length})`;
      button.setAttribute("aria-pressed", String(filter === key)); button.disabled = busy;
    }
    const visible = rows.filter(r => filter === "all" || category(r) === filter);
    if (!rows.length) { cards.append(node("p", "目前沒有申請紀錄")); return; }
    if (!visible.length) { cards.append(node("p", "此分類目前沒有紀錄")); return; }
    for (const row of visible) {
      const state = pending(row) ? "待審核" : row.enabled ? "已允許" : "已禁止";
      const card = node("article", null, `card${pending(row) ? " pending" : ""}`);
      const name = row.display_name || "尚未填寫姓名";
      card.setAttribute("aria-label", `${name}，${state}`);
      const header = node("div", null, "identity"), avatar = node("span", Array.from(name).slice(0, 2).join(""), "avatar"); avatar.setAttribute("aria-hidden", "true");
      const identity = node("div"); identity.append(node("h3", name), node("p", row.email || "未提供 Email", "email")); header.append(avatar, identity);
      card.append(header, node("span", state, "badge"), node("p", row.submitted_at ? `申請時間：${time(row.submitted_at)}` : row.bootstrap ? "既有核准" : "App 成員（尚無申請紀錄）", "meta"));
      if (row.reason) { const details = node("details"); details.append(node("summary", "申請原因"), node("p", row.reason)); card.append(details); }
      if (row.decided_at) card.append(node("p", `最近決定：${time(row.decided_at)}`, "meta"));
      if (row.review_note) card.append(node("p", `最近決定備註：${row.review_note}`, "note"));
      const self = row.applicant_user_id === userId || row.is_creator === true;
      const line = node("div", null, "switch-line"), label = node("span", row.enabled ? "On · 允許使用" : "Off · 禁止使用 🚫");
      const button = node("button", null, "apple-switch"); button.type = "button"; button.setAttribute("role", "switch"); button.setAttribute("aria-checked", String(row.enabled)); button.setAttribute("aria-label", `${name}：${row.enabled ? "允許使用" : "禁止使用"}${pending(row) ? "，待審核" : ""}`); button.disabled = busy || self;
      button.addEventListener("click", () => {
        if (busy || status !== "creator") return;
        selected = { row, enabled: !row.enabled, key: crypto.randomUUID() };
        $("confirm-title").textContent = `確定${selected.enabled ? "允許" : "禁止"}${name}使用？`;
        $("review-note").value = ""; $("confirm-error").textContent = ""; dialog.showModal();
      });
      line.append(label, button); card.append(line);
      if (self) card.append(node("p", "管理者開關已鎖定，避免自己或其他管理者被鎖在系統外。", "meta"));
      cards.append(card);
    }
  }
  function lock(value) { busy = value; reload.disabled = value; toggle.disabled = value; $("confirm-submit").disabled = value; $("confirm-cancel").disabled = value; }
  async function refresh() {
    await creator();
    const value = await rpc("app_access_review_paused", {});
    const result = await rpc("list_app_access_applications", {});
    // Recheck canonical identity before exposing PII after asynchronous reads.
    await creator();
    if (!Array.isArray(result) || result.some(r => typeof r.enabled !== "boolean")) throw new Error("名片服務尚未更新，請先部署 ZG-71 migration");
    rows = result; showState(value); status = "creator"; controls.hidden = false; login.hidden = true;
  }
  async function load() {
    if (busy || dialog.open) return;
    const current = ++generation; lock(true); deny("正在確認權限與載入名片…", "unknown");
    try { await refresh(); if (current === generation) message.textContent = ""; }
    catch (error) { if (current === generation) failure(error); }
    finally { lock(false); if (status === "creator") render(); }
  }
  toggle.addEventListener("change", async () => {
    const next = toggle.checked; toggle.checked = paused === true;
    if (busy || status !== "creator" || typeof paused !== "boolean") return;
    if (!window.confirm(`確定${next ? "暫停" : "啟用"}全站人工審核？`)) return;
    lock(true); message.textContent = "正在更新設定…"; render();
    try { await creator(); const result = await rpc("set_app_access_review_paused", { paused: next }); showState(result?.review_paused); await refresh(); message.textContent = "設定已更新。"; }
    catch (error) { failure(error); }
    finally { lock(false); if (status === "creator") render(); }
  });
  $("confirm-cancel").addEventListener("click", () => { if (!busy) { selected = null; dialog.close(); } });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); else selected = null; });
  $("confirm-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!selected || busy || status !== "creator") return;
    const action = selected, note = $("review-note").value.trim();
    if (Array.from(note).length > 2000) { $("confirm-error").textContent = "備註最多 2000 字。"; return; }
    lock(true); message.textContent = "正在更新存取設定…"; $("confirm-error").textContent = ""; render();
    try {
      await creator();
      await rpc("set_app_access_user_enabled", { p_applicant_user_id: action.row.applicant_user_id, p_enabled: action.enabled, p_note: note || null, p_idempotency_key: action.key });
      selected = null; dialog.close(); await refresh(); message.textContent = "存取設定已更新。";
    } catch (error) {
      // The visual switch was never optimistically changed; recover by rereading on retry.
      selected = null; dialog.close();
      if (error.status === 401 || error.status === 403 || error.code === "42501") failure(error);
      else message.textContent = `更新未確認：${error.message}。開關保留原狀，請重新確認後再試。`;
    } finally { lock(false); if (status === "creator") render(); }
  });
  $("filters").addEventListener("click", event => { if (!busy && event.target.dataset.filter) { filter = event.target.dataset.filter; render(); } });
  reload.addEventListener("click", load);
  $("google").addEventListener("click", () => signInWithGoogle().catch(failure));
  window.addEventListener("storage", () => { if (!busy) void load(); });
  window.addEventListener("focus", () => { if (!busy) void load(); });
  void load();
})();
