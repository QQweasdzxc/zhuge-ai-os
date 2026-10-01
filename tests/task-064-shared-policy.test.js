const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("docs/supabase/20260912_c_shared_completion_archive_policy.sql");
const source = read("shared/board/board-read-service.js");
const BoardRead = require("../shared/board/board-read-service.js");

test("TASK-064 P1 migration defines one private C policy source without touching Consumer data", () => {
  assert.match(migration, /create table if not exists private\.module_c_completion_archive_policies/i);
  assert.match(migration, /policy_key text not null/i);
  assert.match(migration, /policy_version integer not null/i);
  assert.match(migration, /archive_delay_seconds bigint not null/i);
  assert.match(migration, /'completion_archive'/i);
  assert.match(migration, /'module-c-completion-archive-policy'/i);
  assert.match(migration, /'module-c-mother'/i);
  assert.match(migration, /172800/);
  assert.match(migration, /status = 'published'/i);
  assert.match(migration, /on conflict \(policy_key, policy_version\) do nothing/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.module_c_completion_archive_policies from public, anon, authenticated/i);

  const code = migration.replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\b(update|delete)\s+(public\.)?(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(code, /insert\s+into\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(code, /interval\s*'48\s+hours'/i);
});

test("TASK-064 P1 exposes authenticated read and canonical due-time calculation contracts", () => {
  assert.match(migration, /create or replace function public\.board_c_get_completion_archive_policy/i);
  assert.match(migration, /create or replace function public\.board_c_calculate_completion_archive_due_at/i);
  assert.match(migration, /set search_path = pg_catalog, private, auth, public, pg_temp/i);
  assert.match(migration, /v_actor := auth\.uid\(\)/i);
  assert.match(migration, /grant execute on function public\.board_c_get_completion_archive_policy\(text\) to authenticated/i);
  assert.match(migration, /grant execute on function public\.board_c_calculate_completion_archive_due_at\(timestamptz, text\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.board_c_get_completion_archive_policy\(text\) from public, anon/i);
  assert.match(migration, /make_interval\(secs => v_policy\.archive_delay_seconds::double precision\)/i);
  assert.match(migration, /'existing_due_at_retroactive', false/i);
});

test("C Shared Policy adapter keeps the delay and version Cloud-owned", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "board_c_get_completion_archive_policy") {
        return {
          contract_family: "module-c-lifecycle-acceptance",
          contract_version: "module-c-lifecycle-acceptance-v2",
          capability: "completion-archive",
          policy_identity: "module-c-completion-archive-policy",
          policy_key: "completion_archive",
          policy_version: 1,
          archive_delay_seconds: 172800,
          archive_delay_hours: 48,
          policy_source: "module-c-mother",
          cloud_source_of_truth: true,
          existing_due_at_retroactive: false
        };
      }
      if (name === "board_c_calculate_completion_archive_due_at") {
        return {
          contract_family: "module-c-lifecycle-acceptance",
          contract_version: "module-c-lifecycle-acceptance-v2",
          capability: "completion-archive",
          policy_identity: "module-c-completion-archive-policy",
          policy_key: "completion_archive",
          policy_version: 1,
          archive_delay_seconds: 172800,
          completion_at: "2026-09-12T00:00:00.000Z",
          archive_due_at: "2026-09-14T00:00:00.000Z",
          cloud_source_of_truth: true,
          existing_due_at_retroactive: false
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };

  const policy = await BoardRead.getCompletionArchivePolicy({ gateway });
  assert.equal(policy.policyIdentity, "module-c-completion-archive-policy");
  assert.equal(policy.policyVersion, 1);
  assert.equal(policy.archiveDelaySeconds, 172800);
  assert.equal(policy.archiveDelayHours, 48);
  assert.equal(policy.cloudSourceOfTruth, true);
  assert.equal(policy.existingDueAtRetroactive, false);

  const calculated = await BoardRead.calculateCompletionArchiveDueAt("2026-09-12T00:00:00.000Z", { gateway });
  assert.equal(calculated.completionAt, "2026-09-12T00:00:00.000Z");
  assert.equal(calculated.archiveDueAt, "2026-09-14T00:00:00.000Z");
  assert.deepEqual(calls, [
    { name: "board_c_get_completion_archive_policy", args: { p_policy_key: "completion_archive" } },
    {
      name: "board_c_calculate_completion_archive_due_at",
      args: { p_completion_at: "2026-09-12T00:00:00.000Z", p_policy_key: "completion_archive" }
    }
  ]);
});

test("C Shared Policy capability is exposed by the Board Instance service without changing Consumer writers", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        policy_identity: "module-c-completion-archive-policy",
        policy_key: "completion_archive",
        policy_version: 1,
        archive_delay_seconds: 172800,
        archive_delay_hours: 48,
        completion_at: "2026-09-12T00:00:00.000Z",
        archive_due_at: "2026-09-14T00:00:00.000Z"
      };
    },
    async select() { return []; }
  };
  const instance = BoardRead.createInstanceService({ gateway, boardInstanceId: "board-1" });
  const policy = await instance.getCompletionArchivePolicy();
  const calculated = await instance.calculateCompletionArchiveDueAt("2026-09-12T00:00:00.000Z");
  assert.equal(policy.policyVersion, 1);
  assert.equal(calculated.archiveDueAt, "2026-09-14T00:00:00.000Z");
  assert.deepEqual(calls.map(call => call.name), [
    "board_c_get_completion_archive_policy",
    "board_c_calculate_completion_archive_due_at"
  ]);
});

test("browser C source does not duplicate the numeric archive policy", () => {
  const start = source.indexOf("const C_COMPLETION_ARCHIVE_POLICY");
  const end = source.indexOf("function createLifecycleCapability", start);
  assert.ok(start >= 0 && end > start);
  const policyBlock = source.slice(start, end);
  assert.match(policyBlock, /delaySource: "cloud-published-policy"/);
  assert.doesNotMatch(policyBlock, /172800|48\s*hours|2\s*days|archiveDelaySeconds/i);
  assert.equal(typeof BoardRead.C_COMPLETION_ARCHIVE_POLICY, "object");
  assert.equal(typeof BoardRead.getCompletionArchivePolicy, "function");
  assert.equal(typeof BoardRead.calculateCompletionArchiveDueAt, "function");
});

test("invalid Cloud policy responses fail closed", async () => {
  const gateway = { rpc: async () => ({ policy_key: "completion_archive", policy_version: 0, archive_delay_seconds: 0 }) };
  await assert.rejects(
    () => BoardRead.getCompletionArchivePolicy({ gateway }),
    error => error.code === "C_COMPLETION_ARCHIVE_POLICY_INVALID"
  );
});
