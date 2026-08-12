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

  function createMfaService(options = {}) {
    const gateway = options.gateway;
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const unlockDurationMs = Math.max(60000, Number(options.unlockDurationMs || 10 * 60 * 1000));
    const storage = options.storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
    const keyPrefix = String(options.keyPrefix || "zhuge_module_unlock_v1");
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
      getUnlockState: (moduleId, userId) => readUnlock(moduleId, userId) || Object.freeze({ unlocked: false, expiresAt: null, remainingMs: 0 }),
      prepare,
      enroll,
      verify,
      lock
    });
  }

  return Object.freeze({ PROVIDERS, createMfaService });
});
