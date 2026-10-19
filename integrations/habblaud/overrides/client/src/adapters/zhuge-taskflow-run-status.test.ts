import { describe, expect, it } from 'vitest';
import {
  createTaskFlowRunStateMachine,
  readTaskFlowRunStatus,
  type TaskFlowRunReadEvent,
} from './zhuge-taskflow-run-status';

// SIMULATED_TEST_FIXTURE_ONLY — this is not a live TaskFlow or Provider session.
const NOW = Date.parse('2026-10-19T09:00:00.000Z');
const simulatedGatewayResponseFixture = (overrides: Record<string, unknown> = {}): TaskFlowRunReadEvent => ({
  schema: 'zhuge-taskflow-run-read-v1',
  contributor: 'co',
  provider: 'openai-codex',
  taskId: 'task-100',
  runId: 'run-100-a1',
  attempt: 1,
  sequence: 1,
  phase: 'running',
  createdAt: new Date(NOW - 20_000).toISOString(),
  updatedAt: new Date(NOW - 1_000).toISOString(),
  heartbeatAt: new Date(NOW - 1_000).toISOString(),
  approval: { state: 'pm_approved', approvalId: 'approval-100', approvedAt: new Date(NOW - 30_000).toISOString() },
  providerAck: {
    status: 'accepted', provider: 'openai-codex', contributor: 'co', taskId: 'task-100',
    runId: 'run-100-a1', providerRunId: 'codex-thread-100', acknowledgedAt: new Date(NOW - 10_000).toISOString(),
  },
  provenance: {
    kind: 'authenticated-taskflow-read-only', sessionAuthenticated: true, readOnly: true,
    requestId: 'read-100', observedAt: new Date(NOW).toISOString(),
  },
  ...overrides,
} as TaskFlowRunReadEvent);

