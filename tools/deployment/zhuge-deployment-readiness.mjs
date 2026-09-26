#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const manifestPath = path.join(root, "tools/deployment/zhuge-deployment-readiness.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const applyRequested = process.argv.includes("--apply");

if (applyRequested) {
  console.error("DEPLOYMENT_AUTHORIZATION_REQUIRED: this package is a preflight/readiness gate and never applies Production changes.");
  process.exit(2);
}

const requiredFiles = [
  "supabase/functions/zhuge-skyeye-read/index.ts",
  "supabase/functions/task-attachment-ai-read/index.ts",
  "supabase/functions/zhuge-line-task-runtime/index.ts",
  "shared/line/line-task-adapter.js",
  "shared/line/line-webhook-handler.js",
  "shared/line/line-messaging-adapter.js",
  "shared/line/line-reminder-contract.js",
  "shared/line/line-runtime-contract.js",
  "tools/runtime/provider-readiness.mjs",
  "tools/runtime/authenticated-runtime-qa.mjs",
  ".github/workflows/authenticated-runtime-qa.yml",
  "docs/supabase/20260926_task_094_line_runtime.sql",
  "docs/supabase/20260926_task_101_workflow_restore_version.sql",
  "docs/supabase/ROLLBACK_20260926_task_101_workflow_restore_version.sql",
  "docs/supabase/20260926_security_hardening_candidate.sql",
  "docs/supabase/ROLLBACK_20260926_security_hardening_candidate.sql"
];
const missing = requiredFiles.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(JSON.stringify({ status: "FAIL", code: "READINESS_ARTIFACT_MISSING", missing }, null, 2));
  process.exit(1);
}

const secretNames = [...new Set(Object.values(manifest.artifacts).flatMap(item => item.required_secret_names || []))].sort();
const result = {
  status: "PASS",
  contract: manifest.contract,
  mode: manifest.mode,
  automatic_mutation: false,
  production_apply: "human_gate",
  deploy_order: manifest.deploy_order,
  artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([key, item]) => [key, {
    kind: item.kind,
    function: item.function || null,
    source: item.source,
    rollback: item.rollback,
    smoke_contract: item.smoke_contract,
    status: item.status || "source_ready",
    required_secret_names: item.required_secret_names || []
  }])),
  secret_names: secretNames,
  missing: []
};
console.log(JSON.stringify(result, null, 2));
