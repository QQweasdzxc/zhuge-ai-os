/**
 * Read-only exact-origin CORS capability probe.
 * This is NOT an authenticated E2E and does not authorize CORS changes.
 * Runs from GitHub Actions; no personal keys or privileged headers.
 */
const API="https://zhuge-taskflow-api.onrender.com";
const ORIGIN="https://qqweasdzxc.github.io";
async function probe(fetcher=fetch){
 const checks=[];
 for(const [name,path,method,requestHeaders] of [
  ["taskflow-exchange","/auth/zhuge","POST","content-type"],
  ["workspace-list","/api/workspaces","GET","authorization"],
  ["issues-with-workspace","/api/issues","GET","authorization,x-workspace-slug"],
 ]){
  try{
   const res=await fetcher(API+path,{method:"OPTIONS",redirect:"manual",
    headers:{"Origin":ORIGIN,"Access-Control-Request-Method":method,
      "Access-Control-Request-Headers":requestHeaders},
    signal:AbortSignal.timeout(15000)});
   const allow=res.headers.get("access-control-allow-origin");
   const cred=res.headers.get("access-control-allow-credentials");
   const methods=(res.headers.get("access-control-allow-methods")||"").toUpperCase();
   const headers=(res.headers.get("access-control-allow-headers")||"").toLowerCase();
   const ok=res.ok && allow===ORIGIN && methods.split(/,\s*/).includes(method)&&
     requestHeaders.split(",").every(h=>headers.split(/,\s*/).includes(h));
   checks.push({name,status:res.status,corsAllowed:ok,
    returnedOrigin:allow??null,allowedCredentials:cred??null,
    // Never print full backend headers including possible server internals.
    missingRequestedHeaders:requestHeaders.split(",").filter(h=>!headers.split(/,\s*/).includes(h))});
  }catch(e){checks.push({name,corsAllowed:false,reason:e.name==="TimeoutError"?"timeout":"network error"});}
 }
 return {origin:ORIGIN,api:API,status:checks.every(c=>c.corsAllowed)?"PREFLIGHT_PASS":"PREFLIGHT_BLOCKED",
  caveat:"Preflight only, authenticated browser E2E still required",checks};
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
 const result=await probe();
 console.log(JSON.stringify(result,null,2));
 if(process.argv.includes("--require-pass")&&result.status!=="PREFLIGHT_PASS")process.exitCode=1;
}
export {probe};
