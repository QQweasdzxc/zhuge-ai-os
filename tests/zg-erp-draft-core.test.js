const assert=require('assert');
const D=require('../ZG-ERP/erp-draft-core.js'),E=require('../ZG-ERP/erp-edit-core.js');
function mem(){const m=new Map();return {setItem:(k,v)=>m.set(k,v),getItem:k=>m.has(k)?m.get(k):null,removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]||null,get length(){return m.size;},_m:m};}
let t=1000;const clock=()=>t;
const st=mem(),ds=D.create(st,{now:clock});
const A='a@example.test',B='b@example.test';
const base={name:'Monitor',owner:'Ann',project:'P1'};
// 1 save / read back
assert.strictEqual(ds.put(A,'asset-edit','CODE1',{values:{...base,owner:'Bob'},base}).saved,true);
assert.strictEqual(ds.get(A,'asset-edit','CODE1').payload.values.owner,'Bob');
// 2 account separation: another account sees nothing, list excludes it
assert.strictEqual(ds.get(B,'asset-edit','CODE1'),null);
assert.strictEqual(ds.list(B).length,0);assert.strictEqual(ds.list(A).length,1);
// 3 no account: nothing stored
assert.strictEqual(ds.put('','asset-edit','CODE1',{}).saved,false);assert.strictEqual(ds.put(A,'asset-edit','',{}).saved,false);
assert.strictEqual(D.accountOf(null),'');assert.strictEqual(D.accountOf({email:'X@Example.test'}),'x@example.test');
// 4 restore plans
const stored=ds.get(A,'asset-edit','CODE1');
assert.strictEqual(D.restorePlan(stored,{...base},E.rebase).mode,'restored');
assert.strictEqual(D.restorePlan(stored,{...base,project:'P2'},E.rebase).mode,'merged');
assert.strictEqual(D.restorePlan(stored,{...base,project:'P2'},E.rebase).values.project,'P2');
const c=D.restorePlan(stored,{...base,owner:'Cy'},E.rebase);assert.strictEqual(c.mode,'conflict');assert.deepStrictEqual(c.conflicts,['owner']);
// same value typed by both sides is not a conflict
assert.strictEqual(D.restorePlan(stored,{...base,owner:'Bob'},E.rebase).mode,'merged');
// 5 draft equal to base: nothing to restore
ds.put(A,'asset-edit','CODE2',{values:base,base});assert.strictEqual(D.restorePlan(ds.get(A,'asset-edit','CODE2'),base,E.rebase).mode,'none');
// 6 no automatic expiry: an old draft is still there
t+=400*24*3600*1000;assert.strictEqual(ds.get(A,'asset-edit','CODE1').payload.values.owner,'Bob');t=1000;
// 7 corrupt / tampered record ignored
st.setItem(D.keyOf(A,'asset-edit','BAD'),'{not json');assert.strictEqual(ds.get(A,'asset-edit','BAD'),null);
st.setItem(D.keyOf(A,'asset-edit','X1'),JSON.stringify({v:1,account:B,kind:'asset-edit',entity:'X1',savedAt:t,payload:{}}));assert.strictEqual(ds.get(A,'asset-edit','X1'),null);
// 8 discard
ds.discard(A,'asset-edit','CODE1');assert.strictEqual(ds.get(A,'asset-edit','CODE1'),null);
// 9 storage failure is reported, not hidden; missing storage degrades
const bad={setItem(){throw new Error('quota');},getItem:()=>null,removeItem(){},key:()=>null,length:0};
assert.deepStrictEqual(D.create(bad).put(A,'k','e',{}),{saved:false,reason:'storage-failed'});
assert.strictEqual(D.create(null).put(A,'k','e',{}).saved,false);
// 10 entity with separator characters cannot collide across kinds/entities
ds.put(A,'k','a|b',{values:{x:1},base:{}});ds.put(A,'k','a',{values:{x:2},base:{}});assert.strictEqual(ds.get(A,'k','a|b').payload.values.x,1);assert.strictEqual(ds.get(A,'k','a').payload.values.x,2);
// 11 status wording keeps draft and saved distinct
assert(D.statusText('draft').includes('尚未存入正式資料'));assert(!D.statusText('saved').includes('草稿'));
// 12 foreign drafts are countable but unreadable, and removable only explicitly
ds.put(B,'asset-edit','Z9',{values:{a:1},base:{}});assert.strictEqual(ds.foreign(A).length,1);assert.strictEqual(ds.get(A,'asset-edit','Z9'),null);
ds.removeKeys(ds.foreign(A));assert.strictEqual(ds.foreign(A).length,0);assert.strictEqual(ds.list(B).length,0);
// 13 human field labels for conflict messages
assert.deepStrictEqual(D.fieldLabels(['owner','department','zzz']),['保管人','使用部門','其他欄位']);
console.log('draft-core tests pass');
