-- AI Board Batch #2 follow-up: pre-create Development Contract / QA Evidence.
-- This is data seeding only; it does not create Auth users or alter task status.
begin;

insert into public.engineering_checklist_items (
  task_id, checklist_type, stage, item_key, label, required, sort_order, version
)
select t.id, 'task_acceptance', d.stage, d.item_key,
       case d.stage
         when 'co' then format('Co Developer QA：完成「%s」並附 Evidence', t.title)
         when 'gpt' then format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', t.title)
         when 'qjc' then format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', t.title)
       end,
       true, d.sort_order, 1
from public.board_tasks t
cross join (values
  ('co'::text, 'developer-qa'::text, 10),
  ('gpt'::text, 'gpt-review'::text, 20),
  ('qjc'::text, 'pm-acceptance'::text, 30)
) d(stage, item_key, sort_order)
where t.status not in ('cancelled', 'merged')
on conflict (task_id, checklist_type, stage, item_key, version) do nothing;

insert into public.engineering_checklist_items (
  task_id, checklist_type, stage, item_key, label, required, sort_order, version
)
select t.id, 'task_acceptance', d.stage, d.item_key, d.label, true, d.sort_order, 1
from public.board_tasks t
join (values
  ('TASK-026'::text, 'co'::text, 'system-map-written', 'Co：System Map 已寫入正式 Engineering Knowledge，並記錄 Baseline／Artifact Lineage。', 40),
  ('TASK-026'::text, 'gpt'::text, 'handoff-independent-read', 'GPT：可從 Supabase 獨立讀取 TASK-026、System Map 與目前接球狀態。', 50),
  ('TASK-026'::text, 'qjc'::text, 'handoff-pm-qa', 'QJC：確認 Status、Assignee、Board 工作區與下一步一致後完成 PM QA。', 60),
  ('TASK-032'::text, 'co'::text, 'contract-structure', 'Co：Development Contract 支援結構化 Stage、勾選狀態與 Evidence。', 40),
  ('TASK-032'::text, 'gpt'::text, 'contract-review', 'GPT：確認 Checklist 可被下一位接球者獨立讀取，且 Required Gate 不可被跳過。', 50),
  ('TASK-032'::text, 'qjc'::text, 'contract-pm-qa', 'QJC：逐項確認 PM QA Evidence，未完成或 FAIL 不得通過驗收。', 60)
) d(work_code, stage, item_key, label, sort_order) on t.work_code = d.work_code
on conflict (task_id, checklist_type, stage, item_key, version) do nothing;

commit;
