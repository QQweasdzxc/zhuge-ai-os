/* Zhuge AI OS Controlled Engineering Service
 *
 * This Edge Function is the server-side bridge for Co/GPT workflow actors.
 * It authenticates a short-lived signed Engineering Actor Token, validates the
 * requested transition again, then calls the canonical Board RPC with the
 * server-only Service Role secret. Co/GPT never receive that key.
 * The public verification key is not a credential; the private signing key is
 * held only by the protected Engineering Actor Broker runtime.
 */

const ALLOWED_ACTORS = new Set(["Co", "GPT"]);
const ALLOWED_STATUSES = new Set(["ready", "inprogress", "qa", "done"]);
const ACTOR_ISSUER = "zhuge-ai-os-engineering-broker";
const ACTOR_PROFILES: Record<string, { audience: string; scope: string; actors: Set<string> }> = {
  transition: { audience: "engineering-transition", scope: "board:transition", actors: ALLOWED_ACTORS },
  "memory-read": { audience: "engineering-memory-read", scope: "engineering-memory:read", actors: ALLOWED_ACTORS },
  "governance-write": { audience: "engineering-governance-write", scope: "engineering-governance:write", actors: new Set(["GPT"]) }
};
const GOVERNANCE_OPERATIONS = new Set(["create_task_contract", "update_task_contract", "update_checkpoint", "register_artifact", "create_engineering_principle"]);
const ACTOR_KEY_ID = "zhuge-engineering-actor-20260810-212242";
// Key rotation is intentional: only this current public key is accepted, so
// tokens signed with either historical key id are rejected after deployment.
const ACTOR_PUBLIC_JWKS: Record<string, JsonWebKey> = {
  [ACTOR_KEY_ID]: {
    kty: "EC",
    crv: "P-256",
    x: "NWv0bZHSDQJix1hScadvLAFLAFeTibhO8zkfrjNNBgg",
    y: "dIdBSqeL6aM8YOImmClgcboyEeSQrJG8sftwwY2NKbM"
  }
};
const ACTOR_MAX_TTL_SECONDS = 300;
const CHECKLIST_STATES = new Set(["not_verified", "pass", "fail", "na"]);
const TRANSITIONS: Record<string, Record<string, Record<string, string>>> = {
  Co: {
    inprogress: { ready: "Co", qa: "GPT" },
    qa: { inprogress: "Co" }
  },
  GPT: {
    qa: { inprogress: "Co", qa: "QJC" }
  }
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

class AuthenticationError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 401, code = "AUTHORIZATION_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function base64urlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function decodeJson(value: string) {
  return JSON.parse(new TextDecoder().decode(base64urlBytes(value)));
}

async function requireActorToken(request: Request) {
  const token = bearer(request);
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthenticationError("Engineering Actor Token is required.");
  let header: any;
  let claims: any;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    throw new AuthenticationError("Engineering Actor Token is malformed.");
  }
  if (header.alg !== "ES256" || header.typ !== "JWT" || !ACTOR_PUBLIC_JWKS[header.kid]) {
    throw new AuthenticationError("Engineering Actor Token header is invalid.");
  }
  const profile = Object.entries(ACTOR_PROFILES).find(([, value]) => value.audience === claims.aud && value.scope === claims.scope);
  if (claims.iss !== ACTOR_ISSUER || !profile) {
    throw new AuthenticationError("Engineering Actor Token issuer, audience or scope is invalid.");
  }
  if (claims.actor_type !== "ai" || !profile[1].actors.has(claims.actor_label)) {
    throw new AuthenticationError("Engineering Actor Token actor or scope is invalid.", 403);
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > ACTOR_MAX_TTL_SECONDS) {
    throw new AuthenticationError("Engineering Actor Token is expired or outside the allowed TTL.");
  }
  const key = await crypto.subtle.importKey("jwk", ACTOR_PUBLIC_JWKS[header.kid], { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new AuthenticationError("Engineering Actor Token signature is invalid.");
  return { actor: claims.actor_label, jti: String(claims.jti || ""), profile: profile[0] };
}

function config() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
  if (!url || !key) throw new Error("Supabase service runtime is not configured.");
  return { url, key };
}

