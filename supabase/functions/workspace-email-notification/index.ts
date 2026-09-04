import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" }
});
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const movementActions = ["workspace_moved", "task_workspace_moved", "worktodo_task_updated"];
const truncate = (value: unknown, length: number) => String(value ?? "").slice(0, length);
const render = (value: string, context: Record<string, string>) => Object.entries(context)
  .reduce((output, [key, replacement]) => output.split(`{{${key}}}`).join(replacement), value || "");

function workspaceIdFrom(data: Record<string, unknown> | null | undefined) {
  return String(data?.workspace_id || data?.workspaceId || "");
}

function hasWorkspaceEntry(event: Record<string, unknown>, workspaceId: string, boardInstanceId: string) {
  const before = (event.before_data || {}) as Record<string, unknown>;
  const after = (event.after_data || {}) as Record<string, unknown>;
  const afterWorkspaceId = workspaceIdFrom(after);
  const beforeWorkspaceId = workspaceIdFrom(before);
  const eventBoardInstanceId = String(after.board_instance_id || after.boardInstanceId || "");
  return afterWorkspaceId === workspaceId
    && beforeWorkspaceId !== workspaceId
    && (!eventBoardInstanceId || eventBoardInstanceId === boardInstanceId);
}

async function updateAttempt(admin: any, attemptId: string, state: string, details: Record<string, unknown> = {}) {
  const { data: current, error: readError } = await admin.from("engineering_activity_log")
    .select("after_data")
    .eq("id", attemptId)
    .maybeSingle();
  if (readError || !current) return false;
  const afterData = {
    ...(current.after_data || {}),
    ...details,
    state: truncate(state, 40),
    updated_at: new Date().toISOString()
  };
  const { error } = await admin.from("engineering_activity_log")
    .update({ after_data: afterData })
    .eq("id", attemptId);
  return !error;
}

