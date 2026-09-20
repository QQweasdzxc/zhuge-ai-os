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
const CHECKLIST_STATES = new Set(["not_verified", "pass", "fail", "na"]);
const TRANSITIONS = Object.freeze({
  Co: Object.freeze({
    inprogress: Object.freeze({ ready: "Co", qa: "GPT" }),
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
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js claim \\",
    "    --board-instance-id <AI_BOARD_INSTANCE_ID> --actor Co \\",
    "    --idempotency-key co-claim-20260831-001 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js claim-gpt \\",
    "    --board-instance-id <AI_BOARD_INSTANCE_ID> --actor GPT --stage planning \\",
    "    --idempotency-key gpt-plan-20260920-001 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js plan-handoff-co \\",
    "    --task TASK-001 --actor GPT --claim-token <GPT_CLAIM_TOKEN> \\",
    "    --idempotency-key gpt-plan-handoff-20260920-001 --plan-json '{...}' --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js claim-specific-task \\",
    "    --task TASK-001 --actor Co --idempotency-key co-specific-20260901-001 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js reconcile-qjc-to-co-ready \\",
    "    --task TASK-001 --actor GPT --idempotency-key qjc-reconcile-20260901-001 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js engineering-review \\",
    "    --task TASK-001 --actor GPT --review-state pass --next-gate pm_decision_required \\",
    "    --claim-token <GPT_REVIEW_CLAIM_TOKEN> --idempotency-key gpt-review-20260920-001 \\",
    "    --evidence-note 'Review evidence' --regression-note 'Regression evidence' --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js reclaim-expired-claim \\",
    "    --task TASK-001 --expired-claim-token <EXPIRED_CLAIM_TOKEN> --actor Co \\",
    "    --idempotency-key co-reclaim-20260831-001 --lease-seconds 900 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js renew-claim \\",
    "    --claim-token <CLAIM_TOKEN> --lease-seconds 900 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js release-claim \\",
    "    --claim-token <CLAIM_TOKEN> --reason 'blocked by external dependency' --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js renew-gpt-claim \\",
    "    --actor GPT --claim-token <GPT_CLAIM_TOKEN> --lease-seconds 900 --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js release-gpt-claim \\",
    "    --actor GPT --claim-token <GPT_CLAIM_TOKEN> --reason 'manual handoff stop' --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js inspect --task TASK-001",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js transition \\",
    "    --task TASK-001 --target-status qa --target-assignee GPT \\",
    "    --actor Co --expected-status inprogress --confirm",
    "  SUPABASE_URL=... ENGINEERING_ACTOR_TOKEN=... node tools/engineering-transition.js checklist \\",
    "    --task TASK-001 --item-key developer-qa --state pass --actor Co \\",
    "    --evidence-note 'Developer QA evidence' --evidence-ref 'commit:...' \\",
    "    --claim-token <CLAIM_TOKEN> --idempotency-key dev-qa-20260831-001 --confirm",
    "",
    "Actors: Co, GPT (QJC uses the authenticated UI path).",
    "Status: ready, inprogress, qa, done.",
    "Co ready -> inprogress must use claim; --confirm is required for a write.",
    "Without --confirm, write commands are dry-run only."
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
  if (actor === "Co" && currentStatus === "ready" && targetStatus === "inprogress" && targetAssignee === "Co") {
    throw new Error("Co ready -> inprogress requires board_claim_next_task");
  }
  if (actor === "GPT" && currentStatus === "qa") {
    throw new Error("GPT qa transitions require engineering-review");
  }
  const allowedAssignee = TRANSITIONS[actor]?.[currentStatus]?.[targetStatus];
  if (!allowedAssignee || allowedAssignee !== targetAssignee) {
    throw new Error(`Transition is not allowed for ${actor}: ${currentStatus} -> ${targetStatus} / ${targetAssignee}`);
  }
}

function validateChecklist({ actor, stage, state, evidenceNote = "", evidenceRef = "" }) {
  if (!ALLOWED_ACTORS.has(actor)) throw new Error(`Unsupported AI actor: ${actor || "(empty)"}`);
  if (String(stage || "").toLowerCase() !== actor.toLowerCase()) {
    throw new Error(`Actor ${actor} may only update the ${stage || "(unknown)"} checklist stage.`);
  }
  if (!CHECKLIST_STATES.has(state)) throw new Error(`Unsupported checklist state: ${state || "(empty)"}`);
  if (state !== "not_verified" && !String(evidenceNote).trim() && !String(evidenceRef).trim()) {
    throw new Error("Evidence note or evidence reference is required for a verified checklist state.");
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
    const detail = typeof parsed === "string"
      ? parsed.trim()
      : [parsed?.message, parsed?.hint, parsed?.details, parsed?.error].find(value => String(value || "").trim());
    const safeDetail = String(detail || body || response.statusText || "Cloud 未提供受控 RPC 的錯誤明細").trim();
    const error = new Error(`Cloud RPC 失敗（HTTP ${response.status}）：${safeDetail}`);
    error.code = parsed?.code || "SUPABASE_RPC_FAILED";
    error.status = response.status;
    error.details = parsed?.details || null;
    throw error;
  }
  return parsed;
}

async function inspect(config, args) {
  if (!args.task) throw new Error("--task is required.");
  return requestTool(config, { operation: "inspect", task: args.task });
}

function boundedIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 200) {
    throw new Error("--idempotency-key must be between 8 and 200 characters.");
  }
  return key;
}

function boundedLeaseSeconds(value = 900) {
  const lease = Number(value);
  if (!Number.isInteger(lease) || lease < 60 || lease > 86400) {
    throw new Error("--lease-seconds must be an integer between 60 and 86400.");
  }
  return lease;
}

async function claim(config, args) {
  if (!args["board-instance-id"] || args.actor !== "Co") {
    throw new Error("--board-instance-id and --actor Co are required for claim.");
  }
  const payload = {
    operation: "claim",
    actor: "Co",
    boardInstanceId: args["board-instance-id"],
    idempotencyKey: args["idempotency-key"] || null,
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  return requestTool(config, payload);
}

async function claimGpt(config, args) {
  if (!args["board-instance-id"] || args.actor !== "GPT") {
    throw new Error("--board-instance-id and --actor GPT are required for claim-gpt.");
  }
  const stage = String(args.stage || "planning").trim().toLowerCase();
  if (!["planning", "review"].includes(stage)) throw new Error("--stage must be planning or review.");
  const payload = {
    operation: "claim_gpt",
    actor: "GPT",
    boardInstanceId: args["board-instance-id"],
    stage,
    idempotencyKey: args["idempotency-key"] || null,
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  return requestTool(config, payload);
}

async function claimSpecificTask(config, args) {
  if (!args.task || args.actor !== "Co") {
    throw new Error("--task and --actor Co are required for claim-specific-task.");
  }
  const payload = {
    operation: "claim_specific_task",
    actor: "Co",
    task: args.task,
    idempotencyKey: args["idempotency-key"] || null,
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  return requestTool(config, payload);
}

async function reconcileQjcToCoReady(config, args) {
  if (!args.task || args.actor !== "GPT") {
    throw new Error("--task and --actor GPT are required for reconcile-qjc-to-co-ready.");
  }
  const payload = {
    operation: "reconcile_qjc_to_co_ready",
    actor: "GPT",
    task: args.task,
    idempotencyKey: args["idempotency-key"] || null
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  return requestTool(config, payload);
}

async function planHandoffCo(config, args) {
  if (!args.task || args.actor !== "GPT" || !args["claim-token"] || !args["plan-json"]) {
    throw new Error("--task, --actor GPT, --claim-token and --plan-json are required for plan-handoff-co.");
  }
  let plan;
  try { plan = JSON.parse(args["plan-json"]); } catch { throw new Error("--plan-json must be valid JSON."); }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("--plan-json must be a JSON object.");
  const payload = {
    operation: "plan_handoff_co",
    actor: "GPT",
    task: args.task,
    claimToken: args["claim-token"],
    idempotencyKey: args["idempotency-key"] || null,
    plan
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  return requestTool(config, payload);
}

async function engineeringReview(config, args) {
  if (!args.task || args.actor !== "GPT") {
    throw new Error("--task and --actor GPT are required for engineering-review.");
  }
  const payload = {
    operation: "engineering_review",
    actor: "GPT",
    task: args.task,
    reviewState: args["review-state"] || null,
    nextGate: args["next-gate"] || null,
    reviewNote: args["evidence-note"] || null,
    evidenceRef: args["evidence-ref"] || null,
    regressionNote: args["regression-note"] || null,
    regressionRef: args["regression-ref"] || null,
    claimToken: args["claim-token"] || null,
    idempotencyKey: args["idempotency-key"] || null
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  if (!["pass", "rework"].includes(payload.reviewState)) throw new Error("--review-state must be pass or rework.");
  if (!payload.claimToken) throw new Error("--claim-token is required for engineering-review.");
  payload.idempotencyKey = boundedIdempotencyKey(args["idempotency-key"]);
  if (payload.reviewState === "pass" && !["pm_decision_required", "runtime_qa"].includes(payload.nextGate)) {
    throw new Error("--next-gate must be pm_decision_required or runtime_qa for a PASS.");
  }
  if (!payload.reviewNote && !payload.evidenceRef) throw new Error("Review evidence note or reference is required.");
  if (payload.reviewState === "pass" && !payload.regressionNote && !payload.regressionRef) {
    throw new Error("Regression evidence note or reference is required for a PASS.");
  }
  return requestTool(config, payload);
}

async function reclaimExpiredClaim(config, args) {
  if (!args.task || !args["expired-claim-token"] || args.actor !== "Co" || !args["idempotency-key"]) {
    throw new Error("--task, --expired-claim-token, --idempotency-key and --actor Co are required for reclaim-expired-claim.");
  }
  const payload = {
    operation: "reclaim_expired_claim",
    actor: "Co",
    task: args.task,
    expiredClaimToken: args["expired-claim-token"],
    idempotencyKey: boundedIdempotencyKey(args["idempotency-key"]),
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) {
    return {
      dryRun: true,
      service: config.functionUrl,
      operation: payload.operation,
      actor: payload.actor,
      task: payload.task,
      expiredClaimTokenProvided: true,
      idempotencyKey: payload.idempotencyKey,
      leaseSeconds: payload.leaseSeconds
    };
  }
  return requestTool(config, payload);
}

async function renewClaim(config, args) {
  if (!args["claim-token"] || args.actor !== "Co") {
    throw new Error("--claim-token and --actor Co are required for renew-claim.");
  }
  const payload = {
    operation: "renew_claim",
    actor: "Co",
    claimToken: args["claim-token"],
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  return requestTool(config, payload);
}

async function releaseClaim(config, args) {
  if (!args["claim-token"] || args.actor !== "Co") {
    throw new Error("--claim-token and --actor Co are required for release-claim.");
  }
  const payload = {
    operation: "release_claim",
    actor: "Co",
    claimToken: args["claim-token"],
    reason: args.reason || null
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  return requestTool(config, payload);
}

async function renewGptClaim(config, args) {
  if (!args["claim-token"] || args.actor !== "GPT") {
    throw new Error("--claim-token and --actor GPT are required for renew-gpt-claim.");
  }
  const payload = {
    operation: "renew_gpt_claim",
    actor: "GPT",
    claimToken: args["claim-token"],
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"])
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  return requestTool(config, payload);
}

async function releaseGptClaim(config, args) {
  if (!args["claim-token"] || args.actor !== "GPT") {
    throw new Error("--claim-token and --actor GPT are required for release-gpt-claim.");
  }
  const payload = {
    operation: "release_gpt_claim",
    actor: "GPT",
    claimToken: args["claim-token"],
    reason: args.reason || null
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  return requestTool(config, payload);
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

async function checklist(config, args) {
  if (!args.task || !args.actor || !args["item-key"] || !args.state) {
    throw new Error("--task, --actor, --item-key and --state are required.");
  }
  validateChecklist({
    actor: args.actor,
    stage: args.stage || args.actor,
    state: args.state,
    evidenceNote: args["evidence-note"] || "",
    evidenceRef: args["evidence-ref"] || ""
  });
  const payload = {
    operation: "checklist",
    task: args.task,
    actor: args.actor,
    itemKey: args["item-key"],
    state: args.state,
    expectedState: args["expected-state"] || null,
    evidenceNote: args["evidence-note"] || "",
    evidenceRef: args["evidence-ref"] || "",
    idempotencyKey: args["idempotency-key"] || null,
    claimToken: args["claim-token"] || null,
    nextClaimIdempotencyKey: args["next-claim-idempotency-key"] || null,
    leaseSeconds: args["lease-seconds"] === undefined ? 900 : boundedLeaseSeconds(args["lease-seconds"]),
    autoClaimNext: args["auto-claim-next"] !== "false"
  };
  if (!args.confirm) return { dryRun: true, service: config.functionUrl, ...payload };
  return requestTool(config, payload);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!["inspect", "transition", "checklist", "claim", "claim-gpt", "plan-handoff-co", "claim-specific-task", "reconcile-qjc-to-co-ready", "engineering-review", "reclaim-expired-claim", "renew-claim", "release-claim", "renew-gpt-claim", "release-gpt-claim"].includes(args.command)) return usage("Command must be inspect, transition, checklist, claim, claim-gpt, plan-handoff-co, claim-specific-task, reconcile-qjc-to-co-ready, engineering-review, reclaim-expired-claim, renew-claim, release-claim, renew-gpt-claim or release-gpt-claim.");
  const config = configFromEnvironment();
  const result = args.command === "inspect"
    ? await inspect(config, args)
    : args.command === "transition"
      ? await transition(config, args)
      : args.command === "checklist"
        ? await checklist(config, args)
        : args.command === "claim"
          ? await claim(config, args)
          : args.command === "claim-gpt"
            ? await claimGpt(config, args)
            : args.command === "plan-handoff-co"
              ? await planHandoffCo(config, args)
          : args.command === "claim-specific-task"
          ? await claimSpecificTask(config, args)
          : args.command === "reconcile-qjc-to-co-ready"
            ? await reconcileQjcToCoReady(config, args)
          : args.command === "engineering-review"
            ? await engineeringReview(config, args)
          : args.command === "reclaim-expired-claim"
            ? await reclaimExpiredClaim(config, args)
          : args.command === "renew-claim"
            ? await renewClaim(config, args)
            : args.command === "release-claim"
              ? await releaseClaim(config, args)
              : args.command === "renew-gpt-claim"
                ? await renewGptClaim(config, args)
                : await releaseGptClaim(config, args);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { ALLOWED_ACTORS, ALLOWED_STATUSES, CHECKLIST_STATES, TRANSITIONS, configFromEnvironment, validateTransition, validateChecklist, boundedIdempotencyKey, boundedLeaseSeconds, parseArgs, claimSpecificTask, claimGpt, planHandoffCo, reconcileQjcToCoReady, engineeringReview, reclaimExpiredClaim, renewGptClaim, releaseGptClaim };