describe('P2 #74 TaskFlow Run → pixel work-state contract (SIMULATED fixtures only; no live integration)', () => {
  it('maps only a fresh approved Run with a matching provider ACK to working', () => {
    const result = readTaskFlowRunStatus(simulatedGatewayResponseFixture(), 'co', NOW);
    expect(result).toMatchObject({
      state: 'working', contributor: 'co', taskId: 'task-100', runId: 'run-100-a1',
      phase: 'running', source: 'authenticated-taskflow-read-only',
    });
  });

  it('shows an approved queued Run as waiting, without claiming provider work', () => {
    const event = simulatedGatewayResponseFixture({ phase: 'queued', providerAck: undefined, heartbeatAt: undefined });
    expect(readTaskFlowRunStatus(event, 'co', NOW).state).toBe('waiting');
  });

  it('fails closed for missing approval, missing ACK, mismatched ACK, or cross-role evidence', () => {
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ approval: undefined }), 'co', NOW).reason).toBe('PM_APPROVAL_REQUIRED');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ providerAck: undefined }), 'co', NOW).reason).toBe('PROVIDER_ACK_REQUIRED');
    const ack = simulatedGatewayResponseFixture().providerAck!;
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ providerAck: { ...ack, taskId: 'other-task' } }), 'co', NOW).reason).toBe('PROVIDER_ACK_MISMATCH');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ contributor: 'gem', provider: 'google-gemini' }), 'co', NOW).reason).toBe('ROLE_PROVIDER_MISMATCH');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture(), 'gem', NOW).reason).toBe('ROLE_PROVIDER_MISMATCH');
  });

  it('rejects static PR/status snapshots, unauthenticated sources, and stale or future events', () => {
    expect(readTaskFlowRunStatus({ recent_prs: [{ id: '#74', status: 'open' }] }, 'co', NOW).reason).toBe('INVALID_EVENT');
    const event = simulatedGatewayResponseFixture();
    expect(readTaskFlowRunStatus({ ...event, provenance: { ...event.provenance, sessionAuthenticated: false } }, 'co', NOW).reason)
      .toBe('SIMULATED_OR_UNAUTHENTICATED_SOURCE');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ heartbeatAt: new Date(NOW - 61_000).toISOString() }), 'co', NOW).reason)
      .toBe('STALE_EVENT');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ updatedAt: new Date(NOW + 60_000).toISOString() }), 'co', NOW).reason)
      .toBe('FUTURE_TIMESTAMP');
  });

  it('maps terminal success, blocked/failure, and cancellation without retaining working', () => {
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ phase: 'succeeded' }), 'co', NOW).state).toBe('done');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ phase: 'blocked', providerAck: undefined }), 'co', NOW).state).toBe('blocked');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ phase: 'failed', providerAck: undefined }), 'co', NOW).state).toBe('blocked');
    expect(readTaskFlowRunStatus(simulatedGatewayResponseFixture({ phase: 'cancelled', providerAck: undefined }), 'co', NOW))
      .toMatchObject({ state: 'unknown', reason: 'CANCELLED' });
  });

  it('enforces idle → working → done, idempotent duplicate, and out-of-order protection', () => {
    const machine = createTaskFlowRunStateMachine('co');
    expect(machine.current().state).toBe('unknown');
    const running = simulatedGatewayResponseFixture();
    expect(machine.observe(running, { now: NOW, workSpotReachable: true }).state).toBe('working');
    expect(machine.observe(running, { now: NOW, workSpotReachable: true }).state).toBe('working');
    const done = simulatedGatewayResponseFixture({ phase: 'succeeded', sequence: 2 });
    expect(machine.observe(done, { now: NOW, workSpotReachable: true }).state).toBe('done');
    expect(machine.observe(running, { now: NOW, workSpotReachable: true }))
      .toMatchObject({ state: 'done', reason: 'OUT_OF_ORDER_IGNORED' });
    expect(machine.observe(simulatedGatewayResponseFixture({ phase: 'running', sequence: 3 }), { now: NOW, workSpotReachable: true }))
      .toMatchObject({ state: 'unknown', reason: 'RUN_CONFLICT' });
    expect(machine.observe(null, { now: NOW })).toMatchObject({ state: 'unknown', reason: 'INVALID_EVENT' });
  });

  it('blocks overlapping work and requires a legal walk-grid route before working', () => {
    const machine = createTaskFlowRunStateMachine('co');
    expect(machine.observe(simulatedGatewayResponseFixture(), { now: NOW, workSpotReachable: false }))
      .toMatchObject({ state: 'unknown', reason: 'NO_LEGAL_WORK_PATH' });
    expect(machine.observe(simulatedGatewayResponseFixture(), { now: NOW, workSpotReachable: true }).state).toBe('working');
    const otherAck = { ...simulatedGatewayResponseFixture().providerAck!, taskId: 'task-200', runId: 'run-200-a1', providerRunId: 'provider-200' };
    expect(machine.observe(simulatedGatewayResponseFixture({ taskId: 'task-200', runId: 'run-200-a1', providerAck: otherAck }), { now: NOW, workSpotReachable: true }))
      .toMatchObject({ state: 'unknown', reason: 'RUN_CONFLICT' });
  });

  it('requires a new Run ID and linked attempt for retry; stale evidence clears work state', () => {
    const machine = createTaskFlowRunStateMachine('co');
    const first = simulatedGatewayResponseFixture({ phase: 'blocked', providerAck: undefined });
    expect(machine.observe(first, { now: NOW }).state).toBe('blocked');
    const retry = simulatedGatewayRunRetry(first);
    expect(machine.observe(retry, { now: NOW, workSpotReachable: true }).state).toBe('working');
    expect(readTaskFlowRunStatus(simulatedGatewayRunRetry(first, { runId: first.runId, attempt: 2 }), 'co', NOW))
      .toMatchObject({ state: 'unknown', reason: 'INVALID_EVENT' });
    const staleMachine = createTaskFlowRunStateMachine('co');
    expect(staleMachine.observe(retry, { now: NOW, workSpotReachable: true }).state).toBe('working');
    expect(staleMachine.observe({ ...retry, sequence: 2, updatedAt: new Date(NOW).toISOString(), heartbeatAt: new Date(NOW - 61_000).toISOString() }, { now: NOW, workSpotReachable: true }))
      .toMatchObject({ state: 'unknown', reason: 'STALE_EVENT' });
    expect(staleMachine.current().state).toBe('unknown');
  });

  it('permits a linked retry only after the source marks the prior Run retrying', () => {
    const machine = createTaskFlowRunStateMachine('co');
    const first = simulatedGatewayResponseFixture();
    expect(machine.observe(first, { now: NOW, workSpotReachable: true }).state).toBe('working');
    expect(machine.observe({ ...first, phase: 'retrying', sequence: 2, updatedAt: new Date(NOW).toISOString() }, { now: NOW }))
      .toMatchObject({ state: 'waiting', runId: first.runId });
    const retry = simulatedGatewayRunRetry(first);
    expect(machine.observe(retry, { now: NOW, workSpotReachable: true }))
      .toMatchObject({ state: 'working', runId: 'run-100-a2', attempt: 2 });
  });
});

function simulatedGatewayRunRetry(
  previous: TaskFlowRunReadEvent,
  overrides: Record<string, unknown> = {},
): TaskFlowRunReadEvent {
  const runId = String(overrides.runId || 'run-100-a2');
  return simulatedGatewayResponseFixture({
    ...previous,
    runId,
    retryOfRunId: previous.runId,
    attempt: overrides.attempt ?? 2,
    sequence: overrides.sequence ?? 1,
    phase: overrides.phase ?? 'running',
    providerAck: {
      status: 'accepted', provider: 'openai-codex', contributor: 'co', taskId: previous.taskId,
      runId, providerRunId: 'codex-thread-100-retry', acknowledgedAt: new Date(NOW - 5_000).toISOString(),
    },
    heartbeatAt: new Date(NOW - 1_000).toISOString(),
    updatedAt: new Date(NOW - 1_000).toISOString(),
    ...overrides,
  });
}