async function request(configValue: ReturnType<typeof config>, path: string, options: RequestInit = {}) {
  const response = await fetch(`${configValue.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: configValue.key,
      authorization: `Bearer ${configValue.key}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  let parsed: unknown = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
  if (!response.ok) {
    const detail = typeof parsed === "string" ? parsed : (parsed as any)?.message || (parsed as any)?.hint || response.statusText;
    throw new Error(`Supabase ${response.status}: ${detail}`);
  }
  return parsed;
}

async function findTask(cfg: ReturnType<typeof config>, workCode: string) {
  const query = `board_tasks?select=id,work_code,title,status,assignee,workspace_id,board_instance_id,updated_at&work_code=eq.${encodeURIComponent(workCode)}&limit=1`;
  const rows = await request(cfg, query);
  const task = Array.isArray(rows) ? rows[0] : null;
  if (!task) throw new Error(`TASK not found: ${workCode}`);
  return task;
}

function validateTransition(actor: string, currentStatus: string, targetStatus: string, targetAssignee: string) {
  if (!ALLOWED_ACTORS.has(actor)) throw new Error(`Unsupported AI actor: ${actor}`);
  if (!ALLOWED_STATUSES.has(currentStatus) || !ALLOWED_STATUSES.has(targetStatus)) throw new Error("Unsupported Board status.");
  if (TRANSITIONS[actor]?.[currentStatus]?.[targetStatus] !== targetAssignee) {
    throw new Error(`Transition is not allowed: ${actor} ${currentStatus} -> ${targetStatus}/${targetAssignee}`);
  }
}

async function audit(cfg: ReturnType<typeof config>, taskId: string) {
  const query = `engineering_activity_log?select=id,entity_id,action,actor_type,actor_label,before_data,after_data,note,created_at&entity_type=eq.board_task&entity_id=eq.${encodeURIComponent(taskId)}&order=created_at.desc&limit=10`;
  const rows = await request(cfg, query);
  return Array.isArray(rows) ? rows : [];
}

async function findChecklistItem(cfg: ReturnType<typeof config>, taskId: string, itemKey: string) {
  const query = `engineering_checklist_items?select=id,task_id,stage,item_key,label,required,state,checked_by,checked_at,evidence_note,evidence_ref,updated_at&task_id=eq.${encodeURIComponent(taskId)}&item_key=eq.${encodeURIComponent(itemKey)}&limit=1`;
  const rows = await request(cfg, query);
  const item = Array.isArray(rows) ? rows[0] : null;
  if (!item) throw new Error(`Checklist item not found: ${itemKey}`);
  return item;
}

async function checklistAudit(cfg: ReturnType<typeof config>, itemId: string) {
  const query = `engineering_activity_log?select=id,entity_id,action,actor_type,actor_label,before_data,after_data,note,created_at&entity_type=eq.engineering_checklist_item&entity_id=eq.${encodeURIComponent(itemId)}&order=created_at.desc&limit=10`;
  const rows = await request(cfg, query);
  return Array.isArray(rows) ? rows : [];
}

function boundedIdempotencyKey(value: unknown, fallback = "") {
  const key = String(value || fallback).trim();
  if (key.length < 8 || key.length > 200) {
    throw new Error("A bounded idempotency key is required for the Cloud lifecycle operation.");
  }
  return key;
}

function boundedLeaseSeconds(value: unknown, fallback = 900) {
  const lease = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(lease) || lease < 60 || lease > 86400) {
    throw new Error("Claim lease must be an integer between 60 and 86400 seconds.");
  }
  return lease;
}

function validateChecklistUpdate(actor: string, item: any, state: string, evidenceNote: string, evidenceRef: string) {
  if (!CHECKLIST_STATES.has(state)) throw new Error(`Unsupported checklist state: ${state}`);
  if (String(item.stage || "").toLowerCase() !== actor.toLowerCase()) {
    throw new Error(`Actor ${actor} may only update the ${item.stage} checklist stage.`);
  }
  if (state !== "not_verified" && !evidenceNote && !evidenceRef) {
    throw new Error("Evidence note or evidence reference is required for a verified checklist state.");
  }
}

