/* Pages owns its existing Supabase session. No credential crosses the frame. */
(function () {
  "use strict";
  const TF_ORIGIN = "https://zhuge-taskflow-web.onrender.com";
  const parentOrigin = (() => {
    try { return window.parent !== window && new URL(document.referrer).origin === TF_ORIGIN ? TF_ORIGIN : null; }
    catch { return null; }
  })();
  const message = document.getElementById("message");
  const controls = document.getElementById("controls");
  const login = document.getElementById("login");
  const toggle = document.getElementById("paused");
  const reload = document.getElementById("reload");
  let status = "unknown", paused = null, busy = false, generation = 0;
  const announce = () => {
    if (parentOrigin) window.parent.postMessage({ type: "trqn-access-status", status }, parentOrigin);
  };
  function deny(text, next = "denied") {
    status = next; paused = null; controls.hidden = true; login.hidden = next !== "login";
    message.textContent = text; announce();
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
  function showState(value) {
    if (typeof value !== "boolean") throw new Error("狀態回應格式錯誤，請重新確認。");
    paused = value; toggle.checked = value;
    document.getElementById("state").textContent = `人工審核：${value ? "已暫停" : "啟用"}`;
  }
  function failure(error) {
    if (error.status === 401) deny("請先使用既有 Google 帳號登入 TRQN OS。", "login");
    else if (error.status === 403 || error.code === "42501") deny("無權限");
    else deny(`無法確認設定：${error.message}`, "error");
  }
  async function load() {
    if (busy) return;
    const current = ++generation;
    busy = true; reload.disabled = true; toggle.disabled = true;
    deny("正在確認權限…", "unknown");
    try {
      const auth = await getSupabaseAuthUser();
      if (current !== generation) return;
      if (!auth) { deny("請先使用既有 Google 帳號登入 TRQN OS。", "login"); return; }
      const capability = await rpc("resolve_creator_capability", {});
      if (current !== generation) return;
      if (capability?.is_creator !== true || capability.user_id !== auth.user.id) { deny("無權限"); return; }
      const value = await rpc("app_access_review_paused", {});
      if (current !== generation) return;
      showState(value); status = "creator"; controls.hidden = false; login.hidden = true;
      message.textContent = ""; announce();
    } catch (error) { if (current === generation) failure(error); }
    finally { busy = false; reload.disabled = false; toggle.disabled = false; }
  }
  toggle.addEventListener("change", async () => {
    const next = toggle.checked;
    toggle.checked = paused === true;
    if (busy || status !== "creator" || typeof paused !== "boolean") return;
    if (!window.confirm(`確定${next ? "暫停" : "啟用"}全站人工審核？`)) return;
    busy = true; toggle.disabled = true; reload.disabled = true;
    try {
      // Revalidate the canonical creator immediately before the one explicit write.
      const capability = await rpc("resolve_creator_capability", {});
      if (capability?.is_creator !== true) { deny("無權限"); return; }
      const result = await rpc("set_app_access_review_paused", { paused: next });
      showState(result?.review_paused);
      message.textContent = `設定已更新：人工審核${paused ? "已暫停" : "啟用"}。`;
    } catch (error) { failure(error); }
    finally { busy = false; toggle.disabled = false; reload.disabled = false; }
  });
  reload.addEventListener("click", load);
  document.getElementById("google").hidden = window.parent !== window;
  document.getElementById("google").addEventListener("click", () => signInWithGoogle().catch(failure));
  window.addEventListener("message", event => {
    if (parentOrigin && event.origin === parentOrigin && event.source === window.parent && event.data?.type === "trqn-access-query") announce();
  });
  window.addEventListener("storage", () => { if (!busy) void load(); });
  window.addEventListener("focus", () => { if (!busy) void load(); });
  void load();
})();
