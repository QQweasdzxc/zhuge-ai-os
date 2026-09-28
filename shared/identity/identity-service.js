/* Zhuge AI OS Shared Identity
 *
 * Normalizes provider-specific user/session shapes into the only identity
 * contract visible to modules. Tokens and provider session details are never
 * copied into the returned value.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeIdentity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && String(value).trim() !== "");
  }

  function isUuid(value) {
    return UUID_PATTERN.test(String(value || "").trim());
  }

  function normalize(source = {}) {
    const session = source && typeof source === "object" ? source : {};
    const user = session.user && typeof session.user === "object" ? session.user : {};
    const metadata = user.user_metadata && typeof user.user_metadata === "object"
      ? user.user_metadata
      : {};
    const userId = String(firstValue(
      session.userId,
      session.user_id,
      session.user_uuid,
      session.uuid,
      session.id,
      user.id,
      user.user_id,
      user.user_uuid
    ) || "").trim();
    const email = String(firstValue(session.email, user.email) || "").trim();
    const displayName = String(firstValue(
      session.displayName,
      session.name,
      user.displayName,
      metadata.full_name,
      metadata.name,
      email
    ) || "").trim();
    const avatarUrl = String(firstValue(
      session.avatarUrl,
      session.avatar,
      user.avatarUrl,
      metadata.avatar_url,
      metadata.picture
    ) || "").trim();
    const providerValue = String(firstValue(
      session.provider,
      user.app_metadata?.provider,
      user.identities?.[0]?.provider
    ) || "google").trim();
    const isAuthenticated = session.isAuthenticated === false
      ? false
      : isUuid(userId);

    return Object.freeze({
      id: userId,
      userId,
      email,
      displayName,
      name: displayName,
      avatarUrl,
      avatar: avatarUrl,
      provider: isAuthenticated ? providerValue : "",
      isAuthenticated
    });
  }

  function requireUserId(source = {}) {
    const identity = source.userId !== undefined && source.isAuthenticated !== undefined
      ? source
      : normalize(source);
    if (!identity.isAuthenticated || !isUuid(identity.userId)) {
      const error = new Error("A valid Shared Identity UUID is required.");
      error.name = "SharedIdentityError";
      error.code = "IDENTITY_REQUIRED";
      throw error;
    }
    return identity.userId;
  }

  return Object.freeze({ isUuid, normalize, requireUserId });
});
