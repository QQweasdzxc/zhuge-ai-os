import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROTOCOL, validateHandoff, canDispatch, handoffBrief, transitionHandoff
} from "../labs/cloud-handoff/contract.mjs";

const path = new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json", import.meta.url);
const fresh = () => JSON.parse(readFileSync(path, "utf8"));
const at = "2026-10-15T06:00:00Z";
const verifyTime = "2026-10-15T06:01:00Z";
const git = "199ea823af0692ca99e222b024ee3238cbc3a9fc";
function clean(record) {
  record.source.clean = true;
  record.source.dirty_files = 0;
  return record;
}
function unblocked() {
  return transitionHandoff(clean(fresh()), {
    action: "writer_stopped", actor: "co", expected_revision: 0, at,
    stop_evidence: "codex-cloud-executor-confirmed-stopped"
  });
}
const claimArgs = r => ({
  action: "claim", actor: "gem", expected_revision: r.revision,
  at: verifyTime, lease_id: "provider-generated-unique-lease-123",
  lease_until: "2026-10-15T07:01:00Z", verified_git_sha: git
});

test("actual Issue #45 Co exhaustion is NOT a valid Gem handoff", () => {
  const r = validateHandoff(fresh());
  assert.equal(r.protocol, PROTOCOL);
  assert.equal(r.phase, "BLOCKED_CHECKPOINT");
  assert.equal(r.source.dirty_files, 4);
  assert.equal(canDispatch(r).ready, false);
  assert.match(handoffBrief(r), /Uncommitted files: \*\*4\*\*/);
  assert.throws(() => transitionHandoff(r, claimArgs(r)), /only a released handoff/);
});

test("cannot release dirty Co files merely because usage limit was reached", () => {
  assert.throws(() => transitionHandoff(fresh(), {
    action: "writer_stopped", actor: "co", expected_revision: 0, at,
    stop_evidence: "codex-cloud-executor-confirmed-stopped"
  }), /uncommitted or unverified/);
});

test("writer stop, exact Git checkpoint and CAS allow only one Gem claim", () => {
  const ready = unblocked();
  assert.equal(ready.phase, "HANDOFF_READY");
  assert.equal(ready.owner, null);
  assert.equal(canDispatch(ready).ready, true);
  assert.throws(() => transitionHandoff(ready, { ...claimArgs(ready), actor: "co" }), /wrong replacement/);
  assert.throws(() => transitionHandoff(ready, { ...claimArgs(ready), verified_git_sha: "a".repeat(40) }), /branch SHA changed/);
  const claimed = transitionHandoff(ready, claimArgs(ready));
  assert.equal(claimed.phase, "CLAIMED");
  assert.equal(claimed.owner, "gem");
  assert.equal(claimed.revision, 2);
  assert.throws(() => transitionHandoff(claimed, claimArgs(ready)), /stale revision/);
  assert.throws(() => transitionHandoff(claimed, claimArgs(claimed)), /only a released/);
  const running = transitionHandoff(claimed, {
    action: "start", actor: "gem", expected_revision: claimed.revision,
    lease_id: "provider-generated-unique-lease-123", at: "2026-10-15T06:02:00Z"
  });
  assert.equal(running.phase, "RUNNING");
  assert.throws(() => transitionHandoff(running, {
    action: "submit_review", actor: "co", expected_revision: running.revision,
    lease_id: "provider-generated-unique-lease-123", at: "2026-10-15T06:03:00Z",
    verified_git_sha: git, stop_evidence: "provider-confirmed-worker-stopped"
  }), /writer ownership/);
  const review = transitionHandoff(running, {
    action: "submit_review", actor: "gem", expected_revision: running.revision,
    lease_id: "provider-generated-unique-lease-123", at: "2026-10-15T06:03:00Z",
    verified_git_sha: git, stop_evidence: "provider-confirmed-worker-stopped"
  });
  assert.equal(review.phase, "REVIEW_PENDING");
  const accepted = transitionHandoff(review, {
    action: "accept", actor: "cto", expected_revision: review.revision,
    at: "2026-10-15T06:04:00Z", review_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/50"
  });
  assert.equal(accepted.phase, "ACCEPTED");
  assert.equal(accepted.owner, null);
});

