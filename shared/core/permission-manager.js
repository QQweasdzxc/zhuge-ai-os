/* Permission decisions belong to the shared identity layer. This contract
 * reports capability state; it never requests OAuth permission by itself. */
(function (global) {
  function can(capability, permissions = {}) {
    return permissions[String(capability)] === true;
  }

  global.PermissionManager = Object.freeze({ can });
})(window);
