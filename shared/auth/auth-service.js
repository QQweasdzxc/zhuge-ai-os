// P5.2A-1 Foundation Split: Google OAuth, PKCE, Supabase session, and JWT refresh.
function getStoredAuthSession() {
  return readJson(AUTH_SESSION_KEY, null);
}

function setStoredAuthSession(value) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(value));
  localStorage.removeItem("wl_google_auth_session_v1");
}

function setStoredAuthProvider(provider) {
  localStorage.setItem(AUTH_PROVIDER_KEY, String(provider || "email-password"));
}

function getStoredAuthProvider() {
  return localStorage.getItem(AUTH_PROVIDER_KEY) || "email-password";
}

let authSessionRefreshPromise = null;

async function performAuthSessionRefresh() {
  const stored = getStoredAuthSession();
  const refreshToken = stored?.refresh_token || session?.refresh_token || "";
  if (!refreshToken) return null;
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let parsedBody = null;
    try { parsedBody = body ? JSON.parse(body) : null; } catch { parsedBody = null; }
    console.error("Supabase refresh session failed", {
      status: res.status,
      statusText: res.statusText,
      code: parsedBody?.code || "",
      message: parsedBody?.message || body || res.statusText,
      details: parsedBody?.details || "",
      hint: parsedBody?.hint || "",
      body,
      has_refresh_token: !!refreshToken
    });
    return null;
  }
  const data = await res.json();
  const sessionValue = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    provider_token: data.provider_token || stored?.provider_token || session?.provider_token || "",
    provider_refresh_token: data.provider_refresh_token || stored?.provider_refresh_token || session?.provider_refresh_token || "",
    provider_expires_at: data.provider_token
      ? Date.now() + Number(data.expires_in || 3600) * 1000
      : (stored?.provider_expires_at || session?.provider_expires_at || null),
    token_type: data.token_type || "bearer",
    expires_in: Number(data.expires_in || 3600),
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  setStoredAuthSession(sessionValue);
  // Keep the root identity snapshot synchronized too. Modules still receive
  // only the redacted Shared Session contract; no architecture boundary moves.
  if (session) {
    session = {
      ...session,
      access_token: sessionValue.access_token,
      refresh_token: sessionValue.refresh_token,
      token_type: sessionValue.token_type,
      expires_in: sessionValue.expires_in,
      expires_at: sessionValue.expires_at
    };
    persistAiOsSessionOnly();
  }
  return sessionValue;
}

async function refreshAuthSession(force = false) {
  const stored = getStoredAuthSession();
  if (!force && !accessTokenNeedsRefresh()) return stored || session;
  // Supabase rotates refresh tokens. Collapse simultaneous REST/Realtime calls
  // into one refresh so concurrent requests cannot consume the same token.
  if (!authSessionRefreshPromise) {
    authSessionRefreshPromise = performAuthSessionRefresh()
      .finally(() => { authSessionRefreshPromise = null; });
  }
  return authSessionRefreshPromise;
}

async function ensureFreshAuthSession(force = false) {
  if (!currentUserUuid() && !session?.email) return null;
  if (!force && !accessTokenNeedsRefresh()) return getStoredAuthSession() || session;
  return refreshAuthSession(force);
}

function clearStoredAuthSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem("wl_google_auth_session_v1");
  localStorage.removeItem(AUTH_PROVIDER_KEY);
}

function getStoredCodeVerifier() {
  return localStorage.getItem(AUTH_CODE_VERIFIER_KEY);
}

function setStoredCodeVerifier(value) {
  localStorage.setItem(AUTH_CODE_VERIFIER_KEY, value);
  localStorage.removeItem("wl_google_pkce_code_verifier_v1");
}

function clearStoredCodeVerifier() {
  localStorage.removeItem(AUTH_CODE_VERIFIER_KEY);
  localStorage.removeItem("wl_google_pkce_code_verifier_v1");
}

function getStoredOAuthError() {
  return readJson(OAUTH_ERROR_KEY, null);
}

function clearStoredOAuthError() {
  localStorage.removeItem(OAUTH_ERROR_KEY);
}

function captureOAuthError() {
  const params = new URLSearchParams(location.search);
  const code = params.get("error") || params.get("error_code");
  if (!code) return null;
  const rawDescription = params.get("error_description") || "";
  const message = code === "access_denied"
    ? "Google 暫時拒絕這次登入或授權。請確認 OAuth 應用程式已完成必要的發布／驗證設定。"
    : "Google 登入尚未完成，請稍後再試。";
  const payload = {
    code,
    message,
    detail: rawDescription.slice(0, 240),
    at: new Date().toISOString()
  };
  writeJson(OAUTH_ERROR_KEY, payload);
  clearStoredCodeVerifier();
  cleanAuthCallbackUrl();
  console.warn("Zhuge AI OS OAuth authorization was not completed", { code });
  return payload;
}

