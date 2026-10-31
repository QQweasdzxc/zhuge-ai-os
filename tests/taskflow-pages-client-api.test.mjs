import test from "node:test";
import assert from "node:assert/strict";
import {buildNativeCTODispatchBody,createTaskFlowPagesTransport,readZhugeAccessToken,TaskFlowPagesError} from "../labs/taskflow/pages-client/taskflow-api.mjs";

const makeResponse=(status,data)=>({ok:status>=200&&status<300,status,
  json:async()=>data});
const ORIGINAL="https://zhuge-taskflow-api.onrender.com";
function harness({token="zhuge-test-jwt",issue=false}={}){
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(url===ORIGINAL+"/auth/zhuge")return makeResponse(200,{token:"taskflow-in-memory-jwt"});
    if(url===ORIGINAL+"/api/workspaces")return makeResponse(200,[{id:"ws1",slug:"pm-team"}]);
    if(url.startsWith(ORIGINAL+"/api/issues"))return makeResponse(200,issue?{issues:[],total:0}:{issues:[{id:"abc",title:"Real task"}],total:1});
    if(url.startsWith(ORIGINAL+"/api/projects"))return makeResponse(200,{projects:[]});
    return makeResponse(404,{});
  };
  return {calls,client:createTaskFlowPagesTransport({fetcher,getAccessToken:()=>token})};
}
test("reads legacy Zhuge session without writing it elsewhere",()=>{
  const jwt=exp=>`h.${Buffer.from(JSON.stringify({exp})).toString("base64")}.s`;
  const fresh=jwt(Math.floor(Date.now()/1000)+3600);
  const store={getItem:k=>k==="zhuge_ai_os_google_auth_session_v1"?JSON.stringify({access_token:fresh}):null};
  assert.equal(readZhugeAccessToken(store),fresh);
  assert.equal(readZhugeAccessToken({getItem:()=>"{invalid"}),null);
  // Non-JWT or unparseable tokens are skipped, matching login-return.mjs.
  const opaque={getItem:k=>k==="zhuge_ai_os_google_auth_session_v1"?JSON.stringify({access_token:"test-token"}):null};
  assert.equal(readZhugeAccessToken(opaque),null);
});
test("only trusted Render API and canonical Pages caller allowed",()=>{
  assert.throws(()=>createTaskFlowPagesTransport({apiBase:"https://untrusted.example",getAccessToken:()=>""}),/Only the approved/);
  assert.throws(()=>createTaskFlowPagesTransport({origin:"https://attacker.example",getAccessToken:()=>""}),/Unknown Pages/);
});
test("Zhuge token exchange is POSTed to trusted API, TF bearer stays in memory",async()=>{
  const {calls,client}=harness();
  assert.equal(client.connected(),false);
  await client.connect();
  assert.equal(client.connected(),true);
  assert.equal(calls[0].url,ORIGINAL+"/auth/zhuge");
  assert.equal(calls[0].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[0].options.body),{access_token:"zhuge-test-jwt"});
  assert.equal(calls[0].options.credentials,"omit");
  assert.equal(calls[0].options.redirect,"error");
  const ws=await client.listWorkspaces();
  assert.equal(ws[0].slug,"pm-team");
  assert.equal(calls[1].options.headers.Authorization,"Bearer taskflow-in-memory-jwt");
  client.disconnect();
  assert.equal(client.connected(),false);
});
test("workspace-scoped native API uses allowed slug in header, not a public query",async()=>{
  const {calls,client}=harness();
  await client.connect();
  let list=await client.listIssues("pm-team",{limit:23,query:"release"});
  assert.equal(list.issues[0].title,"Real task");
  const c=calls[1];
  assert.equal(c.options.headers["X-Workspace-Slug"],"pm-team");
  assert.match(c.url,/\/api\/issues\?limit=23&offset=0&q=release/);
  assert.doesNotMatch(c.url,/Bearer|taskflow-in-memory/);
  assert.equal(c.options.headers.Authorization,"Bearer taskflow-in-memory-jwt");
  assert.throws(()=>client.listIssues("a/b"),e=>e.code==="INVALID_WORKSPACE");
});
test("auth failure, cross-origin fetch and expired credentials fail closed",async()=>{
  const noToken=harness({token:null}).client;
  await assert.rejects(()=>noToken.connect(),e=>e.code==="SIGN_IN_REQUIRED");
  const client=createTaskFlowPagesTransport({getAccessToken:()=> "sample",fetcher:async()=>{throw Error("network")}});
  await assert.rejects(()=>client.connect(),e=>e.code==="NETWORK_OR_CORS");
  const fetcher=async (url)=>url.endsWith("auth/zhuge")?makeResponse(200,{token:"session-mocked-token"}):makeResponse(401,{});
  const c=createTaskFlowPagesTransport({getAccessToken:()=> "sample",fetcher});
  await c.connect();
  await assert.rejects(()=>c.listWorkspaces(),e=>e.code==="UNAUTHORIZED");
  assert.equal(c.connected(),false);
});
test("root and task paths cannot be arbitrary URLs or path traversal",async()=>{
  const {client}=harness();await client.connect();
  assert.throws(()=>client.getIssue("pm-team","../../admin"),e=>e.code==="INVALID_IDENTIFIER");
  assert.throws(()=>client.listIssues("https://bad"),e=>e.code==="INVALID_WORKSPACE");
});

