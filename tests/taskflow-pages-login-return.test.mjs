import test from "node:test";
import assert from "node:assert/strict";
import {HOME,RETURN_KEY,VERIFY_FAIL_KEY,hasFreshZhugeSession,markExplicitReturn,pendingExplicitReturn,startReturnMonitor} from "../labs/taskflow/pages-client/login-return.mjs";
function storage(){const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
const token=(expiry)=>"header."+Buffer.from(JSON.stringify({exp:expiry})).toString("base64url")+".sig";
test("return intent must be explicit, same target and short-lived",()=>{
 const session=storage(),now=12345000;
 assert.equal(pendingExplicitReturn(session,now),false);
 markExplicitReturn(session,now);
 assert.equal(pendingExplicitReturn(session,now),true);
 assert.equal(pendingExplicitReturn(session,now+181000),false);
 session.setItem(RETURN_KEY,JSON.stringify({created_at:now,target:"https://attacker.example"}));
 assert.equal(pendingExplicitReturn(session,now),false);
});
test("Zhuge JWT must still be valid for 30 seconds",()=>{
 const store=storage();
 store.setItem("zhuge_ai_os_google_auth_session_v1",JSON.stringify({access_token:token(1000)}));
 assert.equal(hasFreshZhugeSession(store,960000),true);
 assert.equal(hasFreshZhugeSession(store,985000),false);
});
test("login monitor navigates only once when existing Zhuge session is fresh",()=>{
 const now=1000000,store=storage(),session=storage();
 markExplicitReturn(session,now);
 store.setItem("zhuge_ai_os_google_auth_session_v1",JSON.stringify({access_token:token(1100)}));
 const urls=[];
 const monitor=startReturnMonitor({sessionStore:session,localStore:store,now:()=>now,
   navigate:url=>urls.push(url),schedule:()=>{throw Error("should not schedule");}});
 assert.equal(monitor.active,false);
 assert.deepEqual(urls,[HOME]);
 assert.equal(session.getItem(RETURN_KEY),null);
 const again=startReturnMonitor({sessionStore:session,localStore:store,now:()=>now,navigate:url=>urls.push(url)});
 assert.equal(again.active,false);
 assert.equal(urls.length,1);
});
test("monitor does not navigate until a real authenticated Zhuge session exists",()=>{
 const now=1000000,store=storage(),session=storage(),urls=[];
 markExplicitReturn(session,now);
 let next,cancelled=false;
 const monitor=startReturnMonitor({sessionStore:session,localStore:store,now:()=>now,
  navigate:url=>urls.push(url),schedule:fn=>{next=fn;return 1;},cancel:()=>{cancelled=true;}});
 assert.equal(monitor.active,true);assert.equal(urls.length,0);
 store.setItem("zhuge_ai_os_session_v1",JSON.stringify({access_token:token(1200)}));
 next();
 assert.deepEqual(urls,[HOME]);assert.equal(cancelled,true);
});

test("status-classic target is explicit while default HOME and unrelated entry remain unchanged",async()=>{
 const {STATUS_CLASSIC}=await import("../labs/taskflow/pages-client/login-return.mjs");
 assert.equal(HOME,"https://qqweasdzxc.github.io/zhuge-ai-os/");
 assert.equal(STATUS_CLASSIC,HOME+"status-classic.html");
 const session=storage(),store=storage(),now=1000000,urls=[];
 const args={sessionStore:session,localStore:store,now:()=>now,navigate:url=>urls.push(url)};
 assert.equal(startReturnMonitor(args).active,false);
 markExplicitReturn(session,now,STATUS_CLASSIC);
 assert.equal(pendingExplicitReturn(session,now),true);
 assert.equal(pendingExplicitReturn(session,now-1),false);
 assert.equal(pendingExplicitReturn(session,now+180000),false);
 store.setItem("zhuge_ai_os_session_v1",JSON.stringify({access_token:token(1200)}));
 startReturnMonitor(args);
 assert.deepEqual(urls,[STATUS_CLASSIC]);
 markExplicitReturn(session,now);
 startReturnMonitor(args);
 assert.deepEqual(urls,[STATUS_CLASSIC,HOME]);
 markExplicitReturn(session,now,"https://attacker.example");
 assert.equal(startReturnMonitor(args).active,false);
 assert.equal(urls.length,2);
});

test("return monitor pauses while a preserved session is known to be unverified",()=>{
 const now=1000000,store=storage(),session=storage(),urls=[];
 markExplicitReturn(session,now);
 store.setItem("zhuge_ai_os_google_auth_session_v1",JSON.stringify({access_token:token(1100)}));
 store.setItem(VERIFY_FAIL_KEY,"1");
 let next;
 const monitor=startReturnMonitor({sessionStore:session,localStore:store,now:()=>now,
  navigate:url=>urls.push(url),schedule:fn=>{next=fn;return 1;},cancel:()=>{}});
 assert.equal(monitor.active,true);
 assert.equal(urls.length,0);
 assert.equal(session.getItem(RETURN_KEY)!==null,true);
 next();
 assert.equal(urls.length,0);
 store.removeItem(VERIFY_FAIL_KEY);
 next();
 assert.deepEqual(urls,[HOME]);
 assert.equal(session.getItem(RETURN_KEY),null);
});
