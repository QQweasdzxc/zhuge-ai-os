/**
 * Read-only contract between an authenticated TaskFlow Run read model and the
 * pixel-office cast. This module deliberately performs no network request and
 * is not wired into the live Habblaud snapshot until the TaskFlow/provider
 * event gate is verified.
 *
 * A payload flag is not an authentication boundary. A future gateway must
 * authenticate the Zhuge session, authorize the run read, and construct this
 * contract server-side. Static status JSON, GitHub Issues/PRs, and fixtures are
 * never sufficient evidence of a live run.
 */

export type TaskFlowContributor = 'gpt' | 'co' | 'gem';
export type TaskFlowProvider = 'openai-gpt' | 'openai-codex' | 'google-gemini';
export type TaskFlowRunPhase =
  | 'queued'
  | 'dispatched'
  | 'provider_acked'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export interface TaskFlowProviderAck {
  status: 'accepted';
  provider: TaskFlowProvider;
  contributor: TaskFlowContributor;
  taskId: string;
  runId: string;
  providerRunId: string;
  acknowledgedAt: string;
}

export interface TaskFlowRunReadEvent {
  schema: 'zhuge-taskflow-run-read-v1';
  contributor: TaskFlowContributor;
  provider: TaskFlowProvider;
  taskId: string;
  runId: string;
  retryOfRunId?: string;
  attempt: number;
  sequence: number;
  phase: TaskFlowRunPhase;
  createdAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  approval: {
    state: 'pm_approved';
    approvalId: string;
    approvedAt: string;
  };
  providerAck?: TaskFlowProviderAck;
  provenance: {
    kind: 'authenticated-taskflow-read-only';
    sessionAuthenticated: true;
    readOnly: true;
    requestId: string;
    observedAt: string;
  };
}

export type PixelRunState = 'unknown' | 'waiting' | 'working' | 'done' | 'blocked';
export type PixelRunReason =
  | 'NO_EVENT'
  | 'INVALID_EVENT'
  | 'SIMULATED_OR_UNAUTHENTICATED_SOURCE'
  | 'ROLE_PROVIDER_MISMATCH'
  | 'PM_APPROVAL_REQUIRED'
  | 'PROVIDER_ACK_REQUIRED'
  | 'PROVIDER_ACK_MISMATCH'
  | 'STALE_EVENT'
  | 'FUTURE_TIMESTAMP'
  | 'RUN_CONFLICT'
  | 'OUT_OF_ORDER_IGNORED'
  | 'NO_LEGAL_WORK_PATH'
  | 'CANCELLED';

export interface PixelRunObservation {
  state: PixelRunState;
  contributor: TaskFlowContributor;
  taskId?: string;
  runId?: string;
  attempt?: number;
  sequence?: number;
  phase?: TaskFlowRunPhase;
  observedAt?: number;
  reason: PixelRunReason;
  /** Identifies the future authenticated read model, never a secret/session token. */
  source?: 'authenticated-taskflow-read-only';
}

export interface RunStateMachine {
  observe(input: unknown, context?: { now?: number; workSpotReachable?: boolean }): PixelRunObservation;
  current(): PixelRunObservation;
}

const EXPECTED_PROVIDER: Record<TaskFlowContributor, TaskFlowProvider> = {
  gpt: 'openai-gpt',
  co: 'openai-codex',
  gem: 'google-gemini',
};

const ACTIVE_TTL_MS = 60_000;
const TERMINAL_TTL_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 30_000;

