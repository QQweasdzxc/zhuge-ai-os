/**
 * GitHub Pages TaskFlow client — a source-only, non-deployed bridge.
 *
 * The Pages origin is the user-facing UI. The existing Render API remains the
 * *only* TaskFlow data/authorization authority. No fabricated issue, local
 * fallback, user identity or provider status is ever returned.
 *
 * This module intentionally does NOT redirect to Render and does not store
 * the exchanged TaskFlow bearer in localStorage/cookies/URL fragments.
 */
export const PAGES_CANONICAL = "https://qqweasdzxc.github.io/zhuge-ai-os/";
export const TASKFLOW_API = "https://zhuge-taskflow-api.onrender.com";
export const ZHUGE_AUTH_KEYS = Object.freeze([
  "zhuge_ai_os_google_auth_session_v1",
  "zhuge_ai_os_session_v1",
]);

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,30}-[1-9]\d*$/i;

/**
 * TaskFlow's shared CoreProvider supports a StorageAdapter. Give the
 * GitHub Pages client a fresh in-memory adapter instead of reusing its
 * localStorage-backed defaultStorage: the github.io eTLD+1 origin can host
 * other GitHub Pages paths and must NOT persist an extra TaskFlow bearer.
 * The source Zulge Google session remains managed by the existing WorkLog.
 */
export function createTaskFlowPagesMemoryStorage() {
  const entries=new Map();
  return Object.freeze({
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key,value) {
      if(typeof key!=="string"||typeof value!=="string")
        throw new TypeError("StorageAdapter accepts strings only");
      entries.set(key,value);
    },
    removeItem(key) { entries.delete(key); },
    keys() { return [...entries.keys()]; },
    clear() { entries.clear(); }
  });
}

export class TaskFlowPagesError extends Error {
  constructor(code) { super(code); this.name = "TaskFlowPagesError"; this.code = code; }
}

export function isCanonicalPagesUrl(input) {
  try {
    const url = new URL(input);
    return url.origin === new URL(PAGES_CANONICAL).origin &&
      ["/zhuge-ai-os/","/zhuge-ai-os/index.html"].includes(url.pathname);
  } catch { return false; }
}

export function readZhugeSessionToken(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  for (const key of ZHUGE_AUTH_KEYS) {
    try {
      const raw = storage.getItem(key);
      if (!raw || raw.length > 32768) continue;
      const session = JSON.parse(raw);
      if (session && typeof session.access_token === "string" &&
          session.access_token.length > 16 && session.access_token.length < 16384) {
        return session.access_token;
      }
    } catch { /* Invalid legacy session means unauthenticated, not bypass. */ }
  }
  return null;
}

/** Tests supply a substitute fetch; production always uses native browser fetch.
 * Never accept a public runtime option for the API base URL.
 */
