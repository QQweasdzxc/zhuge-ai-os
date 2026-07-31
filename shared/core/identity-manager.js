/* Foundation contract: identity is read from the shared session only. */
(function (global) {
  function normalize(identity = {}) {
    return Object.freeze({
      id: identity.id || identity.userId || null,
      email: identity.email || "",
      name: identity.name || identity.displayName || "",
      avatar: identity.avatar || identity.avatarUrl || ""
    });
  }

  global.IdentityManager = Object.freeze({ normalize });
})(window);
