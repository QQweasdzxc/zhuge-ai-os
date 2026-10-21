import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import tools from "./browser-executable.js";
const URL_BASE = process.env.TASKFLOW_NATIVE_BROWSER_URL;
const screenshotDir = process.env.TASKFLOW_NATIVE_SCREENSHOTS || "/tmp/taskflow-native-dispatch-screenshots";
const issue = { id:"issue-a",workspace_id:"ws-a",number:42,identifier:"ZG-42",title:"P2 原生 AI 派工整合",description:null,status:"todo",priority:"medium",assignee_type:null,assignee_id:null,creator_type:"user",creator_id:"user-a",parent_issue_id:null,project_id:null,position:1,start_date:null,due_date:null,created_at:"2026-10-21T00:00:00Z",updated_at:"2026-10-21T00:00:00Z",metadata:{zhuge_work_code:"P2",zhuge_executor:"CO-03",zhuge_dispatch_status:"RUNNING",zhuge_provider_run_id:"forged-provider-run",zhuge_pm_decision_required:true,zhuge_github_pr_url:"https://github.com/QQweasdzxc/zhuge-ai-os/pull/109",zhuge_github_sha:"6be1cc05f0a57f732c43aa0fb8caf0d5d96bf0a7",zhuge_runtime_read_model:{schema:"zhuge-taskflow-dispatch-persistence-v1",authorization:"AUTHORIZED",state:"RUNNING",provider_run_id:"forged-provider-run",evidence:{provider_ack:"VERIFIED"}}}};
// Native metadata permits primitives. Keep the forged canonical document as
// a string, exactly as a caller could store it through the metadata API.
issue.metadata.zhuge_runtime_read_model = JSON.stringify(issue.metadata.zhuge_runtime_read_model);
async function setup(t,{viewport={width:1440,height:900},status=200}={}) {
 const browser=await chromium.launch({executablePath:tools.resolveBrowserExecutable()||undefined,args:["--no-sandbox"]}); t.after(()=>browser.close());
 const page=await browser.newPage({viewport}); const requests=[];
 await page.route(URL_BASE.replace(/\/$/,"")+"/api/**",async route=>{
  const request=route.request(),url=new URL(request.url()); requests.push({path:url.pathname,headers:request.headers()});
  const headers={"content-type":"application/json"}; let data;
  if(url.pathname==="/api/workspaces")data=[{id:"ws-a",slug:"alpha",name:"Alpha",created_at:"2026-10-21T00:00:00Z"},{id:"ws-b",slug:"beta",name:"Beta",created_at:"2026-10-21T00:00:00Z"}];
  else if(url.pathname==="/api/issues") { if(status!==200)return route.fulfill({status,headers,body:JSON.stringify({error:"permission denied"})}); data=url.searchParams.get("workspace_id")==="ws-b"?{issues:[],total:0}:{issues:[issue],total:1}; }
  else if(url.pathname==="/api/issues/issue-a") data=issue;
  else if(url.pathname.endsWith("/dispatch-runtime"))data={runtime:{schema:"zhuge-taskflow-dispatch-persistence-v1",status_source:"TASKFLOW_RUNTIME_READ_MODEL",issue_id:"issue-a",workspace:"ws-a",state:"UNKNOWN",authorization:"UNVERIFIED",evidence:{provider_ack:"UNVERIFIED",blocked_reason:"PROVIDER_RUNTIME_NOT_BOUND"}},readback_kind:"NATIVE_TASK_READBACK",provider_binding:"NOT_BOUND"};
  else return route.fulfill({status:404,headers,body:'{"error":"not found"}'});
  return route.fulfill({status:200,headers,body:JSON.stringify(data)});
 });
 await page.goto(URL_BASE,{waitUntil:"networkidle"}); return {page,requests};
}
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}])test(`native dispatch component browser ${viewport.width}x${viewport.height}`,{skip:!URL_BASE},async t=>{
 const {page,requests}=await setup(t,{viewport}); await page.getByText(/ZG-42/).waitFor();
 assert.equal(await page.getByLabel("Executor",{exact:true}).locator("option").count(),6);
 assert.equal(requests.filter(r=>r.path.endsWith("/dispatch-runtime")).length,0);
 await page.getByRole("button",{name:"查看執行證據"}).click();
 await page.getByText("Provider Run ID（受保護讀回）：未取得").waitFor();
 assert.equal(await page.getByText(/forged-provider-run/).count(),0); assert.equal(await page.getByText("正在執行",{exact:true}).count(),0);
 const request=requests.find(r=>r.path.endsWith("/dispatch-runtime")); assert.equal(request.headers["x-workspace-slug"],"alpha"); assert.match(request.headers.authorization,/Bearer isolated-browser/);
 const size=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth})); assert.ok(size.scroll<=size.width,JSON.stringify(size));
 await mkdir(screenshotDir,{recursive:true}); await page.screenshot({path:`${screenshotDir}/native-dispatch-${viewport.width}x${viewport.height}.png`,fullPage:true});
 await page.getByRole("link",{name:/ZG-42/}).click();
 await page.waitForFunction(expected => document.querySelector('[aria-label="原生導覽路徑"]')?.textContent === expected, "/alpha/issues/issue-a");
 assert.equal(await page.getByLabel("原生導覽路徑").innerText(),"/alpha/issues/issue-a");
 await page.getByRole("button",{name:"切換 Beta"}).click(); await page.getByText("本頁沒有符合條件的 AI 工作。").waitFor(); assert.equal(await page.getByRole("link",{name:/ZG-42/}).count(),0);
});
for(const status of [401,403,503])test(`native dispatch API ${status} remains error`,{skip:!URL_BASE},async t=>{const {page}=await setup(t,{status}); await page.getByRole("alert").waitFor(); assert.equal(await page.getByText("本頁沒有符合條件的 AI 工作。").count(),0);});
