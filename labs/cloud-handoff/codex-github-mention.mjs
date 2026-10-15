/**
 * GitHub @codex PR comment transport, isolated from any live provider.
 * HTTP 201 means a GitHub comment exists, NOT that Codex Cloud accepted.
 * Keep a durable claim PENDING_ACK until provider receipt reconciles.
 * Disabled by default. Server-side credentials only. No automatic retry.
 */
const GH_ID=/^[1-9][0-9]*$/;
const SHA=/^[a-f0-9]{40}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function must(ok,why){if(!ok)throw Error("codex github: "+why);}
export function previewCodexMention({
  repository,prNumber,issueNumber,sha,taskflowIdentifier,approvalId
}){
  must(REPO.test(repository||""),"repository is required");
  must(GH_ID.test(String(prNumber))&&GH_ID.test(String(issueNumber)),"PR and issue IDs required");
  must(SHA.test(sha||""),"exact Git SHA required");
  must(typeof taskflowIdentifier==="string"&&/^[A-Za-z][A-Za-z0-9_-]{1,30}-[1-9][0-9]*$/.test(taskflowIdentifier),"native TaskFlow identifier required");
  must(typeof approvalId==="string"&&/^[A-Za-z0-9_-]{16,128}$/.test(approvalId),"authenticated PM approval reference required");
  const body=[
    "@codex [Zhuge AI OS / authorized Co dispatch]",
    "TaskFlow: "+taskflowIdentifier+"; GitHub Issue #"+issueNumber+"; Draft PR #"+prNumber+".",
    "Checkpoint SHA: "+sha+".",
    "Approval reference: "+approvalId+".",
    "Please first verify the exact HEAD and instructions available from the PR context.",
    "DO NOT merge, force-push, deploy, modify Production, install secrets, or start another agent.",
    "Do not assume GitHub CLI authentication or access to the complete TaskFlow native issue.",
    "Report the actual Codex Cloud thread ID and checked SHA. If blocked, report the blocker, do not bypass it."
  ].join("\n");
  return {body,repository,prNumber,sha};
}
export function createCodexGithubMentionAdapter({
  repository,prNumber,token,writeEnabled=false,fetcher=fetch,
  approvalVerifier,liveHeadVerifier,apiBase="https://api.github.com"
}){
  must(REPO.test(repository||""),"invalid repository");
  must(GH_ID.test(String(prNumber)),"invalid PR");
  must(typeof token==="string"&&token.length>=12,"server-only GitHub token required");
  must(typeof approvalVerifier==="function"&&typeof liveHeadVerifier==="function","trusted approval/head verifier required");
  const base=new URL(apiBase);
  must(base.protocol==="https:"&&!base.username&&!base.password&&!base.search&&!base.hash,"HTTPS GitHub endpoint required");
  const endpoint=base.origin+"/repos/"+repository+"/issues/"+prNumber+"/comments";
  return async function launchCodex({manifest,sha,task,approvalId,nativeIssue,githubIssue}){
    must(writeEnabled===true,"disabled: GitHub comment dispatch requires separate live authorization");
    must(manifest?.phase==="CLAIMED"&&manifest.owner==="co"&&manifest.source.head_sha===sha,"single-writer claim required");
    must(manifest.task.id===task&&manifest.repo===repository,"task/repo mismatch");
    must(manifest.task.taskflow_issue_id===nativeIssue?.id,"TaskFlow source mapping mismatch");
    must(GH_ID.test(String(githubIssue))&&manifest.task.github_issue===githubIssue,"GitHub task mapping mismatch");
    const candidate=previewCodexMention({repository,prNumber,issueNumber:githubIssue,sha,taskflowIdentifier:nativeIssue.identifier,approvalId});
    const approval=await approvalVerifier({approvalId,issue:nativeIssue,task,prNumber,sha});
    must(approval===true,"no current PM approval for this exact dispatch");
    const head=await liveHeadVerifier({repository,prNumber,sha});
    must(head===true,"live PR head differs from authorized checkpoint");
    const res=await fetcher(endpoint,{
      method:"POST",headers:{
        Authorization:"Bearer "+token,Accept:"application/vnd.github+json",
        "Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28"
      },body:JSON.stringify({body:candidate.body}),redirect:"error",signal:AbortSignal.timeout(15000)
    });
    must(res.status===201,"GitHub comment outcome not confirmed; reconcile before retry");
    const result=await res.json();
    const expectedUrl="https://github.com/"+repository+"/pull/"+prNumber+"#issuecomment-"+result.id;
    must(Number.isInteger(result.id)&&result.id>0&&result.html_url===expectedUrl,
      "GitHub comment receipt is ambiguous; reconcile before retry");
    return {state:"PENDING_ACK",receiptId:"github-comment-"+result.id,
      commentId:result.id,commentUrl:result.html_url,providerTaskId:null};
  };
}
