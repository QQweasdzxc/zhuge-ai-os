const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Resolver = require("../shared/engineering-memory/engineering-memory-resolver.js");

const root = path.resolve(__dirname, "..");
const artifactRoot = "/Users/qq/Library/CloudStorage/GoogleDrive-qq.1025@gmail.com/我的雲端硬碟/TOOLS-自製/ZhuGe AI OS/版控";

function canonicalPayload(rows, failures = []) {
  return {
    source: "public.engineering_knowledge",
    status: failures.length ? "failed" : "ready",
    records: rows,
    failures
  };
}

test("Current Resolver returns complete EP-032/033/035 records and follows a Current update without hardcoded versions", async () => {
  let currentVersion = "v1.4";
  const gateway = {
    rpc: async (name, args) => {
      assert.equal(name, "resolve_current_engineering_memory");
      assert.deepEqual(args.p_knowledge_codes, args.p_knowledge_codes.length === 1 ? ["EP-035"] : ["EP-032", "EP-033", "EP-035"]);
      return canonicalPayload(["EP-032", "EP-033", "EP-035"].map(code => ({
        knowledge_code: code,
        knowledge_type: "principle",
        title: `${code} Current`,
        summary: `${code} summary`,
        content: `${code} full current content ${currentVersion}`,
        version: currentVersion,
        updated_at: "2026-08-14T00:00:00Z"
      })));
    }
  };

  const first = await Resolver.resolveCurrentCanonical({ gateway, codes: ["ep-032", "EP-033", "EP-035"] });
  assert.equal(first.status, "ready");
  assert.deepEqual(first.records.map(row => row.knowledgeCode), ["EP-032", "EP-033", "EP-035"]);
  assert.equal(first.records[2].version, "v1.4");
  assert.match(first.records[2].content, /full current content v1\.4/);

  currentVersion = "v1.5";
  const updated = await Resolver.resolveCurrentCanonical({ gateway, codes: ["EP-035"] });
  assert.equal(updated.records[0].version, "v1.5");
  assert.match(updated.records[0].content, /full current content v1\.5/);
});

test("Current Resolver fails closed on duplicate Current Canonical Records", async () => {
  const result = await Resolver.resolveCurrentCanonical({
    codes: ["EP-035"],
    gateway: { rpc: async () => canonicalPayload([], [{ knowledge_code: "EP-035", reason: "Canonical Conflict / Need PM Decision", candidate_count: 2 }]) }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.records.length, 0);
  assert.equal(result.failures[0].reason, Resolver.CANONICAL_CONFLICT);
});

test("Startup Gate keeps checkpoint and PM baseline visibly Unknown when no canonical records exist", async () => {
  const result = await Resolver.readStartupGate({
    codes: ["EP-032", "EP-033", "EP-035"],
    artifactRootProbe: async value => value === artifactRoot,
    gateway: {
      rpc: async (name, args) => {
        assert.equal(name, "resolve_engineering_startup_gate");
        assert.deepEqual(args.p_knowledge_codes, ["EP-032", "EP-033", "EP-035"]);
        return {
          principles: canonicalPayload([]),
          checkpoint: null,
          pm_accepted_baseline: null,
          artifact_rule: {
            artifact_root: artifactRoot,
            immutable: true,
            append_only: true,
            overwrite_allowed: false,
            allowed_artifact_types: ["candidate", "qa", "release"],
            identity_fields: ["version", "build", "timestamp", "git_commit", "sha256", "artifact_type", "qa_status", "pm_acceptance_status", "storage_location"]
          },
          artifact_records: []
        };
      }
    }
  });
  const receipt = Resolver.startupGateReceipt(result);
  assert.equal(receipt["Current TASK"], "Unknown");
  assert.equal(receipt["PM Accepted Baseline"], "Unknown");
  assert.equal(receipt["Artifact Rule"].artifactRoot, artifactRoot);
  assert.equal(receipt["Artifact Rule"].availability, "available");
});

test("Canonical retrieval failure is visible and never falls back to local documents", async () => {
  const result = await Resolver.resolveCurrentCanonical({
    codes: ["EP-035"],
    gateway: { rpc: async () => { throw new Error("RPC unavailable"); } }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failures[0].reason, Resolver.CANONICAL_RETRIEVAL_FAILED);
  assert.match(result.failures[0].detail, /RPC unavailable/);
  const source = fs.readFileSync(path.join(root, "shared/engineering-memory/engineering-memory-resolver.js"), "utf8");
  assert.doesNotMatch(source, /gateway\.select\([\s\S]*knowledge_sources|gateway\.select\([\s\S]*knowledge_units/);
});

test("Authorization failure is distinct from canonical absence or retrieval failure", async () => {
  const error = new Error("Authenticated Engineering Member is required");
  error.status = 403;
  error.code = "42501";
  const result = await Resolver.resolveCurrentCanonical({
    codes: ["EP-035"],
    gateway: { rpc: async () => { throw error; } }
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failures[0].reason, Resolver.AUTHORIZATION_FAILED);
  assert.notEqual(result.failures[0].reason, Resolver.NOT_FOUND);
  assert.notEqual(result.failures[0].reason, Resolver.CANONICAL_RETRIEVAL_FAILED);
});

test("a missing canonical record is reported as Not Found", async () => {
  const result = await Resolver.resolveCurrentCanonical({
    codes: ["EP-999"],
    gateway: {
      rpc: async () => canonicalPayload([], [{ knowledge_code: "EP-999", reason: "Not Found", candidate_count: 0 }])
    }
  });
  assert.equal(result.failures[0].reason, Resolver.NOT_FOUND);
});

test("Migration does not duplicate Principle content into retrieval index tables", () => {
  const migration = fs.readFileSync(path.join(root, "docs/supabase/20260814_engineering_memory_retrieval.sql"), "utf8");
  assert.match(migration, /public\.engineering_knowledge/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(knowledge_sources|knowledge_units)/i);
  assert.match(migration, /Canonical Conflict \/ Need PM Decision/);
  assert.match(migration, /Artifact Root Unavailable/);
});

test("Trusted read migration preserves anonymous denial and grants only resolver execution", () => {
  const migration = fs.readFileSync(path.join(root, "docs/supabase/20260814_trusted_engineering_agent_read.sql"), "utf8");
  assert.match(migration, /auth\.jwt\(\)\s*->>\s*'role'/);
  assert.match(migration, /grant execute on function public\.resolve_current_engineering_memory\(text\[\]\) to authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.resolve_engineering_startup_gate\(text\[\]\) to authenticated, service_role/i);
  assert.match(migration, /revoke execute on function public\.resolve_current_engineering_memory\(text\[\]\) from public, anon/i);
  assert.doesNotMatch(migration, /grant\s+(all|insert|update|delete)\s+on\s+public\./i);
});
