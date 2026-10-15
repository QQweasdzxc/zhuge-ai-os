/**
 * TaskFlow-native Issue read bridge for a future authorized CLOUD dispatcher.
 * Source: TaskFlow API GET /api/issues/{uuid}/ with workspace_id.
 * No direct Supabase public schema access. No live identity configured here.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function must(ok,why){if(!ok)throw Error("taskflow bridge: "+why);}
export function validateTaskflowIssue(issue,{issueId,workspaceId,projectId,revision}){
  must(UUID.test(issueId||"")&&UUID.test(workspaceId||""),"native UUID mapping required");
  must(issue&&typeof issue==="object"&&!Array.isArray(issue),"issue response required");
  must(issue.id===issueId&&issue.workspace_id===workspaceId,"native issue/workspace mismatch");
  must(UUID.test(issue.project_id||"")&&issue.project_id===projectId,"native project mapping mismatch");
  must(Number.isInteger(issue.revision)&&issue.revision===revision,"stale native issue revision");
  must(typeof issue.identifier==="string"&&issue.identifier.length>0&&typeof issue.title==="string"&&issue.title.length>0,"incomplete native issue");
  // TaskFlow WireCategory sends built-in status keys (backlog/todo/etc)
  // or new four-category lifecycle keys. Fail CLOSED on unknown/blocked/
  // terminal values; never infer open state from an arbitrary string.
  const dispatchableCategories=new Set([
    "backlog","todo","in_progress","in_review","unstarted","started"
  ]);
  must(dispatchableCategories.has(issue.status_category),
    "unsupported, blocked or terminal TaskFlow status cannot be dispatched");
  must(typeof issue.status==="string"&&issue.status.length>0,"missing status");
  must(!issue.duplicate_of,"duplicate native task cannot launch another writer");
  return {id:issue.id,workspace_id:issue.workspace_id,project_id:issue.project_id,
    identifier:issue.identifier,status:issue.status,status_category:issue.status_category,
    revision:issue.revision,title:issue.title};
}
export function createTaskflowIssueReader({apiOrigin,accessToken,fetcher=fetch}){
  const u=new URL(apiOrigin);
  must(u.protocol==="https:"&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==="/"&&u.hostname!=="localhost","HTTPS API origin required");
  must(typeof accessToken==="string"&&accessToken.length>=12,"server-side TaskFlow bearer identity required");
  const origin=u.origin;
  return Object.freeze({
    async load({issueId,workspaceId,projectId,revision}){
      must(UUID.test(issueId||"")&&UUID.test(workspaceId||""),"invalid lookup UUID");
      const target=origin+"/api/issues/"+encodeURIComponent(issueId)+"/?workspace_id="+encodeURIComponent(workspaceId);
      const res=await fetcher(target,{method:"GET",headers:{
        Authorization:"Bearer "+accessToken,Accept:"application/json"
      },redirect:"error",signal:AbortSignal.timeout(15000)});
      must(res.status===200,"native API unavailable or access denied (HTTP "+res.status+")");
      const length=Number(res.headers?.get?.("Content-Length"));
      must(!Number.isFinite(length)||length<=131072,"response exceeds read limit");
      const raw=await res.text();
      must(raw.length<=131072,"response too large");
      let json;try{json=JSON.parse(raw);}catch{throw Error("taskflow bridge: invalid native response");}
      return validateTaskflowIssue(json,{issueId,workspaceId,projectId,revision});
    }
  });
}
export async function verifyNativeDispatch({
  snapshot,readIssue,authorizePM,workspaceId,projectId,expectedRevision
}){
  must(snapshot?.task?.taskflow_issue_id&&UUID.test(snapshot.task.taskflow_issue_id),"native mapping missing");
  must(typeof readIssue==="function"&&typeof authorizePM==="function","trusted adapters required");
  must(UUID.test(workspaceId||"")&&UUID.test(projectId||""),"workspace/project mapping missing");
  must(Number.isInteger(expectedRevision)&&expectedRevision>=0,"native revision required");
  const native=await readIssue({issueId:snapshot.task.taskflow_issue_id,workspaceId,projectId,revision:expectedRevision});
  const verified=validateTaskflowIssue(native,{
    issueId:snapshot.task.taskflow_issue_id,workspaceId,projectId,revision:expectedRevision
  });
  must((await authorizePM({issue:verified,workspaceId,projectId,task:snapshot.task.id}))===true,"PM authorization denied");
  return verified;
}
