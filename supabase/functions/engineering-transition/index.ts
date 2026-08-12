/* Zhuge AI OS Controlled Engineering Service
 *
 * This Edge Function is the server-side bridge for Co/GPT workflow actors.
 * It authenticates a short-lived signed Engineering Actor Token, validates the
 * requested transition again, then calls the existing board_transition_task
 * RPC with the server-only Service Role secret. Co/GPT never receive that key.
 * The public verification key is not a credential; the private signing key is
 * held only by the protected Engineering Actor Broker runtime.
 */

const ALLOWED_ACTORS = new Set(["Co", "GPT"]);
const ALLOWED_STATUSES = new Set(["ready", "inprogress", "qa", "done"]);
const ACTOR_ISSUER = "zhuge-ai-os-engineering-broker";
const ACTOR_AUDIENCE = "engineering-transition";
const ACTOR_SCOPE = "board:transition";
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
    ready: { inprogress: "Co" },
    inprogress: { qa: "GPT" },
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
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
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
  if (claims.iss !== ACTOR_ISSUER || claims.aud !== ACTOR_AUDIENCE) {
    throw new AuthenticationError("Engineering Actor Token issuer or audience is invalid.");
  }
  if (claims.actor_type !== "ai" || !ALLOWED_ACTORS.has(claims.actor_label) || claims.scope !== ACTOR_SCOPE) {
    throw new AuthenticationError("Engineering Actor Token actor or scope is invalid.", 403);
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 30 || claims.exp <= now || claims.exp - claims.iat > ACTOR_MAX_TTL_SECONDS) {
    throw new AuthenticationError("Engineering Actor Token is expired or outside the allowed TTL.");
  }
  const key = await crypto.subtle.importKey("jwk", ACTOR_PUBLIC_JWKS[header.kid], { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, base64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new AuthenticationError("Engineering Actor Token signature is invalid.");
  return { actor: claims.actor_label, jti: String(claims.jti || "") };
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
  const query = `board_tasks?select=id,work_code,title,status,assignee,updated_at&work_code=eq.${encodeURIComponent(workCode)}&limit=1`;
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
    if (operation !== "transition") return json({ error: "operation must be inspect, checklist or transition" }, 400);

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
    return json({ error: error instanceof Error ? error.message : "Controlled Engineering Service failed" }, status);
  }
});
