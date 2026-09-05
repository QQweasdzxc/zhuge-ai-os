import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type":"application/json" } });
const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const render = (value:string, ctx:Record<string,string>) => Object.entries(ctx).reduce((out,[k,v]) => out.split(`{{${k}}}`).join(v), value || "");

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers:cors });
  if (req.method !== "POST") return json({code:"METHOD_NOT_ALLOWED",message:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resend=Deno.env.get("RESEND_API_KEY"), from=Deno.env.get("WORKSPACE_NOTIFICATION_FROM_EMAIL");
  if (!url || !anon || !service) return json({code:"SERVER_CONFIG",message:"Supabase server configuration missing"},500);
  const auth=req.headers.get("Authorization") || "";
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userError}=await caller.auth.getUser();
  if (userError || !user) return json({code:"AUTH_REQUIRED",message:"Authentication required"},401);
  const body=await req.json().catch(()=>({}));
  const taskId=String(body.task_id||""), workspaceId=String(body.workspace_id||"");
  if (!taskId || !workspaceId) return json({code:"INVALID_INPUT",message:"task_id and workspace_id are required"},400);
  const admin=createClient(url,service,{auth:{persistSession:false}});
  const {data:ws}=await admin.from("board_workspaces").select("id,name,owner_uuid,board_instance_id").eq("id",workspaceId).maybeSingle();
  if (!ws) return json({code:"NOT_FOUND",message:"Workspace not found"},404);
  if (ws.owner_uuid && ws.owner_uuid !== user.id) return json({code:"FORBIDDEN",message:"Workspace owner access required"},403);
  const {data:setting}=await admin.from("board_workspace_notification_settings").select("enabled,notify_assignee,notify_reporter,custom_emails,subject_template,body_template").eq("workspace_id",workspaceId).maybeSingle();
  if (!setting?.enabled) return json({ok:true,sent:false,reason:"disabled"});
  const {data:task}=await admin.from("board_tasks").select("id,work_code,title,assignee,created_by,workspace_id").eq("id",taskId).maybeSingle();
  if (!task || task.workspace_id !== workspaceId) return json({code:"TASK_STATE_MISMATCH",message:"Task is not in target workspace"},409);
  const recipients=new Set<string>((setting.custom_emails||[]).map((v:string)=>v.trim().toLowerCase()).filter((v:string)=>emailRx.test(v)));
  if (setting.notify_assignee && emailRx.test(String(task.assignee||""))) recipients.add(String(task.assignee).toLowerCase());
  if (setting.notify_reporter && task.created_by) {
    const {data:reporter}=await admin.auth.admin.getUserById(task.created_by);
    if (reporter?.user?.email && emailRx.test(reporter.user.email)) recipients.add(reporter.user.email.toLowerCase());
  }
  if (!recipients.size) return json({ok:true,sent:false,reason:"no_resolvable_recipients"});
  if (!resend || !from) return json({code:"MAIL_CONFIG_MISSING",message:"RESEND_API_KEY / WORKSPACE_NOTIFICATION_FROM_EMAIL is not configured"},503);
  const ctx={"卡片編號":String(task.work_code||task.id),"卡片名稱":String(task.title||""),"工作區名稱":String(ws.name||"")};
  const subject=render(String(setting.subject_template||"{{卡片編號}} 已進入{{工作區名稱}}"),ctx).slice(0,240);
  const text=render(String(setting.body_template||""),ctx).slice(0,12000);
  const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resend}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[...recipients],subject,text})});
  const result=await mail.json().catch(()=>({}));
  if (!mail.ok) return json({code:"MAIL_SEND_FAILED",message:"Email provider rejected notification",provider:result},502);
  return json({ok:true,sent:true,recipient_count:recipients.size,id:result.id||null});
});
