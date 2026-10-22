import test from "node:test";
import assert from "node:assert/strict";
import {createAgentProtectedDetailStore} from "../labs/taskflow/pages-client/agent-detail-store-contract.mjs";

const scope = {verified: true, source: "TASKFLOW_AUTHORITY", issue_id: "issue-113", workspace_id: "ws-1", event_id: "event-1", executor_id: "CO-02"};

test("protected detail store fails closed without native binding", async () => {
  const store = createAgentProtectedDetailStore();
  assert.equal((await store.putDetail({scope, label: "next_step", value: "secret"})).reason, "DETAIL_STORE_UNWIRED");
  assert.equal((await store.getDetail({scope, protectedRef: "ref-1"})).reason, "DETAIL_STORE_UNWIRED");
});

test("protected detail store requires server scope and opaque provider reference", async () => {
  const calls = [];
  const store = createAgentProtectedDetailStore({
    put: async request => { calls.push(request); return {stored: true, protected_ref: "vault://detail/evt-1"}; },
    get: async request => ({found: true, value: "server-only-value", protected_ref: request.protected_ref})
  });
  assert.equal((await store.putDetail({scope: {...scope, verified: false}, label: "next_step", value: "secret"})).reason, "DETAIL_SCOPE_UNVERIFIED");
  const written = await store.putDetail({scope, label: "next_step", value: "secret"});
  assert.equal(written.protected_ref, "vault://detail/evt-1");
  assert.equal(calls[0].value, "secret");
  assert.equal((await store.getDetail({scope, protectedRef: written.protected_ref})).value, "server-only-value");
});
