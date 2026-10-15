/**
 * TaskFlow AI engineering v1: review-only, fail-closed gate.
 * Pure policy; NO provider, TaskFlow native API, credential, or GitHub writes.
 * This source is a separately reconstructed implementation of #51's approved
 * specification; the cloud-only f9963d7 commit was NOT retrieved.
 */
export type Engineer = "co" | "gem";
export type QuotaEvidence = "available" | "exhausted" | "unknown";
export type AIExecutionInput = {
  projectEnabled: boolean;
  cardEnabled: boolean;
  engineer: Engineer;
  pmApproved: boolean;
  nativeMemberAuthorized: boolean;
  correctWorkspace: boolean;
  nativeRunApiReady: boolean;
  backendServiceIdentityReady: boolean;
  providerVerified: boolean;
  providerQuota: QuotaEvidence;
  branchHeadVerified: boolean;
  exactSha: string | null;
  writerStopped: boolean;
  durableClaimCommitted: boolean;
};
export type AIExecutionResult = {
  state: "NOT_ENABLED" | "NEEDS_PM_APPROVAL" | "BLOCKED" | "DISPATCH_PENDING";
  reason: string;
  engineer: Engineer;
};
const SHA = /^[0-9a-f]{40}$/;
export function evaluateAIExecution(x: AIExecutionInput): AIExecutionResult {
  const block = (state: AIExecutionResult["state"], reason: string): AIExecutionResult =>
    ({state, reason, engineer: x.engineer});
  if (!x.projectEnabled || !x.cardEnabled) return block("NOT_ENABLED", "project_and_card_opt_in_required");
  if (x.engineer !== "co" && x.engineer !== "gem") return block("BLOCKED", "unknown_engineer");
  if (!x.nativeMemberAuthorized || !x.correctWorkspace) return block("BLOCKED", "native_permission_denied");
  if (!x.pmApproved) return block("NEEDS_PM_APPROVAL", "exact_task_pm_approval_required");
  if (!x.nativeRunApiReady || !x.backendServiceIdentityReady) return block("BLOCKED", "native_run_authority_missing");
  if (!x.providerVerified) return block("BLOCKED", "provider_unverified");
  if (x.providerQuota !== "available") return block("BLOCKED", "quota_not_verified_available");
  if (!SHA.test(x.exactSha ?? "") || !x.branchHeadVerified) return block("BLOCKED", "github_checkpoint_unverified");
  if (!x.writerStopped || !x.durableClaimCommitted) return block("BLOCKED", "single_writer_unverified");
  // This evaluator does NOT invoke anything. HTTP 201 / bot text is NOT RUNNING.
  return block("DISPATCH_PENDING", "all_gates_verified_no_execution_performed");
}
export const AI_PREVIEW_ONLY = true as const;
export const DEFAULT_ENGINEER: Engineer = "co";
