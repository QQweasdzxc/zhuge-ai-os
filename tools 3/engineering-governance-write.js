#!/usr/bin/env node
/**
 * Protected PM-authorized Governance Write consumer.
 *
 * This tool accepts two short-lived capabilities: the existing GPT actor token
 * and an opaque, payload-bound PM authorization token. It never receives a
 * Supabase service-role credential and has no direct SQL or DML path.
 */
"use strict";

const ALLOWED_OPERATIONS = new Set(["create_task_contract", "update_task_contract", "update_checkpoint", "register_artifact", "create_engineering_principle"]);

function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
}

function configFromEnvironment(env = process.env) {
  const url = String(env.SUPABASE_URL || env.ZHUGE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!url) throw new Error("SUPABASE_URL is required in the protected tool environment.");
  if (!/^https:\/\//i.test(url)) throw new Error("SUPABASE_URL must use HTTPS.");
  const actorToken = String(env.ENGINEERING_ACTOR_TOKEN || "");
  if (!actorToken) throw new Error("ENGINEERING_ACTOR_TOKEN is required in the protected GPT tool environment.");
  const pmAuthorizationToken = String(env.PM_AUTHORIZATION_TOKEN || "");
  if (!pmAuthorizationToken) throw new Error("PM_AUTHORIZATION_TOKEN is required for a governance write.");
  const functionUrl = String(env.ENGINEERING_GOVERNANCE_WRITE_URL || `${url}/functions/v1/engineering-transition`).replace(/\/$/, "");
  if (!/^https:\/\//i.test(functionUrl)) throw new Error("ENGINEERING_GOVERNANCE_WRITE_URL must use HTTPS.");
  return Object.freeze({ url, actorToken, pmAuthorizationToken, functionUrl });
}

function parsePayload(value) {
  try {
    const payload = JSON.parse(String(value || "{}"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload must be a JSON object.");
    return payload;
  } catch (error) {
    throw new Error(`Invalid --payload JSON: ${error.message}`);
  }
}

async function writeGovernance(config, operation, payload) {
  if (!ALLOWED_OPERATIONS.has(operation)) throw new Error(`Governance operation is not allowlisted: ${operation || "(empty)"}`);
  const response = await fetch(config.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.actorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      operation: "governance_write",
      governanceOperation: operation,
      pmAuthorizationToken: config.pmAuthorizationToken,
      payload
    })
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : parsed?.error || parsed?.message || response.statusText;
    const error = new Error(`Governance Write ${response.status}: ${detail}`);
    error.status = response.status;
    error.code = parsed?.code || "AUTHORIZATION_FAILED";
    throw error;
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command !== "write" || !args.operation || !args.payload) {
    throw new Error("Usage: node tools/engineering-governance-write.js write --operation create_task_contract|update_task_contract|update_checkpoint|register_artifact|create_engineering_principle --payload '{...}'");
  }
  const result = await writeGovernance(configFromEnvironment(), args.operation, parsePayload(args.payload));
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { ALLOWED_OPERATIONS, parseArgs, configFromEnvironment, parsePayload, writeGovernance };