function unknown(contributor: TaskFlowContributor, reason: PixelRunReason): PixelRunObservation {
  return { state: 'unknown', contributor, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function acceptedAckMatches(event: TaskFlowRunReadEvent): boolean {
  const ack = event.providerAck;
  return !!ack && ack.status === 'accepted' &&
    ack.provider === event.provider && ack.contributor === event.contributor &&
    ack.taskId === event.taskId && ack.runId === event.runId &&
    validId(ack.providerRunId) && timestamp(ack.acknowledgedAt) !== null;
}

/**
 * Validate a TaskFlow Run read event and reduce it to a display-safe state.
 * The caller must obtain `input` from a same-origin, authenticated, read-only
 * TaskFlow gateway; these structural checks do not authenticate a client.
 */
export function readTaskFlowRunStatus(
  input: unknown,
  expectedContributor: TaskFlowContributor,
  now = Date.now(),
): PixelRunObservation {
  if (!isRecord(input) || input.schema !== 'zhuge-taskflow-run-read-v1') {
    return unknown(expectedContributor, 'INVALID_EVENT');
  }
  const provenance = input.provenance;
  if (!isRecord(provenance) || provenance.kind !== 'authenticated-taskflow-read-only' ||
      provenance.sessionAuthenticated !== true || provenance.readOnly !== true ||
      !validId(provenance.requestId)) {
    return unknown(expectedContributor, 'SIMULATED_OR_UNAUTHENTICATED_SOURCE');
  }
  const observedAt = timestamp(provenance.observedAt);
  const updatedAt = timestamp(input.updatedAt);
  const createdAt = timestamp(input.createdAt);
  if (observedAt === null || updatedAt === null || createdAt === null) {
    return unknown(expectedContributor, 'INVALID_EVENT');
  }
  if (observedAt > now + FUTURE_SKEW_MS || updatedAt > now + FUTURE_SKEW_MS || createdAt > now + FUTURE_SKEW_MS) {
    return unknown(expectedContributor, 'FUTURE_TIMESTAMP');
  }
  if (!validId(input.taskId) || !validId(input.runId) ||
      !(typeof input.sequence === 'number' && Number.isSafeInteger(input.sequence) && input.sequence > 0) ||
      !(typeof input.attempt === 'number' && Number.isSafeInteger(input.attempt) && input.attempt > 0)) {
    return unknown(expectedContributor, 'INVALID_EVENT');
  }
  if (input.contributor !== expectedContributor ||
      input.provider !== EXPECTED_PROVIDER[expectedContributor]) {
    return unknown(expectedContributor, 'ROLE_PROVIDER_MISMATCH');
  }
  const approval = input.approval;
  if (!isRecord(approval) || approval.state !== 'pm_approved' ||
      !validId(approval.approvalId) || timestamp(approval.approvedAt) === null) {
    return unknown(expectedContributor, 'PM_APPROVAL_REQUIRED');
  }
  const approvedAt = timestamp(approval.approvedAt);
  if (approvedAt === null || approvedAt > createdAt || updatedAt < createdAt || observedAt + FUTURE_SKEW_MS < updatedAt) {
    return unknown(expectedContributor, 'INVALID_EVENT');
  }
  if ((input.attempt as number) > 1 && (!validId(input.retryOfRunId) || input.retryOfRunId === input.runId)) {
    return unknown(expectedContributor, 'INVALID_EVENT');
  }
  if (input.attempt === 1 && input.retryOfRunId !== undefined) return unknown(expectedContributor, 'INVALID_EVENT');
  const phases: TaskFlowRunPhase[] = [
    'queued', 'dispatched', 'provider_acked', 'running', 'retrying', 'succeeded', 'blocked', 'failed', 'cancelled',
  ];
  if (!phases.includes(input.phase as TaskFlowRunPhase)) return unknown(expectedContributor, 'INVALID_EVENT');

  const phase = input.phase as TaskFlowRunPhase;
  const requiresAck = phase === 'provider_acked' || phase === 'running' || phase === 'succeeded';
  if (requiresAck && !input.providerAck) return unknown(expectedContributor, 'PROVIDER_ACK_REQUIRED');
  if (input.providerAck !== undefined && !acceptedAckMatches(input as unknown as TaskFlowRunReadEvent)) {
    return unknown(expectedContributor, 'PROVIDER_ACK_MISMATCH');
  }
  if (phase === 'running' && timestamp(input.heartbeatAt) === null) {
    return unknown(expectedContributor, 'STALE_EVENT');
  }
  const ackAt = isRecord(input.providerAck) ? timestamp(input.providerAck.acknowledgedAt) : null;
  if (ackAt !== null && (ackAt > now + FUTURE_SKEW_MS || ackAt < createdAt || ackAt > updatedAt + FUTURE_SKEW_MS)) {
    return unknown(expectedContributor, 'FUTURE_TIMESTAMP');
  }
  const heartbeatAt = timestamp(input.heartbeatAt);
  if (heartbeatAt !== null && heartbeatAt > now + FUTURE_SKEW_MS) return unknown(expectedContributor, 'FUTURE_TIMESTAMP');

  const freshnessAnchor = phase === 'running' ? heartbeatAt : updatedAt;
  const ttl = phase === 'running' || phase === 'provider_acked' ? ACTIVE_TTL_MS : TERMINAL_TTL_MS;
  if (freshnessAnchor === null || now - freshnessAnchor > ttl) return unknown(expectedContributor, 'STALE_EVENT');
  if (now - observedAt > ACTIVE_TTL_MS) return unknown(expectedContributor, 'STALE_EVENT');

  let state: PixelRunState;
  let reason: PixelRunReason = 'NO_EVENT';
  switch (phase) {
    case 'queued':
    case 'dispatched':
    case 'retrying':
      state = 'waiting';
      break;
    case 'provider_acked':
      state = 'waiting';
      break;
    case 'running':
      state = 'working';
      break;
    case 'succeeded':
      state = 'done';
      break;
    case 'blocked':
    case 'failed':
      state = 'blocked';
      break;
    case 'cancelled':
      state = 'unknown';
      reason = 'CANCELLED';
      break;
  }
  return {
    state,
    contributor: expectedContributor,
    taskId: input.taskId,
    runId: input.runId,
    attempt: input.attempt as number,
    sequence: input.sequence as number,
    phase,
    observedAt,
    reason,
    source: 'authenticated-taskflow-read-only',
  };
}

/**
 * Per-character, read-only transition guard. It rejects out-of-order updates,
 * overlapping runs, actor changes, and retries that reuse a Run ID.
 */
export function createTaskFlowRunStateMachine(contributor: TaskFlowContributor): RunStateMachine {
  let currentState = unknown(contributor, 'NO_EVENT');
  return {
    current: () => ({ ...currentState }),
    observe(input: unknown, context = {}): PixelRunObservation {
      const now = context.now ?? Date.now();
      const next = readTaskFlowRunStatus(input, contributor, now);
      if (next.state === 'unknown') {
        currentState = next;
        return { ...next };
      }
      if (next.state === 'working' && context.workSpotReachable !== true) {
        currentState = unknown(contributor, 'NO_LEGAL_WORK_PATH');
        return { ...currentState };
      }
      const prev = currentState;
      if (prev.state !== 'unknown' && prev.runId && next.runId === prev.runId) {
        if ((next.sequence ?? 0) < (prev.sequence ?? 0) || (next.observedAt ?? 0) < (prev.observedAt ?? 0)) {
          return { ...prev, reason: 'OUT_OF_ORDER_IGNORED' };
        }
        if (next.sequence === prev.sequence) return { ...prev };
        if (!isAllowedRunTransition(prev.phase, next.phase)) {
          currentState = unknown(contributor, 'RUN_CONFLICT');
          return { ...currentState };
        }
      } else if (prev.state === 'working' || prev.state === 'waiting') {
        const retryTransition = prev.phase === 'retrying' && next.taskId === prev.taskId &&
          next.attempt === (prev.attempt ?? 0) + 1 &&
          (input as TaskFlowRunReadEvent).retryOfRunId === prev.runId;
        if (!retryTransition) {
          currentState = unknown(contributor, 'RUN_CONFLICT');
          return { ...currentState };
        }
      } else if (prev.runId && next.runId !== prev.runId && next.taskId === prev.taskId && prev.attempt !== undefined) {
        const validRetry = next.attempt === prev.attempt + 1 &&
          (input as TaskFlowRunReadEvent).retryOfRunId === prev.runId;
        if (!validRetry) {
          currentState = unknown(contributor, 'RUN_CONFLICT');
          return { ...currentState };
        }
      } else if (prev.runId && next.runId !== prev.runId && next.taskId !== prev.taskId && next.attempt !== 1) {
        currentState = unknown(contributor, 'RUN_CONFLICT');
        return { ...currentState };
      }
      currentState = next;
      return { ...next };
    },
  };
}

function isAllowedRunTransition(previous?: TaskFlowRunPhase, next?: TaskFlowRunPhase): boolean {
  if (!previous || !next) return false;
  const allowed: Record<TaskFlowRunPhase, readonly TaskFlowRunPhase[]> = {
    queued: ['queued', 'dispatched', 'provider_acked', 'blocked', 'failed', 'cancelled'],
    dispatched: ['dispatched', 'provider_acked', 'blocked', 'failed', 'cancelled'],
    provider_acked: ['provider_acked', 'running', 'blocked', 'failed', 'cancelled'],
    running: ['running', 'retrying', 'succeeded', 'blocked', 'failed', 'cancelled'],
    retrying: ['retrying', 'blocked', 'failed', 'cancelled'],
    succeeded: ['succeeded'],
    blocked: ['blocked', 'retrying'],
    failed: ['failed', 'retrying'],
    cancelled: ['cancelled'],
  };
  return allowed[previous].includes(next);
}
