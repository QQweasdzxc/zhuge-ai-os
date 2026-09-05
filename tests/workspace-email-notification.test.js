import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const functionSource = fs.readFileSync(
  path.join(root, "supabase/functions/workspace-email-notification/index.ts"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(root, "docs/supabase/20260904_c_workspace_email_notifications.sql"),
  "utf8"
);

test("workspace notification is gated by a real workspace-entry audit", () => {
  assert.match(functionSource, /engineering_activity_log/);
  assert.match(functionSource, /movementActions/);
  assert.match(functionSource, /not_workspace_entry/);
  assert.match(functionSource, /beforeWorkspaceId !== workspaceId/);
});

test("workspace notification persists an idempotent attempt before sending", () => {
  assert.match(functionSource, /idempotencyKey = `workspace-email-v1:\$\{movementId\}`/);
  assert.match(functionSource, /action: "workspace_email_notification"/);
  assert.match(functionSource, /reason: "already_processed"/);
  assert.match(functionSource, /finalizeAudit/);
  assert.match(migrationSource, /create unique index if not exists engineering_activity_log_workspace_email_idempotency_idx/i);
  assert.match(migrationSource, /after_data->>'idempotency_key'/i);
});

test("provider secrets remain server-side", () => {
  assert.match(functionSource, /Deno\.env\.get\("RESEND_API_KEY"\)/);
  assert.match(functionSource, /Deno\.env\.get\("WORKSPACE_NOTIFICATION_FROM_EMAIL"\)/);
  assert.doesNotMatch(functionSource, /localStorage|sessionStorage|indexedDB/i);
});