Deno.serve(async (requestValue) => {
  try {
    if (requestValue.method !== "POST") return json({ error: "POST required" }, 405);
    const actorToken = await requireActorToken(requestValue);
    const body = await requestValue.json();
    const cfg = config();
    const operation = String(body.operation || "");

    if (actorToken.profile === "governance-write") {
      if (operation !== "governance_write") {
        throw new AuthenticationError("Governance write capability only accepts governance_write.", 403);
      }
      const governanceOperation = String(body.governanceOperation || "");
      if (!GOVERNANCE_OPERATIONS.has(governanceOperation)) {
        throw new AuthenticationError("Need PM Decision: governance operation is not allowlisted.", 403);
      }
      const authorizationToken = String(body.pmAuthorizationToken || "").trim();
      if (!authorizationToken) {
        throw new AuthenticationError("PM Authorization Missing.", 403);
      }
      try {
        const result = await request(cfg, "rpc/execute_engineering_governance_write", {
          method: "POST",
          body: JSON.stringify({
            p_authorization_token: authorizationToken,
            p_operation: governanceOperation,
            p_payload: body.payload && typeof body.payload === "object" ? body.payload : {},
            p_actor_label: actorToken.actor
          })
        });
        return json({
          capability: "engineering-governance:write",
          actor: actorToken.actor,
          operation: governanceOperation,
          result
        });
      } catch (error) {
        if (error instanceof Error && /PM Authorization|PM Decision|allowlisted|payload does not match/i.test(error.message)) {
          throw new AuthenticationError(error.message, 403);
        }
        throw error;
      }
    }

    if (actorToken.profile === "memory-read") {
      if (operation !== "startup_gate") {
        throw new AuthenticationError("Engineering memory read capability cannot write or transition.", 403);
      }
      const knowledgeCodes = Array.isArray(body.knowledgeCodes)
        ? body.knowledgeCodes.map((code: unknown) => String(code || "").trim().toUpperCase()).filter(Boolean)
        : null;
      const startupGate = await request(cfg, "rpc/resolve_engineering_startup_gate", {
        method: "POST",
        body: JSON.stringify({ p_knowledge_codes: knowledgeCodes?.length ? knowledgeCodes : null })
      });
      return json({
        capability: "engineering-memory:read",
        actor: actorToken.actor,
        startup_gate: startupGate
      });
    }
    if (operation === "startup_gate") {
      throw new AuthenticationError("Engineering transition capability cannot read engineering memory.", 403);
    }

    if (operation === "claim") {
      if (actorToken.actor !== "Co") {
        throw new AuthenticationError("Only the signed Co actor may claim a TASK.", 403);
      }
      if (body.actor && body.actor !== actorToken.actor) {
        throw new AuthenticationError("Actor body does not match the signed token.", 403);
      }
      const boardInstanceId = String(body.boardInstanceId || "").trim();
      if (!boardInstanceId) throw new Error("boardInstanceId is required for Co Claim.");
      const idempotencyKey = boundedIdempotencyKey(body.idempotencyKey, actorToken.jti);
      const result = await request(cfg, "rpc/board_claim_next_task", {
        method: "POST",
        body: JSON.stringify({
          p_board_instance_id: boardInstanceId,
          p_idempotency_key: idempotencyKey,
          p_actor_label: "Co",
          p_lease_seconds: boundedLeaseSeconds(body.leaseSeconds)
        })
      });
      return json({ capability: "board:transition", actor: actorToken.actor, operation, result });
    }

    if (operation === "claim_specific_task") {
      if (actorToken.profile !== "transition" || actorToken.actor !== "Co") {
        throw new AuthenticationError("Only the signed Co actor may use Specific Task Claim.", 403);
      }
      if (body.actor && body.actor !== actorToken.actor) {
        throw new AuthenticationError("Actor body does not match the signed token.", 403);
      }
      const task = await findTask(cfg, String(body.task || ""));
      const idempotencyKey = boundedIdempotencyKey(body.idempotencyKey, actorToken.jti);
      const result = await request(cfg, "rpc/board_claim_specific_task", {
        method: "POST",
        body: JSON.stringify({
          p_task_id: task.id,
          p_idempotency_key: idempotencyKey,
          p_actor_label: "Co",
          p_lease_seconds: boundedLeaseSeconds(body.leaseSeconds)
        })
      });
      const updatedTask = await findTask(cfg, String(body.task));
      return json({ capability: "board:transition", actor: actorToken.actor, operation, result, task: updatedTask, audit: await audit(cfg, updatedTask.id) });
    }

    if (operation === "reclaim_expired_claim") {
      if (actorToken.profile !== "transition" || actorToken.actor !== "Co") {
        throw new AuthenticationError("Only the signed Co actor may reclaim an expired TASK Claim.", 403);
      }
      if (body.actor && body.actor !== actorToken.actor) {
        throw new AuthenticationError("Actor body does not match the signed token.", 403);
      }
      const task = await findTask(cfg, String(body.task || ""));
      const expiredClaimToken = String(body.expiredClaimToken || "").trim();
      if (!expiredClaimToken) throw new Error("expiredClaimToken is required for targeted Claim reclaim.");
      const idempotencyKey = boundedIdempotencyKey(body.idempotencyKey);
      const result = await request(cfg, "rpc/board_reclaim_expired_task", {
        method: "POST",
        body: JSON.stringify({
          p_task_id: task.id,
          p_expired_claim_token: expiredClaimToken,
          p_idempotency_key: idempotencyKey,
          p_lease_seconds: boundedLeaseSeconds(body.leaseSeconds)
        })
      });
      const updatedTask = await findTask(cfg, String(body.task));
      return json({ capability: "board:transition", actor: actorToken.actor, operation, result, task: updatedTask, audit: await audit(cfg, updatedTask.id) });
    }

    if (operation === "renew_claim") {
      if (actorToken.actor !== "Co") {
        throw new AuthenticationError("Only the signed Co actor may renew a TASK claim.", 403);
      }
      const claimToken = String(body.claimToken || "").trim();
      if (!claimToken) throw new Error("claimToken is required for claim renewal.");
      const result = await request(cfg, "rpc/board_renew_task_claim", {
        method: "POST",
        body: JSON.stringify({
          p_claim_token: claimToken,
          p_lease_seconds: boundedLeaseSeconds(body.leaseSeconds)
        })
      });
      return json({ capability: "board:transition", actor: actorToken.actor, operation, result });
    }

    if (operation === "release_claim") {
      if (actorToken.actor !== "Co") {
        throw new AuthenticationError("Only the signed Co actor may release a TASK claim.", 403);
      }
      const claimToken = String(body.claimToken || "").trim();
      if (!claimToken) throw new Error("claimToken is required for claim release.");
      const result = await request(cfg, "rpc/board_release_task_claim", {
        method: "POST",
        body: JSON.stringify({
          p_claim_token: claimToken,
          p_reason: body.reason ? String(body.reason).trim() : null
        })
      });
      return json({ capability: "board:transition", actor: actorToken.actor, operation, result });
    }

    const task = await findTask(cfg, String(body.task || ""));

    if (operation === "inspect") return json({ task, audit: await audit(cfg, task.id) });
    if (operation === "checklist") {
      const itemKey = String(body.itemKey || "");
      const state = String(body.state || "");
      const evidenceNote = String(body.evidenceNote || "").trim();
      const evidenceRef = String(body.evidenceRef || "").trim();
      const item = await findChecklistItem(cfg, task.id, itemKey);
      validateChecklistUpdate(actorToken.actor, item, state, evidenceNote, evidenceRef);
      if (body.expectedState && item.state !== body.expectedState) {
        return json({ error: `Expected ${body.task}/${itemKey} to be ${body.expectedState}, found ${item.state}.` }, 409);
      }

      const isDeveloperQaHandoff = actorToken.actor === "Co"
        && String(item.stage || "").toLowerCase() === "co"
        && itemKey.toLowerCase() === "developer-qa"
        && state === "pass";
      if (isDeveloperQaHandoff) {
        const idempotencyKey = boundedIdempotencyKey(body.idempotencyKey, actorToken.jti);
        const handoff = await request(cfg, "rpc/board_orchestrate_developer_qa", {
          method: "POST",
          body: JSON.stringify({
            p_task_id: task.id,
            p_item_id: item.id,
            p_evidence_note: evidenceNote || null,
            p_evidence_ref: evidenceRef || null,
            p_actor_label: "Co",
            p_claim_token: body.claimToken ? String(body.claimToken).trim() : null
          })
        });
        const updatedTask = await findTask(cfg, String(body.task));
        const updated = await findChecklistItem(cfg, task.id, itemKey);
        let nextClaim: unknown = null;
        let nextClaimError: string | null = null;
        if (body.autoClaimNext !== false) {
          try {
            nextClaim = await request(cfg, "rpc/board_claim_next_task", {
              method: "POST",
              body: JSON.stringify({
                p_board_instance_id: task.board_instance_id,
                p_idempotency_key: boundedIdempotencyKey(body.nextClaimIdempotencyKey, `${idempotencyKey}:next`),
                p_actor_label: "Co",
                p_lease_seconds: boundedLeaseSeconds(body.leaseSeconds)
              })
            });
          } catch (error) {
            nextClaimError = error instanceof Error ? error.message : "Next Co Claim failed.";
          }
        }
        const response = {
          task: updatedTask,
          checklist: updated,
          orchestration: handoff,
          nextClaim,
          nextClaimError,
          audit: await audit(cfg, updatedTask.id)
        };
        if (nextClaimError) {
          return json({
            success: false,
            code: "NEXT_CLAIM_FAILED_AFTER_HANDOFF",
            error: nextClaimError,
            ...response
          }, 503);
        }
        return json({ success: true, ...response });
      }

      const result = await request(cfg, "rpc/board_update_checklist_item", {
        method: "POST",
        body: JSON.stringify({
          p_item_id: item.id,
          p_state: state,
          p_evidence_note: evidenceNote || null,
          p_evidence_ref: evidenceRef || null,
          p_actor_type: "ai",
          p_actor_label: actorToken.actor
        })
      });
      const updated = await findChecklistItem(cfg, task.id, itemKey);
      return json({ task, checklist: updated, result, audit: await checklistAudit(cfg, updated.id) });
    }
    if (operation !== "transition") return json({ error: "operation must be inspect, checklist, claim, claim_specific_task, reclaim_expired_claim, renew_claim, release_claim or transition" }, 400);

    if (body.actor && body.actor !== actorToken.actor) return json({ error: "Actor body does not match the signed token." }, 403);
    const actor = actorToken.actor;
    const targetStatus = String(body.targetStatus || "");
    const targetAssignee = String(body.targetAssignee || "");
    if (body.expectedStatus && task.status !== body.expectedStatus) {
      return json({ error: `Expected ${body.task} to be ${body.expectedStatus}, found ${task.status}.` }, 409);
    }
    validateTransition(actor, task.status, targetStatus, targetAssignee);
    const result = await request(cfg, "rpc/board_transition_task", {
      method: "POST",
      body: JSON.stringify({
        p_task_id: task.id,
        p_target_status: targetStatus,
        p_target_assignee: targetAssignee,
        p_actor_type: "ai",
        p_actor_label: actor,
        p_note: body.note || `Controlled Engineering Service transition by ${actor}`
      })
    });
    const updated = await findTask(cfg, String(body.task));
    return json({ result, task: updated, audit: await audit(cfg, updated.id) });
  } catch (error) {
    const status = error instanceof AuthenticationError ? error.status : 400;
    return json({
      code: error instanceof AuthenticationError ? error.code : "ENGINEERING_SERVICE_FAILED",
      error: error instanceof Error ? error.message : "Controlled Engineering Service failed"
    }, status);
  }
});
