/* Small shared appearance preference used by the Dashboard first.  It only
 * owns the theme preference; it does not touch routing, auth, or data. */
(function (global) {
  "use strict";
  const KEY = "zhuge-appearance-v1";
  const allowed = new Set(["system", "light", "dark"]);

  function read() {
    try {
      const value = global.localStorage?.getItem(KEY);
      return allowed.has(value) ? value : "system";
    } catch {
      return "system";
    }
  }

  function apply(value) {
    const theme = allowed.has(value) ? value : "system";
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-appearance]").forEach(button => {
      const selected = button.dataset.appearance === theme;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    return theme;
  }

  function set(value) {
    const theme = apply(value);
    try { global.localStorage?.setItem(KEY, theme); } catch { /* preference is optional */ }
    return theme;
  }

  global.ZhugeAppearance = Object.freeze({ read, apply, set });
  apply(read());
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-appearance]");
    if (button) set(button.dataset.appearance);
  });
})(window);
