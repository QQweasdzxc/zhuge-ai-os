#!/usr/bin/env node
/**
 * Local-only PM/QJC Governance Approval Runner.
 *
 * This is an operational bridge for the existing Governance architecture. It
 * binds one immutable action manifest to one approval attempt, performs Google
 * OAuth/PKCE on 127.0.0.1, keeps the authenticated Supabase session in memory,
 * issues the existing PM authorization RPC, obtains the existing GPT actor
 * capability from the protected broker, invokes the existing Governance Write
 * path, and performs a read-back. It never exposes either capability to the
 * browser and never provides SQL, DML, service-role, or arbitrary operations.
 */
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const Broker = require("./engineering-actor-broker.js");
const GovernanceTool = require("./engineering-governance-write.js");
const Environment = require("./governance-environment.js");

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const SESSION_TTL_MS = 30 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_ATTEMPT_COOKIE = "pm_governance_oauth_attempt";
const MAX_ACTION_BYTES = 96 * 1024;
const PRODUCT_TASK_UPDATE_PATH = "/api/request-task-update";
const PRODUCT_TASK_UPDATE_STATUS_PATH = "/api/task-update-status";
const PRODUCT_TASK_UPDATE_FIELDS = new Set(["task_id", "summary", "usage_scenario"]);
const ALLOWED_OPERATIONS = new Set([
  "create_task_contract",
  "update_task_contract",
  "update_checkpoint",
  "register_artifact",
  "create_engineering_principle",
  "set_pm_accepted_baseline"
]);
const OPERATION_LABELS = Object.freeze({
  create_task_contract: "建立 Canonical TASK Contract",
  update_task_contract: "更新 Canonical TASK Contract",
  update_checkpoint: "更新 Current Checkpoint",
  register_artifact: "登記 Candidate Artifact",
  create_engineering_principle: "建立 Engineering Principle",
  set_pm_accepted_baseline: "登記 PM Accepted Baseline"
});
const PAYLOAD_FIELDS = Object.freeze({
  create_task_contract: new Set(["title", "summary", "usage_scenario", "priority", "acceptance_criteria"]),
  update_task_contract: new Set([
    "task_id", "title", "summary", "usage_scenario", "priority", "domain", "category",
    "problem", "objective", "proposed_solution", "related_work", "acceptance_criteria",
    "developer_notes", "pm_notes"
  ]),
  update_checkpoint: new Set([
    "checkpoint_key", "current_task", "current_stage", "completed", "pending", "files_changed",
    "cloud_changes", "qa_status", "blocking", "next_action", "branch", "git_commit",
    "working_tree_state"
  ]),
  register_artifact: new Set([
    "artifact_id", "filename", "product_version", "runtime_build", "artifact_timestamp", "git_commit",
    "sha256", "artifact_type", "qa_status", "pm_acceptance_status", "storage_location", "related_task",
    "lineage"
  ]),
  create_engineering_principle: new Set([
    "knowledge_code", "title", "summary", "content", "module", "version", "source_path", "source_reference"
  ]),
  set_pm_accepted_baseline: new Set([
    "product_version", "runtime_build", "git_commit", "artifact_reference", "pm_accepted_at",
    "pm_acceptance_status", "notes"
  ])
});

class RunnerError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function createCodeChallenge(verifier) {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--open") { args.open = true; continue; }
    if (value === "--wait-for-product") { args.waitForProduct = true; continue; }
    if (value === "--help" || value === "-h") { args.help = true; continue; }
    if (!value.startsWith("--")) throw new RunnerError("INVALID_ARGUMENT", `Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) throw new RunnerError("INVALID_ARGUMENT", `Missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
}

function stringValue(value, field, max = 20000) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new RunnerError("INVALID_ACTION", `${field} must be a string.`);
  if (value.length > max) throw new RunnerError("INVALID_ACTION", `${field} is too long.`);
  return value;
}

