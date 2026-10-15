/**
 * Test-only / future cloud coordinator TaskFlow→GitHub→Codex slice.
 *
 * This wrapper deliberately keeps native TaskFlow membership/project
 * authorization in TaskFlow and writer CAS in the cloud-handoff ledger.
 * Neither can be inferred from a GitHub @codex mention or browser UI.
 *
 * No live TF auth, GitHub token, app secret, or provider task is configured.
 */
import { verifyNativeDispatch } from "./taskflow-bridge.mjs";
import { dispatchCloud } from "./dispatcher.mjs";

export async function dispatchTaskflowCodex({
  snapshot,workspaceId,projectId,expectedTaskflowRevision,
  readTaskflowIssue,authorizePM,approvalId,
  now,leaseId,leaseUntil,
  verifyGitHead,verifyWorkerStopped,claimWithCas,
  launchGithubMention
}){
  if(snapshot?.next_actor!=="co")throw Error("taskflow codex: task is not assigned to Co");
  if(typeof approvalId!=="string"||!/^[A-Za-z0-9_-]{16,128}$/.test(approvalId))throw Error("taskflow codex: approved request reference required");
  if(typeof launchGithubMention!=="function")throw Error("taskflow codex: authorized GitHub transport missing");
  const nativeIssue=await verifyNativeDispatch({
    snapshot,workspaceId,projectId,expectedRevision:expectedTaskflowRevision,
    readIssue:readTaskflowIssue,authorizePM
  });
  return dispatchCloud({
    snapshot,actor:"co",now,leaseId,leaseUntil,
    verifyGitHead,verifyWorkerStopped,claimWithCas,
    launchProvider:({manifest,sha,task})=>launchGithubMention({
      manifest,sha,task,approvalId,nativeIssue,githubIssue:snapshot.task.github_issue
    })
  });
}
