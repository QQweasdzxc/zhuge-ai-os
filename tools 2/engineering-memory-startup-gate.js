#!/usr/bin/env node
/**
 * Protected read-only Engineering Memory consumer.
 *
 * This tool accepts only a short-lived Engineering Actor read token. It has no
 * write commands and must never be bundled into browser code.
 */
"use strict";

const Resolver = require("../shared/engineering-memory/engineering-memory-resolver.js");

function configFromEnvironment(env = process.env) {
  const url = String(env.SUPABASE_URL || env.ZHUGE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!url) throw new Error("SUPABASE_URL is required in the protected tool environment.");
  if (!/^https:\/\//i.test(url)) throw new Error("SUPABASE_URL must use HTTPS.");
  const actorToken = String(env.ENGINEERING_ACTOR_TOKEN || "");
  if (!actorToken) throw new Error("ENGINEERING_ACTOR_TOKEN is required in the protected read tool environment.");
  const functionUrl = String(env.ENGINEERING_MEMORY_READ_URL || `${url}/functions/v1/engineering-transition`).replace(/\/$/, "");
  if (!/^https:\/\//i.test(functionUrl)) throw new Error("ENGINEERING_MEMORY_READ_URL must use HTTPS.");
  return Object.freeze({ url, actorToken, functionUrl });
}

async function readStartupGate(config, knowledgeCodes = null) {
  const response = await fetch(config.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.actorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ operation: "startup_gate", knowledgeCodes })
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : parsed?.error || parsed?.message || response.statusText;
    const error = new Error(`Engineering Memory ${response.status}: ${detail}`);
    error.status = response.status;
    error.code = parsed?.code || "AUTHORIZATION_FAILED";
    throw error;
  }
  if (!parsed || !parsed.startup_gate) throw new Error("Engineering Memory returned an invalid Startup Gate payload.");
  return parsed;
}

async function main() {
  const config = configFromEnvironment();
  const payload = await readStartupGate(config);
  console.log(JSON.stringify({
    capability: payload.capability,
    actor: payload.actor,
    startupGate: payload.startup_gate,
    receipt: Resolver.startupGateReceipt(payload.startup_gate)
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { configFromEnvironment, readStartupGate };
