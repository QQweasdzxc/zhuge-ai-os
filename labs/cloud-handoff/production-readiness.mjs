/**
 * Read-only preparation evidence for the ONE official TaskFlow website.
 * NO provider calls, no TaskFlow writes, no persisted settings, no credentials.
 * An informational "ready for review" MUST NOT be treated as permission to dispatch.
 */
import { canDispatch, validateHandoff } from "./contract.mjs";
import { validateTaskflowIssue } from "./taskflow-bridge.mjs";

const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/;
const refuse=(code)=>({status:"BLOCKED",code,canRequestApproval:false,dispatchEnabled:false,providerRunning:false});

export async function inspectTaskflowCoReadiness({
  workspaceId,projectId,issueId,revision,loadNativeIssue,
  loadHandoff,checkGithubHead,verifyPmScope,verifyServerConfiguration
}){
  if(!GUID.test(workspaceId||"")||!GUID.test(projectId||"")||!GUID.test(issueId||"")||
    !Number.isInteger(revision)||revision<0)return refuse("INVALID_TASKFLOW_IDENTITY");
  // No browser flags can elevate privileges; all reads must be supplied by an
  // authenticated server identity bound to the exact workspace and task.
  if([loadNativeIssue,loadHandoff,checkGithubHead,verifyPmScope,verifyServerConfiguration]
    .some(fn=>typeof fn!=="function"))return refuse("SERVER_AUTHORITY_NOT_CONFIGURED");
  try{
    if(await verifyPmScope({workspaceId,projectId,issueId,revision})!==true)
      return refuse("TASKFLOW_PM_SCOPE_UNVERIFIED");
    const issue=validateTaskflowIssue(
      await loadNativeIssue({workspaceId,projectId,issueId,revision}),
      {workspaceId,projectId,issueId,revision}
    );
    const manifest=validateHandoff(await loadHandoff({workspaceId,issueId,projectId}));
    if(manifest.task.taskflow_issue_id!==issueId)
      return refuse("HANDOFF_TASKFLOW_MAPPING_MISMATCH");
    const gate=canDispatch(manifest);
    if(!gate.ready)return refuse("HANDOFF_"+String(gate.reason||"NOT_READY").replace(/[^A-Z0-9_]/gi,"_").toUpperCase().slice(0,70));
    if(!SHA.test(manifest.source.head_sha))return refuse("GITHUB_SHA_MISSING");
    if(await checkGithubHead({repository:manifest.repo,branch:manifest.source.branch,sha:manifest.source.head_sha})!==true)
      return refuse("GITHUB_HEAD_UNVERIFIED");
    const authority=await verifyServerConfiguration({workspaceId,projectId,issueId,actor:"co"});
    if(authority!==true)return refuse("SERVER_OR_PROVIDER_NOT_AUTHORIZED");
    // There is still no live provider launch or confirmed Run. A separate,
    // authorized exact-task dispatch request must pass CAS and explicit PM approval.
    return {status:"READY_FOR_PM_REVIEW",code:"PREFLIGHT_ONLY",canRequestApproval:true,
      dispatchEnabled:false,providerRunning:false,issue:issue.identifier,
      checkpointSha:manifest.source.head_sha};
  }catch{
    // Never leak TaskFlow issue contents, bearer tokens, GH response payloads,
    // or backend error details through the read-only status interface.
    return refuse("READINESS_EVIDENCE_UNAVAILABLE");
  }
}