function arrayOfStrings(value, field, maxItems = 20) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new RunnerError("INVALID_ACTION", `${field} must be a short list.`);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`, 1000)).filter(Boolean);
}

function assertNoSecretFields(value, pathName = "action") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(token|jwk|secret|service.?role|password|private.?key)/i.test(key)) {
      throw new RunnerError("INVALID_ACTION", `${pathName}.${key} is not an allowed action field.`);
    }
    assertNoSecretFields(child, `${pathName}.${key}`);
  }
}

function validatePayload(operation, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RunnerError("INVALID_ACTION", "Governance action payload must be an object.");
  }
  const fields = PAYLOAD_FIELDS[operation];
  for (const key of Object.keys(payload)) {
    if (!fields.has(key)) throw new RunnerError("INVALID_ACTION", `Field ${key} is not allowlisted for ${operation}.`);
  }
  if (operation === "create_task_contract" && !String(payload.title || "").trim()) {
    throw new RunnerError("INVALID_ACTION", "A TASK Contract title is required.");
  }
  if (operation === "update_task_contract" && !String(payload.task_id || "").trim()) {
    throw new RunnerError("INVALID_ACTION", "A TASK Contract id is required.");
  }
  if (operation === "update_checkpoint" && String(payload.checkpoint_key || "current") !== "current") {
    throw new RunnerError("INVALID_ACTION", "Only the current Engineering Checkpoint is allowlisted.");
  }
  if (operation === "register_artifact" && String(payload.artifact_type || "").toLowerCase() !== "candidate") {
    throw new RunnerError("INVALID_ACTION", "Only candidate Artifact Registration is allowlisted.");
  }
  if (operation === "create_engineering_principle") {
    if (!/^EP-[0-9]{3}$/.test(String(payload.knowledge_code || "").trim())) {
      throw new RunnerError("INVALID_ACTION", "Engineering Principle code must use the assigned EP-### namespace.");
    }
    for (const field of ["title", "summary", "content", "source_path", "source_reference"]) {
      if (!String(payload[field] || "").trim()) {
        throw new RunnerError("INVALID_ACTION", `${field} is required for an Engineering Principle.`);
      }
    }
    if (payload.version !== undefined && !/^\d+\.\d+$/.test(String(payload.version).trim())) {
      throw new RunnerError("INVALID_ACTION", "Engineering Principle version is invalid.");
    }
  }
  if (operation === "set_pm_accepted_baseline") {
    if (String(payload.pm_acceptance_status || "").toLowerCase() !== "accepted") {
      throw new RunnerError("INVALID_ACTION", "Only explicit PM accepted status can create the current baseline.");
    }
    for (const field of ["product_version", "runtime_build", "git_commit", "artifact_reference"]) {
      if (!String(payload[field] || "").trim()) {
        throw new RunnerError("INVALID_ACTION", `${field} is required for a PM Accepted Baseline.`);
      }
    }
    if (payload.pm_accepted_at !== undefined && Number.isNaN(Date.parse(String(payload.pm_accepted_at)))) {
      throw new RunnerError("INVALID_ACTION", "pm_accepted_at must be a valid timestamp.");
    }
  }
  return Object.freeze({ ...payload });
}

function normalizeActionManifest(value) {
  assertNoSecretFields(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerError("INVALID_ACTION", "Action manifest must be an object.");
  }
  const operation = String(value.operation || "").trim().toLowerCase();
  if (!ALLOWED_OPERATIONS.has(operation)) throw new RunnerError("INVALID_ACTION", "Governance operation is not allowlisted.");
  const payload = validatePayload(operation, value.payload);
  const display = value.display && typeof value.display === "object" && !Array.isArray(value.display) ? value.display : {};
  const title = stringValue(display.title || payload.title || OPERATION_LABELS[operation], "display.title", 240).trim();
  const purpose = stringValue(display.purpose || "PM review required before this controlled Governance change.", "display.purpose", 2000).trim();
  const impact = arrayOfStrings(display.impact, "display.impact");
  const scope = arrayOfStrings(display.scope, "display.scope");
  const pmNote = stringValue(value.pm_note || display.pm_note || purpose, "pm_note", 1000).trim();
  return Object.freeze({
    operation,
    payload,
    display: Object.freeze({ title, purpose, impact, scope }),
    pmNote
  });
}

function normalizeProductTaskUpdateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerError("INVALID_ACTION", "Task Contract update request must be an object.");
  }
  const source = value;
  assertNoSecretFields(source);
  const taskId = stringValue(source.task_id, "payload.task_id", 120).trim();
  if (!taskId) throw new RunnerError("INVALID_ACTION", "A TASK identity is required.");
  const payload = { task_id: taskId };
  const changedFields = [];
  for (const field of ["summary", "usage_scenario"]) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    payload[field] = stringValue(source[field], `payload.${field}`, 20000);
    changedFields.push(field);
  }
  for (const key of Object.keys(source)) {
    if (!PRODUCT_TASK_UPDATE_FIELDS.has(key)) throw new RunnerError("INVALID_ACTION", `Field ${key} is not allowlisted for the AI Board inline edit path.`);
  }
  if (!changedFields.length) throw new RunnerError("INVALID_ACTION", "At least one editable TASK field is required.");
  const labels = Object.freeze({ summary: "工作內容", usage_scenario: "使用情境" });
  const displayFields = changedFields.map(field => labels[field]);
  return normalizeActionManifest({
    operation: "update_task_contract",
    payload,
    display: {
      title: `更新 ${taskId} 的${displayFields.join("／")}`,
      purpose: "PM 核准後，透過既有受控 update_task_contract path 保存 AI Board TASK 內容；不修改狀態、工作區、負責人或其他治理欄位。",
      scope: [
        `只更新：${displayFields.join("、")}`,
        "沿用既有 PM Authorization、GPT governance-write actor 與 engineering-transition",
        "完成後由正式 board_tasks read-back 驗證"
      ],
      impact: [
        "TASK identity、工程狀態、工作區、負責人與治理紀錄維持不變",
        "不使用 Browser Direct DML、localStorage 或 Shadow Field",
        "PM 可拒絕；未核准不會寫入 Cloud"
      ]
    },
    pm_note: `AI Board inline edit：${displayFields.join("、")}`
  });
}

function readActionManifest(filePath) {
  const absolute = path.resolve(String(filePath || ""));
  if (!absolute || !fs.existsSync(absolute)) throw new RunnerError("INVALID_ACTION", "Action manifest file was not found.");
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > MAX_ACTION_BYTES) throw new RunnerError("INVALID_ACTION", "Action manifest file is invalid or too large.");
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(absolute, "utf8")); }
  catch { throw new RunnerError("INVALID_ACTION", "Action manifest is not valid JSON."); }
  return normalizeActionManifest(parsed);
}

function parseCookies(request) {
  const value = request.headers.cookie || "";
  return Object.fromEntries(value.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function appendSetCookie(response, value) {
  const existing = response.getHeader("Set-Cookie");
  if (!existing) {
    response.setHeader("Set-Cookie", value);
    return;
  }
  response.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, value] : [existing, value]);
}

function setEphemeralCookie(name, value, maxAgeSeconds) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearEphemeralCookie(name) {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function htmlEscape(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function safeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function setCommonHeaders(response, contentType) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function respondJson(response, body, status = 200) {
  setCommonHeaders(response, "application/json; charset=utf-8");
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function respondHtml(response, body, status = 200) {
  setCommonHeaders(response, "text/html; charset=utf-8");
  response.statusCode = status;
  response.end(body);
}

function redirect(response, location) {
  setCommonHeaders(response, "text/plain; charset=utf-8");
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 4096) reject(new RunnerError("INVALID_REQUEST", "Request body is too large."));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function publicError(error) {
  if (error instanceof RunnerError) return { code: error.code, message: error.publicMessage };
  return { code: error?.code || "OPERATIONAL_PATH_FAILED", message: "Governance approval could not be completed. No credential was exposed." };
}

async function parseResponseBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const body = await parseResponseBody(response);
  if (!response.ok) {
    const code = body?.code || body?.error_code || "SUPABASE_REQUEST_FAILED";
    const error = new RunnerError(code, "Supabase authenticated operation failed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function authHeaders(anonKey, accessToken = "") {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken || anonKey}`,
    "Content-Type": "application/json"
  };
}

