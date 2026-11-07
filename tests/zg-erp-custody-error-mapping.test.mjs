import {test} from 'node:test';
import a from 'node:assert/strict';
import {custodyErrorMapping} from '../supabase/functions/zg-ledger-bridge/row-control-core.mjs';

test('verified: wrong-token/expired renew maps to 409 CUSTODY_EXPIRED',()=>{
  const m=custodyErrorMapping('CUSTODY_erp_renew:EDIT_PERMISSION_EXPIRED');
  a.equal(m.status,409);a.equal(m.code,'CUSTODY_EXPIRED');
  a.equal(m.message,'編輯權限已失效或已被其他操作取代，請重新讀取後核對。');
});
test('verified: missing lock row on renew (P0002) maps to 409 CUSTODY_EXPIRED',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_renew:query returned no rows').code,'CUSTODY_EXPIRED');
});
test('verified: begin_write stale/expired lock maps to 409',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_begin_write:EDIT_PERMISSION_EXPIRED').code,'CUSTODY_EXPIRED');
});
test('verified: begin_write vanished lock row (P0002) maps to 409',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_begin_write:query returned no rows').code,'CUSTODY_EXPIRED');
});
test('unchanged: reserve contention stays 409 RECORD_BUSY with original wording',()=>{
  a.deepEqual(custodyErrorMapping('CUSTODY_erp_reserve:RECORD_BUSY'),{status:409,code:'RECORD_BUSY',message:'這筆資料正由其他操作處理，尚未保存；輸入保留，可稍後再試。'});
});
test('scoped: begin_write non-expiry P0001s (OPERATION_EXPIRED / invalid keys) stay 500',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_begin_write:OPERATION_EXPIRED').status,500);
  a.equal(custodyErrorMapping('CUSTODY_erp_begin_write:invalid keys').status,500);
});
test('release path untouched: release rpc errors stay 500 (silent-200 semantics live in erp_release)',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_release:EDIT_PERMISSION_EXPIRED').status,500);
  a.equal(custodyErrorMapping('CUSTODY_erp_release:query returned no rows').status,500);
});
test('no global masking: expiry strings without verified custody prefix stay 500',()=>{
  a.equal(custodyErrorMapping('EDIT_PERMISSION_EXPIRED').status,500);
  a.equal(custodyErrorMapping('query returned no rows').status,500);
  a.equal(custodyErrorMapping('CUSTODY_erp_reserve:EDIT_PERMISSION_EXPIRED').status,500);
  a.equal(custodyErrorMapping('scanPlan:EDIT_PERMISSION_EXPIRED').status,500);
});
test('unexpected faults stay 500 INTERNAL',()=>{
  a.deepEqual(custodyErrorMapping('fetch failed'),{status:500,code:'INTERNAL',message:'Unexpected error.'});
  a.equal(custodyErrorMapping(undefined).status,500);
  a.equal(custodyErrorMapping('').status,500);
});
test('expired message does not promise input retention',()=>{
  a.equal(custodyErrorMapping('CUSTODY_erp_renew:EDIT_PERMISSION_EXPIRED').message.includes('輸入保留'),false);
});
