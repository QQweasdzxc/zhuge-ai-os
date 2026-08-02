/* Zhuge AI OS Shared Supabase Gateway
 *
 * Modules receive a narrow data API through ModuleContext. They never receive
 * the Supabase client, access token, refresh token, or Auth implementation.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSupabaseGateway = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.55.0/dist/umd/supabase.min.js";
  let sdkPromise = null;
  let authClient = null;

  function loadSdk() {
    if (root?.supabase?.createClient) return Promise.resolve(root.supabase);
    if (typeof document === "undefined") return Promise.reject(new Error("Supabase SDK 只能在瀏覽器載入。"));
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${SDK_URL}"]`);
      const script = existing || document.createElement("script");
      const ready = () => root?.supabase?.createClient
        ? resolve(root.supabase)
        : reject(new Error("Supabase SDK 載入失敗。"));
      script.addEventListener("load", ready, { once: true });
      script.addEventListener("error", () => reject(new Error("無法載入 Supabase SDK。")), { once: true });
      if (!existing) {
        script.src = SDK_URL;
        script.async = true;
        document.head.appendChild(script);
      }
    });
    return sdkPromise;
  }

  function requireConfig() {
    if (typeof AUTH_CONFIG === "undefined" || !AUTH_CONFIG.supabaseUrl || !AUTH_CONFIG.supabaseAnonKey) {
      throw new Error("Shared Supabase 設定尚未載入。" );
    }
    return AUTH_CONFIG;
  }

  async function initializeAuthClient() {
    if (authClient) return authClient;
    const sdk = await loadSdk();
    const config = requireConfig();
    authClient = sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    const authSession = typeof ensureFreshAuthSession === "function"
      ? await ensureFreshAuthSession(false)
      : (typeof getStoredAuthSession === "function" ? getStoredAuthSession() : null);
    if (!authSession?.access_token || !authSession?.refresh_token) {
      throw new Error("Shared Session 尚未就緒，請重新登入 Zhuge AI OS。" );
    }
    const { error } = await authClient.auth.setSession({
      access_token: authSession.access_token,
      refresh_token: authSession.refresh_token
    });
    if (error) throw error;
    return authClient;
  }

  async function syncCanonicalSession() {
    const client = await initializeAuthClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const next = data?.session;
    if (!next?.access_token || !next?.refresh_token) throw new Error("AAL2 驗證後未取得有效 Session。" );
    const previous = typeof getStoredAuthSession === "function" ? getStoredAuthSession() : null;
    const canonical = {
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      token_type: next.token_type || "bearer",
      expires_in: Number(next.expires_in || 3600),
      expires_at: Number(next.expires_at || 0) * 1000 || Date.now() + 3600000,
      provider_token: previous?.provider_token || (typeof session !== "undefined" ? session?.provider_token : "") || "",
      provider_refresh_token: previous?.provider_refresh_token || (typeof session !== "undefined" ? session?.provider_refresh_token : "") || "",
      provider_expires_at: previous?.provider_expires_at || (typeof session !== "undefined" ? session?.provider_expires_at : null) || null
    };
    if (typeof setStoredAuthSession === "function") setStoredAuthSession(canonical);
    if (typeof session !== "undefined" && session) {
      session = { ...session, ...canonical };
      if (typeof persistAiOsSessionOnly === "function") persistAiOsSessionOnly();
    }
    return canonical;
  }

  function encodedQuery(query = "") {
    const value = String(query || "").trim();
    return value && !value.startsWith("?") ? `?${value}` : value;
  }

  async function request(path, options = {}) {
    if (typeof ensureFreshAuthSession === "function") await ensureFreshAuthSession(false);
    const config = requireConfig();
    const run = () => fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: typeof cloudHeaders === "function"
        ? cloudHeaders(options.headers || {})
        : { apikey: config.supabaseAnonKey, ...(options.headers || {}) }
    });
    let response = await run();
    if (response.status === 401 && typeof refreshAuthSession === "function") {
      await refreshAuthSession(true);
      response = await run();
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
      const error = new Error(parsed?.message || body || `Supabase ${response.status}`);
      error.code = parsed?.code || "SUPABASE_REQUEST_FAILED";
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function createDataGateway() {
    return Object.freeze({
      select: (table, query = "") => request(`${encodeURIComponent(String(table || ""))}${encodedQuery(query)}`, { method: "GET" })
    });
  }

  return Object.freeze({
    createDataGateway,
    getAuthClient: initializeAuthClient,
    syncCanonicalSession
  });
});