test("interruption never reassigns an unverified or still-running engineer", () => {
  const ready = unblocked();
  const claimed = transitionHandoff(ready, claimArgs(ready));
  const running = transitionHandoff(claimed, {
    action: "start", actor: "gem", expected_revision: claimed.revision,
    lease_id: claimed.lease.id, at: "2026-10-15T06:02:00Z"
  });
  const interrupted = transitionHandoff(running, {
    action: "interrupt", actor: "gem", expected_revision: running.revision,
    lease_id: running.lease.id, reason: "provider quota reached", dirty_files: 4, at: "2026-10-15T06:03:00Z"
  });
  assert.equal(interrupted.owner, "gem");
  assert.equal(interrupted.source.dirty_files, 4);
  assert.equal(interrupted.source.executor_stopped, false);
  assert.equal(canDispatch(interrupted).ready, false);
  assert.throws(() => transitionHandoff(interrupted, claimArgs(interrupted)), /only a released/);
});

test("the active engineer checkpoints a NEW Git SHA without sharing dirty worktree", () => {
  const ready = unblocked();
  const claimed = transitionHandoff(ready, claimArgs(ready));
  const running = transitionHandoff(claimed, {
    action: "start", actor: "gem", expected_revision: claimed.revision,
    lease_id: claimed.lease.id, at: "2026-10-15T06:02:00Z"
  });
  assert.equal(running.source.executor_stopped, false);
  const newSha = "a".repeat(40);
  assert.throws(() => transitionHandoff(running, {
    action: "checkpoint_update", actor: "gem", expected_revision: running.revision,
    lease_id: running.lease.id, at: "2026-10-15T06:03:00Z",
    new_git_sha: newSha, verified_git_sha: git, worktree_clean: true
  }), /live verified/);
  const checkpointed = transitionHandoff(running, {
    action: "checkpoint_update", actor: "gem", expected_revision: running.revision,
    lease_id: running.lease.id, at: "2026-10-15T06:03:00Z",
    new_git_sha: newSha, verified_git_sha: newSha, worktree_clean: true
  });
  assert.equal(checkpointed.source.head_sha, newSha);
  assert.equal(checkpointed.source.checkpoint.verified_sha, newSha);
});

test("PM discard is explicit, cannot be silently chosen by a co or gem", () => {
  const args = {
    action: "writer_stopped", actor: "co", expected_revision: 0, at,
    stop_evidence: "codex-cloud-executor-confirmed-stopped", discard_uncommitted: true,
    pm_explicit_discard: true, discard_reason: "PM explicitly accepts losing four uncommitted files",
    verified_git_sha: git
  };
  assert.throws(() => transitionHandoff(fresh(), args), /explicit PM action/);
  const r = transitionHandoff(fresh(), { ...args, actor: "pm" });
  assert.equal(r.phase, "HANDOFF_READY");
  assert.equal(r.source.dirty_files, 0);
  assert.ok(r.events.some(e => e.actor === "pm" && e.action === "writer_stopped"));
});

test("invalid manifests are rejected, even if formatting looks plausible", () => {
  for (const field of [
    r => { r.task.id = "GH-999"; },
    r => { r.source.branch = "main"; },
    r => { r.source.head_sha = "latest"; },
    r => { r.source.clean = true; },
    r => { r.phase = "HANDOFF_READY"; r.owner = null; },
    r => { r.owner = "someone_else"; },
    r => { r.lease = { id: "short", until: "yesterday" }; },
  ]) {
    const r = fresh(); field(r);
    assert.throws(() => validateHandoff(r), /cloud handoff/);
  }
});