test("native CTO dispatch adapter sends only the versioned TaskFlow mutation fields",async()=>{
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(url===ORIGINAL+"/auth/zhuge")return makeResponse(200,{token:"taskflow-in-memory-jwt"});
    return makeResponse(202,{task_id:"native-task-1"});
  };
  const client=createTaskFlowPagesTransport({fetcher,getAccessToken:()=>"zhuge-test-jwt"});
  await client.connect();
  await client.requestCTODispatch("pm-team","abc",{task_id:"native-task-1",executor_id:"CO-02",provider:"codex"});
  const dispatch=calls[1];
  assert.equal(dispatch.url,ORIGINAL+"/api/issues/abc/dispatch");
  assert.equal(dispatch.options.method,"POST");
  assert.deepEqual(JSON.parse(dispatch.options.body),{task_id:"native-task-1",executor_id:"CO-02",provider:"codex"});
  assert.throws(()=>buildNativeCTODispatchBody({executor_id:"CO-02",provider:"codex",cto_user_id:"forged"}),e=>e.code==="INVALID_DISPATCH_REQUEST");
  assert.throws(()=>buildNativeCTODispatchBody({executor_id:"co-02",provider:"codex"}),e=>e.code==="INVALID_DISPATCH_REQUEST");
});

test("DM transport uses native TaskFlow issue, metadata, agent, run and PR endpoints",async()=>{
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(url===ORIGINAL+"/auth/zhuge")return makeResponse(200,{token:"taskflow-in-memory-jwt"});
    return makeResponse(200, url.includes("/task-runs")?[{id:"task-1",status:"queued"}]:url.includes("/pull-requests")?{pull_requests:[]}:{});
  };
  const client=createTaskFlowPagesTransport({fetcher,getAccessToken:()=>"zhuge-test-jwt"});
  await client.connect();
  await client.listAgents("pm-team");
  await client.createIssue("pm-team",{title:"DM-00｜native card"});
  await client.updateIssue("pm-team","abc",{assignee_type:"agent",assignee_id:"agent-1",suppress_run:true});
  await client.getMetadata("pm-team","abc");
  await client.setMetadata("pm-team","abc","zhuge_work_code","DM-00");
  await client.listTaskRuns("pm-team","abc",{active:true});
  await client.requestStart("pm-team","abc",{});
  await client.listPullRequests("pm-team","abc");
  await client.linkPullRequest("pm-team","abc","https://github.com/org/repo/pull/1");
  await client.deleteMetadata("pm-team","abc","zhuge_provider_run_id");
  const apiCalls=calls.slice(1);
  assert.deepEqual(apiCalls.map(call=>call.options.method||"GET"),["GET","POST","PUT","GET","PUT","GET","POST","GET","POST","DELETE"]);
  assert.match(apiCalls[5].url,/\/task-runs\?active=true$/);
  assert.deepEqual(JSON.parse(apiCalls[6].options.body),{});
  assert.deepEqual(JSON.parse(apiCalls[8].options.body),{url:"https://github.com/org/repo/pull/1"});
  for(const call of apiCalls)assert.equal(call.options.headers["X-Workspace-Slug"],"pm-team");
});

test("runtime readback uses the protected issue endpoint and never accepts client evidence",async()=>{
  const calls=[];
  const fetcher=async (url,options)=>{
    calls.push({url,options});
    if(url===ORIGINAL+"/auth/zhuge")return makeResponse(200,{token:"taskflow-in-memory-jwt"});
    return makeResponse(200,{runtime:{state:"UNKNOWN",authorization:"UNVERIFIED",evidence:{provider_ack:"UNVERIFIED"}}});
  };
  const client=createTaskFlowPagesTransport({fetcher,getAccessToken:()=>"zhuge-test-jwt"});
  await client.connect();
  const value=await client.getDispatchRuntime("pm-team","issue-1");
  assert.equal(value.runtime.state,"UNKNOWN");
  assert.equal(calls[1].url,ORIGINAL+"/api/issues/issue-1/dispatch-runtime");
  assert.equal(calls[1].options.method,"GET");
  assert.equal(calls[1].options.headers["X-Workspace-Slug"],"pm-team");
  assert.equal(calls[1].options.body,undefined);
});
test("expired JWT access tokens are not read as usable",()=>{
  const jwt=exp=>`h.${Buffer.from(JSON.stringify({exp})).toString("base64")}.s`;
  const now=Math.floor(Date.now()/1000);
  const expiredStore={getItem:k=>k==="zhuge_ai_os_google_auth_session_v1"?JSON.stringify({access_token:jwt(now-3600)}):null};
  assert.equal(readZhugeAccessToken(expiredStore),null);
  const freshToken=jwt(now+3600);
  const freshStore={getItem:k=>k==="zhuge_ai_os_google_auth_session_v1"?JSON.stringify({access_token:freshToken}):null};
  assert.equal(readZhugeAccessToken(freshStore),freshToken);
});
