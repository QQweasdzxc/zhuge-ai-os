const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Policy = require("../shared/services/template-adoption-policy.js");
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

test("template adoption is separate from MFA and attaches to the existing Shared Runtime", () => {
  const migration = read("docs/supabase/20260823_creator_template_adoption_control.sql");
  assert.match(migration, /get_creator_template_adoption_preferences/);
  assert.match(migration, /set_creator_template_adoption_preference/);
  assert.match(migration, /template_adoption_policy_v1/);
  assert.match(migration, /p_template_id/);
  assert.doesNotMatch(migration, /service_role/i);

  const board = read("app/Board/ai/board-runtime.js");
  assert.match(board, /模板套用設定/);
  assert.match(board, /不影響登入、MFA、RLS/);
  assert.match(board, /setEnabled\(\{ pageId, templateId: "navigation", enabled \}\)/);

  const context = read("shared/services/module-context.js");
  const provider = read("shared/auth/runtime-session-provider.js");
  assert.match(context, /const templates = Object\.freeze/);
  assert.match(provider, /templatePolicy/);
  assert.match(provider, /readSecurityState = request =>/);
  assert.match(provider, /templatePolicy\n    \}\);/);
});
