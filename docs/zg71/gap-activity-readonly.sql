with evidence as (
select auth_user_id as id from public.app_users union select user_uuid from public.user_profiles
union select auth_user_id from public.worklog_users union select applicant_user_id from private.app_access_application_events
), missing as (
select u.id from auth.users u where not exists(select 1 from evidence e where e.id=u.id)
and (public.app_access_review_paused() or exists(select 1 from private.app_access_application_events e where e.applicant_user_id=u.id and e.event_type in ('approved_bootstrap','application_approved') and e.event_no=(select max(event_no) from private.app_access_application_events where applicant_user_id=u.id)))
) select 'public.app_users.auth_user_id' as source, count(*) as rows, count(distinct "auth_user_id"::text) as users from "public"."app_users" where "auth_user_id"::text in(select id::text from missing)
union all
select 'public.assistant_conversation_states.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."assistant_conversation_states" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.assistant_conversations.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."assistant_conversations" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.assistant_messages.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."assistant_messages" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.board_instance_workflow_state.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."board_instance_workflow_state" where "updated_by"::text in(select id::text from missing)
union all
select 'public.board_instances.archived_by' as source, count(*) as rows, count(distinct "archived_by"::text) as users from "public"."board_instances" where "archived_by"::text in(select id::text from missing)
union all
select 'public.board_instances.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_instances" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_instances.owner_uuid' as source, count(*) as rows, count(distinct "owner_uuid"::text) as users from "public"."board_instances" where "owner_uuid"::text in(select id::text from missing)
union all
select 'public.board_task_attachments.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_task_attachments" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_task_attachments.deleted_by' as source, count(*) as rows, count(distinct "deleted_by"::text) as users from "public"."board_task_attachments" where "deleted_by"::text in(select id::text from missing)
union all
select 'public.board_task_checklist_items.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_task_checklist_items" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_task_checklist_items.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."board_task_checklist_items" where "updated_by"::text in(select id::text from missing)
union all
select 'public.board_task_vendor_links.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_task_vendor_links" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_task_vendor_links.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."board_task_vendor_links" where "updated_by"::text in(select id::text from missing)
union all
select 'public.board_tasks.accepted_by' as source, count(*) as rows, count(distinct "accepted_by"::text) as users from "public"."board_tasks" where "accepted_by"::text in(select id::text from missing)
union all
select 'public.board_tasks.archived_by' as source, count(*) as rows, count(distinct "archived_by"::text) as users from "public"."board_tasks" where "archived_by"::text in(select id::text from missing)
union all
select 'public.board_tasks.completion_by' as source, count(*) as rows, count(distinct "completion_by"::text) as users from "public"."board_tasks" where "completion_by"::text in(select id::text from missing)
union all
select 'public.board_tasks.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_tasks" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_tasks.owner_uuid' as source, count(*) as rows, count(distinct "owner_uuid"::text) as users from "public"."board_tasks" where "owner_uuid"::text in(select id::text from missing)
union all
select 'public.board_tasks.resolved_by' as source, count(*) as rows, count(distinct "resolved_by"::text) as users from "public"."board_tasks" where "resolved_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_adoptions.applied_by' as source, count(*) as rows, count(distinct "applied_by"::text) as users from "public"."board_workflow_adoptions" where "applied_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_adoptions.approved_by' as source, count(*) as rows, count(distinct "approved_by"::text) as users from "public"."board_workflow_adoptions" where "approved_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_adoptions.requested_by' as source, count(*) as rows, count(distinct "requested_by"::text) as users from "public"."board_workflow_adoptions" where "requested_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_definitions.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_workflow_definitions" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_definitions.published_by' as source, count(*) as rows, count(distinct "published_by"::text) as users from "public"."board_workflow_definitions" where "published_by"::text in(select id::text from missing)
union all
select 'public.board_workflow_step_mappings.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_workflow_step_mappings" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_workspace_notification_settings.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_workspace_notification_settings" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_workspace_notification_settings.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."board_workspace_notification_settings" where "updated_by"::text in(select id::text from missing)
union all
select 'public.board_workspaces.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."board_workspaces" where "created_by"::text in(select id::text from missing)
union all
select 'public.board_workspaces.owner_uuid' as source, count(*) as rows, count(distinct "owner_uuid"::text) as users from "public"."board_workspaces" where "owner_uuid"::text in(select id::text from missing)
union all
select 'public.board_workspaces.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."board_workspaces" where "updated_by"::text in(select id::text from missing)
union all
select 'public.broker_position_reconciliations.created_by_auth_user_id' as source, count(*) as rows, count(distinct "created_by_auth_user_id"::text) as users from "public"."broker_position_reconciliations" where "created_by_auth_user_id"::text in(select id::text from missing)
union all
select 'public.broker_position_reconciliations.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."broker_position_reconciliations" where "user_id"::text in(select id::text from missing)
union all
select 'public.broker_position_snapshot_audits.auth_user_id' as source, count(*) as rows, count(distinct "auth_user_id"::text) as users from "public"."broker_position_snapshot_audits" where "auth_user_id"::text in(select id::text from missing)
union all
select 'public.broker_position_snapshot_audits.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."broker_position_snapshot_audits" where "user_id"::text in(select id::text from missing)
union all
select 'public.broker_position_snapshots.created_by_auth_user_id' as source, count(*) as rows, count(distinct "created_by_auth_user_id"::text) as users from "public"."broker_position_snapshots" where "created_by_auth_user_id"::text in(select id::text from missing)
union all
select 'public.broker_position_snapshots.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."broker_position_snapshots" where "user_id"::text in(select id::text from missing)
union all
select 'public.decision_logs.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."decision_logs" where "user_id"::text in(select id::text from missing)
union all
select 'public.engineering_activity_log.actor_id' as source, count(*) as rows, count(distinct "actor_id"::text) as users from "public"."engineering_activity_log" where "actor_id"::text in(select id::text from missing)
union all
select 'public.engineering_artifacts.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."engineering_artifacts" where "created_by"::text in(select id::text from missing)
union all
select 'public.engineering_checklist_items.checked_by' as source, count(*) as rows, count(distinct "checked_by"::text) as users from "public"."engineering_checklist_items" where "checked_by"::text in(select id::text from missing)
union all
select 'public.engineering_governance_authorizations.authorized_by' as source, count(*) as rows, count(distinct "authorized_by"::text) as users from "public"."engineering_governance_authorizations" where "authorized_by"::text in(select id::text from missing)
union all
select 'public.engineering_knowledge.approved_by' as source, count(*) as rows, count(distinct "approved_by"::text) as users from "public"."engineering_knowledge" where "approved_by"::text in(select id::text from missing)
union all
select 'public.engineering_knowledge.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."engineering_knowledge" where "created_by"::text in(select id::text from missing)
union all
select 'public.engineering_members.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."engineering_members" where "user_id"::text in(select id::text from missing)
union all
select 'public.engineering_project_checkpoints.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."engineering_project_checkpoints" where "updated_by"::text in(select id::text from missing)
union all
select 'public.engineering_project_configuration.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."engineering_project_configuration" where "updated_by"::text in(select id::text from missing)
union all
select 'public.engineering_qa.verified_by' as source, count(*) as rows, count(distinct "verified_by"::text) as users from "public"."engineering_qa" where "verified_by"::text in(select id::text from missing)
union all
select 'public.engineering_work_items.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."engineering_work_items" where "created_by"::text in(select id::text from missing)
union all
select 'public.erp_edit_custody.owner_uuid' as source, count(*) as rows, count(distinct "owner_uuid"::text) as users from "public"."erp_edit_custody" where "owner_uuid"::text in(select id::text from missing)
union all
select 'public.erp_write_operations.owner_uuid' as source, count(*) as rows, count(distinct "owner_uuid"::text) as users from "public"."erp_write_operations" where "owner_uuid"::text in(select id::text from missing)
union all
select 'public.identity_claim_logs.auth_user_id' as source, count(*) as rows, count(distinct "auth_user_id"::text) as users from "public"."identity_claim_logs" where "auth_user_id"::text in(select id::text from missing)
union all
select 'public.identity_claim_logs.workspace_user_id' as source, count(*) as rows, count(distinct "workspace_user_id"::text) as users from "public"."identity_claim_logs" where "workspace_user_id"::text in(select id::text from missing)
union all
select 'public.investment_ivtk_card_links.created_by_auth_user_id' as source, count(*) as rows, count(distinct "created_by_auth_user_id"::text) as users from "public"."investment_ivtk_card_links" where "created_by_auth_user_id"::text in(select id::text from missing)
union all
select 'public.investment_ivtk_card_links.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."investment_ivtk_card_links" where "user_id"::text in(select id::text from missing)
union all
select 'public.investment_pending_actions.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."investment_pending_actions" where "user_id"::text in(select id::text from missing)
union all
select 'public.knowledge_candidates.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."knowledge_candidates" where "created_by"::text in(select id::text from missing)
union all
select 'public.knowledge_candidates.reviewed_by' as source, count(*) as rows, count(distinct "reviewed_by"::text) as users from "public"."knowledge_candidates" where "reviewed_by"::text in(select id::text from missing)
union all
select 'public.knowledge_recommendation_candidates.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."knowledge_recommendation_candidates" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.knowledge_sources.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."knowledge_sources" where "created_by"::text in(select id::text from missing)
union all
select 'public.knowledge_sources.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."knowledge_sources" where "updated_by"::text in(select id::text from missing)
union all
select 'public.knowledge_sources.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."knowledge_sources" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.knowledge_suggested_skills.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."knowledge_suggested_skills" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.knowledge_units.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."knowledge_units" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.module_release_history.published_by' as source, count(*) as rows, count(distinct "published_by"::text) as users from "public"."module_release_history" where "published_by"::text in(select id::text from missing)
union all
select 'public.module_releases.published_by' as source, count(*) as rows, count(distinct "published_by"::text) as users from "public"."module_releases" where "published_by"::text in(select id::text from missing)
union all
select 'public.office_member_roster.owner' as source, count(*) as rows, count(distinct "owner"::text) as users from "public"."office_member_roster" where "owner"::text in(select id::text from missing)
union all
select 'public.onboarding_state.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."onboarding_state" where "user_id"::text in(select id::text from missing)
union all
select 'public.opening_positions.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."opening_positions" where "user_id"::text in(select id::text from missing)
union all
select 'public.portfolios.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."portfolios" where "user_id"::text in(select id::text from missing)
union all
select 'public.recommendation_feedback.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."recommendation_feedback" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.strategies.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."strategies" where "user_id"::text in(select id::text from missing)
union all
select 'public.sync_migrations.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."sync_migrations" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.transactions.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."transactions" where "user_id"::text in(select id::text from missing)
union all
select 'public.user_ecp_tasks.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_ecp_tasks" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.user_export_settings.ecp_owner' as source, count(*) as rows, count(distinct "ecp_owner"::text) as users from "public"."user_export_settings" where "ecp_owner"::text in(select id::text from missing)
union all
select 'public.user_export_settings.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_export_settings" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.user_profiles.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_profiles" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.user_settings.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."user_settings" where "user_id"::text in(select id::text from missing)
union all
select 'public.user_tasks.completed_by' as source, count(*) as rows, count(distinct "completed_by"::text) as users from "public"."user_tasks" where "completed_by"::text in(select id::text from missing)
union all
select 'public.user_tasks.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_tasks" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.user_work_models.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_work_models" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.user_work_profiles.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."user_work_profiles" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.watchlists.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."watchlists" where "user_id"::text in(select id::text from missing)
union all
select 'public.work_entries.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."work_entries" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.work_journal_entries.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."work_journal_entries" where "created_by"::text in(select id::text from missing)
union all
select 'public.work_journal_entries.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."work_journal_entries" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.worklog_entries.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."worklog_entries" where "user_id"::text in(select id::text from missing)
union all
select 'public.worklog_settings.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."worklog_settings" where "user_id"::text in(select id::text from missing)
union all
select 'public.worklog_source_events.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."worklog_source_events" where "user_id"::text in(select id::text from missing)
union all
select 'public.worklog_tasks.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "public"."worklog_tasks" where "user_id"::text in(select id::text from missing)
union all
select 'public.worklog_users.auth_user_id' as source, count(*) as rows, count(distinct "auth_user_id"::text) as users from "public"."worklog_users" where "auth_user_id"::text in(select id::text from missing)
union all
select 'public.worktodo_attachments.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."worktodo_attachments" where "created_by"::text in(select id::text from missing)
union all
select 'public.worktodo_attachments.deleted_by' as source, count(*) as rows, count(distinct "deleted_by"::text) as users from "public"."worktodo_attachments" where "deleted_by"::text in(select id::text from missing)
union all
select 'public.worktodo_attachments.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."worktodo_attachments" where "user_uuid"::text in(select id::text from missing)
union all
select 'public.worktodo_checklist_items.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "public"."worktodo_checklist_items" where "created_by"::text in(select id::text from missing)
union all
select 'public.worktodo_checklist_items.updated_by' as source, count(*) as rows, count(distinct "updated_by"::text) as users from "public"."worktodo_checklist_items" where "updated_by"::text in(select id::text from missing)
union all
select 'public.worktodo_checklist_items.user_uuid' as source, count(*) as rows, count(distinct "user_uuid"::text) as users from "public"."worktodo_checklist_items" where "user_uuid"::text in(select id::text from missing)
union all
select 'taskflow.activity_log.actor_id' as source, count(*) as rows, count(distinct "actor_id"::text) as users from "taskflow"."activity_log" where "actor_id"::text in(select id::text from missing)
union all
select 'taskflow.agent.archived_by' as source, count(*) as rows, count(distinct "archived_by"::text) as users from "taskflow"."agent" where "archived_by"::text in(select id::text from missing)
union all
select 'taskflow.agent.owner_id' as source, count(*) as rows, count(distinct "owner_id"::text) as users from "taskflow"."agent" where "owner_id"::text in(select id::text from missing)
union all
select 'taskflow.agent_invocation_target.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."agent_invocation_target" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.agent_runtime.owner_id' as source, count(*) as rows, count(distinct "owner_id"::text) as users from "taskflow"."agent_runtime" where "owner_id"::text in(select id::text from missing)
union all
select 'taskflow.agent_task_queue.accountable_user_id' as source, count(*) as rows, count(distinct "accountable_user_id"::text) as users from "taskflow"."agent_task_queue" where "accountable_user_id"::text in(select id::text from missing)
union all
select 'taskflow.agent_task_queue.initiator_user_id' as source, count(*) as rows, count(distinct "initiator_user_id"::text) as users from "taskflow"."agent_task_queue" where "initiator_user_id"::text in(select id::text from missing)
union all
select 'taskflow.agent_task_queue.originator_user_id' as source, count(*) as rows, count(distinct "originator_user_id"::text) as users from "taskflow"."agent_task_queue" where "originator_user_id"::text in(select id::text from missing)
union all
select 'taskflow.attachment.uploader_id' as source, count(*) as rows, count(distinct "uploader_id"::text) as users from "taskflow"."attachment" where "uploader_id"::text in(select id::text from missing)
union all
select 'taskflow.autopilot.assignee_id' as source, count(*) as rows, count(distinct "assignee_id"::text) as users from "taskflow"."autopilot" where "assignee_id"::text in(select id::text from missing)
union all
select 'taskflow.autopilot_collaborator.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."autopilot_collaborator" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.autopilot_subscriber.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."autopilot_subscriber" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.channel_binding_token.channel_user_id' as source, count(*) as rows, count(distinct "channel_user_id"::text) as users from "taskflow"."channel_binding_token" where "channel_user_id"::text in(select id::text from missing)
union all
select 'taskflow.channel_chat_context_generation.initiator_user_id' as source, count(*) as rows, count(distinct "initiator_user_id"::text) as users from "taskflow"."channel_chat_context_generation" where "initiator_user_id"::text in(select id::text from missing)
union all
select 'taskflow.channel_installation.installer_user_id' as source, count(*) as rows, count(distinct "installer_user_id"::text) as users from "taskflow"."channel_installation" where "installer_user_id"::text in(select id::text from missing)
union all
select 'taskflow.channel_user_binding.channel_user_id' as source, count(*) as rows, count(distinct "channel_user_id"::text) as users from "taskflow"."channel_user_binding" where "channel_user_id"::text in(select id::text from missing)
union all
select 'taskflow.channel_user_binding.multica_user_id' as source, count(*) as rows, count(distinct "multica_user_id"::text) as users from "taskflow"."channel_user_binding" where "multica_user_id"::text in(select id::text from missing)
union all
select 'taskflow.chat_pinned_agent.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."chat_pinned_agent" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.chat_session.creator_id' as source, count(*) as rows, count(distinct "creator_id"::text) as users from "taskflow"."chat_session" where "creator_id"::text in(select id::text from missing)
union all
select 'taskflow.client_usage_daily.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."client_usage_daily" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.comment.author_id' as source, count(*) as rows, count(distinct "author_id"::text) as users from "taskflow"."comment" where "author_id"::text in(select id::text from missing)
union all
select 'taskflow.comment_reaction.actor_id' as source, count(*) as rows, count(distinct "actor_id"::text) as users from "taskflow"."comment_reaction" where "actor_id"::text in(select id::text from missing)
union all
select 'taskflow.feedback.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."feedback" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.github_installation.connected_by_id' as source, count(*) as rows, count(distinct "connected_by_id"::text) as users from "taskflow"."github_installation" where "connected_by_id"::text in(select id::text from missing)
union all
select 'taskflow.github_pending_check_suite.repo_owner' as source, count(*) as rows, count(distinct "repo_owner"::text) as users from "taskflow"."github_pending_check_suite" where "repo_owner"::text in(select id::text from missing)
union all
select 'taskflow.github_pull_request.repo_owner' as source, count(*) as rows, count(distinct "repo_owner"::text) as users from "taskflow"."github_pull_request" where "repo_owner"::text in(select id::text from missing)
union all
select 'taskflow.inbox_item.actor_id' as source, count(*) as rows, count(distinct "actor_id"::text) as users from "taskflow"."inbox_item" where "actor_id"::text in(select id::text from missing)
union all
select 'taskflow.issue.assignee_id' as source, count(*) as rows, count(distinct "assignee_id"::text) as users from "taskflow"."issue" where "assignee_id"::text in(select id::text from missing)
union all
select 'taskflow.issue.creator_id' as source, count(*) as rows, count(distinct "creator_id"::text) as users from "taskflow"."issue" where "creator_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_reaction.actor_id' as source, count(*) as rows, count(distinct "actor_id"::text) as users from "taskflow"."issue_reaction" where "actor_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_source_context.captured_by_user_id' as source, count(*) as rows, count(distinct "captured_by_user_id"::text) as users from "taskflow"."issue_source_context" where "captured_by_user_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_subscriber.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."issue_subscriber" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_view.owner_id' as source, count(*) as rows, count(distinct "owner_id"::text) as users from "taskflow"."issue_view" where "owner_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_view_preference.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."issue_view_preference" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.issue_wakeup.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."issue_wakeup" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.issue_wakeup.filter_actor_id' as source, count(*) as rows, count(distinct "filter_actor_id"::text) as users from "taskflow"."issue_wakeup" where "filter_actor_id"::text in(select id::text from missing)
union all
select 'taskflow.lark_installation.installer_user_id' as source, count(*) as rows, count(distinct "installer_user_id"::text) as users from "taskflow"."lark_installation" where "installer_user_id"::text in(select id::text from missing)
union all
select 'taskflow.lark_user_binding.multica_user_id' as source, count(*) as rows, count(distinct "multica_user_id"::text) as users from "taskflow"."lark_user_binding" where "multica_user_id"::text in(select id::text from missing)
union all
select 'taskflow.member.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."member" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.notification_preference.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."notification_preference" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.personal_access_token.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."personal_access_token" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.pinned_item.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."pinned_item" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.plugin_package.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."plugin_package" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.project_resource.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."project_resource" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.quick_action.assignee_id' as source, count(*) as rows, count(distinct "assignee_id"::text) as users from "taskflow"."quick_action" where "assignee_id"::text in(select id::text from missing)
union all
select 'taskflow.runtime_profile.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."runtime_profile" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.seat_capacity_outbox.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."seat_capacity_outbox" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.service_agent_tokens.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."service_agent_tokens" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.skill.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."skill" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.squad.creator_id' as source, count(*) as rows, count(distinct "creator_id"::text) as users from "taskflow"."squad" where "creator_id"::text in(select id::text from missing)
union all
select 'taskflow.task_supplement.author_id' as source, count(*) as rows, count(distinct "author_id"::text) as users from "taskflow"."task_supplement" where "author_id"::text in(select id::text from missing)
union all
select 'taskflow.task_token.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."task_token" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.user_composio_connection.composio_user_id' as source, count(*) as rows, count(distinct "composio_user_id"::text) as users from "taskflow"."user_composio_connection" where "composio_user_id"::text in(select id::text from missing)
union all
select 'taskflow.user_composio_connection.user_id' as source, count(*) as rows, count(distinct "user_id"::text) as users from "taskflow"."user_composio_connection" where "user_id"::text in(select id::text from missing)
union all
select 'taskflow.vcs_pull_request.repo_owner' as source, count(*) as rows, count(distinct "repo_owner"::text) as users from "taskflow"."vcs_pull_request" where "repo_owner"::text in(select id::text from missing)
union all
select 'taskflow.workspace_invitation.invitee_user_id' as source, count(*) as rows, count(distinct "invitee_user_id"::text) as users from "taskflow"."workspace_invitation" where "invitee_user_id"::text in(select id::text from missing)
union all
select 'taskflow.workspace_invitation.inviter_id' as source, count(*) as rows, count(distinct "inviter_id"::text) as users from "taskflow"."workspace_invitation" where "inviter_id"::text in(select id::text from missing)
union all
select 'taskflow.workspace_mcp_server.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."workspace_mcp_server" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.workspace_share_link.created_by' as source, count(*) as rows, count(distinct "created_by"::text) as users from "taskflow"."workspace_share_link" where "created_by"::text in(select id::text from missing)
union all
select 'taskflow.user.id',count(*),count(distinct id) from taskflow."user" where id in(select id from missing);

