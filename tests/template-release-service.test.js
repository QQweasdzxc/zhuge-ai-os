const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = path.join(__dirname, "..", "shared", "services", "template-release-service.js");

const IDENTITY = Object.freeze({
  version: "0.9.0-alpha.9.13",
  build: "20260829-1024",
  commit: "0123456789abcdef0123456789abcdef01234567",
  fingerprint: "a".repeat(64),
});

function loadService(rpc) {
  delete require.cache[require.resolve(SERVICE)];
  global.ZhugeSupabaseGateway = { createDataGateway: () => ({ rpc }) };
  return require(SERVICE);
}

function releasePayload(args, status = "published_pending_reload") {
  const consumers = {};
  for (const consumerId of args.p_consumer_ids || ["c", "worktodo", "ai-board"]) {
    consumers[consumerId] = {
      status,
      module_version: args.p_published_version || IDENTITY.version,
      build: args.p_published_build || IDENTITY.build,
    };
  }
  return {
    module_id: args.p_module_id || "c",
    development_version: args.p_development_version || IDENTITY.version,
    development_build: args.p_development_build || IDENTITY.build,
    development_source_commit: args.p_development_source_commit || IDENTITY.commit,
    development_source_fingerprint: args.p_development_source_fingerprint || IDENTITY.fingerprint,
    published_version: args.p_published_version || IDENTITY.version,
    published_build: args.p_published_build || IDENTITY.build,
    source_commit: args.p_source_commit || IDENTITY.commit,
    source_fingerprint: args.p_source_fingerprint || IDENTITY.fingerprint,
    published_at: "2026-08-29T00:00:00.000Z",
    published_by: "creator",
    consumer_adoptions: consumers,
  };
}

test("runtime release service reads the generic persistent module contract", async () => {
  const calls = [];
  const service = loadService(async (name, args) => {
    calls.push({ name, args });
    return releasePayload({ p_module_id: "c", p_consumer_ids: ["c", "worktodo", "ai-board"] });
  });

  const release = await service.read("C");
  assert.equal(calls[0].name, "get_published_module_release");
  assert.deepEqual(calls[0].args, { p_module_id: "c" });
  assert.equal(release.moduleId, "c");
  assert.equal(service.forConsumer(release, "ai_board").status, "published_pending_reload");
  assert.equal(service.forConsumer(release, "worktodo").identityMatches, true);
  assert.equal(release.persistent, true);
});

test("runtime release service publishes one identity for a dynamic consumer set", async () => {
  const calls = [];
  const service = loadService(async (name, args) => {
    calls.push({ name, args });
    if (name === "record_module_adoption" || name === "get_published_module_release") return releasePayload(args, "adopted");
    return releasePayload(args);
  });

  const release = await service.publish({
    moduleId: "C",
    consumers: ["worktodo", "AI_Board", "worktodo"],
    developmentVersion: IDENTITY.version,
    developmentBuild: IDENTITY.build,
    developmentSourceCommit: IDENTITY.commit,
    developmentSourceFingerprint: IDENTITY.fingerprint,
    publishedVersion: IDENTITY.version,
    publishedBuild: IDENTITY.build,
    sourceCommit: IDENTITY.commit,
    sourceFingerprint: "b".repeat(64),
  });

  assert.equal(calls[0].name, "publish_module_release");
  assert.deepEqual(calls[0].args, {
    p_module_id: "c",
    p_published_version: IDENTITY.version,
    p_published_build: IDENTITY.build,
    p_source_commit: IDENTITY.commit,
    p_source_fingerprint: "b".repeat(64),
    p_consumer_ids: ["worktodo", "ai-board"],
    p_development_version: IDENTITY.version,
    p_development_build: IDENTITY.build,
    p_development_source_commit: IDENTITY.commit,
    p_development_source_fingerprint: IDENTITY.fingerprint,
  });
  assert.equal(service.forConsumer(release, "worktodo").status, "published_pending_reload");

  const adopted = await service.adopt({ moduleId: "c", consumerId: "worktodo", release });
  assert.equal(calls[1].name, "record_module_adoption");
  assert.deepEqual(calls[1].args, {
    p_module_id: "c",
    p_consumer_id: "worktodo",
    p_published_version: IDENTITY.version,
    p_published_build: IDENTITY.build,
  });
  assert.equal(calls[2].name, "get_published_module_release");
  assert.deepEqual(calls[2].args, { p_module_id: "c" });
  assert.equal(service.forConsumer(adopted, "worktodo").status, "adopted");
});

test("runtime release service never reports adoption success when Cloud read-back disagrees", async () => {
  const calls = [];
  const service = loadService(async (name, args) => {
    calls.push({ name, args });
    if (name === "record_module_adoption") return releasePayload(args, "adopted");
    return releasePayload(args, "published_pending_reload");
  });
  const release = await service.read("c");

  await assert.rejects(
    service.adopt({ moduleId: "c", consumerId: "worktodo", release }),
    error => error && error.code === "ADOPTION_READBACK_MISMATCH",
  );
  assert.deepEqual(calls.map(call => call.name), ["get_published_module_release", "record_module_adoption", "get_published_module_release"]);
});

test("runtime release service is module-agnostic and does not encode a C-only consumer list", async () => {
  const calls = [];
  const service = loadService(async (name, args) => {
    calls.push({ name, args });
    return releasePayload(args);
  });

  await service.publish({
    moduleId: "navigation",
    consumers: ["worktodo", "ai-board", "settings"],
    ...IDENTITY,
    publishedVersion: IDENTITY.version,
    publishedBuild: IDENTITY.build,
    sourceCommit: IDENTITY.commit,
    sourceFingerprint: IDENTITY.fingerprint,
  });

  assert.equal(calls[0].args.p_module_id, "navigation");
  assert.deepEqual(calls[0].args.p_consumer_ids, ["worktodo", "ai-board", "settings"]);
});

test("publish rejects missing consumers before touching Cloud", async () => {
  let called = false;
  const service = loadService(async () => {
    called = true;
    return null;
  });

  await assert.rejects(
    service.publish({ moduleId: "c", ...IDENTITY, publishedVersion: IDENTITY.version, publishedBuild: IDENTITY.build }),
    /At least one module consumer/,
  );
  assert.equal(called, false);
});

test("runtime release service has no browser-local persistence path", () => {
  const source = fs.readFileSync(SERVICE, "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
});

test("runtime release service compares loaded source with persisted published source", () => {
  const service = loadService(async () => null);
  const matching = service.compareSourceIdentity(
    { sourceCommit: IDENTITY.commit, sourceFingerprint: IDENTITY.fingerprint },
    { sourceCommit: IDENTITY.commit, sourceFingerprint: IDENTITY.fingerprint },
  );
  const mismatching = service.compareSourceIdentity(
    { sourceCommit: IDENTITY.commit, sourceFingerprint: IDENTITY.fingerprint },
    { sourceCommit: "fedcba9876543210fedcba9876543210fedcba98", sourceFingerprint: "b".repeat(64) },
  );
  assert.deepEqual(matching, { status: "matched", matches: true });
  assert.deepEqual(mismatching, { status: "mismatch", matches: false });
  assert.deepEqual(service.compareSourceIdentity({}, {}), { status: "unknown", matches: false });
});
