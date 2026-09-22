import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const migration = fs.readFileSync(
  path.join(repoRoot, 'docs/supabase/20260921_task_074_runtime_qa_action.sql'),
  'utf8',
);

test('TASK-074 runtime QA is a bounded authenticated QJC contract', () => {
  assert.match(migration, /create or replace function public\.board_task074_runtime_qa/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /is_engineering_member\(array\['owner'\]/);
  assert.match(migration, /v_state not in \('pass', 'rework'\)/);
  assert.match(migration, /runtime_qa/);
  assert.match(migration, /allowed_roles @> array\['qjc'\]/);
  assert.match(migration, /v_gate\.completion_role[\s\S]*<> 'qjc'/);
  assert.match(migration, /human_action_required <> true/);
  assert.match(migration, /p_evidence_note/);
  assert.match(migration, /p_evidence_ref/);
});

test('runtime QA uses canonical workflow binding, idempotency, and audit evidence', () => {
  assert.match(migration, /workflow_version_id = v_definition\.id/);
  assert.match(migration, /current_workflow_step_id = v_target_step\.id/);
  assert.match(migration, /private\.board_workflow_action_idempotency/);
  assert.match(migration, /'task074_runtime_qa'/);
  assert.match(migration, /'evidence_key', 'runtime_qa'/);
  assert.match(migration, /request_hash/);
  assert.match(migration, /idempotency key was already used with a different runtime QA request/);
  assert.match(migration, /engineering_activity_log/);
  assert.match(migration, /'QJC'/);
});

test('runtime QA cannot complete a task or grant GPT/service actor access', () => {
  assert.match(migration, /v_target_step\.is_completion/);
  assert.match(migration, /runtime QA cannot perform PM-controlled completion/);
  assert.match(migration, /runtime QA target is outside the bounded pass\/rework contract/);
  assert.match(migration, /revoke all on function public\.board_task074_runtime_qa/);
  assert.match(migration, /from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.board_task074_runtime_qa[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function public\.board_task074_runtime_qa[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.board_task074_runtime_qa[\s\S]*to (gpt|co)/i);
});

test('runtime QA fails closed without an exact published gate and unambiguous transition', () => {
  assert.match(migration, /status = 'published'/);
  assert.match(migration, /v_gate_count <> 1/);
  assert.match(migration, /v_transition_count <> 1/);
  assert.match(migration, /published workflow must define exactly one required runtime_qa gate/);
  assert.match(migration, /runtime QA transition is missing or ambiguous/);
});
