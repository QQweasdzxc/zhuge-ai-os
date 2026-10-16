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
  readTaskflowIssue,authorizePM,verifyApprovalRef,verifyZeroAdditionalCost,approvalId,
  now,leaseId,leaseUntil,dispatchId,
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
  // Before acquiring the durable writer lease, confirm the exact, unexpired
  // PM dispatch approval. The GitHub transport independently rechecks it
  // immediately before issuing the potentially billable @codex comment.
  if (typeof verifyApprovalRef !== "function" ||
      await verifyApprovalRef({approvalId,issue:nativeIssue,task:snapshot.task.id,sha:snapshot.source.head_sha}) !== true) {
    throw Error("taskflow codex: PM dispatch approval not verified");
  }
  // Cost authority is separate from the per-task PM approval: no overage,
  // credit purchase or pay-as-you-go fallback may be inferred from a UI flag.
  if(typeof verifyZeroAdditionalCost!=="function" ||
     await verifyZeroAdditionalCost({approvalId,issue:nativeIssue,task:snapshot.task.id,
       sha:snapshot.source.head_sha,provider:"co",stage:"preclaim"})!==true){
    throw Error("taskflow codex: zero additional spend not verified");
  }
  return dispatchCloud({
    snapshot,actor:"co",now,leaseId,leaseUntil,dispatchId,
    verifyGitHead,verifyWorkerStopped,claimWithCas,
    launchProvider:async({manifest,sha,task,dispatchId:claimedDispatchId})=>{
      // Repeat the cost authorization immediately before requesting Codex.
      // If it changed after CAS, dispatchCloud quarantines the claim rather
      // than retrying or launching a second provider.
      if(await verifyZeroAdditionalCost({approvalId,issue:nativeIssue,task,
          sha,provider:"co",stage:"prelaunch"})!==true){
        throw Error("cost authority changed after claim");
      }
      return launchGithubMention({
        manifest,sha,task,approvalId,nativeIssue,githubIssue:snapshot.task.github_issue,
        dispatchId:claimedDispatchId
      });
    }
  });
}
