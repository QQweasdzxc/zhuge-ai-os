#!/usr/bin/env node
/**
 * Zhuge AI OS Controlled Engineering Transition Tool
 *
 * This file is a server/tool-side adapter only. It must never be loaded by a
 * browser or bundled into a public client. This tool never receives the
 * Supabase service-role key; it uses a short-lived Engineering Actor Token.
 */
"use strict";

const ALLOWED_ACTORS = new Set(["Co", "GPT"]);
const ALLOWED_STATUSES = new Set(["ready", "inprogress", "qa", "done"]);
const TRANSITIONS = Object.freeze({
  Co: Object.freeze({
    ready: Object.freeze({ inprogress: "Co" }),
    inprogress: Object.freeze({ qa: "GPT" }),
    qa: Object.freeze({ inprogress: "Co" })
  }),
  GPT: Object.freeze({
    qa: Object.freeze({ inprogress: "Co", qa: "QJC" })
  })
});

function usage(message = "") {
  if (message) console.error(`Error: ${message}`);
  console.error([
    "Usage:",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js transition \\",
    "    --task TASK-001 --target-status inprogress --target-assignee Co \\",
    "    --actor Co --expected-status ready --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js inspect --task TASK-001",
    "",
    "Actors: Co, GPT (QJC uses the authenticated UI path).",
    "Status: ready, inprogress, qa, done.",
    "--confirm is required for a write; without it transition is dry-run only."
  ].join("\n"));
  process.exitCode = message ? 1 : 0;
}

function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    if (key === "confirm") { args.confirm = true; continue; }
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
  const actorToken = String(env.ENGINEERING_ACTOR_TOKEN || "");
  if (!actorToken) throw new Error("ENGINEERING_ACTOR_TOKEN is required in the protected actor tool environment.");
  if (!/^https:\/\//i.test(url)) throw new Error("SUPABASE_URL must use HTTPS.");
  const functionUrl = String(env.ENGINEERING_TRANSITION_URL || `${url}/functions/v1/engineering-transition`).replace(/\/$/, "");
  if (!/^https:\/\//i.test(functionUrl)) throw new Error("ENGINEERING_TRANSITION_URL must use HTTPS.");
  return Object.freeze({ url, actorToken, functionUrl });
}

function validateTransition({ actor, currentStatus, targetStatus, targetAssignee }) {
  if (!ALLOWED_ACTORS.has(actor)) throw new Error(`Unsupported AI actor: ${actor || "(empty)"}`);
  if (!ALLOWED_STATUSES.has(currentStatus)) throw new Error(`Unsupported current status: ${currentStatus || "(empty)"}`);
  if (!ALLOWED_STATUSES.has(targetStatus)) throw new Error(`Unsupported target status: ${targetStatus || "(empty)"}`);
  const allowedAssignee = TRANSITIONS[actor]?.[currentStatus]?.[targetStatus];
  if (!allowedAssignee || allowedAssignee !== targetAssignee) {
    throw new Error(`Transition is not allowed for ${actor}: ${currentStatus} -> ${targetStatus} / ${targetAssignee}`);
  }
}

async function requestTool(config, payload) {
  const response = await fetch(config.functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.actorToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  let parsed = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : parsed?.message || parsed?.hint || response.statusText;
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return parsed;
}

async function inspect(config, args) {
  if (!args.task) throw new Error("--task is required.");
  return requestTool(config, { operation: "inspect", task: args.task });
}

async function transition(config, args) {
  if (!args.task || !args.actor || !args["target-status"] || !args["target-assignee"]) {
    throw new Error("--task, --actor, --target-status and --target-assignee are required.");
  }
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, operation: "transition", task: args.task, actor: args.actor, expectedStatus: args["expected-status"] || null, targetStatus: args["target-status"], targetAssignee: args["target-assignee"] };
  return requestTool(config, {
    operation: "transition",
    task: args.task,
    actor: args.actor,
    expectedStatus: args["expected-status"] || null,
    targetStatus: args["target-status"],
    targetAssignee: args["target-assignee"],
    note: args.note || `Controlled Engineering Tool transition by ${args.actor}`
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!["inspect", "transition"].includes(args.command)) return usage("Command must be inspect or transition.");
  const config = configFromEnvironment();
  const result = args.command === "inspect" ? await inspect(config, args) : await transition(config, args);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { ALLOWED_ACTORS, ALLOWED_STATUSES, TRANSITIONS, configFromEnvironment, validateTransition, parseArgs };
