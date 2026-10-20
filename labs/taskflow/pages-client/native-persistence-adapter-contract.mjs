export const NATIVE_PERSISTENCE_ADAPTER_VERSION = "1.0";

export const NATIVE_TRANSACTION_AUDIT_CONTRACT = Object.freeze({
  version: "1.0",
  persisted_record: "native_taskflow_record.audit_log",
  review_sink: "injected_only_for_review_and_observability",
  requirement: "precondition_rejections_and_rollbacks_must_remain_traceable"
});

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

function auditFromRecord(record, event, outcome = "RECORDED_IN_NATIVE_RECORD") {
  const eventId = text(event?.event_id);
  const persisted = Array.isArray(record?.audit_log)
    && eventId
    && record.audit_log.some(entry => text(entry?.event_id) === eventId);
  return {
    state: persisted ? outcome : "UNVERIFIED",
    event_id: eventId || null,
    contract: NATIVE_TRANSACTION_AUDIT_CONTRACT
  };
}

async function emitReviewAudit(auditSink, entry) {
  if (typeof auditSink !== "function") {
    return {state: "UNVERIFIED", event_id: entry.event_id || null, contract: NATIVE_TRANSACTION_AUDIT_CONTRACT};
  }
  try {
    await auditSink({...entry});
    return {state: "REVIEW_SINK_RECORDED", event_id: entry.event_id || null, contract: NATIVE_TRANSACTION_AUDIT_CONTRACT};
  } catch (error) {
    return {
      state: "UNVERIFIED",
      event_id: entry.event_id || null,
      error: error instanceof Error ? error.message : String(error),
      contract: NATIVE_TRANSACTION_AUDIT_CONTRACT
    };
  }
}

async function blockedWithAudit(reason, detail, event, auditSink, extra = {}) {
  const audit = await emitReviewAudit(auditSink, {
    event_id: text(event?.event_id) || null,
    type: text(event?.type) || "UNKNOWN",
    outcome: "REJECTED",
    reason,
    ...extra
  });
  return {...blocked(reason, detail), audit};
}

function mutationContractError(current, result, event) {
  if (!result || !result.record) return "MUTATION_RESULT_INVALID";
  const next = result.record;
  for (const key of ["schema", "intent_id", "idempotency_key", "workspace", "issue_id", "work_code", "executor_id", "provider"]) {
    if (next[key] !== current[key]) return `MUTATION_${key.toUpperCase()}_MISMATCH`;
  }
  if (!Number.isInteger(next.version) || next.version < current.version) return "MUTATION_VERSION_INVALID";
  if (!Number.isInteger(next.fencing_epoch) || next.fencing_epoch < current.fencing_epoch) return "FENCING_EPOCH_REGRESSION";
  if (result.reason === "EVENT_REPLAY") {
    return next.version === current.version ? null : "REPLAY_VERSION_ADVANCED";
  }
  if (next.version !== current.version + 1) return "MUTATION_VERSION_NOT_ADVANCED_ONCE";
  if (current.lease_active && (next.writer_id !== current.writer_id || next.fencing_token !== current.fencing_token)) {
    return "WRITER_LEASE_MUTATION_UNAUTHORIZED";
  }
  if (!current.lease_active && text(event?.type) !== "LEASE_ACQUIRED"
      && (next.writer_id !== current.writer_id || next.fencing_token !== current.fencing_token)) {
    return "WRITER_FENCING_MUTATION_UNAUTHORIZED";
  }
  return null;
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
export function createNativePersistenceAdapter({beginTransaction, auditSink} = {}) {
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
        return blockedWithAudit("NATIVE_TRANSACTION_INTERFACE_INVALID", "", event, auditSink);
      }

      // Every mutation locks the native issue first, then its task queue row.
      // This fixed order is part of the cross-process deadlock contract.
      await tx.lockIssue(text(issueId));
      if (text(taskId)) await tx.lockTask(text(taskId));

      const current = await tx.readRecord({issueId: text(issueId), taskId: text(taskId) || null});
      if (!current) {
        await rollbackQuietly(tx);
        return blockedWithAudit("NATIVE_DISPATCH_RECORD_NOT_FOUND", "", event, auditSink);
      }
      if (text(current.idempotency_key) !== text(idempotencyKey)) {
        await rollbackQuietly(tx);
        return blockedWithAudit("IDEMPOTENCY_KEY_MISMATCH", "", event, auditSink, {issue_id: text(issueId)});
      }
      if (current.version !== event.expected_version) {
        await rollbackQuietly(tx);
        return blockedWithAudit("PERSISTED_VERSION_CONFLICT", "", event, auditSink, {
          issue_id: text(issueId),
          expected_version: event.expected_version,
          observed_version: current.version
        });
      }

      const result = await mutate(current, event);
      const contractError = mutationContractError(current, result, event);
      if (contractError) {
        await rollbackQuietly(tx);
        return blockedWithAudit(contractError, "", event, auditSink, {issue_id: text(issueId)});
      }

      // A replay is already represented by the existing event history. Do
      // not write a second record or advance a writer on that path.
      if (result.reason !== "EVENT_REPLAY") await tx.writeRecord(result.record);
      await tx.commit();
      return {
        ...result,
        committed: true,
        storage: NATIVE_ROW_LOCK_CONTRACT.storage,
        lock_contract: NATIVE_ROW_LOCK_CONTRACT,
        transaction_evidence: {
          issue_locked: true,
          task_locked: Boolean(text(taskId)),
          expected_version: event.expected_version,
          observed_version: current.version,
          write: result.reason === "EVENT_REPLAY" ? "REPLAY_NO_WRITE" : "NATIVE_RECORD_WRITE",
          audit: auditFromRecord(result.record, event, result.reason === "EVENT_REPLAY" ? "ALREADY_RECORDED_IN_NATIVE_RECORD" : "RECORDED_IN_NATIVE_RECORD")
        }
      };
    } catch (error) {
      await rollbackQuietly(tx);
      return {
        ...await blockedWithAudit("NATIVE_TRANSACTION_ROLLBACK", error instanceof Error ? error.message : String(error), event, auditSink, {issue_id: text(issueId)}),
        transaction_evidence: {issue_locked: Boolean(tx), task_locked: Boolean(text(taskId)), write: "ROLLED_BACK"}
      };
    }
  }

  return Object.freeze({
    version: NATIVE_PERSISTENCE_ADAPTER_VERSION,
    contract: NATIVE_ROW_LOCK_CONTRACT,
    audit_contract: NATIVE_TRANSACTION_AUDIT_CONTRACT,
    configured,
    runAtomicMutation
  });
}
