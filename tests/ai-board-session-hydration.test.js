const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runtimePath = path.join(__dirname, "..", "app", "Board", "ai", "board-runtime.js");
const runtime = fs.readFileSync(runtimePath, "utf8");

test("AI Board hydrates the canonical Auth session before creating the Shared Platform", () => {
  const hydration = runtime.indexOf("function hydrateBoardSession()");
  const init = runtime.indexOf("async function init()");
  const platform = runtime.indexOf("const platform = provider.createPlatform()", init);

  assert.ok(hydration >= 0, "AI Board must expose a boot hydration path");
  assert.match(runtime.slice(hydration, hydration + 900), /getSupabaseAuthUser\(\)/);
  assert.match(runtime.slice(hydration, hydration + 900), /supabaseSessionFromUser/);
  assert.match(runtime.slice(hydration, hydration + 900), /persistAiOsSessionOnly\(\)/);
  assert.ok(init >= 0 && platform > init, "AI Board init must create the platform");
  assert.ok(runtime.indexOf("await hydrateBoardSession()", init) < platform, "hydration must finish before the security platform is created");
});

test("AI Board session hydration is single-flight and fail-safe", () => {
  const hydration = runtime.slice(runtime.indexOf("function hydrateBoardSession()"), runtime.indexOf("function renderMfaUnlock"));

  assert.match(hydration, /boardSessionHydrationPromise/);
  assert.match(hydration, /\.finally\(\(\) => \{ boardSessionHydrationPromise = null; \}\)/);
  assert.match(runtime, /renderSessionHydrationState\(\)/);
  assert.match(runtime, /if \(typeof clearStoredAuthSession === "function"\) clearStoredAuthSession\(\);/);
  assert.match(runtime, /if \(!hydrated\) \{/);
});

test("AI Board restores the captured board markup after successful hydration", () => {
  const init = runtime.slice(runtime.indexOf("async function init()"));
  assert.match(runtime, /function restoreCapturedBoardMarkup\(\)/);
  assert.match(init, /if \(access\.allowed\) \{\s*restoreCapturedBoardMarkup\(\);\s*startBoardRuntime\(\);/);
});
