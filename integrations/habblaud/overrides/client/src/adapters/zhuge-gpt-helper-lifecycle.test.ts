import { describe, expect, it } from 'vitest';
import {
  createGptHelperLifecycleMachine,
  projectGptHelperSnapshot,
  readGptHelperEvent,
  type GptHelperLifecycleEvent,
} from './zhuge-gpt-helper-lifecycle';

// SIMULATED_TEST_FIXTURE_ONLY. Nothing here is a live GPT child session or ACK.
const NOW = Date.parse('2026-10-19T10:00:00.000Z');
const parent = { taskId: 'task-parent-01', runId: 'run-parent-01' };

function event(overrides: Partial<GptHelperLifecycleEvent> = {}): GptHelperLifecycleEvent {
  const createdAt = new Date(NOW - 30_000).toISOString();
  const updatedAt = new Date(NOW - 1_000).toISOString();
  return {
    schema: 'zhuge-gpt-helper-lifecycle-v1',
    helperId: 'gpt-child-01',
    parentTaskId: parent.taskId,
    parentRunId: parent.runId,
    taskId: 'task-child-01',
    runId: 'run-child-01-a1',
    attempt: 1,
    sequence: 1,
    phase: 'running',
    createdAt,
    updatedAt,
    heartbeatAt: updatedAt,
    dependencyTaskIds: ['task-dependency-01'],
    parent: {
      contributor: 'gpt', provider: 'openai-gpt', approved: true,
      approvalId: 'approval-parent-01', providerRunId: 'gpt-parent-provider-01',
      providerAck: {
        status: 'accepted', provider: 'openai-gpt', taskId: parent.taskId,
        runId: parent.runId, providerRunId: 'gpt-parent-provider-01',
        acknowledgedAt: new Date(NOW - 25_000).toISOString(),
      },
    },
    providerAck: {
      status: 'accepted', provider: 'openai-gpt', taskId: 'task-child-01',
      runId: 'run-child-01-a1', providerRunId: 'gpt-child-provider-01',
      acknowledgedAt: new Date(NOW - 20_000).toISOString(),
    },
    provenance: {
      kind: 'authenticated-taskflow-helper-read-only', sessionAuthenticated: true, readOnly: true,
      requestId: 'request-01', observedAt: new Date(NOW).toISOString(),
    },
    ...overrides,
  };
}

