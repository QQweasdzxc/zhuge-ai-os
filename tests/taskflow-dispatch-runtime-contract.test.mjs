import test from "node:test";
import assert from "node:assert/strict";
import {acceptProviderEvent, acquireWriterLease, createDispatchIntent, dispatchIntentKey, resolveDuplicateIntent} from "../labs/taskflow/pages-client/dispatch-runtime-contract.mjs";

const base={intentId:"intent-1",issuerUserId:"user-cto",issuerAuthorization:"AUTHORIZED",workspace:"zhuge-ai-os",scope:"taskflow",workCode:"DM-02",issueId:"issue-1",executorId:"CO-02",provider:"codex"};

test("dispatch intent is scoped and idempotent",()=>{
  const intent=createDispatchIntent(base);
  assert.equal(intent.idempotency_key,dispatchIntentKey(base));
  assert.equal(resolveDuplicateIntent(intent,{...intent}).action,"REUSE");
  assert.equal(resolveDuplicateIntent({...intent,provider_run_id:"run-a"},{...intent,provider_run_id:"run-b"}).action,"BLOCK");
});
test("CTO authority and writer lease fail closed",()=>{
  const intent=createDispatchIntent({...base,issuerAuthorization:"UNVERIFIED"});
  assert.equal(acquireWriterLease(intent,{writerId:"writer",fencingToken:"f-1",expiresAt:Date.now()+1000}).reason,"CTO_AUTHORIZATION_UNVERIFIED");
  assert.equal(acquireWriterLease(createDispatchIntent(base),{writerId:"writer",fencingToken:"f-1",expiresAt:Date.now()-1}).reason,"LEASE_INVALID");
});
test("provider evidence requires real run id and current fencing token",()=>{
  const lease=acquireWriterLease(createDispatchIntent(base),{writerId:"writer",fencingToken:"f-1",expiresAt:Date.now()+1000});
  assert.equal(acceptProviderEvent({status:"running",fencing_token:"wrong",provider_run_id:"run-1"},lease).reason,"FENCING_TOKEN_MISMATCH");
  assert.equal(acceptProviderEvent({status:"running",fencing_token:"f-1"},lease).reason,"PROVIDER_RUN_ID_MISSING");
  assert.equal(acceptProviderEvent({status:"running",fencing_token:"f-1",provider_run_id:"run-1"},lease).state,"RUNNING");
});
