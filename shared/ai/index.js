/* Shared Mr. KM capability contract. No network calls or model inference are
 * performed here; modules provide domain context through this boundary. */
(function (global) {
  const capabilities = Object.freeze(["prompt", "memory", "knowledge", "embedding"]);

  function request(capability, payload = {}) {
    if (!capabilities.includes(capability)) throw new Error(`Unsupported Mr. KM capability: ${capability}`);
    return Object.freeze({ capability, payload });
  }

  global.MrKM = Object.freeze({ capabilities, request });
})(window);
