import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
import browserTools from "./browser-executable.js";
const {resolveBrowserExecutable,fixtureURL}=browserTools;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const API="https://zhuge-taskflow-api.onrender.com";
async function setup(t,{signedIn=true,viewport={width:1440,height:900},issueList=null,issueDetail=null,dispatchErrorStatus=0}={}){
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
     "access-control-allow-methods":"GET,POST,OPTIONS","content-type":"application/json"};
   if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
   let data,status=200;
   if(u.pathname==="/auth/zhuge")data={token:"taskflow-test-in-memory-jwt"};
   else if(u.pathname==="/api/workspaces")data=[{id:"ws1",slug:"test-workspace",name:"Engineering"}];
   else if(u.pathname==="/api/issues"){
     const fallback={id:"issue-1",title:"Native issue from API",identifier:"ZG-1",status:"todo",priority:"high",project_id:"proj1"};
     const requestedIssues=Array.isArray(issueList)?issueList:[fallback];
     if(dispatchErrorStatus && requests.filter(request=>request.pathname==="/api/issues").length>1){status=dispatchErrorStatus;data={error:dispatchErrorStatus===403?"forbidden":"dispatch unavailable"};}
     else data={issues:requestedIssues,total:requestedIssues.length};
   }
   else if(u.pathname==="/api/projects")data={projects:[{id:"proj1",name:"Native Project"}]};
   else if(u.pathname==="/api/issue-statuses")data={statuses:[]};
   else if(/^\/api\/issues\/[^/]+$/.test(u.pathname))data=issueDetail||{id:"issue-1",identifier:"ZG-1",title:"Native issue from API",status:"todo",priority:"high",description:"This issue description came from API",project_id:"proj1"};
   else if(u.pathname==="/api/issues/issue-1/comments")data=[];
   else if(u.pathname==="/api/issues/issue-1/task-runs")data=[];
   else if(u.pathname==="/api/issues/issue-1/pull-requests")data={pull_requests:[]};
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
test("native TaskFlow Pages client stays usable in mobile landscape",async t=>{
 const {page}=await setup(t,{viewport:{width:844,height:390}});
 await page.getByText("Native issue from API").first().waitFor();
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
 assert.ok(width.scroll<=width.viewport,JSON.stringify(width));
 assert.equal(await page.locator("#tf-dispatch-executor").count(),1);
});

test("Workbench renders native issues, PM Inbox routing, and native detail links",async t=>{
 const dispatchIssue={id:"dispatch-1",identifier:"ZG-42",title:"DM-04｜Workbench 接線",status:"todo",project_id:"proj1",metadata:{zhuge_work_code:"DM-04",zhuge_executor:"CO-02",zhuge_dispatch_status:"REVIEW",zhuge_pm_decision_required:"true",zhuge_task_id:"task-42"}};
 const {page}=await setup(t,{issueList:[dispatchIssue],issueDetail:{...dispatchIssue,description:"Native dispatch evidence"}});
 await page.getByRole("link",{name:"AI 派工 Workbench"}).click();
 await page.locator(".tf-dispatch-card-link strong").filter({hasText:"DM-04｜Workbench 接線"}).waitFor();
 assert.match(await page.locator("#tf-pm-inbox").innerText(),/待 PM 裁示/);
 const card=page.locator(".tf-dispatch-card-link").first();
 assert.match(await card.getAttribute("href"),/\#\/tf\/issues\/dispatch-1$/);
 await card.click();
 await page.getByText("Native dispatch evidence").waitFor();
 assert.match(page.url(),/\#\/tf\/issues\/dispatch-1$/);
});

test("Workbench shows truthful empty state and permission errors",async t=>{
 const {page}=await setup(t,{dispatchErrorStatus:403});
 await page.getByRole("link",{name:"AI 派工 Workbench"}).click();
 await page.getByText("PM Inbox 讀取失敗").waitFor();
 assert.match(await page.locator("#tf-pm-inbox").innerText(),/沒有以空資料取代錯誤|未以空資料取代錯誤/);
});

test("Workbench empty state excludes ordinary native issues",async t=>{
 const {page}=await setup(t,{issueList:[{id:"ordinary-1",identifier:"ZG-99",title:"一般 TaskFlow 任務",status:"todo"}]});
 await page.getByRole("link",{name:"AI 派工 Workbench"}).click();
 await page.getByText("目前沒有可驗證的 PM 待處理案件").waitFor();
 assert.equal(await page.locator(".tf-dispatch-card").count(),1);
});
