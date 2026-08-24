const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Policy = require("../shared/services/template-adoption-policy.js");
const ManagementCenter = require("../shared/components/template-management-center.js");
const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

test("A/B/C are one canonical template registry and page adoption defaults off", () => {
  assert.deepEqual(Policy.TEMPLATE_IDS, ["navigation", "workspace", "board"]);
  assert.equal(Policy.TEMPLATES.navigation.code, "A");
  assert.equal(Policy.TEMPLATES.workspace.code, "B");
  assert.equal(Policy.TEMPLATES.board.code, "C");

  const service = Policy.createService({ dataGateway: { rpc: async () => ({}) } });
  assert.equal(service.isTemplateEnabled({ pageId: "ai-board", templateId: "navigation", userId: USER_ID }), false);
  assert.equal(service.isTemplateEnabled({ pageId: "ai-board", templateId: "not-a-template", userId: USER_ID }), false);
  assert.equal(Policy.PAGE_REGISTRY["tasks-new"].supportedTemplates.includes("board"), true);
  assert.deepEqual(
    Object.values(Policy.PAGE_REGISTRY)
      .filter(page => page.supportedTemplates.includes("workspace"))
      .map(page => page.id),
    ["worklog"]
  );
});

test("template adoption uses guarded Cloud RPCs and never local storage", async () => {
  const calls = [];
  const service = Policy.createService({
    dataGateway: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_creator_template_adoption_preferences") {
          return { is_creator: true, version: 1, template_adoption: { version: 1, pages: { "ai-board": { navigation: true } } } };
        }
        return { enabled: args.p_enabled };
      }
    }
  });

  const loaded = await service.load({ userId: USER_ID, isCreator: true });
  assert.equal(service.isTemplateEnabled({ pageId: "ai-board", templateId: "navigation", userId: USER_ID }), true);
  assert.equal(loaded.pages["ai-board"].navigation, true);
  await service.setEnabled({ pageId: "tasks-new", templateId: "navigation", userId: USER_ID, isCreator: true, enabled: true });
  assert.deepEqual(calls[1], {
    name: "set_creator_template_adoption_preference",
    args: { p_page_id: "tasks-new", p_template_id: "navigation", p_enabled: true }
  });

  const nonCreator = await service.load({ userId: "other-user", isCreator: false });
  assert.equal(nonCreator.pages["ai-board"], undefined);
  await assert.rejects(service.setEnabled({ pageId: "ai-board", templateId: "navigation", userId: "other-user", isCreator: false, enabled: true }), /Creator/);
});

test("Template Management Center derives consumers and counts from the canonical Registry", async () => {
  const service = Policy.createService({
    dataGateway: {
      rpc: async () => ({
        is_creator: true,
        template_adoption: {
          version: 1,
          pages: {
            dashboard: { navigation: true },
            worklog: { workspace: true },
            "ai-board": { board: true },
            "tasks-new": { board: false }
          }
        }
      })
    }
  });
  await service.load({ userId: USER_ID, isCreator: true });

  const models = ManagementCenter.buildTemplateModel({
    runtime: { service },
    policy: { status: "resolved", is_creator: true, userId: USER_ID },
    service,
    templates: Policy.TEMPLATES,
    pages: Policy.PAGE_REGISTRY,
    userId: USER_ID,
    status: "resolved",
    isCreator: true
  });

  assert.deepEqual(models.map(model => model.template.id), ["navigation", "workspace", "board"]);
  assert.equal(models.find(model => model.template.id === "navigation").consumers.length, 8);
  assert.equal(models.find(model => model.template.id === "workspace").consumers.length, 1);
  assert.deepEqual(models.find(model => model.template.id === "workspace").consumers.map(page => page.id), ["worklog"]);
  assert.deepEqual(models.find(model => model.template.id === "board").consumers.map(page => page.id), ["ai-board", "tasks-new"]);
  assert.equal(models.find(model => model.template.id === "navigation").enabledCount, 1);
  assert.equal(models.find(model => model.template.id === "workspace").enabledCount, 1);
  assert.equal(models.find(model => model.template.id === "board").enabledCount, 1);
});

test("Template Management Center bind waits for a policy event instead of scheduling a render loop", async () => {
  const previousDocument = global.document;
  const previousRuntime = global.ZhugeTemplateAdoptionRuntime;
  const listeners = new Map();
  let refreshes = 0;

  global.document = {
    addEventListener(name, callback) {
      listeners.set(name, callback);
    }
  };
  global.ZhugeTemplateAdoptionRuntime = { policy: { status: "resolved" } };

  try {
    ManagementCenter.bind({ querySelectorAll: () => [] }, { onUpdated: () => { refreshes += 1; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(refreshes, 0);
    listeners.get("zhuge-template-adoption-ready")?.();
    assert.equal(refreshes, 1);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousRuntime === undefined) delete global.ZhugeTemplateAdoptionRuntime;
    else global.ZhugeTemplateAdoptionRuntime = previousRuntime;
  }
});

test("template adoption is separate from MFA and attaches to the existing Shared Runtime", () => {
  const migration = read("docs/supabase/20260823_creator_template_adoption_control.sql");
  assert.match(migration, /get_creator_template_adoption_preferences/);
  assert.match(migration, /set_creator_template_adoption_preference/);
  assert.match(migration, /template_adoption_policy_v1/);
  assert.match(migration, /p_template_id/);
  assert.doesNotMatch(migration, /service_role/i);

  const board = read("app/Board/ai/board-runtime.js");
  const management = read("shared/components/template-management-center.js");
  assert.doesNotMatch(board, /mountTemplateAdoptionSettings|模板套用設定|data-template-adoption-settings/);
  assert.match(management, /data-template-management-center/);
  assert.match(management, /supportedTemplates/);
  assert.match(management, /setEnabled\(\{ pageId, templateId, userId:/);
  assert.match(management, /bootstrapTemplatePolicy\(\{ force: true \}\)/);
  assert.doesNotMatch(management, /queueMicrotask\(\(\) => options\.onUpdated\(\)\)/);

  const context = read("shared/services/module-context.js");
  const provider = read("shared/auth/runtime-session-provider.js");
  assert.match(context, /const templates = Object\.freeze/);
  assert.match(provider, /templatePolicy/);
  assert.match(provider, /readSecurityState = request =>/);
  assert.match(provider, /templatePolicy\n    \}\);/);
});
