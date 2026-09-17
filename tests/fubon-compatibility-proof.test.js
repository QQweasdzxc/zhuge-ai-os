const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const source = read("supabase/functions/fubon-compatibility-proof/index.ts");
const readme = read("supabase/functions/fubon-compatibility-proof/README.md");

test("Fubon compatibility proof pins the SDK and keeps credentials server-side", () => {
  assert.match(source, /npm:fubon-neo@2\.3\.0/);
  for (const secret of [
    "FUBON_API_PERSONAL_ID",
    "FUBON_API_KEY",
    "FUBON_CERT_PASSWORD",
    "FUBON_CERT_FILE_BASE64"
  ]) {
    assert.match(source, new RegExp(secret));
  }
  assert.match(source, /Deno\.env\.get/);
  assert.match(source, /values_returned: false/);
  assert.match(source, /credentials_returned: false/);
  assert.match(readme, /server-side Secret Manager/);
  assert.match(readme, /Never put[\s\S]*?their values in Chat, Browser code, Source, Git, ZIP/);
});

test("proof uses the existing authenticated Creator/App Access authority", () => {
  assert.match(source, /client\.auth\.getUser\(\)/);
  assert.match(source, /client\.rpc\("resolve_creator_capability", \{\}\)/);
  assert.match(source, /client\.rpc\("is_app_access_approved", \{\}\)/);
  assert.match(source, /CREATOR_CAPABILITY_REQUIRED/);
  assert.match(source, /APP_ACCESS_APPROVAL_REQUIRED/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("proof covers only SDK load, login, inventory and REST latest quote", () => {
  assert.match(source, /await import\(SDK_SPECIFIER\)/);
  assert.match(source, /sdk\.apikeyLogin\(/);
  assert.match(source, /sdk\.accounting\.inventories\(/);
  assert.match(source, /sdk\.initRealtime\(\)/);
  assert.match(source, /marketdata\?\.restClient\?\.stock\?\.intraday\?\.quote/);
  assert.match(source, /transport: "REST"/);
  assert.match(source, /stream_subscriptions: 0/);
  assert.doesNotMatch(source, /placeOrder|modifyPrice|cancelOrder|batchCancelOrder/);
  assert.doesNotMatch(source, /\.connect\(\)|\.subscribe\(/);
  assert.doesNotMatch(source, /create_broker_position_snapshot|investment_record_transaction|opening_positions/);
});

test("certificate is ephemeral and request cannot inject secrets or provider options", () => {
  assert.match(source, /Deno\.writeFile\(path, bytes, \{ createNew: true \}\)/);
  assert.match(source, /Deno\.remove\(path\)/);
  assert.match(source, /REQUEST_BODY_NOT_ALLOWED/);
  assert.match(source, /certificatePath/);
  assert.match(source, /FUBON_CERT_FILE_BASE64/);
  assert.match(readme, /request body must be empty/);
  assert.match(readme, /invocation-local `\/tmp`/);
});

test("function is POST-only, origin constrained and returns sanitized failures", () => {
  assert.match(source, /request\.method !== "POST"/);
  assert.match(source, /ALLOWED_ORIGIN = "https:\/\/qqweasdzxc\.github\.io"/);
  assert.match(source, /error_code: error\.code/);
  assert.match(source, /PROOF_FAILED/);
  assert.doesNotMatch(source, /JSON\.stringify\(error\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(payload\)/);
});
