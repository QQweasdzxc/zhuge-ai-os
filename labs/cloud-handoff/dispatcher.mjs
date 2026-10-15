/**
 * Cloud dispatch gate v1 — dependency injected, never contacts the Internet
 * until an authorized caller provides all four adapters.
 * Actual provider authentication/billing and TaskFlow Run integration are
 * separate release gates. This module is NOT an unattended worker.
 */
import { canDispatch, transitionHandoff } from "./contract.mjs";

export async function dispatchCloud({
  snapshot, actor, now, leaseId, leaseUntil,
  verifyGitHead, verifyWorkerStopped, claimWithCas, launchProvider
}) {
  const gate = canDispatch(snapshot);
  if (!gate.ready) throw new Error("cloud dispatch blocked: " + gate.reason);
  if (typeof verifyGitHead !== "function" || typeof verifyWorkerStopped !== "function" ||
      typeof claimWithCas !== "function" || typeof launchProvider !== "function") {
    throw new Error("cloud dispatch blocked: all trusted provider and CAS adapters required");
  }
  const verifiedHead = await verifyGitHead({
    repository: snapshot.repo,
    branch: snapshot.source.branch,
    expectedSha: snapshot.source.head_sha
  });
  if (verifiedHead !== true) throw new Error("cloud dispatch blocked: GitHub branch differs from checkpoint");
  const workerStopped = await verifyWorkerStopped({
    evidence: snapshot.source.stop_evidence,
    previousOwner: snapshot.events.at(-1)?.actor ?? null,
    task: snapshot.task.id
  });
  if (workerStopped !== true) throw new Error("cloud dispatch blocked: previous agent may still write");
  const next = transitionHandoff(snapshot, {
    action: "claim", actor, expected_revision: snapshot.revision, at: now,
    lease_id: leaseId, lease_until: leaseUntil,
    verified_git_sha: snapshot.source.head_sha
  });
  // compare-and-swap must be against durable GitHub/TaskFlow state, never
  // a process-local lock; stale CAS must prevent provider execution.
  const claimed = await claimWithCas({
    task: snapshot.task.id, expectedRevision: snapshot.revision,
    expectedSha: snapshot.source.head_sha, next
  });
  if (claimed?.committed !== true || claimed?.revision !== next.revision) {
    throw new Error("cloud dispatch blocked: atomic ownership claim not confirmed");
  }
  try {
    const run = await launchProvider({
      actor, manifest: next, branch: snapshot.source.branch,
      sha: snapshot.source.head_sha, task: snapshot.task.id
    });
    // GitHub comment creation is a dispatch RECEIPT, not a Codex Cloud ACK.
    // Keep the CLAIMED lease and wait for trustworthy provider reconciliation.
    if (run?.state === "PENDING_ACK" &&
        typeof run.receiptId === "string" && /^github-comment-[1-9][0-9]*$/.test(run.receiptId) &&
        Number.isInteger(run.commentId) && run.commentId > 0 && run.providerTaskId === null) {
      return { state: "PENDING_PROVIDER_ACK", dispatchReceipt: run.receiptId,
        claimedRevision: next.revision };
    }
    if (typeof run?.runId !== "string" || !run.runId) {
      throw new Error("provider did not return a run id");
    }
    return { state: "LAUNCHED", runId: run.runId, claimedRevision: next.revision };
  } catch {
    // Unknown launch outcome. Never release the durable lease and start
    // a second runner. A reconciler must query the provider and quarantine.
    throw new Error("cloud dispatch needs reconciliation: ownership remains claimed; do not auto-retry");
  }
}