function actionView(action) {
  return Object.freeze({
    operation: action.operation,
    operationLabel: OPERATION_LABELS[action.operation],
    title: action.display.title,
    purpose: action.display.purpose,
    impact: action.display.impact,
    scope: action.display.scope
  });
}

function renderApprovalPage(view, runtime = {}) {
  const state = {
    action: view || runtime.action || null,
    phase: runtime.phase || (view ? "pending" : "waiting"),
    authenticated: Boolean(runtime.authenticated),
    ownerVerified: Boolean(runtime.ownerVerified),
    user: runtime.user || null,
    csrf: runtime.csrf || "",
    error: runtime.error || null,
    result: runtime.result || null
  };
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PM Governance Approval</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Noto Sans TC",sans-serif;background:#0f141c;color:#eef3f9}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#203655 0,#0f141c 46%);padding:24px;box-sizing:border-box}
main{width:min(760px,100%);border:1px solid #314055;border-radius:18px;background:#151d28;box-shadow:0 20px 70px #0008;overflow:hidden}
header{padding:24px 26px;border-bottom:1px solid #293548;background:#192536}h1{font-size:21px;margin:0 0 8px}header p{margin:0;color:#aebdd0;line-height:1.55;font-size:13px}
section{padding:22px 26px}.kicker{font-size:11px;color:#8db7ef;letter-spacing:.08em;text-transform:uppercase}.summary{display:grid;gap:14px;margin-top:14px}.row{display:grid;gap:5px}.label{font-size:11px;color:#8192a8}.value{font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:7px}.chip{border:1px solid #3b506d;border-radius:999px;padding:5px 9px;color:#bdd4f2;font-size:11px;background:#17283e}
.status{margin-top:18px;border:1px solid #3a4b62;border-radius:10px;padding:11px 12px;color:#c9d6e5;line-height:1.5;font-size:12px}.status.ok{border-color:#2e6d52;background:#12281f;color:#9be5be}.status.error{border-color:#70404a;background:#2a1b23;color:#ffb0b3}.status.warn{border-color:#6a5934;background:#2a2518;color:#f0d17a}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.button{border:1px solid #4a6385;border-radius:9px;padding:10px 14px;background:#1a2d47;color:#eaf3ff;cursor:pointer;font:inherit}.button.primary{background:#2868a8;border-color:#5f9ddb}.button.danger{background:#332126;border-color:#74404d}.button:disabled{opacity:.45;cursor:not-allowed}.identity{font-size:12px;color:#9eb0c5;margin-top:12px}.small{font-size:11px;color:#8192a8;line-height:1.5;margin-top:12px}
</style></head><body><main>
<header><div class="kicker">Zhuge AI OS · Controlled Governance</div><h1>PM／QJC Governance Approval</h1><p>此頁只提供既有 Governance Action 的 review／approve／reject；執行所需的授權能力由受控本機流程保存，不會顯示於 Browser。</p></header>
<section><div class="kicker">Governance Action</div><div class="summary">
<div class="row"><div class="label">變更類型</div><div class="value" id="operationLabel"></div></div>
<div class="row"><div class="label">變更標題</div><div class="value" id="title"></div></div>
<div class="row"><div class="label">目的</div><div class="value" id="purpose"></div></div>
<div class="row" id="scopeRow"><div class="label">Scope</div><div class="chips" id="scope"></div></div>
<div class="row" id="impactRow"><div class="label">影響</div><div class="chips" id="impact"></div></div>
</div><div class="status" id="status" aria-live="polite"></div><div class="identity" id="identity"></div>
<div class="actions"><button class="button primary" id="login" type="button">使用 Google 登入</button><button class="button primary" id="approve" type="button" disabled>核准 Governance 變更</button><button class="button danger" id="reject" type="button">拒絕／取消</button></div>
<div class="small">PM 不需輸入 JSON、SQL 或任何憑證。拒絕、取消、第二次核准都不會執行 Governance Write。</div>
</section></main>
<script>window.__PM_GOVERNANCE_APPROVAL__=${safeScriptJson(state)};</script>
<script>
(() => {
  const initial = window.__PM_GOVERNANCE_APPROVAL__ || {};
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const setChips = (id, values, rowId) => { const list = Array.isArray(values) ? values : []; $(id).innerHTML = list.map(item => '<span class="chip">' + esc(item) + '</span>').join(""); $(rowId).hidden = !list.length; };
  function renderAction(action) {
    $("operationLabel").textContent = action?.operationLabel || "等待受控工作內容更新請求";
    $("title").textContent = action?.title || "—";
    $("purpose").textContent = action?.purpose || "—";
    setChips("scope", action?.scope, "scopeRow");
    setChips("impact", action?.impact, "impactRow");
  }
  renderAction(initial.action);
  function stateMessage(data) {
    const phase = data.phase || "pending";
    if (phase === "waiting" || !data.action) return ["warn", "等待 AI Board 提交一筆工作內容／使用情境更新請求；PM 核准前不會寫入 Cloud。"];
    if (phase === "success") {
      const readBack = data.result?.readBack;
      const identity = readBack?.workCode || readBack?.filename || readBack?.identity || "canonical record";
      return ["ok", "Governance Write 已完成，Canonical read-back 已回傳：" + identity];
    }
    if (phase === "rejected") return ["warn", "PM 已拒絕／取消；本次沒有 Governance Write。"];
    if (phase === "running") return ["warn", "正在執行受控 Authorization 與 Governance Write，請勿重複操作。"];
    if (phase === "failed") return ["error", data.error?.message || "Governance approval failed；未暴露任何 credential。"];
    if (!data.authenticated) return ["warn", "請先完成 Google Login；未登入不可核准。"];
    if (!data.ownerVerified) return ["error", "目前登入身分未通過 Engineering owner 驗證；不可執行 Governance 變更。"];
    return ["", "已登入。按下核准後，Server 會重新驗證 Engineering owner 並執行既有受控流程。"];
  }
  function render(data) {
    renderAction(data.action);
    const [kind, message] = stateMessage(data); const box = $("status"); box.className = "status " + kind; box.textContent = message;
    $("identity").textContent = data.user?.email ? "目前登入：" + data.user.email : "";
    $("login").hidden = Boolean(data.authenticated) || ["running","success","rejected"].includes(data.phase);
    $("approve").hidden = !data.ownerVerified || !data.action;
    $("approve").disabled = !data.authenticated || !data.ownerVerified || data.phase !== "pending" || !data.csrf || !data.action;
    $("reject").hidden = !data.ownerVerified || !data.action;
    $("reject").disabled = !data.action || ["running","success","rejected"].includes(data.phase);
  }
  async function refresh() { try { const response = await fetch("/api/state", { cache: "no-store" }); const data = await response.json(); render(data); window.__PM_GOVERNANCE_APPROVAL__ = data; } catch { $("status").textContent = "Runner 連線失敗；請確認 localhost process 仍在執行。"; } }
  $("login").onclick = () => { location.href = "/auth/start"; };
  $("approve").onclick = async () => { $("approve").disabled = true; try { const response = await fetch("/api/approve", { method: "POST", headers: { "X-PM-Approval-Nonce": window.__PM_GOVERNANCE_APPROVAL__?.csrf || "" } }); const data = await response.json(); render(data); window.__PM_GOVERNANCE_APPROVAL__ = data; } catch { await refresh(); } };
  $("reject").onclick = async () => { try { const response = await fetch("/api/reject", { method: "POST", headers: { "X-PM-Approval-Nonce": window.__PM_GOVERNANCE_APPROVAL__?.csrf || "" } }); const data = await response.json(); render(data); window.__PM_GOVERNANCE_APPROVAL__ = data; } catch { await refresh(); } };
  render(initial); refresh(); window.setInterval(refresh, 1000);
})();
</script></body></html>`;
}

function assertSameOrigin(request, port) {
  const origin = request.headers.origin;
  if (origin !== `http://${HOST}:${port}`) throw new RunnerError("CSRF_DENIED", "Request origin is not allowed.");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extractExecutionResult(execution) {
  const outer = execution?.result && typeof execution.result === "object" ? execution.result : execution;
  const governance = outer?.result && typeof outer.result === "object" ? outer.result : outer;
  const record = governance?.result && typeof governance.result === "object" ? governance.result : governance;
  if (Array.isArray(record)) return record[0] || null;
  return record && typeof record === "object" ? record : null;
}

function readBackTarget(action, execution) {
  const record = extractExecutionResult(execution) || {};
  if (action.operation === "create_engineering_principle") {
    const knowledgeCode = String(record.knowledge_code || action.payload.knowledge_code || "").trim();
    return knowledgeCode ? { rpc: "resolve_engineering_startup_gate", knowledgeCodes: [knowledgeCode], identity: knowledgeCode } : null;
  }
  if (action.operation === "update_checkpoint") return { table: "engineering_project_checkpoints", filter: "checkpoint_key=eq.current", identity: "current" };
  if (action.operation === "register_artifact") {
    const artifactId = String(record.artifact_id || action.payload.artifact_id || "");
    return artifactId ? { table: "engineering_artifacts", filter: `artifact_id=eq.${encodeURIComponent(artifactId)}`, identity: artifactId } : null;
  }
  const taskId = String(record.id || action.payload.task_id || "");
  return taskId ? { table: "board_tasks", filter: `id=eq.${encodeURIComponent(taskId)}`, identity: taskId } : null;
}

function summarizeReadBack(action, rows) {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) throw new RunnerError("READ_BACK_FAILED", "Governance Write returned no canonical read-back record.");
  if (action.operation === "create_engineering_principle") {
    const principle = row.knowledge_code ? row : null;
    if (!principle || String(principle.knowledge_code) !== String(action.payload.knowledge_code)) {
      throw new RunnerError("READ_BACK_FAILED", "Engineering Principle read-back does not match the approved code.");
    }
    for (const field of ["title", "summary", "content", "source_path", "source_reference"]) {
      if (String(principle[field] || "") !== String(action.payload[field] || "")) {
        throw new RunnerError("READ_BACK_FAILED", `Engineering Principle read-back does not match ${field}.`);
      }
    }
    return {
      table: "public.engineering_knowledge",
      identity: principle.knowledge_code,
      knowledgeCode: principle.knowledge_code,
      status: principle.status || null,
      version: principle.version || null,
      title: principle.title || null
    };
  }
  if (action.operation === "update_checkpoint") {
    return { table: "engineering_project_checkpoints", identity: "current", currentTask: row.current_task || null, currentStage: row.current_stage || null, updatedAt: row.updated_at || null };
  }
  if (action.operation === "register_artifact") {
    return { table: "engineering_artifacts", identity: row.artifact_id || null, filename: row.filename || null, productVersion: row.product_version || null, runtimeBuild: row.runtime_build || null, artifactType: row.artifact_type || null, pmAcceptanceStatus: row.pm_acceptance_status || null };
  }
  return { table: "board_tasks", identity: row.id || null, workCode: row.work_code || null, title: row.title || null, status: row.status || null };
}

function objectValue(value) {
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object") return value[0];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function summarizeBaselineReadBack(action, startupGate) {
  const gate = objectValue(startupGate);
  const baseline = objectValue(gate?.pm_accepted_baseline || gate?.pmAcceptedBaseline);
  if (!baseline) throw new RunnerError("READ_BACK_FAILED", "Startup Gate returned no PM Accepted Baseline record.");
  const expected = action.payload;
  const fields = ["product_version", "runtime_build", "git_commit", "artifact_reference", "pm_acceptance_status"];
  for (const field of fields) {
    if (String(baseline[field] || "").trim() !== String(expected[field] || "").trim()) {
      throw new RunnerError("READ_BACK_FAILED", "PM Accepted Baseline read-back does not match the approved payload.");
    }
  }
  if (expected.pm_accepted_at && String(baseline.pm_accepted_at || "") !== String(expected.pm_accepted_at)) {
    throw new RunnerError("READ_BACK_FAILED", "PM Accepted Baseline timestamp read-back does not match the approved payload.");
  }
  if (expected.notes && String(baseline.notes || "") !== String(expected.notes)) {
    throw new RunnerError("READ_BACK_FAILED", "PM Accepted Baseline notes read-back does not match the approved payload.");
  }
  const principles = objectValue(gate?.principles);
  const failures = Array.isArray(principles?.failures) ? principles.failures : [];
  return {
    table: "engineering_pm_accepted_baselines",
    identity: "current",
    productVersion: baseline.product_version || null,
    runtimeBuild: baseline.runtime_build || null,
    gitCommit: baseline.git_commit || null,
    artifactReference: baseline.artifact_reference || null,
    pmAcceptedAt: baseline.pm_accepted_at || null,
    pmAcceptanceStatus: baseline.pm_acceptance_status || null,
    notes: baseline.notes || "",
    startupGateStatus: failures.length ? "FAIL" : "PASS",
    startupGatePrincipleFailures: failures.length
  };
}

function createRunner(options = {}) {
  const environment = options.environment || Environment.resolveExecutionEnvironment(options.env || process.env, options);
  const fetchImpl = options.fetchImpl || fetch;
  const issueActorToken = options.issueActorToken || Broker.issueActorToken;
  const writeGovernance = options.writeGovernance || GovernanceTool.writeGovernance;
  const readPrivateJwk = options.readPrivateJwk || (() => Environment.readProtectedPrivateJwk(options.env || process.env, options));
  const now = options.now || (() => Date.now());
  let action = options.action || null;
  const waitForProduct = options.waitForProduct === true;
  if (!action && !waitForProduct) throw new RunnerError("INVALID_ACTION", "A validated action manifest is required.");
  const productOrigins = new Set((options.productOrigins || environment.productOrigins || [Environment.readPublicAppOrigin()]).map(origin => {
    try { return new URL(String(origin)).origin; } catch { throw new RunnerError("INVALID_ARGUMENT", "Product origin is invalid."); }
  }));
  const sessions = new Map();
  const oauthAttempts = new Map();
  const approval = {
    phase: action ? "pending" : "waiting",
    csrf: randomToken(24),
    error: null,
    result: null,
    action,
    requestId: null
  };

  function baseUrl(port) { return `http://${HOST}:${port}`; }

  function assertProductOrigin(request, port) {
    const origin = request.headers.origin;
    if (origin === baseUrl(port)) return origin;
    if (!origin || !productOrigins.has(origin)) throw new RunnerError("CSRF_DENIED", "Product origin is not allowed.");
    return origin;
  }

  function setProductCors(response, origin) {
    if (!origin) return;
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  function queueProductTaskUpdate(requestValue) {
    if (!waitForProduct) throw new RunnerError("NOT_FOUND", "This runner is not in Product inline-edit mode.");
    if (approval.phase !== "waiting") throw new RunnerError("RUNNER_BUSY", "This approval runner already has an active or completed action; start a new runner for another edit.");
    action = normalizeProductTaskUpdateRequest(requestValue);
    approval.action = action;
    approval.requestId = randomToken(16);
    approval.phase = "pending";
    approval.csrf = randomToken(24);
    approval.error = null;
    approval.result = null;
    return approval.requestId;
  }

  function productTaskUpdateState(requestId) {
    if (!approval.requestId || String(requestId || "") !== approval.requestId) {
      throw new RunnerError("REQUEST_NOT_FOUND", "The inline-edit request is no longer available.");
    }
    return {
      requestId: approval.requestId,
      phase: approval.phase,
      readBack: approval.result?.readBack || null,
      error: approval.error
    };
  }

  function purgeEphemeral() {
    const cutoff = now() - OAUTH_STATE_TTL_MS;
    for (const [attemptId, value] of oauthAttempts) if (value.createdAt < cutoff) oauthAttempts.delete(attemptId);
    const sessionCutoff = now() - SESSION_TTL_MS;
    for (const [sid, value] of sessions) if (value.createdAt < sessionCutoff) sessions.delete(sid);
  }

  async function supabaseRequest(pathname, options = {}) {
    const url = `${environment.supabaseUrl}${pathname}`;
    return requestJson(fetchImpl, url, options);
  }

  async function fetchAuthUser(session) {
    const user = await supabaseRequest("/auth/v1/user", { headers: authHeaders(environment.supabaseAnonKey, session.accessToken) });
    if (!user?.id) throw new RunnerError("AUTHENTICATION_FAILED", "Authenticated Supabase user could not be verified.");
    return Object.freeze({ id: String(user.id), email: String(user.email || ""), name: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "") });
  }

  async function probeOwner(session) {
    // The existing issuance function checks the authenticated owner before any
    // insert. An intentionally invalid actor causes the owner branch to stop
    // before capability creation, while a non-owner stops at the owner check.
    // This is a fail-closed capability probe, not an issuance path.
    const response = await fetchImpl(`${environment.supabaseUrl}/rest/v1/rpc/issue_engineering_governance_authorization`, {
      method: "POST",
      headers: authHeaders(environment.supabaseAnonKey, session.accessToken),
      body: JSON.stringify({
        p_authorization: {
          operation: "create_task_contract",
          authorized_actor: "__owner_probe__",
          payload: {}
        }
      })
    });
    const body = await parseResponseBody(response);
    if (response.ok) {
      if (body && typeof body === "object" && body.authorization_token) delete body.authorization_token;
      throw new RunnerError("OWNER_PROBE_FAILED", "Owner verification returned an unexpected capability response.");
    }
    if (body?.code === "22023") return true;
    if (body?.code === "42501") return false;
    return false;
  }

  async function refreshSession(session) {
    if (!session?.refreshToken) return null;
    try {
      const data = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: authHeaders(environment.supabaseAnonKey),
        body: JSON.stringify({ refresh_token: session.refreshToken })
      });
      if (!data?.access_token || !data?.refresh_token) return null;
      session.accessToken = String(data.access_token);
      session.refreshToken = String(data.refresh_token);
      session.expiresAt = now() + Number(data.expires_in || 3600) * 1000;
      session.createdAt = now();
      return session;
    } catch {
      return null;
    }
  }

  async function getSession(request) {
    purgeEphemeral();
    const sid = parseCookies(request).pm_governance_sid;
    const session = sid ? sessions.get(sid) : null;
    if (!session) return null;
    if (session.expiresAt <= now() + 30000 && !(await refreshSession(session))) {
      sessions.delete(sid);
      return null;
    }
    try {
      session.user = await fetchAuthUser(session);
      if (session.ownerStatus === undefined) {
        session.ownerStatus = await probeOwner(session).then(allowed => allowed ? "allowed" : "denied").catch(() => "unknown");
      }
      return session;
    } catch {
      sessions.delete(sid);
      return null;
    }
  }

  async function startOAuth(port) {
    // Supabase Auth owns the OAuth state. The runner only owns a local,
    // HttpOnly transaction handle that binds this browser callback to the
    // in-memory PKCE verifier. Do not send a caller-generated `state` to
    // /authorize: Supabase must create and register its own flow state.
    const attemptId = randomToken(32);
    const verifier = createCodeVerifier();
    oauthAttempts.set(attemptId, { verifier, createdAt: now() });
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: `${baseUrl(port)}/auth/callback`,
      code_challenge: createCodeChallenge(verifier),
      code_challenge_method: "S256",
      scopes: "openid email profile",
      access_type: "offline",
      prompt: "select_account"
    });
    return {
      attemptId,
      url: `${environment.supabaseUrl}/auth/v1/authorize?${params.toString()}`
    };
  }

  async function completeOAuth(request, response, port, query) {
    const attemptId = parseCookies(request)[OAUTH_ATTEMPT_COOKIE] || "";
    const pending = oauthAttempts.get(attemptId);
    oauthAttempts.delete(attemptId);
    if (!pending || pending.createdAt + OAUTH_STATE_TTL_MS < now()) throw new RunnerError("AUTHENTICATION_FAILED", "Google Login state expired; please start again.");
    // Supabase validates its provider state at /auth/v1/callback before it
    // redirects here. The hosted callback may return only `code`; the local
    // HttpOnly attempt handle and PKCE verifier bind this code exchange to the
    // runner without inventing or accepting a second OAuth state.
    if (query.get("error")) throw new RunnerError("AUTHENTICATION_FAILED", "Google Login was cancelled or denied.");
    const code = String(query.get("code") || "");
    if (!code) throw new RunnerError("AUTHENTICATION_FAILED", "Google Login did not return an authorization code.");
    const data = await supabaseRequest("/auth/v1/token?grant_type=pkce", {
      method: "POST",
      headers: authHeaders(environment.supabaseAnonKey),
      body: JSON.stringify({ auth_code: code, code_verifier: pending.verifier })
    });
    if (!data?.access_token || !data?.refresh_token) throw new RunnerError("AUTHENTICATION_FAILED", "Supabase did not return a valid authenticated session.");
    const session = {
      accessToken: String(data.access_token),
      refreshToken: String(data.refresh_token),
      expiresAt: now() + Number(data.expires_in || 3600) * 1000,
      createdAt: now(),
      user: null
    };
    session.user = await fetchAuthUser(session);
    const sid = randomToken(32);
    sessions.set(sid, session);
    appendSetCookie(response, `pm_governance_sid=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    redirect(response, "/");
  }

  async function issueAndExecute(session) {
    if (action.operation === "set_pm_accepted_baseline") {
      const saved = await supabaseRequest("/rest/v1/rpc/set_engineering_pm_accepted_baseline", {
        method: "POST",
        headers: authHeaders(environment.supabaseAnonKey, session.accessToken),
        body: JSON.stringify({ p_baseline: action.payload })
      });
      const startupGate = await supabaseRequest("/rest/v1/rpc/resolve_engineering_startup_gate", {
        method: "POST",
        headers: authHeaders(environment.supabaseAnonKey, session.accessToken),
        body: JSON.stringify({ p_knowledge_codes: null })
      });
      const readBack = summarizeBaselineReadBack(action, startupGate);
      return {
        operation: action.operation,
        readBack,
        writeReceipt: objectValue(saved) ? { identity: "current", table: "engineering_pm_accepted_baselines" } : null
      };
    }
    let pmAuthorizationToken = "";
    let actorToken = "";
    let writeConfig = null;
    try {
      const issued = await supabaseRequest("/rest/v1/rpc/issue_engineering_governance_authorization", {
        method: "POST",
        headers: authHeaders(environment.supabaseAnonKey, session.accessToken),
        body: JSON.stringify({
          p_authorization: {
            operation: action.operation,
            authorized_actor: "GPT",
            payload: action.payload,
            pm_note: action.pmNote
          }
        })
      });
      pmAuthorizationToken = String(issued?.authorization_token || "");
      const authorizationId = String(issued?.authorization_id || "");
      if (!pmAuthorizationToken || !authorizationId) throw new RunnerError("AUTHORIZATION_FAILED", "PM Authorization issuance did not return a valid capability.");
      if (issued && typeof issued === "object") delete issued.authorization_token;

      const privateJwk = readPrivateJwk();
      actorToken = issueActorToken("GPT", { profile: "governance-write", privateJwk });
      if (!actorToken) throw new RunnerError("ACTOR_AUTHORIZATION_FAILED", "GPT governance-write actor authorization is unavailable.");
      writeConfig = {
        url: environment.supabaseUrl,
        actorToken,
        pmAuthorizationToken,
        functionUrl: environment.governanceWriteUrl
      };
      const execution = await writeGovernance(writeConfig, action.operation, action.payload);
      if (action.operation === "create_engineering_principle") {
        const startupGate = await supabaseRequest("/rest/v1/rpc/resolve_engineering_startup_gate", {
          method: "POST",
          headers: authHeaders(environment.supabaseAnonKey, session.accessToken),
          body: JSON.stringify({ p_knowledge_codes: [action.payload.knowledge_code] })
        });
        const principles = objectValue(startupGate?.principles);
        const records = Array.isArray(principles?.records) ? principles.records : [];
        const readBack = summarizeReadBack(action, records);
        return { authorizationId, operation: action.operation, readBack };
      }
      const target = readBackTarget(action, execution);
      if (!target) throw new RunnerError("READ_BACK_FAILED", "Governance Write completed without a canonical read-back identity.");
      const rows = await supabaseRequest(`/rest/v1/${target.table}?select=*&${target.filter}&limit=1`, {
        method: "GET",
        headers: authHeaders(environment.supabaseAnonKey, session.accessToken)
      });
      const readBack = summarizeReadBack(action, rows);
      return { authorizationId, operation: action.operation, readBack };
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      throw new RunnerError("OPERATIONAL_PATH_FAILED", "Governance approval could not be completed. No credential was exposed.");
    } finally {
      pmAuthorizationToken = "";
      actorToken = "";
      if (writeConfig) {
        writeConfig.actorToken = "";
        writeConfig.pmAuthorizationToken = "";
      }
    }
  }

  function currentState(session) {
    return {
      phase: approval.phase,
      authenticated: Boolean(session),
      ownerVerified: session?.ownerStatus === "allowed",
      user: session?.user ? { email: session.user.email, name: session.user.name } : null,
      action: approval.action ? actionView(approval.action) : null,
      requestId: approval.requestId,
      csrf: session && approval.phase === "pending" ? approval.csrf : "",
      error: approval.error,
      result: approval.result
    };
  }

  function currentProductStatus(requestId) {
    return productTaskUpdateState(requestId);
  }

  async function handle(request, response, port) {
    const requestUrl = new URL(request.url || "/", baseUrl(port));
    const session = await getSession(request);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      respondHtml(response, renderApprovalPage(approval.action ? actionView(approval.action) : null, currentState(session)));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/auth/start") {
      const oauth = await startOAuth(port);
      appendSetCookie(response, setEphemeralCookie(OAUTH_ATTEMPT_COOKIE, oauth.attemptId, Math.floor(OAUTH_STATE_TTL_MS / 1000)));
      redirect(response, oauth.url);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/auth/callback") {
      appendSetCookie(response, clearEphemeralCookie(OAUTH_ATTEMPT_COOKIE));
      try { await completeOAuth(request, response, port, requestUrl.searchParams); }
      catch (error) { respondHtml(response, renderApprovalPage(approval.action ? actionView(approval.action) : null, { ...currentState(null), error: publicError(error) }), 400); }
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/state") {
      respondJson(response, currentState(session));
      return;
    }
    if (requestUrl.pathname === PRODUCT_TASK_UPDATE_PATH || requestUrl.pathname === PRODUCT_TASK_UPDATE_STATUS_PATH) {
      const origin = assertProductOrigin(request, port);
      setProductCors(response, origin);
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (requestUrl.pathname === PRODUCT_TASK_UPDATE_PATH && request.method === "POST") {
        try {
          const body = await readRequestBody(request);
          const requestId = queueProductTaskUpdate(JSON.parse(body || "{}"));
          respondJson(response, { ok: true, requestId, phase: approval.phase, action: actionView(approval.action) }, 202);
        } catch (error) {
          respondJson(response, publicError(error), error?.code === "CSRF_DENIED" ? 403 : 422);
        }
        return;
      }
      if (requestUrl.pathname === PRODUCT_TASK_UPDATE_STATUS_PATH && request.method === "GET") {
        try {
          respondJson(response, currentProductStatus(requestUrl.searchParams.get("request_id")));
        } catch (error) {
          respondJson(response, publicError(error), error?.code === "CSRF_DENIED" ? 403 : 404);
        }
        return;
      }
      respondJson(response, { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, 405);
      return;
    }
    if (request.method === "POST" && ["/api/approve", "/api/reject"].includes(requestUrl.pathname)) {
      try {
        assertSameOrigin(request, port);
        const nonce = request.headers["x-pm-approval-nonce"] || "";
        if (!session) throw new RunnerError("AUTHENTICATION_REQUIRED", "請先完成 authenticated Google Login。");
        if (session.ownerStatus !== "allowed") throw new RunnerError("OWNER_REQUIRED", "Authenticated Engineering owner is required.");
        if (!constantTimeEqual(nonce, approval.csrf)) throw new RunnerError("CSRF_DENIED", "Approval request is invalid.");
        if (approval.phase !== "pending") throw new RunnerError("APPROVAL_REPLAY_DENIED", "This approval action is no longer available.");
        await readRequestBody(request);
        if (requestUrl.pathname === "/api/reject") {
          approval.phase = "rejected";
          approval.error = null;
          approval.result = null;
          respondJson(response, currentState(session));
          return;
        }
        if (!approval.action) throw new RunnerError("INVALID_ACTION", "No Governance action is waiting for PM approval.");
        approval.phase = "running";
        approval.result = await issueAndExecute(session);
        approval.phase = "success";
        respondJson(response, currentState(session));
        return;
      } catch (error) {
        approval.phase = approval.phase === "running" ? "failed" : approval.phase;
        approval.error = publicError(error);
        if (!response.headersSent) respondJson(response, currentState(session), error?.code === "AUTHENTICATION_REQUIRED" ? 401 : 403);
        return;
      }
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/logout") {
      const sid = parseCookies(request).pm_governance_sid;
      if (sid) sessions.delete(sid);
      response.setHeader("Set-Cookie", "pm_governance_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
      respondJson(response, { ok: true });
      return;
    }
    respondJson(response, { code: "NOT_FOUND", message: "Not found." }, 404);
  }

  function start(startOptions = {}) {
    const port = Number(startOptions.port || DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RunnerError("INVALID_ARGUMENT", "Port must be an integer between 1024 and 65535.");
    const server = http.createServer((request, response) => {
      handle(request, response, port).catch(error => {
        if (!response.headersSent) respondJson(response, publicError(error), 500);
      });
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, HOST, () => {
        server.removeListener("error", reject);
        resolve({ server, port, url: `${baseUrl(port)}/` });
      });
    });
  }

  return Object.freeze({ action, environment, currentState, handle, start, sessions, oauthAttempts, approval, queueProductTaskUpdate, productTaskUpdateState: currentProductStatus });
}

function usage(message = "") {
  if (message) console.error(`Error: ${message}`);
  console.error([
    "Usage:",
    "  node tools/pm-governance-approval.js start --action-file /path/to/action.json [--port 8765] [--open]",
    "  node tools/pm-governance-approval.js start --wait-for-product [--port 8765] [--open]",
    "",
    "The action file is supplied by the protected engineering workflow. In product mode,",
    "AI Board may submit only an allowlisted task-content update request. PM reviews",
    "the rendered action and clicks approve or reject; no token, JSON or SQL is entered."
  ].join("\n"));
  process.exitCode = message ? 1 : 0;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return usage();
  if (args.command !== "start" || (!args["action-file"] && !args.waitForProduct)) return usage("start requires --action-file or --wait-for-product.");
  if (args["action-file"] && args.waitForProduct) return usage("choose --action-file or --wait-for-product, not both.");
  const action = args["action-file"] ? readActionManifest(args["action-file"]) : null;
  const environment = Environment.resolveExecutionEnvironment(process.env);
  const runner = createRunner({ action, environment, waitForProduct: Boolean(args.waitForProduct) });
  const started = await runner.start({ port: args.port || DEFAULT_PORT });
  console.log(`PM Governance Approval Runner listening at ${started.url}`);
  console.log("PM must complete Google Login, review the action, then click approve or reject in the local page.");
  if (args.open && process.platform === "darwin") {
    const child = spawn("open", [started.url], { stdio: "ignore", detached: true });
    child.unref();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.publicMessage || "Governance runner failed."); process.exitCode = 1; });
}

module.exports = {
  ALLOWED_OPERATIONS,
  DEFAULT_PORT,
  HOST,
  OAUTH_ATTEMPT_COOKIE,
  PRODUCT_TASK_UPDATE_PATH,
  PRODUCT_TASK_UPDATE_STATUS_PATH,
  PRODUCT_TASK_UPDATE_FIELDS,
  OPERATION_LABELS,
  PAYLOAD_FIELDS,
  RunnerError,
  parseArgs,
  validatePayload,
  normalizeActionManifest,
  normalizeProductTaskUpdateRequest,
  readActionManifest,
  renderApprovalPage,
  createRunner,
  extractExecutionResult,
  readBackTarget,
  summarizeReadBack,
  summarizeBaselineReadBack
};
