/**
 * Server-only Co/Codex bridge onto the EXISTING cloud-handoff module.
 * No credentials, network, PR comments or automatic provider fallback here.
 * This bridge never manufactures a verified Provider ACK from a GitHub receipt.
 */
import { dispatchTaskflowCodex } from "./taskflow-codex-dispatch.mjs";

// Until the trusted TaskFlow service provides both verifiers, deny all runs.
export const verifyApprovalRefUnconfigured = async () => false;
export const verifyZeroAdditionalCostUnconfigured = async () => false;

export function createTaskflowCodexHandoffBridge({
  verifyApprovalRef = verifyApprovalRefUnconfigured,
  verifyZeroAdditionalCost = verifyZeroAdditionalCostUnconfigured,
  launchGithubMention = null
} = {}) {
  return Object.freeze({
    async dispatch(envelope) {
      // Never accept verifiers supplied in request/envelope/UI JSON.
      const result = await dispatchTaskflowCodex({
        ...envelope,
        verifyApprovalRef,
        verifyZeroAdditionalCost,
        // The GitHub @codex transport itself is independently disabled until
        // separate PR permission and checkpoint approval are verified.
        launchGithubMention
      });
      if (result?.state !== "PENDING_PROVIDER_ACK") {
        throw new Error("cloud handoff: official provider ACK is not configured");
      }
      return Object.freeze({
        state: "PENDING_ACK",
        receiptId: result.dispatchReceipt,
        dispatchId: result.dispatchId,
        verifiedRunId: null,
        verifiedAckEventId: null
      });
    }
  });
}
