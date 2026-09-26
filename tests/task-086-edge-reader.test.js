const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../supabase/functions/task-attachment-ai-read/index.ts"), "utf8");

test("TASK-086 Edge Reader is a read-only authenticated structured boundary", () => {
  assert.match(source, /Deno\.serve/);
  assert.match(source, /requireAuthenticated/);
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /zhuge-task-attachment-ai-read-v1/);
  assert.match(source, /zhuge-attachment-ai-input-v1/);
  assert.match(source, /store: false/);
  assert.match(source, /mutation: \"none\"/);
  assert.match(source, /RESULT_SCHEMA/);
  assert.doesNotMatch(source, /service_role/i);
  assert.doesNotMatch(source, /storage_path|signed_url|signedUrl/);
  assert.doesNotMatch(source, /insert into|update public\.|delete from/i);
});

test("TASK-086 Edge Reader explicitly rejects malformed, unsupported and over-limit parts", () => {
  assert.match(source, /INVALID_CONTRACT/);
  assert.match(source, /PART_UNSUPPORTED/);
  assert.match(source, /IMAGE_FORMAT_UNSUPPORTED/);
  assert.match(source, /IMAGE_TOO_LARGE/);
  assert.match(source, /AI_PROVIDER_TIMEOUT/);
  assert.match(source, /INVALID_AI_RESULT/);
});