export async function connectTaskFlowPages({storage,fetchImpl=fetch,signal}={}) {
  if(typeof fetchImpl!=="function") throw new TaskFlowPagesError("NETWORK_UNAVAILABLE");
  const zhugeToken=readZhugeSessionToken(storage);
  if(!zhugeToken)throw new TaskFlowPagesError("LOGIN_REQUIRED");
  let exchanged;
  try {
    exchanged=await fetchImpl(TASKFLOW_API+"/auth/zhuge",{
      method:"POST",mode:"cors",redirect:"error",cache:"no-store",credentials:"omit",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({access_token:zhugeToken}),signal
    });
  }catch{throw new TaskFlowPagesError("API_CORS_OR_NETWORK_UNAVAILABLE");}
  if(exchanged.status===401||exchanged.status===403)
    throw new TaskFlowPagesError("LOGIN_EXPIRED");
  if(!exchanged.ok)throw new TaskFlowPagesError("AUTH_SERVER_UNAVAILABLE");
  let exchangedBody;
  try{exchangedBody=await exchanged.json();}catch{throw new TaskFlowPagesError("INVALID_AUTH_REPLY");}
  const bearer=exchangedBody?.token;
  if(typeof bearer!=="string"||bearer.length<16||bearer.length>32768)
    throw new TaskFlowPagesError("INVALID_AUTH_REPLY");

  // Kept in this closure only; not returned, serialized or put into the URL.
  const request=async (relativePath,{workspaceSlug,signal:requestSignal}={})=>{
    if(typeof relativePath!=="string"||!relativePath.startsWith("/api/")||
      relativePath.includes("//")||relativePath.includes(".."))
      throw new TaskFlowPagesError("API_PATH_REJECTED");
    if(workspaceSlug!==undefined && !SLUG.test(workspaceSlug))
      throw new TaskFlowPagesError("INVALID_WORKSPACE");
    const url=new URL(relativePath,TASKFLOW_API);
    if(url.origin!==TASKFLOW_API||!url.pathname.startsWith("/api/"))
      throw new TaskFlowPagesError("API_ORIGIN_REJECTED");
    let reply;
    try{
      reply=await fetchImpl(url.href,{
        method:"GET",mode:"cors",redirect:"error",cache:"no-store",
        credentials:"omit",signal:requestSignal,
        headers:{Authorization:"Bearer "+bearer,Accept:"application/json",
          "X-Client-Platform":"web",
          ...(workspaceSlug?{"X-Workspace-Slug":workspaceSlug}:{})}
      });
    }catch{throw new TaskFlowPagesError("API_CORS_OR_NETWORK_UNAVAILABLE");}
    if(reply.status===401||reply.status===403)throw new TaskFlowPagesError("TASKFLOW_PERMISSION_DENIED");
    if(!reply.ok)throw new TaskFlowPagesError("TASKFLOW_DATA_UNAVAILABLE");
    try{return await reply.json();}
    catch{throw new TaskFlowPagesError("INVALID_API_REPLY");}
  };
  return Object.freeze({
    async listWorkspaces({signal:requestSignal}={}){
      const data=await request("/api/workspaces",{signal:requestSignal});
      if(!Array.isArray(data)||data.length>500||!data.every(w=>
        w && UUID.test(w.id||"")&&SLUG.test(w.slug||"")&&typeof w.name==="string"))
        throw new TaskFlowPagesError("INVALID_WORKSPACE_REPLY");
      return data.map(({id,slug,name})=>({id,slug,name}));
    },
    async listIssues({workspace,limit=50,offset=0,signal:requestSignal}={}){
      if(!workspace||!UUID.test(workspace.id||"")||!SLUG.test(workspace.slug||""))
        throw new TaskFlowPagesError("INVALID_WORKSPACE");
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||
        !Number.isSafeInteger(offset)||offset<0)throw new TaskFlowPagesError("INVALID_PAGE");
      const query=new URLSearchParams({workspace_id:workspace.id,limit:String(limit),offset:String(offset)});
      const data=await request("/api/issues?"+query.toString(),{
        workspaceSlug:workspace.slug,signal:requestSignal
      });
      if(!data || !Array.isArray(data.issues)||data.issues.length>limit||
        !Number.isSafeInteger(data.total)||data.total<0||
        !data.issues.every(issue=>issue && UUID.test(issue.id||"") &&
          IDENTIFIER.test(issue.identifier||"")&&typeof issue.title==="string"))
        throw new TaskFlowPagesError("INVALID_ISSUE_REPLY");
      return {issues:data.issues,total:data.total};
    },
    async getIssue({workspace,issueId,signal:requestSignal}={}){
      if(!workspace||!UUID.test(workspace.id||"")||!SLUG.test(workspace.slug||"")||
        !UUID.test(issueId||""))throw new TaskFlowPagesError("INVALID_ISSUE_REQUEST");
      const data=await request("/api/issues/"+issueId,{
        workspaceSlug:workspace.slug,signal:requestSignal
      });
      if(!data||data.id!==issueId||!IDENTIFIER.test(data.identifier||"")||
        typeof data.title!=="string")throw new TaskFlowPagesError("INVALID_ISSUE_REPLY");
      return data;
    },
  });
}
