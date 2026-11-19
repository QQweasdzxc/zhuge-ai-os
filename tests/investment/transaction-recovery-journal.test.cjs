const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../../modules/investment/services/transaction-recovery-journal.js');
function storage(){const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
test('same-tab reload keeps only opaque identifier and timestamp, not financial draft',()=>{const s=storage();create(s,'A').begin('opaque-key-A');assert.equal(create(s,'A').read().key,'opaque-key-A');assert.deepEqual(Object.keys(JSON.parse([...s.m.values()][0])).sort(),['at','key']);});
test('other owner sees no pending key and cannot clear it',()=>{const s=storage();create(s,'A').begin('opaque-key-A');assert.equal(create(s,'B').read(),null);assert.throws(()=>create(s,'B').clear('opaque-key-A'));assert.equal(create(s,'A').read().key,'opaque-key-A');});
test('pending operation cannot be replaced by another submission',()=>{const s=storage(),j=create(s,'A');j.begin('opaque-key-A');assert.throws(()=>j.begin('opaque-key-B'));assert.equal(j.read().key,'opaque-key-A');});
test('only matching key clears pending operation',()=>{const s=storage(),j=create(s,'A');j.begin('opaque-key-A');assert.throws(()=>j.clear('opaque-key-B'));j.clear('opaque-key-A');assert.equal(j.read(),null);});
test('missing storage and unavailable storage fail closed',()=>{assert.throws(()=>create(null,'A').read());const j=create({getItem:()=>null,setItem:()=>{throw Error();}},'A');assert.throws(()=>j.begin('opaque-key-A'));});
test('corruption and unexpected fields fail closed',()=>{const s=storage(),j=create(s,'A');j.begin('opaque-key-A');const slot=[...s.m.keys()][0];for(const v of ['{','null','{}',JSON.stringify({key:'opaque-key-A',at:1,price:50})]){s.setItem(slot,v);assert.throws(()=>j.read());}});
test('silently dropped writes are rejected before mutation',()=>{const j=create({getItem:()=>null,setItem:()=>{}},'A');assert.throws(()=>j.begin('opaque-key-A'));});
