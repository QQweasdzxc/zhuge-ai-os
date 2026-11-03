// TaskFlow-owned invisible Zhuge identity intake (overrides channel).
//
// A Zhuge AI OS entry (pixel office wall, landing page) may hand the TaskFlow
// credential to this Render web origin in the URL fragment (#zhuge_token=...).
// The fragment never reaches the server, so a client script must plant it into
// localStorage before the app's auth store initializes - this is what lets the
// normal path skip any visible handoff page. Injected before-interactive into
// the root layout by labs/taskflow/patches/apply-taskflow-token-intake.py.
//
// Security invariants (kept identical to zhuge-handoff.html):
// - The fragment is stripped via history.replaceState BEFORE any validation
//   can fail, so the credential never lingers in the visible URL, browser
//   history, screenshots, or logs.
// - The token is length-capped and only ever written to localStorage; it is
//   never logged, rendered, or sent anywhere by this script.
// - An optional zhuge_dest is followed only when it resolves to this origin.
// - Failure leaves the app to boot normally into its own unauthenticated
//   state; this script never renders, blocks, or loops.
export const ZHUGE_TOKEN_INTAKE_INLINE = String.raw`
(() => {
  "use strict";
  try {
    var hash = window.location.hash || "";
    if (hash.indexOf("zhuge_token=") < 0) return;
    var params = new URLSearchParams(hash.slice(1));
    var token = params.get("zhuge_token") || "";
    var dest = params.get("zhuge_dest") || "";
    // Strip before any validation can fail (see module comment).
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token || token.length > 16384) return;
    window.localStorage.setItem("multica_token", token);
    if (!dest) return;
    if (dest.charAt(0) !== "/" || dest.indexOf("//") === 0 || dest.indexOf("\\") >= 0) return;
    var resolved = new URL(dest, window.location.origin);
    if (resolved.origin !== window.location.origin) return;
    window.location.replace(resolved.pathname + resolved.search + resolved.hash);
  } catch (err) {
    // Normal boot continues; the app shows its own login when unauthenticated.
  }
})();
`;
