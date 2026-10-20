import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import browserTools from "./browser-executable.js";
const {resolveBrowserExecutable,fixtureURL}=browserTools;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const API="https://zhuge-taskflow-api.onrender.com";
async function setup(t,{signedIn=true,viewport={width:1440,height:900},dispatch=false}={}){
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),args:["--no-sandbox","--disable-dev-shm-usage"]});
 t.after(async()=>browser.close());
 const page=await browser.newPage({viewport});
 if(signedIn)await page.addInitScript(()=>localStorage.setItem("zhuge_ai_os_google_auth_session_v1",JSON.stringify({access_token:"test-supabase-access-token"})));
 const requests=[];
 await page.route(API+"/**",async route=>{
   const req=route.request();
   const u=new URL(req.url());
   requests.push({pathname:u.pathname,headers:req.headers(),method:req.method(),post:req.postData()});
   const headers={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type,x-workspace-slug",
     "access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS","content-type":"application/json"};
   if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
   let data,status=200;
   if(u.pathname==="/auth/zhuge")data={token:"taskflow-test-in-memory-jwt"};
   else if(u.pathname==="/api/workspaces")data=[{id:"ws1",slug:"test-workspace",name:"Engineering"}];
   else if(u.pathname==="/api/agents"&&dispatch)data=[{id:"agent-1",name:"CO-02 Agent",runtime_bound:true,status:"online"}];
   else if(u.pathname==="/api/issues"&&req.method()==="POST"&&dispatch)data={id:"issue-new",identifier:"ZG-2",title:"DM-00｜建立 native card",status:"todo",priority:"high",metadata:{}};
   else if(u.pathname==="/api/issues")data={issues:[{id:"issue-1",title:"Native issue from API",identifier:"ZG-1",status:"todo",priority:"high",project_id:"proj1"}],total:1};
   else if(u.pathname==="/api/projects")data={projects:[{id:"proj1",name:"Native Project"}]};
   else if(u.pathname==="/api/issue-statuses")data={statuses:[]};
   else if(u.pathname==="/api/issues/issue-1")data={id:"issue-1",identifier:"ZG-1",title:"Native issue from API",status:"todo",priority:"high",description:"This issue description came from API",project_id:"proj1"};
   else if(u.pathname==="/api/issues/issue-1/comments")data=[];
   else if(u.pathname==="/api/issues/issue-new"&&dispatch)data={id:"issue-new",identifier:"ZG-2",title:"DM-00｜建立 native card",status:"todo",priority:"high",description:"- 工作編號：DM-00",metadata:{zhuge_work_code:"DM-00",zhuge_dispatch_status:"ASSIGNED",zhuge_owner:"CO-02",zhuge_next_step:"下一步",zhuge_source_evidence:"https://github.com/org/repo/issues/1",zhuge_acceptance:"PM 驗收",zhuge_observed_at:"2026-10-20T00:00:00.000Z"}};
   else if(u.pathname.startsWith("/api/issues/issue-new/metadata/")&&dispatch&&req.method()==="PUT")data={metadata:{}};
   else {status=404;data={error:"not found"};}
   return route.fulfill({status,headers,body:JSON.stringify(data)});
 });
 const pageURL=await fixtureURL(path.join(root,"labs/taskflow/pages-client/index.html"));
 await page.goto(pageURL,{waitUntil:"load"});
 return {page,requests,rootURL:pageURL};
}
test("anonymous Pages client never fakes TaskFlow data or redirects to Render",async t=>{
 const {page,requests,rootURL}=await setup(t,{signedIn:false});
 await page.getByText("需要先登入 Zhuge AI OS").waitFor();
 assert.equal(new URL(page.url()).origin,new URL(rootURL).origin);
 assert.equal(requests.length,0,"no TaskFlow identity exchange without existing Zhuge session");
 assert.equal(await page.locator(".tf-issue").count(),0);
 assert.equal(await page.locator("#tf-login").isVisible(),true);
});
test("Pages client reads real mocked native API contracts without changing host",async t=>{
 const {page,requests,rootURL}=await setup(t);
 await page.getByText("Native issue from API").first().waitFor();
 assert.equal(new URL(page.url()).origin,new URL(rootURL).origin);
 assert.ok(requests.some(x=>x.pathname==="/auth/zhuge" && x.method==="POST"));
 const issues=requests.find(x=>x.pathname==="/api/issues");
 assert.equal(issues.headers["x-workspace-slug"],"test-workspace");
 assert.equal(issues.headers.authorization,"Bearer taskflow-test-in-memory-jwt");
 await page.getByText("Native issue from API").first().click();
 await page.getByText("This issue description came from API").waitFor();
 assert.ok(page.url().includes("#/tf/issues/issue-1"));
 assert.equal(new URL(page.url()).origin,new URL(rootURL).origin);
});
test("mobile native TaskFlow Pages client has no horizontal overflow",async t=>{
 const {page}=await setup(t,{viewport:{width:390,height:844}});
 await page.getByText("Native issue from API").first().waitFor();
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert.ok(width.scroll<=width.viewport,JSON.stringify(width));
});
test("PM can open the native DM card entry and create a real TaskFlow issue contract",async t=>{
 const {page,requests}=await setup(t,{dispatch:true});
 await page.getByText("Native issue from API").first().waitFor();
 await page.getByRole("button",{name:"新增 DM 任務"}).click();
 await page.locator("#tf-create-form input[name=title]").fill("建立 native card");
 await page.locator("#tf-create-form input[name=nextStep]").fill("接上原生 metadata readback");
 await page.locator("#tf-create-form input[name=sourceEvidence]").fill("https://github.com/org/repo/issues/1");
 await page.locator("#tf-create-form textarea[name=acceptance]").fill("PM 可在 native card 看到工作編號與下一步");
 await page.locator("#tf-create-form select[name=agentId]").selectOption("agent-1");
 await page.getByRole("button",{name:"建立原生 TaskFlow 卡"}).click();
 await page.getByText("DM-00｜建立 native card").first().waitFor();
 const create=requests.find(item=>item.pathname==="/api/issues"&&item.method==="POST");
 assert.ok(create);
 assert.equal(JSON.parse(create.post).assignee_id,"agent-1");
 assert.match(JSON.parse(create.post).title,/^DM-00/);
 assert.ok(requests.some(item=>item.pathname.startsWith("/api/issues/issue-new/metadata/")&&item.method==="PUT"));
 assert.ok(requests.some(item=>item.pathname==="/api/issues/issue-new"&&item.method==="GET"));
});
