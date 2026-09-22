import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const movementActions = ["workspace_moved", "task_workspace_moved"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" }
});

const asObject = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const asText = (value: unknown, fallback = "") => {
  const text = typeof value === "string" ? value : value == null ? fallback : String(value);
  return text.trim();
};

const render = (value: string, context: Record<string, string>) => Object.entries(context)
  .reduce((output, [key, replacement]) => output.split(`{{${key}}}`).join(replacement), value || "");

const safeProviderDetail = (value: unknown) => {
  const detail = asObject(value);
  const code = asText(detail.code).slice(0, 120);
  const message = asText(detail.message || detail.error).slice(0, 500);
  return { ...(code ? { code } : {}), ...(message ? { message } : {}) };
};

const movementEnteredWorkspace = (row: Record<string, unknown>, workspaceId: string) => {
  const before = asObject(row.before_data);
  const after = asObject(row.after_data);
  const beforeWorkspaceId = asText(before.workspace_id);
  const afterWorkspaceId = asText(after.workspace_id);
  return afterWorkspaceId === workspaceId && beforeWorkspaceId && beforeWorkspaceId !== workspaceId;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("WORKSPACE_NOTIFICATION_FROM_EMAIL") || "";
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json({ code: "SERVER_CONFIG", message: "Supabase server configuration missing" }, 500);
  }

  const authorization = request.headers.get("Authorization") || "";
  const caller = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const { data: { user }, error: userError } = await caller.auth.getUser();
  if (userError || !user) return json({ code: "AUTH_REQUIRED", message: "Authentication required" }, 401);

  const requestBody = await request.json().catch(() => ({}));
  const body = asObject(requestBody);
  const taskId = asText(body.task_id);
  const workspaceId = asText(body.workspace_id);
  const cardUrl = asText(body.card_url);
  if (!taskId || !workspaceId) {
    return json({ code: "INVALID_INPUT", message: "task_id and workspace_id are required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: workspace, error: workspaceError } = await admin
    .from("board_workspaces")
    .select("id,name,owner_uuid,board_instance_id")
    .eq("id", workspaceId)
    .eq("active", true)
    .maybeSingle();
  if (workspaceError) return json({ code: "WORKSPACE_READ_FAILED", message: "Workspace read failed" }, 500);
  if (!workspace) return json({ code: "NOT_FOUND", message: "Workspace not found" }, 404);
  if (workspace.owner_uuid && workspace.owner_uuid !== user.id) {
    return json({ code: "FORBIDDEN", message: "Workspace owner access required" }, 403);
  }

  const { data: task, error: taskError } = await admin
    .from("board_tasks")
    .select("id,work_code,title,assignee,created_by,workspace_id,board_instance_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) return json({ code: "TASK_READ_FAILED", message: "Task read failed" }, 500);
  if (!task || task.workspace_id !== workspaceId) {
    return json({ code: "TASK_STATE_MISMATCH", message: "Task is not in target workspace" }, 409);
  }

  // A direct invocation is not enough to send mail. The latest movement audit
  // must prove that this task entered this workspace in the current event.
  const { data: movementRows, error: movementError } = await admin
    .from("engineering_activity_log")
    .select("id,entity_id,action,before_data,after_data,created_at")
    .eq("entity_type", "board_task")
    .eq("entity_id", taskId)
    .in("action", movementActions)
    .order("created_at", { ascending: false })
    .limit(20);
  if (movementError) return json({ code: "MOVEMENT_AUDIT_READ_FAILED", message: "Movement audit read failed" }, 503);
  const movement = (Array.isArray(movementRows) ? movementRows : [])
    .find((row) => movementEnteredWorkspace(row as Record<string, unknown>, workspaceId));
  if (!movement) return json({ ok: true, sent: false, reason: "not_workspace_entry" });

  const movementId = asText(movement.id);
  if (!movementId) return json({ code: "MOVEMENT_AUDIT_INVALID", message: "Movement audit identity is missing" }, 503);
  const idempotencyKey = `workspace-email-v1:${movementId}`;

  const { data: existingAttempts, error: existingAttemptError } = await admin
    .from("engineering_activity_log")
    .select("id,after_data,created_at")
    .eq("entity_type", "board_workspace")
    .eq("entity_id", workspaceId)
    .eq("action", "workspace_email_notification")
    .contains("after_data", { idempotency_key: idempotencyKey })
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingAttemptError) {
    return json({ code: "IDEMPOTENCY_READ_FAILED", message: "Notification idempotency read failed" }, 503);
  }
  const existingAttempt = Array.isArray(existingAttempts) ? existingAttempts[0] : null;
  if (existingAttempt) {
    const existingData = asObject(existingAttempt.after_data);
    return json({
      ok: true,
      sent: existingData.state === "sent",
      reason: "already_processed",
      audit_id: existingAttempt.id,
      idempotency_key: idempotencyKey
    });
  }

  const initialAudit = {
    schema_version: "workspace-email-notification-v1",
    state: "pending",
    trigger: "workspace_entry",
    idempotency_key: idempotencyKey,
    movement_activity_id: movementId,
    task_id: taskId,
    workspace_id: workspaceId,
    board_instance_id: workspace.board_instance_id || task.board_instance_id || null
  };
  const { data: attempt, error: attemptError } = await admin
    .from("engineering_activity_log")
    .insert({
      entity_type: "board_workspace",
      entity_id: workspaceId,
      action: "workspace_email_notification",
      after_data: initialAudit,
      note: "Module C Workspace Email notification attempt",
      actor_id: user.id,
      actor_type: "system",
      actor_label: "System",
      activity_type: "system_activity"
    })
    .select("id")
    .single();
  if (attemptError || !attempt) {
    // A future unique idempotency index may make a concurrent insert fail. A
    // second read turns that race into the same no-send result.
    const { data: racedAttempts } = await admin
      .from("engineering_activity_log")
      .select("id,after_data")
      .eq("entity_type", "board_workspace")
      .eq("entity_id", workspaceId)
      .eq("action", "workspace_email_notification")
      .contains("after_data", { idempotency_key: idempotencyKey })
      .limit(1);
    const racedAttempt = Array.isArray(racedAttempts) ? racedAttempts[0] : null;
    if (racedAttempt) {
      const racedData = asObject(racedAttempt.after_data);
      return json({
        ok: true,
        sent: racedData.state === "sent",
        reason: "already_processed",
        audit_id: racedAttempt.id,
        idempotency_key: idempotencyKey
      });
    }
    return json({ code: "AUDIT_CREATE_FAILED", message: "Notification audit could not be persisted" }, 503);
  }

  const auditId = attempt.id;
  const finalizeAudit = async (state: string, details: Record<string, unknown> = {}) => {
    const afterData = {
      ...initialAudit,
      ...details,
      state,
      finalized_at: new Date().toISOString()
    };
    const { error } = await admin
      .from("engineering_activity_log")
      .update({ after_data: afterData, note: `Module C Workspace Email notification: ${state}` })
      .eq("id", auditId);
    return !error;
  };

  const { data: setting, error: settingError } = await admin
    .from("board_workspace_notification_settings")
    .select("enabled,notify_assignee,notify_reporter,custom_emails,cc_emails,bcc_emails,subject_template,body_template")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (settingError) {
    await finalizeAudit("settings_read_failed");
    return json({ code: "SETTINGS_READ_FAILED", message: "Workspace notification settings read failed", audit_id: auditId }, 503);
  }
  if (!setting?.enabled) {
    const auditSaved = await finalizeAudit("disabled");
    if (!auditSaved) return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification audit could not be finalized", audit_id: auditId }, 503);
    return json({ ok: true, sent: false, reason: "disabled", audit_id: auditId, idempotency_key: idempotencyKey });
  }

  const recipients = new Set<string>();
  const customEmails = Array.isArray(setting.custom_emails) ? setting.custom_emails : [];
  customEmails
    .map((value: unknown) => asText(value).toLowerCase())
    .filter((value: string) => emailRx.test(value))
    .forEach((value: string) => recipients.add(value));
  if (setting.notify_assignee) {
    const assignee = asText(task.assignee);
    if (emailRx.test(assignee)) recipients.add(assignee.toLowerCase());
  }
  if (setting.notify_reporter && task.created_by) {
    const { data: reporter } = await admin.auth.admin.getUserById(task.created_by);
    const reporterEmail = asText(reporter?.user?.email);
    if (emailRx.test(reporterEmail)) recipients.add(reporterEmail.toLowerCase());
  }
  const ccRecipients = new Set<string>((Array.isArray(setting.cc_emails) ? setting.cc_emails : []).map((value: unknown) => asText(value).toLowerCase()).filter((value: string) => emailRx.test(value)));
  const bccRecipients = new Set<string>((Array.isArray(setting.bcc_emails) ? setting.bcc_emails : []).map((value: unknown) => asText(value).toLowerCase()).filter((value: string) => emailRx.test(value)));
  [...recipients].forEach(value => { ccRecipients.delete(value); bccRecipients.delete(value); });
  [...ccRecipients].forEach(value => bccRecipients.delete(value));
  if (!recipients.size) {
    const auditSaved = await finalizeAudit("no_resolvable_recipients");
    if (!auditSaved) return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification audit could not be finalized", audit_id: auditId }, 503);
    return json({ ok: true, sent: false, reason: "no_resolvable_recipients", audit_id: auditId, idempotency_key: idempotencyKey });
  }
  if (!resendApiKey || !fromEmail) {
    const auditSaved = await finalizeAudit("provider_not_configured", { recipient_count: recipients.size });
    if (!auditSaved) return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification audit could not be finalized", audit_id: auditId }, 503);
    return json({ code: "MAIL_CONFIG_MISSING", message: "Email provider is not configured", audit_id: auditId }, 503);
  }

  const context = {
    "卡片編號": asText(task.work_code || task.id),
    "卡片名稱": asText(task.title),
    "工作區名稱": asText(workspace.name)
  };
  const subject = render(asText(setting.subject_template, "{{卡片編號}} 已進入{{工作區名稱}}"), context).slice(0, 240);
  const renderedBody = render(asText(setting.body_template), context).slice(0, 12000);
  const emailText = cardUrl ? `${renderedBody}\n\n開啟此卡片：${cardUrl}` : renderedBody;
  let providerResponse: Response;
  let providerBody: unknown = {};
  try {
    providerResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: fromEmail, to: [...recipients], cc: [...ccRecipients], bcc: [...bccRecipients], subject, text: emailText })
    });
    providerBody = await providerResponse.json().catch(() => ({}));
  } catch (_error) {
    const auditSaved = await finalizeAudit("provider_uncertain", { recipient_count: recipients.size });
    if (!auditSaved) return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification audit could not be finalized", audit_id: auditId }, 503);
    return json({ code: "MAIL_PROVIDER_UNCERTAIN", message: "Email provider response was uncertain", audit_id: auditId }, 502);
  }

  const providerData = asObject(providerBody);
  const providerRequestId = asText(providerData.id).slice(0, 200) || null;
  if (!providerResponse.ok) {
    const auditSaved = await finalizeAudit("provider_rejected", {
      recipient_count: recipients.size,
      provider_request_id: providerRequestId,
      provider_detail: safeProviderDetail(providerBody)
    });
    if (!auditSaved) return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification audit could not be finalized", audit_id: auditId }, 503);
    return json({
      code: "MAIL_SEND_FAILED",
      message: "Email provider rejected notification",
      audit_id: auditId,
      provider_request_id: providerRequestId
    }, 502);
  }

  const auditSaved = await finalizeAudit("sent", {
    recipient_count: recipients.size,
    provider_request_id: providerRequestId
  });
  if (!auditSaved) {
    return json({ code: "AUDIT_UPDATE_FAILED", message: "Notification sent but audit could not be finalized", audit_id: auditId }, 503);
  }
  return json({
    ok: true,
    sent: true,
    recipient_count: recipients.size,
    audit_id: auditId,
    idempotency_key: idempotencyKey,
    provider_request_id: providerRequestId
  });
});
