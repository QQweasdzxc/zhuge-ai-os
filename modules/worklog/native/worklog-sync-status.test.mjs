import test from 'node:test';
import assert from 'node:assert/strict';
import {syncFailureLabel,syncConnectionLabel} from './worklog-sync-status.mjs';
test('no server error does not claim a healthy completed sync',()=>{assert.match(syncConnectionLabel({error:null}),/未重新驗證/)});
test('failed attempt survives null server error and old timestamp',()=>{const message=syncFailureLabel({code:'PROVIDER_FAILED'});assert.match(message,/PROVIDER_FAILED/);assert.equal(syncConnectionLabel({error:null},{lastAttempt:message}),message);assert.match(message,/TF 已儲存/)});
test('only bounded diagnostic code is shown, not raw server payload',()=>{assert.match(syncFailureLabel({code:'<script>private token</script>',message:'private'}),/UNKNOWN/);assert.doesNotMatch(syncFailureLabel({message:'private'}),/private/)});
test('running takes priority and server error remains an unfinished state',()=>{assert.match(syncConnectionLabel({error:'failed'},{syncing:true}),/同步中/);assert.match(syncConnectionLabel({error:'failed'}),/未完成/)});

test('server status error is never rendered verbatim, including long or credential-shaped content',()=>{const expected='Google 同步尚有未完成項目，請確認日曆結果；TF 已儲存的工時保留。';for(const error of ['x'.repeat(100000),'<script>synthetic private payload</script>','Bearer SYNTHETIC_CREDENTIAL_SHAPE_ONLY','access_token=synthetic-not-a-secret','RECONNECT']){assert.equal(syncConnectionLabel({error}),expected);assert.doesNotMatch(syncConnectionLabel({error}),/synthetic|Bearer|script|RECONNECT|重新連線/);}});
