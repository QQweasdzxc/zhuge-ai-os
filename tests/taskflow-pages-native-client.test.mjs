import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGES_CANONICAL,TASKFLOW_API,isCanonicalPagesUrl,readZhugeSessionToken,
  connectTaskFlowPages,TaskFlowPagesError
} from "../labs/taskflow/pages-client/taskflow-pages-api.mjs";

const WID="11111111-1111-4111-8111-111111111111";
const IID="22222222-2222-4222-8222-222222222222";
const WORKSPACE={id:WID,slug:"zhuge-lab",name:"Zhuge AI OS"};
const ISSUE={id:IID,identifier:"ZG-6",title:"Google 日曆整合",status:"todo"};
const ZHUGE_TOKEN="confidential-zhugesession-token";
const TF_TOKEN="confidential-taskflow-bearer-token";
const storage=(token=ZHUGE_TOKEN)=>({
 getItem(key){return key==="zhuge_ai_os_google_auth_session_v1"?
   JSON.stringify({access_token:token}):null}
});
function fixtureFetch({status=200,badData=false,networkError=false}={}){
 const calls=[];
 const fetchImpl=async (url,init)=>{
   calls.push({url,init});
   if(networkError)throw Error("cross-site browser blocked");
   if(url===TASKFLOW_API+"/auth/zhuge")
     return Response.json(status===200?{token:TF_TOKEN}:{error:"rejected"}, {status});
   if(url===TASKFLOW_API+"/api/workspaces")
     return Response.json(badData?{not:"array"}:[WORKSPACE]);
   if(url.startsWith(TASKFLOW_API+"/api/issues?"))
     return Response.json(badData?{issues:[{id:"?",title:3}],total:3}:
       {issues:[ISSUE],total:1});
   if(url===TASKFLOW_API+"/api/issues/"+IID)return Response.json(ISSUE);
   throw Error("unexpected request "+url);
 };
 return {fetchImpl,calls};
}
test("canonical root accepts only original GitHub Pages path, never Render origin",()=>{
 assert.ok(isCanonicalPagesUrl(PAGES_CANONICAL));
 assert.ok(isCanonicalPagesUrl(PAGES_CANONICAL+"?from=bookmark"));
 assert.ok(!isCanonicalPagesUrl("https://zhuge-taskflow-web.onrender.com/"));
 assert.ok(!isCanonicalPagesUrl("https://evil.example/zhuge-ai-os/"));
 assert.ok(!isCanonicalPagesUrl("https://qqweasdzxc.github.io/not-zhuge-ai-os/"));
});
test("reads only existing session on Pages origin, never guesses an identity",()=>{
 assert.equal(readZhugeSessionToken(storage()),ZHUGE_TOKEN);
 assert.equal(readZhugeSessionToken({getItem:()=>"{bad"}),null);
 assert.equal(readZhugeSessionToken({getItem:()=>null}),null);
});
test("Pages session exchanges via trusted Render API then reads genuine workspace/Issue",async()=>{
 const {calls,fetchImpl}=fixtureFetch();
 const session=await connectTaskFlowPages({storage:storage(),fetchImpl});
 const w=await session.listWorkspaces();
 assert.deepEqual(w,[WORKSPACE]);
 const {issues,total}=await session.listIssues({workspace:WORKSPACE});
 assert.deepEqual(issues,[ISSUE]);assert.equal(total,1);
 assert.deepEqual(await session.getIssue({workspace:WORKSPACE,issueId:IID}),ISSUE);
 assert.equal(calls.length,4);
 const auth=calls[0],workspace=calls[1],list=calls[2];
 assert.equal(auth.url,TASKFLOW_API+"/auth/zhuge");
 assert.equal(auth.init.method,"POST");
 assert.deepEqual(JSON.parse(auth.init.body),{access_token:ZHUGE_TOKEN});
 assert.equal(auth.init.credentials,"omit");
 assert.equal(workspace.init.headers.Authorization,"Bearer "+TF_TOKEN);
 assert.equal(list.init.headers["X-Workspace-Slug"],WORKSPACE.slug);
 assert.match(list.url,/workspace_id=11111111/);
 assert.ok(calls.every(c=>c.init.redirect==="error"&&c.init.credentials==="omit"));
 assert.ok(calls.every(c=>c.url.startsWith(TASKFLOW_API+"/")));
 assert.ok(!JSON.stringify(w).includes(TF_TOKEN));
 assert.ok(!JSON.stringify(issues).includes(TF_TOKEN));
 assert.ok(!Object.values(session).some(v=>typeof v!=="function"));
});
test("Pages bridge never redirects to Render and has no hidden placeholder data",async()=>{
 const {fetchImpl}=fixtureFetch();
 const client=await connectTaskFlowPages({storage:storage(),fetchImpl});
 assert.ok(!("redirect" in client) && !("webUrl" in client));
 await assert.rejects(client.listIssues({workspace:{id:"bogus",slug:"zhuge-lab"}}),{
   code:"INVALID_WORKSPACE"
 });
 await assert.rejects(client.getIssue({workspace:WORKSPACE,issueId:"../secrets"}),{
   code:"INVALID_ISSUE_REQUEST"
 });
 await assert.rejects(client.listIssues({workspace:WORKSPACE,limit:200}),{
   code:"INVALID_PAGE"
 });
});
test("no login, expired user, blocked CORS and invalid backend payload stay fail-closed",async()=>{
 await assert.rejects(connectTaskFlowPages({storage:{getItem:()=>null}}),{
   code:"LOGIN_REQUIRED"
 });
 await assert.rejects(connectTaskFlowPages({
   storage:storage(),fetchImpl:fixtureFetch({status:401}).fetchImpl
 }),{code:"LOGIN_EXPIRED"});
 await assert.rejects(connectTaskFlowPages({
   storage:storage(),fetchImpl:fixtureFetch({networkError:true}).fetchImpl
 }),{code:"API_CORS_OR_NETWORK_UNAVAILABLE"});
 const {fetchImpl}=fixtureFetch({badData:true});
 const client=await connectTaskFlowPages({storage:storage(),fetchImpl});
 await assert.rejects(client.listWorkspaces(),{code:"INVALID_WORKSPACE_REPLY"});
 await assert.rejects(client.listIssues({workspace:WORKSPACE}),{code:"INVALID_ISSUE_REPLY"});
});
