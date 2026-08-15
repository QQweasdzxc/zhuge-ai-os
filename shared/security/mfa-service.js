/* Shared MFA and short-lived module unlock service.
 * TOTP is the active provider. Email OTP and Passkey keep stable extension
 * points without exposing Supabase Auth to product modules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeMfa = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROVIDERS = Object.freeze({
    totp: Object.freeze({ id: "totp", label: "Google Authenticator", available: true }),
    emailOtp: Object.freeze({ id: "email_otp", label: "Email OTP", available: false }),
    passkey: Object.freeze({ id: "passkey", label: "Passkey", available: false })
  });

  const MODULES = Object.freeze({
    investment: Object.freeze({ settingKey: "investment_mfa_required" }),
    "ai-board": Object.freeze({ settingKey: "ai_board_mfa_required" })
  });

  function createMfaService(options = {}) {
    const gateway = options.gateway;
    const dataGateway = options.dataGateway || null;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const unlockDurationMs = Math.max(60000, Number(options.unlockDurationMs || 10 * 60 * 1000));
    const storage = options.storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    const keyPrefix = String(options.keyPrefix || "zhuge_module_unlock_v1");
    const policyCache = new Map();
    if (!gateway || typeof gateway.getAuthClient !== "function" || typeof gateway.syncCanonicalSession !== "function") {
      throw new TypeError("MFA Service requires the Shared Supabase Gateway.");
    }

    const key = (moduleId, userId) => `${keyPrefix}:${String(moduleId || "")}:${String(userId || "")}`;

    function readUnlock(moduleId, userId) {
      if (!storage || !moduleId || !userId) return null;
      try {
        const value = JSON.parse(storage.getItem(key(moduleId, userId)) || "null");
        if (!value || value.userId !== userId || Number(value.expiresAt || 0) <= now()) {
          storage.removeItem(key(moduleId, userId));
          return null;
        }
        return Object.freeze({ unlocked: true, expiresAt: Number(value.expiresAt), remainingMs: Number(value.expiresAt) - now() });
      } catch {
        return null;
      }
    }

    function grantUnlock(moduleId, userId) {
      const expiresAt = now() + unlockDurationMs;
      if (storage) storage.setItem(key(moduleId, userId), JSON.stringify({ userId, expiresAt }));
      return Object.freeze({ unlocked: true, expiresAt, remainingMs: unlockDurationMs });
    }

    function lock(moduleId, userId) {
      if (storage) storage.removeItem(key(moduleId, userId));
      return Object.freeze({ unlocked: false, expiresAt: null, remainingMs: 0 });
    }

    function moduleConfig(moduleId) {
      return MODULES[String(moduleId || "").trim().toLowerCase()] || null;
    }

    function defaultPolicy(userId, isCreator = false, status = "default", error = null) {
      return Object.freeze({
        userId: String(userId || ""),
        is_creator: isCreator === true,
        investment_mfa_required: true,
        ai_board_mfa_required: true,
        status,
        error: error ? String(error?.message || error) : null
      });
    }

    function boolPreference(value, fallback = true) {
      return typeof value === "boolean" ? value : fallback;
    }

    function normalizePolicy(payload, userId) {
      const row = Array.isArray(payload) ? payload[0] : payload;
      return Object.freeze({
        userId: String(userId || ""),
        is_creator: true,
        investment_mfa_required: boolPreference(row?.investment_mfa_required),
        ai_board_mfa_required: boolPreference(row?.ai_board_mfa_required),
        status: "resolved",
        error: null
      });
    }

    function getPolicy(userId) {
      return policyCache.get(String(userId || "")) || defaultPolicy(userId);
    }

    async function loadPolicy({ userId, isCreator = false, force = false } = {}) {
      const normalizedUserId = String(userId || "");
      if (!isCreator) {
        const policy = defaultPolicy(normalizedUserId, false, "non_creator");
        policyCache.set(normalizedUserId, policy);
        return policy;
      }
      if (!force && policyCache.get(normalizedUserId)?.status === "resolved") return policyCache.get(normalizedUserId);
      try {
        if (!dataGateway || typeof dataGateway.rpc !== "function") throw new Error("MFA Settings Cloud RPC 尚未載入。");
        const payload = await dataGateway.rpc("get_creator_mfa_preferences", {});
        const policy = normalizePolicy(payload, normalizedUserId);
        policyCache.set(normalizedUserId, policy);
        return policy;
      } catch (error) {
        // Settings read errors are fail-closed: both protected modules remain ON.
        const policy = defaultPolicy(normalizedUserId, true, "error", error);
        policyCache.set(normalizedUserId, policy);
        return policy;
      }
    }

    async function setRequired({ moduleId, userId, isCreator = false, required } = {}) {
      const config = moduleConfig(moduleId);
      if (!config) throw new Error("不支援的敏感模組設定。");
      if (!isCreator) {
        const error = new Error("只有 Creator 可以變更敏感模組二次驗證設定。");
        error.code = "CREATOR_CAPABILITY_REQUIRED";
        throw error;
      }
      if (!dataGateway || typeof dataGateway.rpc !== "function") throw new Error("MFA Settings Cloud RPC 尚未載入。");
      const normalizedUserId = String(userId || "");
      await dataGateway.rpc("set_creator_mfa_preference", {
        p_module_id: String(moduleId).trim().toLowerCase(),
        p_required: required !== false
      });
      const previous = getPolicy(normalizedUserId);
      const next = Object.freeze({
        ...previous,
        userId: normalizedUserId,
        is_creator: true,
        [config.settingKey]: required !== false,
        status: "resolved",
        error: null
      });
      policyCache.set(normalizedUserId, next);
      return next;
    }

    function isModuleRequired(moduleId, userId) {
      const config = moduleConfig(moduleId);
      if (!config) return true;
      return getPolicy(userId)[config.settingKey] !== false;
    }

    async function listVerifiedTotpFactors() {
      const client = await gateway.getAuthClient();
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      return (data?.totp || data?.all || []).filter(factor => factor.factor_type === "totp" && factor.status === "verified");
    }

    async function prepare() {
      const factors = await listVerifiedTotpFactors();
      if (factors.length) {
        return Object.freeze({ mode: "challenge", provider: "totp", factorId: factors[0].id, friendlyName: factors[0].friendly_name || "Google Authenticator" });
      }
      return Object.freeze({ mode: "enrollment_required", provider: "totp" });
    }

    async function enroll() {
      const client = await gateway.getAuthClient();
      const { data: factorData, error: factorError } = await client.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const stale = (factorData?.all || factorData?.totp || []).filter(factor => factor.factor_type === "totp" && factor.status !== "verified");
      for (const factor of stale) {
        const { error: removeError } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (removeError) throw removeError;
      }
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Zhuge AI OS Protected Module" });
      if (error) throw error;
      return Object.freeze({
        mode: "enroll",
        provider: "totp",
        factorId: data.id,
        qrCode: data.totp?.qr_code || "",
        secret: data.totp?.secret || ""
      });
    }

    async function verify({ moduleId, userId, factorId, code } = {}) {
      const normalizedCode = String(code || "").replace(/\s+/g, "");
      if (!factorId) throw new Error("缺少驗證器資訊，請重新開始驗證。" );
      if (!/^\d{6}$/.test(normalizedCode)) throw new Error("請輸入 Google Authenticator 顯示的 6 位數驗證碼。" );
      const client = await gateway.getAuthClient();
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: normalizedCode });
      if (error) throw error;
      await gateway.syncCanonicalSession();
      return grantUnlock(moduleId, userId);
    }

    return Object.freeze({
      providers: () => PROVIDERS,
      getPolicy: userId => getPolicy(userId),
      loadPolicy,
      setRequired,
      isModuleRequired,
      getUnlockState: (moduleId, userId) => {
        if (!isModuleRequired(moduleId, userId)) return Object.freeze({ unlocked: true, bypassed: true, expiresAt: null, remainingMs: 0 });
        return readUnlock(moduleId, userId) || Object.freeze({ unlocked: false, expiresAt: null, remainingMs: 0 });
      },
      prepare,
      enroll,
      verify,
      lock
    });
  }

  return Object.freeze({ PROVIDERS, MODULES, createMfaService });
});
