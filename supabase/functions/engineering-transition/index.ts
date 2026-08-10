/* Zhuge AI OS Controlled Engineering Service
 *
 * This Edge Function is the server-side bridge for Co/GPT workflow actors.
 * It accepts only a service-role JWT at the function boundary, validates the
 * requested transition again, then calls the existing board_transition_task
 * RPC. The service-role secret is supplied by Supabase runtime environment and
 * is never returned to callers or bundled into browser assets.
 */

const ALLOWED_ACTORS = new Set(["Co", "GPT"]);
const ALLOWED_STATUSES = new Set(["ready", "inprogress", "qa", "done"]);
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

function bearer(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function jwtPayload(token: string) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

function requireServiceActor(request: Request) {
  const token = bearer(request);
  const claims = jwtPayload(token);
  if (!token || claims?.role !== "service_role") throw new Error("Controlled Engineering Service requires a service-role tool caller.");
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

Deno.serve(async (requestValue) => {
  try {
    requireServiceActor(requestValue);
    if (requestValue.method !== "POST") return json({ error: "POST required" }, 405);
    const body = await requestValue.json();
    const cfg = config();
    const operation = String(body.operation || "");
    const task = await findTask(cfg, String(body.task || ""));

    if (operation === "inspect") return json({ task, audit: await audit(cfg, task.id) });
    if (operation !== "transition") return json({ error: "operation must be inspect or transition" }, 400);

    const actor = String(body.actor || "");
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
    return json({ error: error instanceof Error ? error.message : "Controlled Engineering Service failed" }, 400);
  }
});
