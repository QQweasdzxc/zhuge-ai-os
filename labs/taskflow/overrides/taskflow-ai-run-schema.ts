import { z } from "zod";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const RUN_STATES = [
  "approved", "expired", "dispatch_pending", "provider_ack_pending", "running",
  "blocked", "review_pending", "completed", "failed", "cancelled",
] as const;
const EVENT_KINDS = [
  "pm_approved", "approval_expired", "dispatch_blocked", "provider_pending",
  "provider_ack", "progress", "review", "completed", "failed", "cancelled",
  "github_pr_updated", "github_pr_merged",
] as const;

export const TaskFlowAIEngineeringEventSchema = z.object({
  run_id: uuid,
  kind: z.enum(EVENT_KINDS),
  state: z.string(),
  github_sha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  created_at: z.string(),
});

export const TaskFlowAIEngineeringRunSchema = z.object({
  id: uuid,
  task_identifier: z.string().regex(/^[A-Z0-9]{1,10}-[1-9][0-9]*$/),
  engineer: z.literal("co"),
  state: z.enum(RUN_STATES),
  github_pr: z.number().int().safe().positive().nullable(),
  github_pr_state: z.string().nullable(),
  github_checks_state: z.string().nullable(),
  github_head_sha: z.string().regex(/^(?:[a-f0-9]{40})?$/).nullable(),
  github_snapshot_head_sha: z.string().regex(/^(?:[a-f0-9]{40})?$/).nullable(),
  github_snapshot_fetched_at: z.string().nullable(),
  created_at: z.string(),
  approval_expires_at: z.string(),
  provider_thread_id: z.string().nullable(),
  last_evidence_sha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  revision: z.number().int().safe().positive(),
  events: z.array(TaskFlowAIEngineeringEventSchema),
});

export const TaskFlowAIEngineeringRunListSchema = z.object({
  runs: z.array(TaskFlowAIEngineeringRunSchema).max(20),
  dispatch_enabled: z.literal(false),
});

export type TaskFlowAIEngineeringRun = z.infer<typeof TaskFlowAIEngineeringRunSchema>;
export type TaskFlowAIEngineeringEvent = z.infer<typeof TaskFlowAIEngineeringEventSchema>;