describe('P2 #75 GPT helper lifecycle (SIMULATED fixtures only; no live provider integration)', () => {
  it('does not project absent, created, or assigned helpers as people in the office', () => {
    expect(projectGptHelperSnapshot([], parent, NOW)).toMatchObject({ helpers: [], hasUnknown: false, reason: 'NO_EVENTS' });
    const created = event({ phase: 'created', providerAck: undefined, heartbeatAt: undefined });
    const assigned = event({ phase: 'assigned', sequence: 2, providerAck: undefined, heartbeatAt: undefined });
    expect(projectGptHelperSnapshot([created, assigned], parent, NOW)).toMatchObject({
      helpers: [], pending: [{ state: 'pending', present: false, helperId: 'gpt-child-01' }],
    });
  });

  it('projects only a fresh parent-linked, PM-approved helper with matching parent and child ACKs', () => {
    expect(readGptHelperEvent(event(), parent, NOW)).toMatchObject({
      state: 'working', present: true, helperId: 'gpt-child-01', parentTaskId: parent.taskId,
      parentRunId: parent.runId, taskId: 'task-child-01', runId: 'run-child-01-a1',
      source: 'authenticated-taskflow-helper-read-only', reason: 'VERIFIED_ACTIVE',
    });
  });

  it('fails closed for unauthenticated source, missing approval or missing/mismatched provider ACK', () => {
    const unauthenticated = { ...event(), provenance: { ...event().provenance, sessionAuthenticated: false } };
    const unapproved = { ...event(), parent: { ...event().parent, approved: false } };
    expect(readGptHelperEvent(unauthenticated, parent, NOW).reason)
      .toBe('UNAUTHENTICATED_SOURCE');
    expect(readGptHelperEvent(unapproved, parent, NOW).reason)
      .toBe('PARENT_APPROVAL_REQUIRED');
    expect(readGptHelperEvent(event({ providerAck: undefined }), parent, NOW).reason).toBe('HELPER_ACK_REQUIRED');
    const ack = event().providerAck!;
    expect(readGptHelperEvent(event({ providerAck: { ...ack, taskId: 'another-task' } }), parent, NOW).reason)
      .toBe('HELPER_ACK_MISMATCH');
    const parentWithoutAck = { ...event(), parent: { ...event().parent, providerAck: undefined } };
    expect(readGptHelperEvent(parentWithoutAck, parent, NOW).reason)
      .toBe('PARENT_ACK_MISMATCH');
  });

  it('rejects wrong parent, stale heartbeat, future timestamps, and static PR-derived events', () => {
    expect(readGptHelperEvent(event({ parentRunId: 'other-run' }), parent, NOW).reason).toBe('PARENT_IDENTITY_MISMATCH');
    const staleAt = new Date(NOW - 61_000).toISOString();
    const stale = event({
      createdAt: new Date(NOW - 120_000).toISOString(), updatedAt: staleAt, heartbeatAt: staleAt,
      providerAck: { ...event().providerAck!, acknowledgedAt: new Date(NOW - 90_000).toISOString() },
      parent: { ...event().parent, providerAck: { ...event().parent.providerAck, acknowledgedAt: new Date(NOW - 100_000).toISOString() } },
    });
    expect(readGptHelperEvent(stale, parent, NOW).reason).toBe('STALE_EVENT');
    expect(readGptHelperEvent(event({ updatedAt: new Date(NOW + 60_000).toISOString() }), parent, NOW).reason).toBe('FUTURE_TIMESTAMP');
    expect(readGptHelperEvent({ prCount: 6, status: 'working' }, parent, NOW).reason).toBe('INVALID_EVENT');
  });

  it('deduplicates repeated ACKs, derives helpers only from child records, and uses explicit dependency IDs', () => {
    const first = event({ dependencyTaskIds: ['task-dependency-01', 'task-dependency-01'] });
    const second = event({ helperId: 'gpt-child-02', taskId: 'task-child-02', runId: 'run-child-02-a1',
      providerAck: { ...event().providerAck!, taskId: 'task-child-02', runId: 'run-child-02-a1', providerRunId: 'gpt-child-provider-02' } });
    const projection = projectGptHelperSnapshot([first, first, second], parent, NOW);
    expect(projection.helpers).toHaveLength(2);
    expect(projection.helpers[0].dependencyTaskIds).toEqual(['task-dependency-01']);
    expect(projectGptHelperSnapshot([first], parent, NOW).helpers).toHaveLength(1);
  });

  it('keeps snapshot reload deterministic and terminal helpers disappear', () => {
    const active = event();
    expect(projectGptHelperSnapshot([active], parent, NOW)).toEqual(projectGptHelperSnapshot([active], parent, NOW));
    const done = event({ phase: 'done', sequence: 2, updatedAt: new Date(NOW).toISOString(), heartbeatAt: undefined });
    expect(projectGptHelperSnapshot([active, done], parent, NOW).helpers).toEqual([]);
    expect(readGptHelperEvent(done, parent, NOW)).toMatchObject({ state: 'done', present: false, reason: 'TERMINAL' });
  });

  it('enforces legal lifecycle transitions and makes replayed events idempotent', () => {
    const machine = createGptHelperLifecycleMachine(parent);
    const created = event({ phase: 'created', providerAck: undefined, heartbeatAt: undefined });
    const assigned = event({ phase: 'assigned', sequence: 2, providerAck: undefined, heartbeatAt: undefined });
    const running = event({ sequence: 3 });
    const waiting = event({ phase: 'waiting', sequence: 4, updatedAt: new Date(NOW).toISOString(), heartbeatAt: undefined });
    const done = event({ phase: 'done', sequence: 5, updatedAt: new Date(NOW).toISOString(), heartbeatAt: undefined });
    expect(machine.observe(created, NOW).state).toBe('pending');
    expect(machine.observe(assigned, NOW).state).toBe('pending');
    expect(machine.observe(running, NOW).state).toBe('working');
    expect(machine.observe(running, NOW).state).toBe('working');
    expect(machine.observe(waiting, NOW).state).toBe('waiting');
    expect(machine.observe(done, NOW)).toMatchObject({ state: 'done', present: false });
    expect(machine.observe(event({ phase: 'running', sequence: 6 }), NOW).reason).toBe('ILLEGAL_TRANSITION');
  });

  it('requires a new Run and explicit retry link after failure', () => {
    const machine = createGptHelperLifecycleMachine(parent);
    const failed = event({ phase: 'failed', sequence: 2, updatedAt: new Date(NOW).toISOString(), heartbeatAt: undefined });
    expect(machine.observe(failed, NOW).state).toBe('failed');
    const invalidRetry = event({ phase: 'running', sequence: 1, attempt: 2, runId: 'run-child-01-a2', providerAck: {
      ...event().providerAck!, runId: 'run-child-01-a2', providerRunId: 'gpt-child-provider-02',
    } });
    expect(machine.observe(invalidRetry, NOW).reason).toBe('RETRY_LINK_REQUIRED');
    const retry = event({ phase: 'running', sequence: 1, attempt: 2, runId: 'run-child-01-a2', retryOfRunId: failed.runId,
      providerAck: { ...event().providerAck!, runId: 'run-child-01-a2', providerRunId: 'gpt-child-provider-02' } });
    expect(machine.observe(retry, NOW).state).toBe('working');
  });

  it('turns conflicting duplicate sequences into unknown instead of retaining a possibly stale avatar', () => {
    const machine = createGptHelperLifecycleMachine(parent);
    const first = event();
    expect(machine.observe(first, NOW).state).toBe('working');
    const conflicting = event({ ...first, phase: 'blocked', providerAck: { ...first.providerAck!, providerRunId: 'different-provider-run' } });
    expect(machine.observe(conflicting, NOW).reason).toBe('RUN_CONFLICT');
    expect(machine.current().present).toBe(false);
    const snapshot = projectGptHelperSnapshot([first, conflicting], parent, NOW);
    expect(snapshot.helpers).toEqual([]);
    expect(snapshot.hasUnknown).toBe(true);
  });
});
