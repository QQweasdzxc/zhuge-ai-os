/* Foundation contract: modules consume the application session; they do not
 * start a second OAuth flow. */
(function (global) {
  function read() {
    if (typeof AppState !== "undefined" && typeof AppState.snapshot === "function") {
      return AppState.snapshot();
    }
    return null;
  }

  global.SessionManager = Object.freeze({ read });
})(window);
