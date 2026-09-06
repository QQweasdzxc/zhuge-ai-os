/* Zhuge AI OS Shared Session
 *
 * Adapts the root application's existing session provider to a redacted,
 * read-only module contract. It does not persist, refresh, sign in, or sign out.
 */
(function (root, factory) {
  const identityApi = root?.ZhugeIdentity
    || (typeof require === "function" ? require("../identity/identity-service.js") : null);
  const api = factory(identityApi);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Identity) {
  "use strict";

  if (!Identity) throw new Error("ZhugeIdentity must load before ZhugeSession.");

  const EMPTY_SESSION = Object.freeze({
    status: "anonymous",
    isAuthenticated: false,
    identity: Identity.normalize({}),
    aal: "aal0",
    expiresAt: null,
    isExpired: false
  });

  function decodeJwtPayload(token = "") {
    try {
      const encoded = String(token).split(".")[1];
      if (!encoded || typeof atob !== "function") return null;
      const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function epochMilliseconds(value) {
    const numeric = Number(value || 0);
    if (!numeric) return null;
    return numeric > 1000000000000 ? numeric : numeric * 1000;
  }

  function normalizeAal(raw = {}, jwt = null, authenticated = false) {
    const value = String(raw.aal || raw.assuranceLevel || jwt?.aal || "").toLowerCase();
    if (value === "aal2") return "aal2";
    return authenticated ? "aal1" : "aal0";
  }

  function normalizeSnapshot(rawValue, now = Date.now()) {
    const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
    const session = raw.session && typeof raw.session === "object"
      ? raw.session
      : (raw.authSession && typeof raw.authSession === "object" ? raw.authSession : raw);
    const identitySource = raw.user && !session.user ? { ...session, user: raw.user } : session;
    const identity = Identity.normalize(identitySource);
    const jwt = decodeJwtPayload(session.access_token || "");
    const expiresAt = epochMilliseconds(session.expires_at) || epochMilliseconds(jwt?.exp);
    const isExpired = Boolean(expiresAt && expiresAt <= now);
    const isAuthenticated = identity.isAuthenticated && !isExpired;

    return Object.freeze({
      status: isExpired ? "expired" : (isAuthenticated ? "authenticated" : "anonymous"),
      isAuthenticated,
      identity: isAuthenticated ? identity : Identity.normalize({}),
      aal: normalizeAal(session, jwt, isAuthenticated),
      expiresAt,
      isExpired
    });
  }

  function createSessionService(options = {}) {
    const readSession = typeof options.readSession === "function" ? options.readSession : () => null;
    const subscribeSource = typeof options.subscribe === "function" ? options.subscribe : null;
    const now = typeof options.now === "function" ? options.now : () => Date.now();

    function getSnapshot() {
      return normalizeSnapshot(readSession(), now());
    }

    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Session listener must be a function.");
      if (!subscribeSource) return () => {};
      const unsubscribe = subscribeSource(() => listener(getSnapshot()));
      return typeof unsubscribe === "function" ? unsubscribe : () => {};
    }

    return Object.freeze({
      getSnapshot,
      getCurrentIdentity: () => getSnapshot().identity,
      getCurrentUserId: () => Identity.requireUserId(getSnapshot().identity),
      isAuthenticated: () => getSnapshot().isAuthenticated,
      subscribe
    });
  }

  return Object.freeze({ EMPTY_SESSION, createSessionService, normalizeSnapshot });
});