function recordOAuthDebug(stage, detail) {
  const payload = { stage, detail, at: new Date().toISOString(), href: location.href };
  localStorage.setItem("zhuge_ai_os_oauth_debug_v1", JSON.stringify(payload));
  console.error("Zhuge AI OS OAuth Debug", payload);
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function codeChallengeFromVerifier(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function cleanAuthCallbackUrl() {
  const params = new URLSearchParams(location.search);
  ["code", "state", "error", "error_code", "error_description", "error_reason"].forEach(key => params.delete(key));
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : ""));
}

function captureHashAuthSession() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const accessToken = hash.get("access_token");
  if (!accessToken) return null;
  authCallbackCaptured = true;
  const sessionValue = {
    access_token: accessToken,
    refresh_token: hash.get("refresh_token"),
    provider_token: hash.get("provider_token") || "",
    provider_refresh_token: hash.get("provider_refresh_token") || "",
    provider_expires_at: hash.get("provider_token") ? Date.now() + Number(hash.get("expires_in") || 3600) * 1000 : null,
    token_type: hash.get("token_type") || "bearer",
    expires_in: Number(hash.get("expires_in") || 3600),
    expires_at: Date.now() + Number(hash.get("expires_in") || 3600) * 1000
  };
  setStoredAuthSession(sessionValue);
  // A confirmation/recovery link uses the same Supabase hash contract as an
  // OAuth callback.  The provider marker lets boot restore the correct shared
  // identity without treating every password session as Google OAuth.
  setStoredAuthProvider(getStoredAuthProvider());
  clearStoredCodeVerifier();
  history.replaceState(null, "", location.pathname + location.search);
  return sessionValue;
}

async function exchangeCodeForSession() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code) return null;
  const codeVerifier = getStoredCodeVerifier();
  if (!codeVerifier) return null;
  authCallbackCaptured = true;
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    recordOAuthDebug("pkce_token_exchange_failed", { status: res.status, body });
    clearStoredAuthSession();
    return null;
  }
  const data = await res.json();
  const sessionValue = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    provider_token: data.provider_token || "",
    provider_refresh_token: data.provider_refresh_token || "",
    provider_expires_at: data.provider_token ? Date.now() + Number(data.expires_in || 3600) * 1000 : null,
    token_type: data.token_type || "bearer",
    expires_in: Number(data.expires_in || 3600),
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  setStoredAuthSession(sessionValue);
  setStoredAuthProvider("google-oauth");
  clearStoredCodeVerifier();
  cleanAuthCallbackUrl();
  return sessionValue;
}

async function getAuthSession() {
  const oauthError = captureOAuthError();
  if (oauthError) {
    // Browser Back can restore a stale OAuth error after login succeeded.
    // Preserve the valid existing session instead of entering OAuth again.
    const stored = getStoredAuthSession();
    if (stored?.access_token || hasGoogleOAuthSession()) return stored || session;
    return null;
  }
  return captureHashAuthSession() || await exchangeLinkedIdentityForSession() || await exchangeCodeForSession() || await refreshAuthSession(false) || getStoredAuthSession();
}

function authSessionFromResponse(data, provider = "email-password") {
  if (!data?.access_token) return null;
  const sessionValue = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || "",
    provider_token: data.provider_token || "",
    provider_refresh_token: data.provider_refresh_token || "",
    provider_expires_at: data.provider_token ? Date.now() + Number(data.expires_in || 3600) * 1000 : null,
    token_type: data.token_type || "bearer",
    expires_in: Number(data.expires_in || 3600),
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  setStoredAuthSession(sessionValue);
  setStoredAuthProvider(provider);
  return sessionValue;
}

async function exchangeLinkedIdentityForSession() {
  const code = new URLSearchParams(location.search).get("code");
  if (!code || localStorage.getItem(AUTH_LINK_PENDING_KEY) !== "1") return null;
  const gateway = typeof ZhugeSupabaseGateway !== "undefined" ? ZhugeSupabaseGateway : null;
  if (!gateway?.getAuthClient) return null;
  try {
    const client = await gateway.getAuthClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data?.session?.access_token) return null;
    const sessionValue = authSessionFromResponse(data.session, "google-oauth");
    localStorage.removeItem(AUTH_LINK_PENDING_KEY);
    cleanAuthCallbackUrl();
    return sessionValue;
  } catch (error) {
    recordOAuthDebug("identity_link_exchange_failed", { message: error?.message || String(error) });
    return null;
  }
}

