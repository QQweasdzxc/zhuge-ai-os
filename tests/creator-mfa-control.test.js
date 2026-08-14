const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CreatorResolver = require("../shared/identity/creator-resolver.js");
const Mfa = require("../shared/security/mfa-service.js");

const ROOT = path.join(__dirname, "..");
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Creator Resolver uses the canonical UUID through one Cloud capability RPC", async () => {
  const calls = [];
  const resolver = CreatorResolver.create({
    readUserId: () => USER_ID,
    dataGateway: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { user_id: USER_ID, is_creator: true };
      }
    }
  });

  const state = await resolver.resolve();
  assert.equal(state.userId, USER_ID);
  assert.equal(state.is_creator, true);
  assert.equal(resolver.isCreator(), true);
  assert.deepEqual(calls, [{ name: "resolve_creator_capability", args: {} }]);
  assert.equal("access_token" in state, false);
});

test("Creator Resolver treats unknown and Cloud errors as non-Creator", async () => {
  const unknown = CreatorResolver.create({ readUserId: () => "" });
  assert.equal((await unknown.resolve()).is_creator, false);

  const failed = CreatorResolver.create({
    readUserId: () => USER_ID,
    dataGateway: { rpc: async () => { throw new Error("network failed"); } }
  });
  const state = await failed.resolve();
  assert.equal(state.status, "error");
  assert.equal(state.is_creator, false);
});

test("Creator MFA preferences are independent Cloud settings with ON fail-safe", async () => {
  const calls = [];
  const service = Mfa.createMfaService({
    gateway: { getAuthClient: async () => ({ auth: {} }), syncCanonicalSession: async () => ({}) },
    dataGateway: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "get_creator_mfa_preferences") return { investment_mfa_required: false, ai_board_mfa_required: true };
        return { required: args.p_required };
      }
    },
    storage: null
  });

  const loaded = await service.loadPolicy({ userId: USER_ID, isCreator: true });
  assert.equal(loaded.investment_mfa_required, false);
  assert.equal(loaded.ai_board_mfa_required, true);
  assert.equal(service.isModuleRequired("investment", USER_ID), false);
  assert.equal(service.isModuleRequired("ai-board", USER_ID), true);

  await service.setRequired({ moduleId: "ai-board", userId: USER_ID, isCreator: true, required: false });
  assert.deepEqual(calls[1], {
    name: "set_creator_mfa_preference",
    args: { p_module_id: "ai-board", p_required: false }
  });
  assert.equal(service.isModuleRequired("ai-board", USER_ID), false);

  const nonCreator = await service.loadPolicy({ userId: "other-user", isCreator: false });
  assert.equal(nonCreator.investment_mfa_required, true);
  assert.equal(nonCreator.ai_board_mfa_required, true);

  const errorService = Mfa.createMfaService({
    gateway: { getAuthClient: async () => ({ auth: {} }), syncCanonicalSession: async () => ({}) },
    dataGateway: { rpc: async () => { throw new Error("read failed"); } },
    storage: null
  });
  const failed = await errorService.loadPolicy({ userId: USER_ID, isCreator: true });
  assert.equal(failed.status, "error");
  assert.equal(failed.investment_mfa_required, true);
  assert.equal(failed.ai_board_mfa_required, true);
});

test("Creator MFA control remains on the controlled Cloud path", () => {
  const migration = read("docs/supabase/20260814_creator_only_mfa_control.sql");
  assert.match(migration, /resolve_creator_capability/);
  assert.match(migration, /get_creator_mfa_preferences/);
  assert.match(migration, /set_creator_mfa_preference/);
  assert.match(migration, /revoke insert, update, delete on table public\.user_settings from public/i);
  assert.match(migration, /investment_mfa_required/);
  assert.match(migration, /ai_board_mfa_required/);

  const mfa = read("shared/security/mfa-service.js");
  assert.doesNotMatch(mfa, /localStorage/);
  assert.match(mfa, /dataGateway\.rpc\("get_creator_mfa_preferences"/);
  assert.match(mfa, /dataGateway\.rpc\("set_creator_mfa_preference"/);

  const board = read("app/Board/ai/board-runtime.js");
  assert.match(board, /is_creator/);
  assert.match(board, /investment:\s*"Investment"/);
  assert.match(board, /"ai-board":\s*"AI Board"/);
  assert.match(board, /Google Authenticator/);
  assert.match(board, /🟡 二次驗證暫停/);
  assert.match(board, /setMfaRequired/);
  assert.match(board, /loadMfaPolicy/);
});
