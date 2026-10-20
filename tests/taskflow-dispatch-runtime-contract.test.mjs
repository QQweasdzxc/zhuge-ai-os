import test from "node:test";
import assert from "node:assert/strict";
import {acceptHeartbeat, acceptProviderEvent, acceptUniqueProviderEvent, acquireWriterLease, createDispatchIntent, dispatchIntentKey, resolveDuplicateIntent} from "../labs/taskflow/pages-client/dispatch-runtime-contract.mjs";

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
test("provider events and heartbeats reject replay, stale lease and unknown evidence",()=>{
  const lease=acquireWriterLease(createDispatchIntent(base),{writerId:"writer",fencingToken:"f-1",expiresAt:Date.now()+1000});
  const seen=new Set();
  const event={event_id:"evt-1",status:"running",fencing_token:"f-1",provider_run_id:"run-1"};
  assert.equal(acceptUniqueProviderEvent(event,lease,seen).state,"RUNNING");
  assert.equal(acceptUniqueProviderEvent(event,lease,seen).reason,"PROVIDER_EVENT_REPLAY");
  assert.equal(acceptUniqueProviderEvent({...event,event_id:"evt-2",provider_run_id:""},lease,seen).reason,"PROVIDER_RUN_ID_MISSING");
  assert.equal(acceptUniqueProviderEvent({...event,event_id:"evt-3"},lease,seen,Date.now()+2000).reason,"LEASE_EXPIRED");
  assert.equal(acceptHeartbeat({fencing_token:"f-1",observed_at:Date.now()-61_000},lease).reason,"HEARTBEAT_STALE");
  assert.equal(acceptHeartbeat({fencing_token:"wrong",observed_at:Date.now()},lease).reason,"FENCING_TOKEN_MISMATCH");
  assert.equal(acceptProviderEvent({status:"mystery",fencing_token:"f-1",provider_run_id:"run-2"},lease).state,"UNKNOWN");
});
