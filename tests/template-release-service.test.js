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

function releasePayload(args, status = "published_pending_reload", overrides = {}) {
  const consumers = {};
  for (const consumerId of args.p_consumer_ids || ["c", "worktodo", "ai-board"]) {
    consumers[consumerId] = {
      status,
      module_version: args.p_published_version || IDENTITY.version,
      build: args.p_published_build || IDENTITY.build,
    };
    if (status === "adopted" && overrides.includeAdoptionSourceIdentity !== false && args.includeAdoptionSourceIdentity !== false) {
      consumers[consumerId].source_commit = args.p_source_commit || IDENTITY.commit;
      consumers[consumerId].source_fingerprint = args.p_source_fingerprint || IDENTITY.fingerprint;
    }
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
  assert.equal(release.consumers.worktodo.sourceIdentityStatus, "resolved_from_published_release");
  assert.equal(release.consumers.worktodo.sourceIdentityPersisted, false);
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
  assert.equal(adopted.consumers.worktodo.sourceIdentityStatus, "matched");
  assert.equal(adopted.consumers.worktodo.sourceIdentityPersisted, true);
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
    error => error && error.code === "ADOPTION_SOURCE_IDENTITY_MISMATCH",
  );
  assert.deepEqual(calls.map(call => call.name), ["get_published_module_release", "record_module_adoption", "get_published_module_release"]);
});

test("runtime release service does not treat Version/Build as a complete source identity", () => {
  const service = loadService(async () => null);
  const release = service.normalize({
    module_id: "c",
    published_version: IDENTITY.version,
    published_build: IDENTITY.build,
    source_commit: IDENTITY.commit,
    source_fingerprint: IDENTITY.fingerprint,
    consumer_adoptions: {
      worktodo: {
        status: "adopted",
        module_version: IDENTITY.version,
        build: IDENTITY.build,
      },
    },
  }, "c");

  const consumer = service.forConsumer(release, "worktodo");
  assert.equal(consumer.identityMatches, true);
  assert.equal(consumer.adoption.sourceIdentityStatus, "resolved_from_published_release");
  assert.equal(consumer.adoption.sourceIdentityPersisted, false);

  const unverifiable = service.normalize({
    module_id: "c",
    published_version: IDENTITY.version,
    published_build: IDENTITY.build,
    consumer_adoptions: {
      worktodo: {
        status: "adopted",
        module_version: IDENTITY.version,
        build: IDENTITY.build,
      },
    },
  }, "c");
  assert.equal(service.forConsumer(unverifiable, "worktodo").identityMatches, false);
  assert.equal(unverifiable.consumers.worktodo.sourceIdentityStatus, "unknown");
});

test("adopt requires the canonical Cloud write to persist Published source identity", async () => {
  const service = loadService(async (name, args) => {
    if (name === "record_module_adoption") return releasePayload(args, "adopted", { includeAdoptionSourceIdentity: false });
    return releasePayload(args, "adopted", { includeAdoptionSourceIdentity: false });
  });
  const release = await service.read("c");

  await assert.rejects(
    service.adopt({ moduleId: "c", consumerId: "worktodo", release }),
    error => error && error.code === "ADOPTION_SOURCE_IDENTITY_MISMATCH",
  );
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

test("runtime release service preserves Published C and adopted semantic snapshots", async () => {
  const semanticSnapshot = {
    schemaVersion: 1,
    version: IDENTITY.version,
    build: IDENTITY.build,
    inventory: { baseline: "C Mother Template", capabilities: [{ id: "runtime-behavior", present: true }] },
    behaviorContract: { id: "module-c-lifecycle-acceptance-v1", source: "module-c-mother", completionDecision: "canonical" }
  };
  const payload = releasePayload({ p_module_id: "c", p_consumer_ids: ["ai-board"] });
  payload.published_snapshot = semanticSnapshot;
  payload.consumer_adoptions["ai-board"].snapshot = semanticSnapshot;
  const service = loadService(async () => payload);

  const release = await service.read("c");

  assert.deepEqual(release.publishedSnapshot, semanticSnapshot);
  assert.deepEqual(release.consumers["ai-board"].snapshot, semanticSnapshot);
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

test("development identity prefers the explicit current source over the published snapshot", () => {
  const service = loadService(async () => null);
  const previousRelease = global.ZhugeMotherTemplateRelease;
  const previousRegistry = global.ZhugeModuleDevelopmentIdentity;
  const developmentCommit = "0123456789abcdef0123456789abcdef01234567";
  const publishedCommit = "fedcba9876543210fedcba9876543210fedcba98";
  try {
    global.ZhugeMotherTemplateRelease = {
      getSnapshot: () => ({
        developmentVersion: IDENTITY.version,
        developmentBuild: IDENTITY.build,
        developmentSourceCommit: developmentCommit,
        developmentSourceFingerprint: "d".repeat(64),
        sourceCommit: publishedCommit,
        sourceFingerprint: "p".repeat(64),
      }),
      currentProductIdentity: () => ({ version: IDENTITY.version, build: IDENTITY.build }),
    };
    delete global.ZhugeModuleDevelopmentIdentity;
    const development = service.getDevelopmentIdentity("c");
    assert.equal(development.sourceCommit, developmentCommit);
    assert.equal(development.sourceFingerprint, "d".repeat(64));
    assert.equal(
      service.hasPendingDevelopment(
        { publishedVersion: IDENTITY.version, publishedBuild: IDENTITY.build, sourceFingerprint: "p".repeat(64) },
        development,
      ),
      true,
    );
  } finally {
    if (previousRelease === undefined) delete global.ZhugeMotherTemplateRelease;
    else global.ZhugeMotherTemplateRelease = previousRelease;
    if (previousRegistry === undefined) delete global.ZhugeModuleDevelopmentIdentity;
    else global.ZhugeModuleDevelopmentIdentity = previousRegistry;
  }
});
