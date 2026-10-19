/**
 * Read-only contract for projecting real GPT child Runs as temporary helpers.
 * This is a candidate data contract, not a provider API implementation. It is
 * deliberately not wired to Habblaud's OfficeSnapshot or character renderer.
 */

export type HelperPhase = 'created' | 'assigned' | 'running' | 'blocked' | 'waiting' | 'done' | 'cancelled' | 'failed';
export type HelperState = 'unknown' | 'pending' | 'working' | 'waiting' | 'blocked' | 'done' | 'cancelled' | 'failed';
export type HelperReason =
  | 'NO_EVENTS'
  | 'INVALID_EVENT'
  | 'UNAUTHENTICATED_SOURCE'
  | 'PARENT_IDENTITY_MISMATCH'
  | 'PARENT_APPROVAL_REQUIRED'
  | 'PARENT_ACK_REQUIRED'
  | 'PARENT_ACK_MISMATCH'
  | 'HELPER_ACK_REQUIRED'
  | 'HELPER_ACK_MISMATCH'
  | 'STALE_EVENT'
  | 'FUTURE_TIMESTAMP'
  | 'OUT_OF_ORDER_IGNORED'
  | 'ILLEGAL_TRANSITION'
  | 'RUN_CONFLICT'
  | 'RETRY_LINK_REQUIRED'
  | 'VERIFIED_ACTIVE'
  | 'TERMINAL';

export interface HelperProviderAck {
  status: 'accepted';
  provider: 'openai-gpt';
  taskId: string;
  runId: string;
  providerRunId: string;
  acknowledgedAt: string;
}

export interface GptHelperLifecycleEvent {
  schema: 'zhuge-gpt-helper-lifecycle-v1';
  /** Stable provider child identity, unique within the parent Run. */
  helperId: string;
  parentTaskId: string;
  parentRunId: string;
  taskId: string;
  runId: string;
  retryOfRunId?: string;
  attempt: number;
  sequence: number;
  phase: HelperPhase;
  createdAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  dependencyTaskIds: string[];
  parent: {
    contributor: 'gpt';
    provider: 'openai-gpt';
    approved: true;
    approvalId: string;
    providerRunId: string;
    providerAck: HelperProviderAck;
  };
  providerAck?: HelperProviderAck;
  provenance: {
    kind: 'authenticated-taskflow-helper-read-only';
    sessionAuthenticated: true;
    readOnly: true;
    requestId: string;
    observedAt: string;
  };
}

export interface HelperObservation {
  state: HelperState;
  present: boolean;
  helperId?: string;
  parentTaskId?: string;
  parentRunId?: string;
  taskId?: string;
  runId?: string;
  attempt?: number;
  sequence?: number;
  dependencyTaskIds?: string[];
  observedAt?: number;
  reason: HelperReason;
  source?: 'authenticated-taskflow-helper-read-only';
}

export interface HelperSnapshotProjection {
  helpers: HelperObservation[];
  /** Verified TaskFlow child records that have not ACKed and must not be rendered as people. */
  pending: HelperObservation[];
  hasUnknown: boolean;
  reason?: HelperReason;
  observedAt: number;
}

export interface HelperLifecycleMachine {
  observe(input: unknown, now?: number): HelperObservation;
  current(): HelperObservation;
}

export interface ExpectedParentRun {
  taskId: string;
  runId: string;
}

const FUTURE_SKEW_MS = 30_000;
const RUNNING_TTL_MS = 60_000;
const OTHER_ACTIVE_TTL_MS = 5 * 60_000;
const TERMINAL_TTL_MS = 5 * 60_000;
const PHASES = new Set<HelperPhase>(['created', 'assigned', 'running', 'blocked', 'waiting', 'done', 'cancelled', 'failed']);
const TRANSITIONS: Record<HelperPhase, readonly HelperPhase[]> = {
  created: ['created', 'assigned', 'cancelled', 'failed'],
  assigned: ['assigned', 'running', 'blocked', 'cancelled', 'failed'],
  running: ['running', 'waiting', 'blocked', 'done', 'cancelled', 'failed'],
  waiting: ['waiting', 'running', 'blocked', 'done', 'cancelled', 'failed'],
  blocked: ['blocked', 'running', 'cancelled', 'failed'],
  done: ['done'],
  cancelled: ['cancelled'],
  failed: ['failed'],
};