-- Private App evidence (counts only).
with evidence as (
select auth_user_id as id from public.app_users union select user_uuid from public.user_profiles
union select auth_user_id from public.worklog_users union select applicant_user_id from private.app_access_application_events
), missing as (
select u.id from auth.users u where not exists(select 1 from evidence e where e.id=u.id)
and (public.app_access_review_paused() or exists(select 1 from private.app_access_application_events e where e.applicant_user_id=u.id and e.event_type in ('approved_bootstrap','application_approved') and e.event_no=(select max(event_no) from private.app_access_application_events where applicant_user_id=u.id)))
) select 'private.app_access_application_events.applicant_user_id' as source,count(*) as rows,count(distinct "applicant_user_id"::text) as users from "private"."app_access_application_events" where "applicant_user_id"::text in(select id::text from missing)
union all
select 'private.app_access_application_events.reviewer_user_id' as source,count(*) as rows,count(distinct "reviewer_user_id"::text) as users from "private"."app_access_application_events" where "reviewer_user_id"::text in(select id::text from missing)
union all
select 'private.creator_user_notes.created_by_user_id' as source,count(*) as rows,count(distinct "created_by_user_id"::text) as users from "private"."creator_user_notes" where "created_by_user_id"::text in(select id::text from missing)
union all
select 'private.creator_user_notes.subject_user_id' as source,count(*) as rows,count(distinct "subject_user_id"::text) as users from "private"."creator_user_notes" where "subject_user_id"::text in(select id::text from missing)
union all
select 'private.creator_user_notes.updated_by_user_id' as source,count(*) as rows,count(distinct "updated_by_user_id"::text) as users from "private"."creator_user_notes" where "updated_by_user_id"::text in(select id::text from missing)
union all
select 'private.line_subject_bindings.user_id' as source,count(*) as rows,count(distinct "user_id"::text) as users from "private"."line_subject_bindings" where "user_id"::text in(select id::text from missing);
