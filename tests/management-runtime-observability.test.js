const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ManagementCenter = require("../shared/components/template-management-center.js");
const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const RELEASE = {
  publishedVersion: "0.9.0-alpha.9.13",
  publishedBuild: "20260911-1445",
  consumers: {
    c: { status: "adopted", moduleVersion: "0.9.0-alpha.9.13", build: "20260911-1445" },
    "ai-board": { status: "adopted", moduleVersion: "0.9.0-alpha.9.13", build: "20260911-1445" },
    worktodo: { status: "adopted", moduleVersion: "0.9.0-alpha.9.13", build: "20260911-1445" },
    "gas-instance": { status: "adopted", moduleVersion: "0.9.0-alpha.9.13", build: "20260911-1445" },
    "investment-instance": { status: "adopted", moduleVersion: "0.9.0-alpha.9.13", build: "20260911-1445" }
  }
};

const instances = [
  { id: "mother-instance", name: "C 母版測試", templateKey: "c", isTemplateInstance: true, active: true, consumerId: "c" },
  { id: "ai-instance", name: "AI Board", templateKey: "c", legacyApplicationScope: "ai_board", active: true, consumerId: "ai-board" },
  { id: "worktodo-instance", name: "工作待辦", templateKey: "c", legacyApplicationScope: "worktodo", active: true, consumerId: "worktodo" },
  { id: "gas-instance", name: "庶務行政", templateKey: "c", taskCodePrefix: "GAS", active: true, consumerId: "gas-instance" },
  { id: "investment-instance", name: "投資戰情板", templateKey: "c", taskCodePrefix: "IVTK", active: true, consumerId: "investment-instance" }
];

function authority(instance, options = {}) {
  return {
    board_instance_id: instance.id,
    contract: "module-c-authority-conformance-v2",
    status: options.status || "pass",
    feature: { shared_runtime: "module-c-golden-master-runtime" },
    source: {
      module_adoption_key: instance.consumerId,
      module_release_adopted: true,
      consumer_data_scope: "board-instance-owned"
    },
    authority: {
      card: "module-c-canonical-contract",
      cloud_writer: "controlled-security-definer-rpc+private-core",
      completion: "module-c-canonical-contract",
      archive: "module-c-canonical-contract"
    },
    workflow: { status: options.workflow || "not_configured" },
    completion_designation: { status: options.completion || "configured" },
    archive_designation: { status: options.archive || "configured" },
    policy: {
      identity: "module-c-completion-archive-policy",
      current_delay_seconds: 86400
    },
    legacy_routes: { current_route_reachable: false }
  };
}

test("runtime model uses actual C Board Instances and preserves consumer differences", () => {
  const authorities = new Map(instances.map(instance => [instance.id, { value: authority(instance, { workflow: instance.id === "ai-instance" ? "published" : "not_configured" }) }]));
  const entries = ManagementCenter.buildRuntimeIdentityModel({
    instances,
    authorities,
    release: RELEASE,
    navigation: {
      destination(id) {
        return {
          "ai-board": "/app/Board/ai/",
          "tasks-new": "/app/Board/worktodo/",
          procurement: "/app/Board/procurement/",
          investment: "/modules/investment/"
        }[id] || "#";
      }
    }
  });

  assert.deepEqual(entries.map(entry => entry.key), ["c-mother", "ai-board", "worktodo", "gas", "investment"]);
  assert.equal(entries.find(entry => entry.key === "worktodo").boardInstanceId, "worktodo-instance");
  assert.equal(entries.find(entry => entry.key === "worktodo").runtime, "C Shared Runtime");
  assert.equal(entries.find(entry => entry.key === "worktodo").data, "Existing WorkTodo Same Data · Board Instance-owned");
  assert.equal(entries.find(entry => entry.key === "worktodo").writer, "C Canonical Writer · Single Writer");
  assert.equal(entries.find(entry => entry.key === "worktodo").workflow, "NOT_CONFIGURED / N/A");
  assert.equal(entries.find(entry => entry.key === "worktodo").lifecycle, "C Shared / 24h");
  assert.equal(entries.find(entry => entry.key === "worktodo").legacy, "Retired");
  assert.equal(entries.find(entry => entry.key === "worktodo").runtimeEntry, "/app/Board/worktodo/");
  assert.equal(entries.find(entry => entry.key === "worktodo").health, "Current / Healthy");
  assert.equal(entries.find(entry => entry.key === "ai-board").workflow, "Configured / Published");
  assert.equal(entries.find(entry => entry.key === "ai-board").health, "Current / Healthy");
  assert.equal(entries.find(entry => entry.key === "investment").writer, "C Shared Contract · Read-only");
  assert.equal(entries.find(entry => entry.key === "investment").lifecycle, "N/A（Read-only）");
});

test("runtime model never turns missing evidence into a healthy status", () => {
  const worktodo = instances.find(instance => instance.consumerId === "worktodo");
  const entries = ManagementCenter.buildRuntimeIdentityModel({
    instances: [worktodo],
    authorities: new Map([[worktodo.id, { error: new Error("checker unavailable") }]]),
    release: RELEASE,
    navigation: { destination: () => "/app/Board/worktodo/" }
  });
  const entry = entries.find(item => item.key === "worktodo");
  assert.equal(entry.health, "Unknown / Not Available");
  assert.equal(entry.runtime, "Unknown / Not Available");
  assert.equal(entry.writer, "Unknown / Not Available");
  assert.match(entry.authorityError, /checker unavailable/);
});

test("GAS and Investment adoption is resolved by their real Cloud instance keys", () => {
  const selected = instances.filter(instance => ["GAS", "IVTK"].includes(instance.taskCodePrefix));
  const authorities = new Map(selected.map(instance => [instance.id, { value: authority(instance) }]));
  const entries = ManagementCenter.buildRuntimeIdentityModel({ instances: selected, authorities, release: RELEASE });
  assert.match(entries.find(entry => entry.key === "gas").adoption, /已採用/);
  assert.match(entries.find(entry => entry.key === "investment").adoption, /已採用/);
  assert.equal(entries.find(entry => entry.key === "gas").adoptionKey, "gas-instance");
  assert.equal(entries.find(entry => entry.key === "investment").adoptionKey, "investment-instance");
});

test("Management Center observes existing Cloud/runtime authorities without adding a writer or registry", () => {
  const source = read("shared/components/template-management-center.js");
  const authoritySource = source.slice(source.indexOf("function authorityModel"), source.indexOf("function buildRuntimeIdentityModel"));
  assert.match(source, /listModuleConsumers\(\{ templateKey: "c", gateway \}\)/);
  assert.match(source, /createInstanceService\(/);
  assert.match(source, /getAuthorityConformance\(\)/);
  assert.match(source, /ZhugeModulePublishService/);
  assert.match(source, /module-c-golden-master-runtime/);
  assert.match(source, /board-instance-owned/);
  assert.doesNotMatch(authoritySource, /cloudEnabled/);
  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /data-template-runtime-observability/);
});