function unknown(reason: HelperReason): HelperObservation {
  return { state: 'unknown', present: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f]/.test(value);
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function ackMatches(value: unknown, taskId: string, runId: string, providerRunId: string): boolean {
  if (!isRecord(value)) return false;
  return value.status === 'accepted' && value.provider === 'openai-gpt' &&
    value.taskId === taskId && value.runId === runId &&
    validId(value.providerRunId) && value.providerRunId === providerRunId &&
    parseTime(value.acknowledgedAt) !== null;
}

/**
 * Validate a single server-built TaskFlow child-Run event. The provenance
 * fields are only assertions; the HTTP gateway must authenticate/authorize the
 * caller and construct these fields server-side before this function is used.
 */
export function readGptHelperEvent(
  input: unknown,
  expectedParent: ExpectedParentRun,
  now = Date.now(),
): HelperObservation {
  if (!isRecord(input) || input.schema !== 'zhuge-gpt-helper-lifecycle-v1' ||
      !validId(input.helperId) || !validId(input.parentTaskId) || !validId(input.parentRunId) ||
      !validId(input.taskId) || !validId(input.runId) ||
      !Number.isSafeInteger(input.attempt) || (input.attempt as number) < 1 ||
      !Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1 ||
      !PHASES.has(input.phase as HelperPhase) || !Array.isArray(input.dependencyTaskIds) ||
      input.dependencyTaskIds.length > 64 || !input.dependencyTaskIds.every(validId)) {
    return unknown('INVALID_EVENT');
  }
  if (input.parentTaskId !== expectedParent.taskId || input.parentRunId !== expectedParent.runId) {
    return unknown('PARENT_IDENTITY_MISMATCH');
  }
  const provenance = input.provenance;
  if (!isRecord(provenance) || provenance.kind !== 'authenticated-taskflow-helper-read-only' ||
      provenance.sessionAuthenticated !== true || provenance.readOnly !== true || !validId(provenance.requestId)) {
    return unknown('UNAUTHENTICATED_SOURCE');
  }
  const createdAt = parseTime(input.createdAt);
  const updatedAt = parseTime(input.updatedAt);
  const observedAt = parseTime(provenance.observedAt);
  if (createdAt === null || updatedAt === null || observedAt === null || createdAt > updatedAt) return unknown('INVALID_EVENT');
  if (createdAt > now + FUTURE_SKEW_MS || updatedAt > now + FUTURE_SKEW_MS || observedAt > now + FUTURE_SKEW_MS) {
    return unknown('FUTURE_TIMESTAMP');
  }
  if (observedAt + FUTURE_SKEW_MS < updatedAt) return unknown('INVALID_EVENT');
  const phase = input.phase as HelperPhase;
  const active = phase === 'running' || phase === 'waiting' || phase === 'blocked';
  const parent = input.parent;
  if (!isRecord(parent) || parent.contributor !== 'gpt' || parent.provider !== 'openai-gpt' || parent.approved !== true ||
      !validId(parent.approvalId) || !validId(parent.providerRunId)) return unknown('PARENT_APPROVAL_REQUIRED');
  const parentAck = parent.providerAck;
  if (!ackMatches(parentAck, expectedParent.taskId, expectedParent.runId, parent.providerRunId)) {
    return unknown('PARENT_ACK_MISMATCH');
  }
  const parentAckAt = isRecord(parentAck) ? parseTime(parentAck.acknowledgedAt) : null;
  if (parentAckAt === null || parentAckAt > updatedAt) return unknown('PARENT_ACK_MISMATCH');

  if (active) {
    const childAck = input.providerAck;
    if (!isRecord(childAck)) return unknown('HELPER_ACK_REQUIRED');
    const childProviderRunId = childAck.providerRunId;
    if (!validId(childProviderRunId) || !ackMatches(childAck, input.taskId, input.runId, childProviderRunId)) {
      return unknown('HELPER_ACK_MISMATCH');
    }
    const childAckAt = parseTime(childAck.acknowledgedAt);
    if (childAckAt === null || childAckAt < createdAt || childAckAt > updatedAt) return unknown('HELPER_ACK_MISMATCH');
  }

  const heartbeatAt = phase === 'running' ? parseTime(input.heartbeatAt) : updatedAt;
  if (phase === 'running' && (heartbeatAt === null || heartbeatAt < createdAt || heartbeatAt > updatedAt)) {
    return unknown('INVALID_EVENT');
  }
  const age = now - (heartbeatAt ?? updatedAt);
  const ttl = phase === 'running' ? RUNNING_TTL_MS : active ? OTHER_ACTIVE_TTL_MS : TERMINAL_TTL_MS;
  if (age > ttl) return unknown('STALE_EVENT');

  if (!active) {
    const terminalState: HelperState = phase === 'done' ? 'done' : phase === 'cancelled' ? 'cancelled' : phase === 'failed' ? 'failed' : 'pending';
    return {
      state: terminalState, present: false, helperId: input.helperId, parentTaskId: input.parentTaskId,
      parentRunId: input.parentRunId, taskId: input.taskId, runId: input.runId,
      attempt: input.attempt as number, sequence: input.sequence as number,
      dependencyTaskIds: [...new Set(input.dependencyTaskIds)], observedAt,
      reason: terminalState === 'pending' ? 'HELPER_ACK_REQUIRED' : 'TERMINAL',
      source: 'authenticated-taskflow-helper-read-only',
    };
  }

  const state: HelperState = phase === 'running' ? 'working' : phase;
  return {
    state, present: true, helperId: input.helperId, parentTaskId: input.parentTaskId,
    parentRunId: input.parentRunId, taskId: input.taskId, runId: input.runId,
    attempt: input.attempt as number, sequence: input.sequence as number,
    dependencyTaskIds: [...new Set(input.dependencyTaskIds)], observedAt,
    reason: 'VERIFIED_ACTIVE', source: 'authenticated-taskflow-helper-read-only',
  };
}

/**
 * An in-memory reducer for one logical helper. Replaying the same provider
 * event is idempotent; stale/out-of-order or illegal transitions never revive
 * a helper. A retry must be a new Run linked to the previous Run.
 */
export function createGptHelperLifecycleMachine(expectedParent: ExpectedParentRun): HelperLifecycleMachine {
  let current = unknown('NO_EVENTS');
  let accepted: HelperObservation | undefined;
  let lastPhase: HelperPhase | undefined;
  let lastFingerprint: string | undefined;
  const observe = (input: unknown, now = Date.now()): HelperObservation => {
    const next = readGptHelperEvent(input, expectedParent, now);
    if (next.state === 'unknown') {
      current = next;
      return current;
    }
    if (!isRecord(input)) return current;
    const phase = input.phase as HelperPhase;
    const attempt = input.attempt as number;
    const sequence = input.sequence as number;
    const fingerprint = stableValue(input);
    if (fingerprint === lastFingerprint && accepted) {
      current = accepted;
      return current;
    }
    const previous = accepted;
    if (previous && (next.helperId !== previous.helperId || next.taskId !== previous.taskId ||
        next.parentTaskId !== previous.parentTaskId || next.parentRunId !== previous.parentRunId)) {
      current = unknown('RUN_CONFLICT');
      accepted = undefined;
      lastPhase = undefined;
      lastFingerprint = undefined;
      return current;
    }
    if (previous && previous.runId === next.runId && previous.helperId === next.helperId && previous.sequence !== undefined && sequence === previous.sequence) {
      current = unknown('RUN_CONFLICT');
      accepted = undefined;
      lastPhase = undefined;
      lastFingerprint = undefined;
      return current;
    }
    if (previous && previous.runId === next.runId && previous.helperId === next.helperId && previous.sequence !== undefined && sequence < previous.sequence) {
      current = { ...previous, reason: 'OUT_OF_ORDER_IGNORED' };
      return current;
    }
    if (lastPhase && previous && next.helperId === previous.helperId && next.parentRunId === previous.parentRunId) {
      if (next.runId === previous.runId) {
        if (next.attempt !== previous.attempt || !TRANSITIONS[lastPhase].includes(phase)) {
          current = unknown('ILLEGAL_TRANSITION');
          return current;
        }
      } else {
        const retryAllowed = lastPhase === 'blocked' || lastPhase === 'failed' || lastPhase === 'cancelled';
        const linkedRetry = retryAllowed && next.attempt === (previous.attempt ?? 0) + 1 &&
          input.retryOfRunId === previous.runId && input.runId !== previous.runId;
        if (!linkedRetry) {
          current = unknown('RETRY_LINK_REQUIRED');
          return current;
        }
      }
    } else if (next.attempt !== 1 || input.retryOfRunId !== undefined) {
      current = unknown('RUN_CONFLICT');
      return current;
    }
    current = next;
    accepted = next;
    lastPhase = phase;
    lastFingerprint = fingerprint;
    return current;
  };
  return { observe, current: () => current };
}

/** Reduce one authenticated response to helpers that may enter the office. */
export function projectGptHelperSnapshot(
  input: unknown,
  expectedParent: ExpectedParentRun,
  now = Date.now(),
): HelperSnapshotProjection {
  if (!Array.isArray(input)) return { helpers: [], pending: [], hasUnknown: true, reason: 'INVALID_EVENT', observedAt: now };
  if (input.length === 0) return { helpers: [], pending: [], hasUnknown: false, reason: 'NO_EVENTS', observedAt: now };
  const groups = new Map<string, unknown[]>();
  let hasUnknown = false;
  for (const event of input) {
    const parsed = readGptHelperEvent(event, expectedParent, now);
    if (parsed.state === 'unknown' || !parsed.helperId) {
      hasUnknown = true;
      continue;
    }
    const key = `${parsed.parentRunId}:${parsed.helperId}`;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const helpers: HelperObservation[] = [];
  const pending: HelperObservation[] = [];
  for (const records of groups.values()) {
    const sequenceFingerprints = new Map<string, string>();
    let conflictingSequence = false;
    const uniqueRecords = new Map<string, unknown>();
    for (const event of records) {
      const record = event as Record<string, unknown>;
      const fingerprint = stableValue(event);
      const sequenceKey = `${record.attempt}:${record.sequence}`;
      const existing = sequenceFingerprints.get(sequenceKey);
      if (existing !== undefined && existing !== fingerprint) conflictingSequence = true;
      sequenceFingerprints.set(sequenceKey, fingerprint);
      uniqueRecords.set(fingerprint, event);
    }
    if (conflictingSequence) {
      hasUnknown = true;
      continue;
    }
    const ordered = [...uniqueRecords.values()].sort((a, b) => {
      const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
      return Number(left.attempt) - Number(right.attempt) || Number(left.sequence) - Number(right.sequence);
    });
    const machine = createGptHelperLifecycleMachine(expectedParent);
    for (const event of ordered) {
      const observation = machine.observe(event, now);
      if (observation.state === 'unknown') hasUnknown = true;
    }
    const current = machine.current();
    if (current.present) helpers.push(current);
    else if (current.state === 'pending') pending.push(current);
  }
  helpers.sort((a, b) => `${a.parentRunId}:${a.helperId}`.localeCompare(`${b.parentRunId}:${b.helperId}`));
  pending.sort((a, b) => `${a.parentRunId}:${a.helperId}`.localeCompare(`${b.parentRunId}:${b.helperId}`));
  return { helpers, pending, hasUnknown, observedAt: now };
}
