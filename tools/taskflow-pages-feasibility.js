"use strict";
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const file=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
function assess(){
 const root=file("index.html");
 const client=file("labs/taskflow/pages-client/app.mjs");
 const api=file("labs/taskflow/pages-client/taskflow-api.mjs");
 const login=file("labs/taskflow/pages-client/login-return.mjs");
 const legacy=file("modules/worklog/index.html");
 const gates={
  "pages-root-is-dashboard-not-render-redirect":root.includes('id="tf-issues"')&&
    root.includes('src="labs/taskflow/pages-client/app.mjs')&&
    !root.includes('window.location.replace("https://zhuge-taskflow-web.onrender.com/")'),
  "root-loads-real-native-api-data":client.includes("transport.listIssues(")&&client.includes("transport.listWorkspaces()"),
  "native-auth-is-fail-closed":api.includes('"/auth/zhuge"')&&api.includes('credentials:"omit"')&&
    api.includes("X-Workspace-Slug"),
  "existing-login-and-return-preserved":root.includes("tf-login-action")&&
    legacy.includes("startReturnMonitor()")&&login.includes("hasFreshZhugeSession"),
  "older-AIOS-OAuth-routes-preserved":root.includes("hasExplicitAiosRoute")&&root.includes('current.searchParams.has("code")'),
  "page-origin-canonical":root.includes('rel="canonical" href="https://qqweasdzxc.github.io/zhuge-ai-os/"')
 };
 const homeCodeReady=Object.values(gates).every(Boolean);
 return {
  scope:"HOME_ONLY",
  status:homeCodeReady?"HOME_CANDIDATE_READY_FOR_RUNTIME_QA":"BLOCKED_NOT_READY",
  deploymentAllowed:false,
  pmRuntimeQARequired:true,
  githubAppAllowed:false,
  taskflowLiveDispatchAllowed:false,
  otherPagesOutsideScope:true,
  gates
 };
}
if(require.main===module){
 const r=assess();process.stdout.write(JSON.stringify(r,null,2)+"\n");
 if(process.argv.includes("--require-home-code")&&r.status!=="HOME_CANDIDATE_READY_FOR_RUNTIME_QA")process.exitCode=1;
}
module.exports={assess};
