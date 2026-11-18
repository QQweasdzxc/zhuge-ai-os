const test = require("node:test");
const assert = require("node:assert/strict");

const Repository = require("../../modules/investment/services/supabase-investment-repository.js");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";

// The repository write gate must follow the saved sensitive-write switch
// (aal2, or aal1 with investment_sensitive_write_mfa_required === false),
// never the entry switch. Unknown assurance or an unresolved policy is
// fail-closed. Mirrors the server-side split verified by
// legacy-write-mfa-policy-sql.test.cjs.

function makeData(calls) {
  return {
    async select(table) {
      calls.push({ type: "select", table });
      if (table === "app_users") return [{ id: "owner-1", email: "owner@example.com" }];
      if (table === "portfolios") return [{ id: "portfolio-1", name: "主要投資組合", base_currency: "TWD", is_default: true }];
      return [];
    },
    async rpc(name, payload) {
      calls.push({ type: "rpc", name, payload });
      if (name === "investment_record_transaction") return [{ transaction_id: "transaction-new", idempotent: false }];
      if (name === "investment_confirm_pending_action") return [{ action_id: "action-1", status: "confirmed", transaction_id: "transaction-1", idempotent: false }];
      if (name === "create_broker_position_snapshot") return [{ snapshot_id: "snapshot-1", was_existing: false }];
      return [];
    }
  };
}

function makeRepository({ aal, policy, allowAal1Read = true }) {
  // allowAal1Read is the module bootstrap's translation of the entry switch:
  // entry off -> aal1 reads allowed; entry on -> the module requires aal2
  // before any page data loads. The write gate under test is independent of it.
  const calls = [];
  const data = makeData(calls);
  const repository = Repository.create({
    userId: USER_ID,
    data,
    gateway: data,
    allowAal1Read,
    sessionSnapshot: { isAuthenticated: true, aal },
    getMfaPolicy: () => policy
  });
  return { repository, calls };
}

const resolvedCreator = (overrides = {}) => ({
  status: "resolved",
  is_creator: true,
  userId: USER_ID,
  investment_entry_mfa_required: true,
  investment_sensitive_write_mfa_required: false,
  ...overrides
});

const draft = {
  tradeDate: "2026-11-18",
  tradeType: "BUY",
  symbol: "2330",
  name: "台積電",
  market: "TW",
  quantity: 1,
  price: 1000,
  fee: 0,
  tax: 0,
  currency: "TWD",
  idempotencyKey: "synthetic-write-policy-001"
};

test("write gate allows aal1 when the saved sensitive-write switch is off", async () => {
  const { repository, calls } = makeRepository({ aal: "aal1", policy: resolvedCreator() });
  const result = await repository.recordTransaction(draft);
  assert.equal(result.transaction_id, "transaction-new");
  assert.equal(calls.filter(c => c.type === "rpc" && c.name === "investment_record_transaction").length, 1);
});

test("write gate blocks aal1 when the sensitive-write switch is on, even with entry off", async () => {
  const { repository, calls } = makeRepository({
    aal: "aal1",
    policy: resolvedCreator({ investment_entry_mfa_required: false, investment_sensitive_write_mfa_required: true })
  });
  await assert.rejects(repository.recordTransaction(draft), (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED");
  assert.equal(calls.filter(c => c.type === "rpc").length, 0);
});

test("entry on still fences an aal1 session end-to-end (record path loads portfolio data)", async () => {
  // With the entry switch on the module keeps allowAal1Read false, so even
  // with the write switch off an aal1 session cannot reach the write RPC:
  // the internal read already requires step-up. Writes never loosen entry.
  const { repository, calls } = makeRepository({
    aal: "aal1",
    allowAal1Read: false,
    policy: resolvedCreator({ investment_entry_mfa_required: true, investment_sensitive_write_mfa_required: false })
  });
  await assert.rejects(repository.recordTransaction(draft), (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED");
  assert.equal(calls.filter(c => c.type === "rpc").length, 0);
});

test("write gate always allows aal2", async () => {
  const { repository } = makeRepository({
    aal: "aal2",
    policy: resolvedCreator({ investment_sensitive_write_mfa_required: true })
  });
  const result = await repository.recordTransaction(draft);
  assert.equal(result.transaction_id, "transaction-new");
});

test("write gate is fail-closed for unknown assurance", async () => {
  const { repository, calls } = makeRepository({ aal: "unknown", policy: resolvedCreator() });
  await assert.rejects(repository.recordTransaction(draft), (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED");
  assert.equal(calls.filter(c => c.type === "rpc").length, 0);
});

test("write gate is fail-closed when the policy is unresolved or bound to another user", async () => {
  for (const policy of [
    { status: "loading" },
    resolvedCreator({ userId: "someone-else" }),
    resolvedCreator({ is_creator: false })
  ]) {
    const { repository, calls } = makeRepository({ aal: "aal1", policy });
    await assert.rejects(repository.recordTransaction(draft), (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED");
    assert.equal(calls.filter(c => c.type === "rpc").length, 0);
  }
});

test("pending confirm and broker snapshot share the same policy-aware write gate", async () => {
  const allowed = makeRepository({ aal: "aal1", policy: resolvedCreator() });
  const confirmed = await allowed.repository.confirmPendingAction("action-1");
  assert.equal(confirmed.action_id, "action-1");
  const blocked = makeRepository({
    aal: "aal1",
    policy: resolvedCreator({ investment_sensitive_write_mfa_required: true })
  });
  await assert.rejects(blocked.repository.confirmPendingAction("action-1"), (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED");
  await assert.rejects(
    blocked.repository.createBrokerPositionSnapshot({ broker: "Synthetic", snapshotAt: "2026-11-18T10:00:00+08:00", positions: [], idempotencyKey: "synthetic-write-policy-snap" }),
    (err) => err && err.code === "INVESTMENT_ASSURANCE_REQUIRED"
  );
  assert.equal(blocked.calls.filter(c => c.type === "rpc").length, 0);
});

test("read gate keeps the existing entry behavior (aal1 read unchanged)", async () => {
  const { repository } = makeRepository({
    aal: "aal1",
    policy: resolvedCreator({ investment_sensitive_write_mfa_required: true })
  });
  // Reads never consulted the write switch; they must not throw the write error.
  await assert.doesNotReject(repository.loadTransactions());
});
