import test from "node:test";
import assert from "node:assert/strict";
import {createServerProtectedDetailStore} from "../labs/taskflow/pages-client/server-protected-detail-store-reference.mjs";

const key = Buffer.alloc(32, 7);
const scope = {authority_scope: "TASKFLOW_AUTHORITY_VERIFIED", workspace_id: "ws-1", issue_id: "issue-113", event_id: "event-1"};
const principalResolver = async () => ({verified: true, source: "TASKFLOW_AUTHORITY", user_id: "server-user"});
const aclResolver = async input => input.workspace_id === "ws-1" ? ({workspace: "ALLOW", issue: "ALLOW"}) : ({workspace: "DENY", issue: "DENY"});

test("reference Detail Store encrypts sensitive values and returns only scoped references", async () => {
  const store = createServerProtectedDetailStore({encryptionKey: key, principalResolver, aclResolver});
  const written = await store.put({scope, label: "next_step", value: "API_KEY=never-public"});
  assert.equal(written.stored, true);
  assert.match(written.protected_ref, /^vault:\/\/taskflow\/ws-1\/issue-113\//);
  const read = await store.get({scope, protected_ref: written.protected_ref});
  assert.equal(read.value, "API_KEY=never-public");
  const crossWorkspace = await store.get({scope: {...scope, workspace_id: "ws-2"}, protected_ref: written.protected_ref});
  assert.equal(crossWorkspace.reason, "DETAIL_SCOPE_UNVERIFIED");
});

test("reference Detail Store fails closed without server encryption binding", async () => {
  const store = createServerProtectedDetailStore({principalResolver, aclResolver});
  assert.equal((await store.put({scope, label: "x", value: "secret"})).reason, "DETAIL_STORE_UNWIRED");
});
