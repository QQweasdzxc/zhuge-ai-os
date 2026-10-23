import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import tools from "./browser-executable.js";
const URL_BASE = process.env.TASKFLOW_NATIVE_BROWSER_URL;
const screenshotDir = process.env.TASKFLOW_NATIVE_SCREENSHOTS || "/tmp/taskflow-native-dispatch-screenshots";
const workspaceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const issueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const queueId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const issue = { id:issueId,workspace_id:workspaceA,number:42,identifier:"ZG-42",title:"P2 原生 AI 派工整合",description:null,status:"todo",priority:"medium",assignee_type:"agent",assignee_id:"99999999-9999-4999-8999-999999999999",creator_type:"member",creator_id:"11111111-1111-4111-8111-111111111111",parent_issue_id:null,project_id:projectId,position:1,start_date:null,due_date:null,created_at:"2026-10-21T00:00:00Z",updated_at:"2026-10-21T00:00:00Z",metadata:{zhuge_dispatch_status:"RUNNING",zhuge_provider_run_id:"forged-provider-run",zhuge_runtime_read_model:{authorization:"AUTHORIZED",evidence:{provider_ack:"VERIFIED"},state:"RUNNING"}} };
issue.metadata.zhuge_runtime_read_model = JSON.stringify(issue.metadata.zhuge_runtime_read_model);
function mappingsFor(workspaceId) {
  return { schema:"taskflow-native-executor-project-mapping-v1", source:"TASKFLOW_NATIVE_EXECUTOR_REGISTRY", workspace_id:workspaceId, checked_at:new Date().toISOString(), mappings:["CO-01","CO-02","CO-03","GEM-01","GH-HELPER"].map(executor_id=>({executor_id,state:executor_id==="CO-03"&&workspaceId===workspaceA?"VERIFIED":"GAP",reason:executor_id==="CO-03"&&workspaceId===workspaceA?"":"NATIVE_PROJECT_NOT_BOUND",project_id:executor_id==="CO-03"&&workspaceId===workspaceA?projectId:"",project_title:executor_id==="CO-03"&&workspaceId===workspaceA?"CO-03 原生專案":"",workspace_id:workspaceId,workspace_access:executor_id==="CO-03"&&workspaceId===workspaceA?"ALLOW":"UNVERIFIED",project_access:executor_id==="CO-03"&&workspaceId===workspaceA?"ALLOW":"UNVERIFIED",source:"TASKFLOW_NATIVE_EXECUTOR_REGISTRY"})) };
}
function taskResponse(workspaceId) {
  const tasks=workspaceId===workspaceA?[{issue_id:issueId,workspace_id:workspaceA,project_id:projectId,project_title:"CO-03 原生專案",title:issue.title,issue_status:"todo",executor_id:"CO-03",taskflow_task_id:queueId,taskflow_task_status:"queued",provider_runtime_state:"UNVERIFIED",provider_ack:"UNVERIFIED",updated_at:"2026-10-21T00:00:00Z"}]:[];
  return {schema:"taskflow-native-ai-task-readback-v1",source:"TASKFLOW_NATIVE_ISSUE_AGENT_QUEUE",workspace_id:workspaceId,observed_at:new Date().toISOString(),limit:20,offset:0,total:tasks.length,tasks,consistency:"NON_ATOMIC_OFFSET",provider_runtime_state:"UNVERIFIED"};
}
async function setup(t,{viewport={width:1440,height:900},status=200}={}) {
 const browser=await chromium.launch({executablePath:tools.resolveBrowserExecutable()||undefined,args:["--no-sandbox"]}); t.after(()=>browser.close());
 const page=await browser.newPage({viewport}); const requests=[];
 await page.route(URL_BASE.replace(/\/$/,"")+"/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()); requests.push({path:url.pathname,headers:request.headers()});
  const headers={"content-type":"application/json"}; let data;
  if(url.pathname==="/api/workspaces")data=[{id:workspaceA,slug:"alpha",name:"Alpha",created_at:"2026-10-21T00:00:00Z"},{id:workspaceB,slug:"beta",name:"Beta",created_at:"2026-10-21T00:00:00Z"}];
  else if(url.pathname==="/api/zhuge/ai/project-mappings"||url.pathname==="/api/zhuge/ai/tasks") {
    if(status!==200)return route.fulfill({status,headers,body:JSON.stringify({error:"permission denied"})});
    const workspaceId=request.headers()["x-workspace-slug"]==="beta"?workspaceB:workspaceA;
    data=url.pathname.endsWith("project-mappings")?mappingsFor(workspaceId):taskResponse(workspaceId);
  }
  else if(url.pathname===`/api/issues/${issueId}`) data=issue;
  else if(url.pathname.endsWith("/dispatch-runtime"))data={runtime:{schema:"zhuge-taskflow-dispatch-persistence-v1",status_source:"TASKFLOW_RUNTIME_READ_MODEL",issue_id:issueId,workspace:workspaceA,state:"UNKNOWN",authorization:"UNVERIFIED",evidence:{provider_ack:"UNVERIFIED",blocked_reason:"PROVIDER_RUNTIME_NOT_BOUND"}},readback_kind:"NATIVE_TASK_READBACK",provider_binding:"NOT_BOUND"};
  else return route.fulfill({status:404,headers,body:'{"error":"not found"}'});
  return route.fulfill({status:200,headers,body:JSON.stringify(data)});
 });
 await page.goto(URL_BASE,{waitUntil:"networkidle"}); return {page,requests};
}
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}])test(`native dispatch component browser ${viewport.width}x${viewport.height}`,{skip:!URL_BASE},async t=>{
 const {page,requests}=await setup(t,{viewport}); await page.getByText(/ZG-42|P2 原生 AI 派工整合/).waitFor();
 assert.equal(await page.getByLabel("Executor",{exact:true}).locator("option").count(),6);
 assert.equal(await page.getByRole("link",{name:"CO-03 原生專案"}).getAttribute("href"),`/alpha/projects/${projectId}`);
 assert.equal(requests.filter(r=>r.path==="/api/zhuge/ai/project-mappings").length,1);
 assert.equal(requests.filter(r=>r.path==="/api/zhuge/ai/tasks").length,1);
 assert.equal(requests.filter(r=>r.path.endsWith("/dispatch-runtime")).length,0);
 await page.getByRole("button",{name:"查看受保護執行證據"}).click();
 await page.getByText("Provider Run ID（受保護讀回）：未取得").waitFor();
 assert.equal(await page.getByText(/forged-provider-run/).count(),0); assert.equal(await page.getByText("正在執行",{exact:true}).count(),0);
 const request=requests.find(r=>r.path.endsWith("/dispatch-runtime")); assert.equal(request.headers["x-workspace-slug"],"alpha"); assert.match(request.headers.authorization,/Bearer isolated-browser/);
 const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth})); assert.ok(size.scroll<=size.width,JSON.stringify(size));
 await mkdir(screenshotDir,{recursive:true}); await page.screenshot({path:`${screenshotDir}/native-dispatch-${viewport.width}x${viewport.height}.png`,fullPage:true});
 await page.getByRole("link",{name:/P2 原生 AI 派工整合/}).click();
 await page.waitForFunction(expected => document.querySelector('[aria-label="原生導覽路徑"]')?.textContent === expected, "/alpha/issues/"+issueId);
 assert.equal(await page.getByLabel("原生導覽路徑").innerText(),"/alpha/issues/"+issueId);
 await page.getByRole("button",{name:"切換 Beta"}).click(); await page.getByText("目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。").waitFor(); assert.equal(await page.getByRole("link",{name:/ZG-42/}).count(),0);
});
for(const status of [401,403,503])test(`native dispatch API ${status} remains error`,{skip:!URL_BASE},async t=>{const {page}=await setup(t,{status}); await page.getByRole("alert").waitFor(); assert.equal(await page.getByText("目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。").count(),0);});