async function getSupabaseAuthUser() {
  const authSession = await getAuthSession();
  if (!authSession?.access_token) return null;
  let activeAuthSession = authSession;
  let res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/user`, { headers: authHeaders(activeAuthSession.access_token) });
  if (res.status === 401) {
    const refreshed = await refreshAuthSession(true);
    if (refreshed?.access_token) {
      activeAuthSession = refreshed;
      res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/user`, { headers: authHeaders(activeAuthSession.access_token) });
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    recordOAuthDebug("auth_user_fetch_failed", { status: res.status, body });
    clearStoredAuthSession();
    return null;
  }
  const user = await res.json();
  return { user, authSession: activeAuthSession, provider: getStoredAuthProvider() };
}

async function signInWithEmailPassword(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error("請輸入 Email 與密碼。");
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ email: normalizedEmail, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || "Email 登入失敗，請確認帳密或完成 Email 驗證。");
  return authSessionFromResponse(data, "email-password");
}

async function signUpWithEmailPassword(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error("請輸入 Email 與密碼。");
  if (String(password).length < 8) throw new Error("密碼至少需要 8 個字元。");
  const emailRedirectTo = location.origin + location.pathname;
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/signup?redirect_to=${encodeURIComponent(emailRedirectTo)}`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ email: normalizedEmail, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.message || "建立帳號失敗，請稍後再試。");
  if (data.access_token) authSessionFromResponse(data, "email-password");
  return data;
}

async function requestPasswordReset(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("請先輸入 Email。");
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/recover`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ email: normalizedEmail, redirect_to: location.origin + location.pathname })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.message || "重設密碼信件寄送失敗。");
  return data;
}

async function setPasswordForCurrentUser(password) {
  if (!currentAccessToken()) throw new Error("請先登入後再設定密碼。");
  if (String(password || "").length < 8) throw new Error("密碼至少需要 8 個字元。");
  const res = await fetch(`${AUTH_CONFIG.supabaseUrl}/auth/v1/user`, {
    method: "PUT", headers: authHeaders(currentAccessToken()), body: JSON.stringify({ password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.msg || data.message || "設定密碼失敗。");
  return data;
}

async function linkGoogleIdentity() {
  const gateway = typeof ZhugeSupabaseGateway !== "undefined" ? ZhugeSupabaseGateway : null;
  if (!gateway?.getAuthClient) throw new Error("Shared Auth 連結服務尚未載入。");
  const client = await gateway.getAuthClient();
  const { data, error } = await client.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Google 連結網址未建立。");
  localStorage.setItem(AUTH_LINK_PENDING_KEY, "1");
  location.href = data.url;
}

async function signInWithGoogle() {
  clearStoredOAuthError();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier);
  setStoredCodeVerifier(codeVerifier);
  setStoredAuthProvider("google-oauth");
  const redirectTo = location.origin + location.pathname;
  const params = new URLSearchParams({
    provider: "google",
    redirect_to: redirectTo,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scopes: GOOGLE_DRIVE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent"
  });
  location.href = `${AUTH_CONFIG.supabaseUrl}/auth/v1/authorize?${params.toString()}`;
}

function googleSessionFromUser(authUser, authSession = {}) {
  return supabaseSessionFromUser(authUser, authSession, "google-oauth");
}

function supabaseSessionFromUser(authUser, authSession = {}, provider = getStoredAuthProvider()) {
  const meta = authUser.user_metadata || {};
  const email = authUser.email || "";
  return {
    provider,
    user_uuid: authUser.id,
    uuid: authUser.id,
    name: meta.full_name || meta.name || email || "Google User",
    email,
    avatar: meta.avatar_url || "",
    avatarUrl: meta.avatar_url || "",
    access_token: authSession.access_token || "",
    refresh_token: authSession.refresh_token || "",
    provider_token: authSession.provider_token || "",
    provider_refresh_token: authSession.provider_refresh_token || "",
    provider_expires_at: authSession.provider_expires_at || null,
    expires_at: authSession.expires_at || null,
    expires_in: authSession.expires_in || null,
    token_type: authSession.token_type || "bearer",
    loginAt: new Date().toISOString()
  };
}

function currentGoogleProviderToken() {
  const stored = getStoredAuthSession();
  const token = session?.provider_token || stored?.provider_token || "";
  const expiresAt = tokenExpiresAtMs(session?.provider_expires_at) || tokenExpiresAtMs(stored?.provider_expires_at);
  if (expiresAt && Date.now() + 30000 >= expiresAt) return "";
  return token;
}

function hasGoogleDriveAccess() {
  return Boolean(currentGoogleProviderToken());
}

async function getGoogleAuthUser() {
  const result = await getSupabaseAuthUser();
  return result ? { user: result.user, authSession: result.authSession } : null;
}

function hasGoogleOAuthSession() {
  return !!session?.email && !!currentUserUuid() && !!currentAccessToken();
}

function clearInvalidAuthState() {
  if (session && !hasGoogleOAuthSession()) {
    session = null;
    saveAll();
  }
}