async function resolveBoardAccess(admin: any, instance: Record<string, unknown>, userId: string) {
  if (instance.authorization_mode === "owner") return instance.owner_uuid === userId;
  if (instance.authorization_mode !== "engineering") return false;
  const { data, error } = await admin.from("engineering_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("role", ["owner", "editor", "viewer"])
    .limit(1)
    .maybeSingle();
  return !error && Boolean(data?.user_id);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST required" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const resend = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("WORKSPACE_NOTIFICATION_FROM_EMAIL") || "";
  if (!url || !anon || !service) return json({ code: "SERVER_CONFIG", message: "Supabase server configuration missing" }, 500);

  const authorization = request.headers.get("Authorization") || "";
  const caller = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } }
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  const user = authData?.user;
  if (authError || !user) return json({ code: "AUTH_REQUIRED", message: "Authentication required" }, 401);

  const body = await request.json().catch(() => ({}));
  const taskId = String(body?.task_id || "").trim();
  const workspaceId = String(body?.workspace_id || "").trim();
  if (!taskId || !workspaceId) return json({ code: "INVALID_INPUT", message: "task_id and workspace_id are required" }, 400);

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: workspace, error: workspaceError } = await admin.from("board_workspaces")
    .select("id,name,board_instance_id,active")
    .eq("id", workspaceId)
    .eq("active", true)
    .maybeSingle();
  if (workspaceError) return json({ code: "WORKSPACE_READ_FAILED", message: "Workspace lookup failed" }, 500);
  if (!workspace?.board_instance_id) return json({ code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" }, 404);

  const { data: instance, error: instanceError } = await admin.from("board_instances")
    .select("id,authorization_mode,owner_uuid,active")
    .eq("id", workspace.board_instance_id)
    .eq("active", true)
    .maybeSingle();
  if (instanceError) return json({ code: "BOARD_READ_FAILED", message: "Board lookup failed" }, 500);
  if (!instance || !(await resolveBoardAccess(admin, instance, user.id))) {
    return json({ code: "FORBIDDEN", message: "Board access required" }, 403);
  }

  const { data: task, error: taskError } = await admin.from("board_tasks")
    .select("id,work_code,title,assignee,created_by,workspace_id,board_instance_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) return json({ code: "TASK_READ_FAILED", message: "Task lookup failed" }, 500);
  if (!task || task.workspace_id !== workspaceId || task.board_instance_id !== workspace.board_instance_id) {
    return json({ code: "TASK_STATE_MISMATCH", message: "Task is not in target workspace" }, 409);
  }

  const { data: events, error: eventError } = await admin.from("engineering_activity_log")
    .select("id,entity_id,action,before_data,after_data,created_at")
    .eq("entity_type", "board_task")
    .eq("entity_id", taskId)
    .in("action", movementActions)
    .order("created_at", { ascending: false })
    .limit(50);
  if (eventError) return json({ code: "MOVEMENT_READ_FAILED", message: "Movement audit lookup failed" }, 500);
  const movement = (events || []).find((event: Record<string, unknown>) => hasWorkspaceEntry(
    event,
    workspaceId,
    workspace.board_instance_id
  ));
  if (!movement?.id) {
    return json({ ok: true, sent: false, reason: "no_workspace_entry_event" });
  }

  const idempotencyKey = `workspace-email-v1:${movement.id}`;
  const { data: setting, error: settingError } = await admin.from("board_workspace_notification_settings")
    .select("enabled,notify_assignee,notify_reporter,custom_emails,subject_template,body_template")
    .eq("workspace_id", workspaceId)
    .eq("board_instance_id", workspace.board_instance_id)
    .maybeSingle();
  if (settingError) return json({ code: "SETTING_READ_FAILED", message: "Notification setting lookup failed" }, 500);

  const attempt = {
    entity_type: "board_workspace",
    entity_id: workspaceId,
    action: "workspace_email_notification",
    before_data: {
      task_id: taskId,
      board_instance_id: workspace.board_instance_id,
      movement_activity_id: movement.id,
      trigger: "workspace_entry"
    },
    after_data: {
      idempotency_key: idempotencyKey,
      task_id: taskId,
      workspace_id: workspaceId,
      board_instance_id: workspace.board_instance_id,
      movement_activity_id: movement.id,
      state: "pending"
    },
    note: "Module C workspace email notification attempt",
    actor_id: null,
    actor_type: "system",
    actor_label: "System",
    activity_type: "system_activity"
  };
  const { data: inserted, error: attemptError } = await admin.from("engineering_activity_log")
    .insert(attempt)
    .select("id")
    .maybeSingle();
  if (attemptError || !inserted?.id) {
    const { data: existing } = await admin.from("engineering_activity_log")
      .select("id,after_data")
      .eq("entity_type", "board_workspace")
      .eq("entity_id", workspaceId)
      .eq("action", "workspace_email_notification")
      .filter("after_data->>idempotency_key", "eq", idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return json({ ok: true, sent: false, reason: "already_processed", delivery_id: existing.id });
    return json({ code: "AUDIT_WRITE_FAILED", message: "Notification attempt could not be recorded" }, 500);
  }
  const attemptId = String(inserted.id);

  if (!setting?.enabled) {
    const audited = await updateAttempt(admin, attemptId, "disabled", { idempotency_key: idempotencyKey });
    return json({ ok: true, sent: false, reason: "disabled", delivery_id: attemptId, audited });
  }

  const recipients = new Set<string>((Array.isArray(setting.custom_emails) ? setting.custom_emails : [])
    .map((value: unknown) => String(value || "").trim().toLowerCase())
    .filter((value: string) => emailRx.test(value)));
  if (setting.notify_assignee) {
    const assignee = String(task.assignee || "").trim().toLowerCase();
    if (emailRx.test(assignee)) recipients.add(assignee);
  }
  if (setting.notify_reporter && task.created_by) {
    const { data: reporter } = await admin.auth.admin.getUserById(task.created_by);
    const reporterEmail = String(reporter?.user?.email || "").trim().toLowerCase();
    if (emailRx.test(reporterEmail)) recipients.add(reporterEmail);
  }
  if (!recipients.size) {
    const audited = await updateAttempt(admin, attemptId, "no_resolvable_recipients", {
      idempotency_key: idempotencyKey,
      recipient_count: 0
    });
    return json({ ok: true, sent: false, reason: "no_resolvable_recipients", delivery_id: attemptId, audited });
  }
  if (!resend || !from) {
    const audited = await updateAttempt(admin, attemptId, "config_missing", {
      idempotency_key: idempotencyKey,
      recipient_count: recipients.size
    });
    return json({ code: "MAIL_CONFIG_MISSING", message: "Email provider is not configured", delivery_id: attemptId, audited }, 503);
  }

  const context = {
    "卡片編號": String(task.work_code || task.id),
    "卡片名稱": String(task.title || ""),
    "工作區名稱": String(workspace.name || "")
  };
  const subject = truncate(render(String(setting.subject_template || "{{卡片編號}} 已進入{{工作區名稱}}"), context), 240);
  const text = truncate(render(String(setting.body_template || "您的案件 {{卡片編號}}「{{卡片名稱}}」目前已進入「{{工作區名稱}}」。"), context), 12000);

  let response: Response;
  let providerBody: Record<string, unknown> = {};
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [...recipients], subject, text })
    });
    providerBody = await response.json().catch(() => ({}));
  } catch {
    const audited = await updateAttempt(admin, attemptId, "provider_uncertain", {
      idempotency_key: idempotencyKey,
      recipient_count: recipients.size,
      error_code: "MAIL_PROVIDER_UNCERTAIN"
    });
    return json({ code: "MAIL_PROVIDER_UNCERTAIN", message: "Email provider response was uncertain", delivery_id: attemptId, audited }, 502);
  }

  if (!response.ok) {
    const audited = await updateAttempt(admin, attemptId, "provider_rejected", {
      idempotency_key: idempotencyKey,
      recipient_count: recipients.size,
      provider_status: response.status,
      provider_error: truncate(providerBody?.message || providerBody?.error || "provider_rejected", 240)
    });
    return json({ code: "MAIL_SEND_FAILED", message: "Email provider rejected notification", delivery_id: attemptId, audited }, 502);
  }

  const providerId = truncate(providerBody?.id || "", 160);
  const audited = await updateAttempt(admin, attemptId, "sent", {
    idempotency_key: idempotencyKey,
    recipient_count: recipients.size,
    provider_id: providerId
  });
  return json({ ok: true, sent: true, recipient_count: recipients.size, delivery_id: attemptId, provider_id: providerId || null, audited });
});
