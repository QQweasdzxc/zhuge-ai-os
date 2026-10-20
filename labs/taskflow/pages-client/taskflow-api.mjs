/**
 * TaskFlow Pages-native authenticated transport POC (NO PROD DEPLOY).
 * Uses the existing trusted Render API and the user's preexisting Zhuge
 * session on the GitHub Pages origin. No API secrets in the Pages bundle.
 * The TaskFlow bearer stays in JS memory and is never written to a URL,
 * a cookie, IndexedDB, or localStorage.
 */
export const OFFICIAL_API = "https://zhuge-taskflow-api.onrender.com";
export const OFFICIAL_PAGES_ORIGIN = "https://qqweasdzxc.github.io";
const TOKEN_KEY = "zhuge_ai_os_google_auth_session_v1";
const SECONDARY_KEY = "zhuge_ai_os_session_v1";

export class TaskFlowPagesError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = "TaskFlowPagesError";
    this.code = code;
    this.status = status;
  }
}
export function readZhugeAccessToken(store) {
  for (const key of [TOKEN_KEY, SECONDARY_KEY]) {
    try {
      const record = JSON.parse(store?.getItem(key) ?? "null");
      if (typeof record?.access_token === "string" && record.access_token.length) {
        return record.access_token;
      }
    } catch { /* invalid/old session is treated as absent */ }
  }
  return null;
}
export function createTaskFlowPagesTransport({
  fetcher = fetch,
  apiBase = OFFICIAL_API,
  getAccessToken,
  origin = OFFICIAL_PAGES_ORIGIN,
} = {}) {
  const base = new URL(apiBase);
  if (base.origin !== OFFICIAL_API || base.pathname !== "/" || base.search || base.hash) {
    throw new TaskFlowPagesError("Only the approved TaskFlow API origin is allowed", "INVALID_API_ORIGIN");
  }
  if (origin !== OFFICIAL_PAGES_ORIGIN) {
    throw new TaskFlowPagesError("Unknown Pages caller origin", "INVALID_PAGES_ORIGIN");
  }
  if (typeof getAccessToken !== "function") {
    throw new TaskFlowPagesError("Zhuge session source unavailable", "MISSING_AUTH_SOURCE");
  }
  let bearer = null;
  async function jsonFetch(url, options = {}) {
    let reply;
    try {
      reply = await fetcher(url, {...options,mode:"cors",credentials:"omit",redirect:"error"});
    } catch (cause) {
      throw new TaskFlowPagesError("TaskFlow API unavailable or Pages origin CORS not authorized", "NETWORK_OR_CORS");
    }
    if (reply.status === 401 || reply.status === 403) {
      throw new TaskFlowPagesError("Your session is invalid or workspace access was denied", reply.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",reply.status);
    }
    if (!reply.ok) {
      throw new TaskFlowPagesError("TaskFlow API returned HTTP "+reply.status,"HTTP_ERROR",reply.status);
    }
    if (reply.status === 204) return null;
    try { return await reply.json(); }
    catch { throw new TaskFlowPagesError("TaskFlow response was not valid JSON", "INVALID_RESPONSE",reply.status); }
  }
  function requiredSlug(slug) {
    if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
      throw new TaskFlowPagesError("Valid workspace slug required", "INVALID_WORKSPACE");
    }
    return slug;
  }
  function requiredId(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
      throw new TaskFlowPagesError("Valid TaskFlow identifier required", "INVALID_IDENTIFIER");
    }
    return id;
  }
  async function connect() {
    const zhugeToken = getAccessToken();
    if (!zhugeToken) throw new TaskFlowPagesError("Sign in to Zhuge AI OS first","SIGN_IN_REQUIRED");
    // Existing /auth/zhuge endpoint validates Zhuge identity server-side.
    const value = await jsonFetch(OFFICIAL_API+"/auth/zhuge",{
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({access_token:zhugeToken})
    });
    if (typeof value?.token !== "string" || value.token.length < 10) {
      throw new TaskFlowPagesError("TaskFlow identity response was invalid","INVALID_AUTH_RESPONSE");
    }
    bearer=value.token;
    return true;
  }
  function disconnect(){bearer=null;}
  async function api(path,{workspace,method="GET",body,signal}={}) {
    if(!bearer)throw new TaskFlowPagesError("TaskFlow identity not connected","AUTH_REQUIRED");
    if(typeof path!=="string"||!path.startsWith("/api/")||path.startsWith("//")||path.includes("..")){
      throw new TaskFlowPagesError("Only TaskFlow API paths may be called","INVALID_API_PATH");
    }
    const headers={"Authorization":"Bearer "+bearer,"Accept":"application/json"};
    if(workspace)headers["X-Workspace-Slug"]=requiredSlug(workspace);
    if(body!==undefined)headers["Content-Type"]="application/json";
    try {
      return await jsonFetch(OFFICIAL_API+path,{
        method,headers,
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        ...(signal?{signal}:{})
      });
    }catch(error){
      if(error.code==="UNAUTHORIZED")disconnect();
      throw error;
    }
  }
  return Object.freeze({
    connect,disconnect,
    listWorkspaces:()=>api("/api/workspaces"),
    listIssues:(workspace,{limit=50,offset=0,query=""}={})=>{
      requiredSlug(workspace);
      const search=new URLSearchParams({limit:String(Math.min(100,Math.max(1,limit))),offset:String(Math.max(0,offset))});
      if(query)search.set("q",query.trim().slice(0,200));
      return api("/api/issues?"+search.toString(),{workspace});
    },
    getIssue:(workspace,id)=>api("/api/issues/"+encodeURIComponent(requiredId(id)),{workspace}),
    listProjects:(workspace)=>api("/api/projects",{workspace}),
    listStatuses:(workspace)=>api("/api/issue-statuses",{workspace}),
    listComments:(workspace,id)=>api("/api/issues/"+encodeURIComponent(requiredId(id))+"/comments",{workspace}),
    listTaskRuns:(workspace,id,{active=false}={})=>api("/api/issues/"+encodeURIComponent(requiredId(id))+"/task-runs?active="+(active?"true":"false"),{workspace}),
    listPullRequests:(workspace,id)=>api("/api/issues/"+encodeURIComponent(requiredId(id))+"/pull-requests",{workspace}),
    connected:()=>Boolean(bearer)
  });
}
