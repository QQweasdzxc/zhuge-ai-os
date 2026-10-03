const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Read = require('../shared/board/board-read-service');
const Golden = require('../shared/components/golden-master');
const Board = require('../shared/components/task-board');
const workspaceId = '70d94d8d-7c49-48ed-b39c-c985c6efea3e';
const retained = Read.normalizeTask({id:'480f59c0-d252-4e04-9b37-457bfbac346b',work_code:'TASK-079',workspace_id:workspaceId,status:'done',completion_at:'2026-09-21T15:07:30Z',archive_due_at:'2026-09-22T15:07:30Z',archived_at:null});

test('TASK-079 historical presentation and retained delete count agree without mutating its row', () => {
  const rows = Object.freeze([Object.freeze(retained)]);
  const before = JSON.stringify(rows);
  const counts = Read.projectWorkspaceTaskCounts(rows,workspaceId);
  assert.deepEqual(counts,{current:0,history:1,retained:1,historyCodes:['TASK-079']});
  assert.equal(JSON.stringify(rows),before);
  assert.equal(retained.archivedAt,null,'Archive eligibility is not a persisted archive claim');
  const html = Board.renderColumns([{id:workspaceId,countProjection:counts}]);
  for (const label of ['目前卡 0','歷史卡 1','保留總數 1']) assert.ok(html.includes(label));
  assert.equal(Golden.workspaceDeleteBlockedMessage(counts),'此工作區目前無進行中卡片，但仍保留 1 張歷史卡（TASK-079），因此不能刪除。');
});

test('current/history partition uses canonical lifecycle and never includes other Workspace rows', () => {
  const rows = [retained, {...retained,id:'active',workCode:'TASK-080',status:'ready',completionAt:null,archiveDueAt:null}, {...retained,id:'future',archiveDueAt:'2999-01-01T00:00:00Z'}, {...retained,id:'cancelled',status:'cancelled'}, {...retained,id:'persisted',archivedAt:'2026-09-23T00:00:00Z'}, {...retained,id:'other',workspaceId:'other'}];
  const counts = Read.projectWorkspaceTaskCounts(rows,workspaceId);
  assert.equal(counts.current,2); assert.equal(counts.history,3); assert.equal(counts.retained,5);
  assert.equal(counts.current+counts.history,counts.retained);
  assert.match(Golden.workspaceDeleteBlockedMessage(counts),/目前有 2 張目前卡.*3 張歷史卡.*保留總數 5/);
  assert.deepEqual(Read.projectWorkspaceTaskCounts(rows,''),{current:0,history:0,retained:0,historyCodes:[]});
});

test('cancelled Completion countdown remains current and WorkTodo keeps its existing archive predicate', () => {
  assert.equal(Read.projectWorkspaceTaskCounts([{...retained,archiveDueAt:null}],workspaceId).current,1);
  const counts = Read.projectWorkspaceTaskCounts([retained,{...retained,id:'archived',archivedAt:'2026-09-23'}],workspaceId,{isHistorical:task=>Boolean(task.archivedAt)});
  assert.equal(counts.current,1); assert.equal(counts.history,1); assert.equal(counts.retained,2);
});

test('empty/search-filtered UI cannot weaken canonical populated Workspace delete', () => {
  // Filtering card presentation does not filter state.tasks used by projection.
  assert.equal([retained].filter(row=>row.title.includes('no-match')).length,0);
  assert.equal(Read.projectWorkspaceTaskCounts([retained],workspaceId).retained,1);
  const rpc = fs.readFileSync(path.join(__dirname,'../docs/supabase/20260915_c_workspace_delete_populated_fail_closed.sql'),'utf8');
  assert.match(rpc,/select count\(\*\)[\s\S]*where workspace_id = p_workspace_id/);
  assert.doesNotMatch(rpc,/delete from public.board_tasks/i);
});

test('detach writer cancels only the countdown outside Completion and preserves canonical security', () => {
  const file = fs.readdirSync(path.join(__dirname,'../supabase/migrations')).find(name=>name.endsWith('_module_c_detach_cancel_completion_countdown.sql'));
  const sql = fs.readFileSync(path.join(__dirname,'../supabase/migrations',file),'utf8');
  assert.match(sql,/private.board_c_completion_archive_designation\(v_task.board_instance_id\)/);
  assert.match(sql,/archive_due_at = case when v_target_is_completion then archive_due_at else null end/);
  assert.doesNotMatch(sql,/completion_at\s*=|set archived_at|cron\.schedule|create table|delete from/i);
  assert.match(sql,/auth.uid\(\) is null/); assert.match(sql,/public.board_task_can_write\(p_task_id\)/);
  assert.match(sql,/Active task lease must be released/); assert.match(sql,/return v_existing.response/);
  assert.match(sql,/grant execute on function public.board_c_detach_workflow_and_move_task_v1\(uuid, uuid, text, text\) to authenticated/);
});
