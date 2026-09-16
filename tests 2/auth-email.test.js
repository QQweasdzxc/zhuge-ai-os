const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Shared Auth exposes Supabase Email/Password lifecycle without a custom password store", () => {
  const source = read("shared/auth/auth-service.js");
  assert.match(source, /auth\/v1\/signup\?redirect_to=/);
  assert.match(source, /auth\/v1\/token\?grant_type=password/);
  assert.match(source, /auth\/v1\/recover/);
  assert.match(source, /auth\/v1\/user/);
  assert.match(source, /provider\s*=\s*"email-password"|provider\s*:\s*"email-password"/);
  assert.match(source, /exchangeLinkedIdentityForSession/);
  assert.match(source, /linkIdentity/);
  assert.doesNotMatch(source, /passwords?\s*(table|schema)|custom_password/i);
});

test("WorkLog presents Google and Email authentication in one shared login surface", () => {
  const source = read("modules/worklog/worklog-app.js");
  assert.match(source, /使用 Google 帳號登入/);
  assert.match(source, /Email 登入/);
  assert.match(source, /建立帳號/);
  assert.match(source, /忘記密碼/);
  assert.match(source, /supabaseSessionFromUser/);
});
