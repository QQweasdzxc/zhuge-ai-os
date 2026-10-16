/**
 * Zhuge AI OS / Cloud Handoff v1
 * Pure protocol; NO network calls, secrets, database mutations, or agent launch.
 * An authorized cloud dispatcher must enforce actor identity and atomic CAS.
 */
export const PROTOCOL = "zhuge.cloud-handoff.v1";
export const PHASES = Object.freeze([
  "BLOCKED_CHECKPOINT", "HANDOFF_READY", "CLAIMED",
  "RUNNING", "REVIEW_PENDING", "ACCEPTED"
]);
const SHA = /^[a-f0-9]{40}$/;
const DISPATCH_ID = /^[a-f0-9]{32}$/;
const ACTORS = new Set(["co", "gem"]);
const iso = value => typeof value === "string" && !Number.isNaN(Date.parse(value));
function insist(condition, message) {
  if (!condition) throw new Error("cloud handoff: " + message);
}
function isSha(value) { return typeof value === "string" && SHA.test(value); }
function cleanCheckpoint(record) {
  const s = record.source;
  return s.clean === true &&
    s.dirty_files === 0 &&
    s.checkpoint?.kind === "commit" &&
    s.checkpoint.sha === s.head_sha &&
    s.checkpoint.verified_sha === s.head_sha &&
    iso(s.checkpoint.verified_at);
}
export function validateHandoff(record) {
  insist(record && typeof record === "object" && !Array.isArray(record), "record required");
  insist(record.protocol === PROTOCOL, "unknown protocol");
  insist(typeof record.task?.id === "string" && /^GH-[1-9][0-9]*$/.test(record.task.id), "task id required");
  insist(Number.isInteger(record.task.github_issue) && record.task.github_issue > 0, "GitHub issue required");
  insist(record.task.id === "GH-" + record.task.github_issue, "issue identity mismatch");
  insist(record.task.taskflow_issue_id === null || (typeof record.task.taskflow_issue_id === "string" && record.task.taskflow_issue_id.length > 0), "invalid TaskFlow mapping");
  insist(typeof record.repo === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(record.repo), "repository required");
  insist(typeof record.source?.branch === "string" && /^review\/[A-Za-z0-9._/-]+$/.test(record.source.branch) && !record.source.branch.includes(".."), "review branch required");
  insist(isSha(record.source.base_sha) && isSha(record.source.head_sha), "exact Git SHA required");
  insist(typeof record.source.clean === "boolean", "worktree cleanliness required");
  insist(Number.isInteger(record.source.dirty_files) && record.source.dirty_files >= 0, "dirty file count required");
  insist(record.source.clean === (record.source.dirty_files === 0), "worktree state contradicts dirty count");
  insist(["none", "commit"].includes(record.source.checkpoint?.kind), "checkpoint kind invalid");
  insist(record.source.checkpoint.kind !== "commit" || isSha(record.source.checkpoint.sha), "checkpoint SHA required");
  insist(PHASES.includes(record.phase), "unsupported phase");
  insist(Number.isInteger(record.revision) && record.revision >= 0, "invalid revision");
  insist(record.owner === null || ACTORS.has(record.owner), "invalid owner");
  // Dispatch correlation must be stored in the durable CAS manifest BEFORE
  // the remote GitHub POST. A process-local nonce is not recoverable on timeout.
  if (record.dispatch !== undefined && record.dispatch !== null) {
    insist(DISPATCH_ID.test(record.dispatch?.id), "invalid persisted dispatch ID");
    insist(Number.isInteger(record.dispatch?.claimed_revision) &&
      record.dispatch.claimed_revision >= 1, "invalid persisted claim revision");
  }
  insist(record.next_actor === null || ACTORS.has(record.next_actor), "invalid next actor");
  insist(record.lease === null || (typeof record.lease?.id === "string" && record.lease.id.length >= 16 && iso(record.lease.until)), "invalid lease");
  insist(Array.isArray(record.remaining) && record.remaining.every(x => typeof x === "string" && x.length > 0 && x.length <= 500), "remaining work list required");
  insist(Array.isArray(record.events) && record.events.every(x => typeof x?.action === "string" && iso(x.at) && Number.isInteger(x.revision)), "invalid audit events");
  insist(typeof record.block_reason === "string" && record.block_reason.length <= 700, "invalid block reason");
  if (record.phase === "HANDOFF_READY" || record.phase === "CLAIMED" || record.phase === "RUNNING" || record.phase === "REVIEW_PENDING" || record.phase === "ACCEPTED") {
    insist(cleanCheckpoint(record), "a verified, clean Git checkpoint is mandatory");
  }
  if (record.phase === "HANDOFF_READY") {
    insist(record.owner === null && record.lease === null, "handoff ready must be unowned");
    insist(record.source.executor_stopped === true && typeof record.source.stop_evidence === "string" && record.source.stop_evidence.length > 0, "old writer stop confirmation required");
  }
  if (record.phase === "CLAIMED" || record.phase === "RUNNING") {
    insist(ACTORS.has(record.owner) && record.lease !== null, "one owner and lease required");
  }
  if (record.phase === "BLOCKED_CHECKPOINT") {
    insist(record.owner !== null && record.lease === null, "blocked task must preserve previous owner, no active lease");
  }
  if (record.phase === "REVIEW_PENDING" || record.phase === "ACCEPTED") {
    insist(record.owner === null && record.lease === null, "review must not have a writer");
  }
  return record;
}
export function canDispatch(record) {
  validateHandoff(record);
  if (record.phase !== "HANDOFF_READY") return { ready: false, reason: "handoff_not_ready" };
  if (!cleanCheckpoint(record)) return { ready: false, reason: "unverified_checkpoint" };
  if (record.source.executor_stopped !== true || !record.source.stop_evidence) return { ready: false, reason: "previous_writer_not_stopped" };
  return { ready: true, reason: "requires_atomic_claim_and_live_git_verification" };
}
export function transitionHandoff(snapshot, command) {
  const record = structuredClone(validateHandoff(snapshot));
  insist(command && typeof command === "object", "transition command required");
  insist(command.expected_revision === record.revision, "stale revision; reload before writing");
  insist(iso(command.at), "timestamp required");
  const { action, actor, at } = command;
  const actionFrom = record.phase;
  const ownerAction = () => {
    insist(actor === record.owner && record.lease?.id === command.lease_id, "writer ownership and lease must match");
    insist(Date.parse(record.lease.until) > Date.parse(at), "expired lease cannot write");
  };
  switch (action) {
    case "interrupt":
      insist(actionFrom === "RUNNING" && actor === record.owner, "only running owner may record interruption");
      ownerAction();
      insist(typeof command.reason === "string" && command.reason.length >= 5, "interruption reason required");
      record.phase = "BLOCKED_CHECKPOINT";
      record.block_reason = command.reason;
      record.lease = null;
      insist(Number.isInteger(command.dirty_files) && command.dirty_files >= 0, "interruption must report actual dirty files");
      record.source.dirty_files = command.dirty_files;
      record.source.clean = command.dirty_files === 0;
      record.source.executor_stopped = false;
      record.source.stop_evidence = null;
      // Even a clean working tree must not automatically yield to Gem until
      // the old cloud writer has demonstrably stopped.
      break;
    case "writer_stopped":
      insist(actionFrom === "BLOCKED_CHECKPOINT", "writer stop can only unblock a checkpoint");
      insist(actor === record.owner || actor === "pm", "writer or PM confirmation required");
      insist(typeof command.stop_evidence === "string" && command.stop_evidence.length >= 12, "auditable stop evidence required");
      if (command.discard_uncommitted === true) {
        insist(actor === "pm" && command.pm_explicit_discard === true, "discard of uncommitted work requires explicit PM action");
        insist(typeof command.discard_reason === "string" && command.discard_reason.length >= 12, "discard audit reason required");
        insist(isSha(command.verified_git_sha), "verified Git SHA required");
        record.source.head_sha = command.verified_git_sha;
        record.source.clean = true;
        record.source.dirty_files = 0;
        record.source.checkpoint = { kind: "commit", sha: command.verified_git_sha, verified_sha: command.verified_git_sha, verified_at: at };
      } else {
        insist(cleanCheckpoint(record), "uncommitted or unverified work cannot be handed over");
      }
      record.source.executor_stopped = true;
      record.source.stop_evidence = command.stop_evidence;
      record.owner = null;
      record.lease = null;
      record.phase = "HANDOFF_READY";
      record.block_reason = "";
      break;
    case "claim":
      insist(actionFrom === "HANDOFF_READY", "only a released handoff may be claimed");
      insist(ACTORS.has(actor) && actor === record.next_actor, "wrong replacement engineer");
      insist(typeof command.lease_id === "string" && command.lease_id.length >= 16, "dispatcher-provided unpredictable lease id required");
      insist(iso(command.lease_until) && Date.parse(command.lease_until) > Date.parse(at), "future lease required");
      insist(command.verified_git_sha === record.source.head_sha, "branch SHA changed; re-verify GitHub head");
      // This pure transition is NOT authentication. The trusted dispatcher must
      // verify actor, stop evidence, and GitHub CAS before persisting a claim.
      record.owner = actor;
      record.lease = { id: command.lease_id, until: command.lease_until };
      if (actor === "co") {
        insist(DISPATCH_ID.test(command.dispatch_id), "trusted dispatch ID required");
        record.dispatch = {
          id: command.dispatch_id, claimed_revision: record.revision + 1
        };
      } else {
        // Do not reuse a Co dispatch ID for the next engineer.
        record.dispatch = null;
      }
      record.phase = "CLAIMED";
      break;
    case "start":
      insist(actionFrom === "CLAIMED", "claim first");
      ownerAction();
      record.phase = "RUNNING";
      record.source.executor_stopped = false;
      record.source.stop_evidence = null;
      break;
    case "checkpoint_update":
      insist(actionFrom === "RUNNING", "only running owner can update a checkpoint");
      ownerAction();
      insist(isSha(command.new_git_sha) && command.new_git_sha === command.verified_git_sha, "new Git head must be live verified");
      insist(command.worktree_clean === true, "cannot checkpoint dirty worktree");
      record.source.head_sha = command.new_git_sha;
      record.source.clean = true;
      record.source.dirty_files = 0;
      record.source.checkpoint = { kind: "commit", sha: command.new_git_sha, verified_sha: command.new_git_sha, verified_at: at };
      break;
    case "submit_review":
      insist(actionFrom === "RUNNING", "only a running engineer can submit");
      ownerAction();
      insist(command.verified_git_sha === record.source.head_sha, "unverified commit");
      insist(cleanCheckpoint(record), "clean checkpoint required");
      insist(typeof command.stop_evidence === "string" && command.stop_evidence.length >= 12, "writer stop evidence required");
      record.source.executor_stopped = true;
      record.source.stop_evidence = command.stop_evidence;
      record.phase = "REVIEW_PENDING";
      record.owner = null;
      record.lease = null;
      break;
    case "rework":
      insist(actionFrom === "REVIEW_PENDING" && actor === "cto", "CTO reviews before reassignment");
      insist(ACTORS.has(command.next_actor), "next engineer required");
      record.next_actor = command.next_actor;
      record.phase = "HANDOFF_READY";
      break;
    case "accept":
      insist(actionFrom === "REVIEW_PENDING" && actor === "cto", "CTO review required");
      insist(typeof command.review_url === "string" && command.review_url.startsWith("https://github.com/"), "review evidence required");
      record.phase = "ACCEPTED";
      break;
    default:
      throw new Error("cloud handoff: unknown transition");
  }
  record.revision += 1;
  record.events.push({ revision: record.revision, at, actor, action, from: actionFrom, to: record.phase });
  return validateHandoff(record);
}
export function handoffBrief(record) {
  validateHandoff(record);
  const gate = canDispatch(record);
  const lines = [
    "# Cloud Handoff: " + record.task.id,
    "",
    "- State: **" + record.phase + "**",
    "- Actor: " + (record.owner || "unassigned"),
    "- Next: " + (record.next_actor || "not selected"),
    "- GitHub: https://github.com/" + record.repo + "/issues/" + record.task.github_issue,
    "- Branch: " + record.source.branch,
    "- Last recorded Git SHA: \`" + record.source.head_sha + "\`",
    "- Uncommitted files: **" + record.source.dirty_files + "**",
    "- Safe to dispatch: **" + (gate.ready ? "YES after CAS / live proof" : "NO (" + gate.reason + ")") + "**",
    "",
    "## Remaining work",
    ...record.remaining.map(s => "- " + s),
    "",
    "## Gate",
    gate.ready ? "A cloud dispatcher must still authenticate the actor, re-check the live GitHub branch HEAD, atomically claim one writer, and verify provider stop." :
      "Do not ask the replacement agent to resume uncommitted files. Request an actual Git commit / secured patch or explicit PM discard approval after the former worker is stopped.",
  ];
  return lines.join("\n") + "\n";
}
