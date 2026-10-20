export const NATIVE_PERSISTENCE_ADAPTER_VERSION = "1.0";

/**
 * The adapter deliberately names existing TaskFlow authority instead of
 * introducing a dispatch table. The concrete SQL is owned by the native
 * repository layer; the build candidate must provide the two row locks in
 * this order inside one database transaction.
 */
export const NATIVE_ROW_LOCK_CONTRACT = Object.freeze({
  storage: "existing_taskflow_native_issue_and_agent_task_queue",
  issue_lock: "native issue row FOR UPDATE",
  task_lock: "native agent_task_queue row FOR UPDATE",
  lock_order: ["issue", "agent_task_queue"],
  write_boundary: "same transaction as the row locks",
  forbidden: ["new dispatch task table", "client-side authorization", "provider_run_id synthesis"]
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function blocked(reason, detail = "") {
  return {
    accepted: false,
    committed: false,
    state: "BLOCKED",
    reason,
    detail,
    storage: NATIVE_ROW_LOCK_CONTRACT.storage
  };
}

function transactionMethodsAvailable(tx) {
  return tx && ["lockIssue", "lockTask", "readRecord", "writeRecord", "commit", "rollback"]
    .every(method => typeof tx[method] === "function");
}

async function rollbackQuietly(tx) {
  if (!tx || typeof tx.rollback !== "function") return;
  try {
    await tx.rollback();
  } catch {
    // The original mutation failure is the evidence the caller needs. A
    // rollback failure remains a deployment/DB alert, never a success state.
  }
}

/**
 * Create a candidate adapter around TaskFlow's existing transaction layer.
 * No database client is imported here: the real handler injects the native
 * transaction implementation, while Review tests inject a lock-aware fake.
 */
export function createNativePersistenceAdapter({beginTransaction} = {}) {
  const configured = typeof beginTransaction === "function";

  async function runAtomicMutation({
    issueId,
    taskId = "",
    idempotencyKey,
    event,
    mutate
  } = {}) {
    if (!configured) return blocked("NATIVE_ROW_LOCK_ADAPTER_UNVERIFIED");
    if (!text(issueId) || !text(idempotencyKey)) return blocked("NATIVE_TASK_IDENTITY_MISSING");
    if (!Number.isInteger(event?.expected_version)) return blocked("EXPECTED_VERSION_REQUIRED");
    if (typeof mutate !== "function") return blocked("MUTATION_REDUCER_REQUIRED");

    let tx;
    try {
      tx = await beginTransaction({
        issue_id: text(issueId),
        task_id: text(taskId) || null,
        lock_contract: NATIVE_ROW_LOCK_CONTRACT
      });
      if (!transactionMethodsAvailable(tx)) {
        await rollbackQuietly(tx);
        return blocked("NATIVE_TRANSACTION_INTERFACE_INVALID");
      }

      // Every mutation locks the native issue first, then its task queue row.
      // This fixed order is part of the cross-process deadlock contract.
      await tx.lockIssue(text(issueId));
      if (text(taskId)) await tx.lockTask(text(taskId));

      const current = await tx.readRecord({issueId: text(issueId), taskId: text(taskId) || null});
      if (!current) {
        await rollbackQuietly(tx);
        return blocked("NATIVE_DISPATCH_RECORD_NOT_FOUND");
      }
      if (text(current.idempotency_key) !== text(idempotencyKey)) {
        await rollbackQuietly(tx);
        return blocked("IDEMPOTENCY_KEY_MISMATCH");
      }
      if (current.version !== event.expected_version) {
        await rollbackQuietly(tx);
        return blocked("PERSISTED_VERSION_CONFLICT");
      }

      const result = await mutate(current, event);
      if (!result || !result.record) {
        await rollbackQuietly(tx);
        return blocked("MUTATION_RESULT_INVALID");
      }

      // A replay is already represented by the existing event history. Do
      // not write a second record or advance a writer on that path.
      if (result.reason !== "EVENT_REPLAY") await tx.writeRecord(result.record);
      await tx.commit();
      return {
        ...result,
        committed: true,
        storage: NATIVE_ROW_LOCK_CONTRACT.storage,
        lock_contract: NATIVE_ROW_LOCK_CONTRACT
      };
    } catch (error) {
      await rollbackQuietly(tx);
      return blocked("NATIVE_TRANSACTION_ROLLBACK", error instanceof Error ? error.message : String(error));
    }
  }

  return Object.freeze({
    version: NATIVE_PERSISTENCE_ADAPTER_VERSION,
    contract: NATIVE_ROW_LOCK_CONTRACT,
    configured,
    runAtomicMutation
  });
}
