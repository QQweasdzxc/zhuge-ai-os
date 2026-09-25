const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("SkyEye is a mobile-only shared-navigation entry, not a desktop destination", () => {
  const nav = read("shared/components/zhuge-navigation.js");
  const css = read("shared/theme/zhuge-navigation.css");
  assert.match(nav, /skyeye:\s*\{ icon: "🛰️", label: "天眼"/);
  assert.match(nav, /skyeye:\s*"modules\/skyeye\/"/);
  assert.match(css, /data-nav-group="mobile"/);
  assert.match(css, /@media\(max-width:767px\).*data-nav-group="mobile"/s);
});

test("SkyEye client requests the read adapter through the Shared Gateway and gates CCTV", () => {
  const app = read("modules/skyeye/skyeye-app.js");
  assert.match(app, /invokeFunction\(FUNCTION_NAME/);
  assert.match(app, /include_cctv: includeCctv/);
  assert.match(app, /if \(key === "cctv" && !state\.cctvRequested\)/);
  assert.doesNotMatch(app, /api_key|TDX_CLIENT_SECRET|CWA_API_KEY|MOENV_API_KEY/);
});

test("SkyEye uses the bounded map overlay contract and lazy CCTV presentation", () => {
  const app = read("modules/skyeye/skyeye-app.js");
  const html = read("modules/skyeye/index.html");
  const css = read("modules/skyeye/assets/skyeye.css");
  const overlay = read("modules/skyeye/services/skyeye-overlay-contract.js");
  assert.match(html, /data-skyeye-overlays/);
  assert.match(html, /skyeye-overlay-contract\.js/);
  assert.match(app, /overlayContract\.open/);
  assert.match(app, /overlayContract\.minimize/);
  assert.match(app, /overlayContract\.expand/);
  assert.match(app, /overlayContract\.close/);
  assert.match(app, /overlayContract\.snapPosition/);
  assert.match(app, /renderCctvMedia/);
  assert.match(app, /qualityLabel/);
  assert.match(app, /資料品質/);
  assert.match(app, /item\.mode !== "primary" \|\| item\.layerKey !== "cctv"/);
  assert.doesNotMatch(app, /marker\.image_url[\s\S]{0,220}renderSelectedDetail/);
  assert.match(overlay, /MAX_PRIMARY = 1/);
  assert.match(overlay, /MAX_MINIMIZED = 2/);
  assert.match(css, /\.skyeye-overlay-layer[\s\S]*pointer-events: none/);
  assert.match(css, /\.skyeye-overlay-handle[\s\S]*touch-action: none/);
  assert.match(css, /min-height: 44px/);
});

test("SkyEye Edge adapter has a read-only and sanitized provider boundary", () => {
  const edge = read("supabase/functions/zhuge-skyeye-read/index.ts");
  const normalizers = read("supabase/functions/zhuge-skyeye-read/normalizers.mjs");
  assert.match(edge, /Deno\.serve/);
  assert.match(edge, /read_only: true/);
  assert.match(edge, /product_data_mutation: false/);
  assert.match(edge, /stream_subscriptions: 0/);
  assert.match(edge, /trading_operations: 0/);
  assert.match(edge, /TDX_CLIENT_ID/);
  assert.match(edge, /CWA_API_KEY/);
  assert.match(edge, /MOENV_API_KEY/);
  assert.match(edge, /includeCctv && layers\.includes\("cctv"\)/);
  assert.match(edge, /PROVIDER_TIMEOUT/);
  assert.match(edge, /PROVIDER_MALFORMED_RESPONSE/);
  assert.match(edge, /PROVIDER_NETWORK_ERROR/);
  assert.match(edge, /INSUFFICIENT_EVIDENCE/);
  assert.match(edge, /data_quality/);
  assert.match(normalizers, /freshnessFor/);
  assert.match(normalizers, /malformed/);
  assert.doesNotMatch(edge, /console\.(log|error|warn)\(/);
  assert.doesNotMatch(edge, /service_role/i);
  assert.doesNotMatch(edge, /supabase\.from|\.insert\(|\.update\(|\.delete\(/i);
});
