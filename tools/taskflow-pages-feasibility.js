"use strict";
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const file=p=>fs.readFileSync(path.join(ROOT,p),"utf8");
function assess(){
 const homepage=file("index.html");
 const config=file("third_party/multica/apps/web/next.config.ts");
 const proxy=file("third_party/multica/apps/web/proxy.ts");
 const source=file("labs/taskflow/Dockerfile.web");
 const pages=file("tools/build-pages-site.js");
 const gates={
  "canonical-root-preserves-pages-origin":!(/location\.replace\(["']https:\/\/zhuge-taskflow-web\.onrender\.com/.test(homepage)),
  "full-taskflow-client-available":false,
  "next-runtime-independent":!(/output:\s*["']standalone/.test(config))&&!/NextResponse/.test(proxy),
  "pages-publisher-knows-client-bundle":pages.includes("taskflow-pages-client-dist"),
  "authenticated-api-scope-proven":false,
  "websocket-and-deeplink-proven":false,
  "docker-next-server-dependency-removed":!source.includes("apps/web/server.js"),
 };
 return {status:Object.values(gates).every(Boolean)?"READY_FOR_PM_E2E":"BLOCKED_NOT_READY",
  deploymentAllowed:false,githubAppAllowed:false,taskflowLiveDispatchAllowed:false,gates};
}
if(require.main===module){
 const report=assess();
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
 // Source-only audit is intentionally not a passing production acceptance.
 if(process.argv.includes("--require-ready")&&report.status!=="READY_FOR_PM_E2E")process.exitCode=1;
}
module.exports={assess};
