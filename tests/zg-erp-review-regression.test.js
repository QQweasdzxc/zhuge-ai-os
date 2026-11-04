const test=require('node:test');const assert=require('node:assert/strict');
const {reconcile,snapshotOf}=require('../ZG-ERP/erp-reconcile.js');
const a={recordKey:'R1',code:'A',siteLead:'4F (115.下)',zone:'4F',name:'A',project:'P'};
const b={...a,recordKey:'R2',siteLead:'別頁'};
const db={assets:[{code:'A',site:'4F',zone:'4F',project:'P'}],sessions:[],records:[]};
test('source filter is provenance only, not actual observed site',()=>{
 const r=reconcile([a],db,{source:'4F (115.下)',project:'P'},[]);
 assert.equal(r.matched.length,1);assert.equal(r.pending.length,0);assert.equal(r.counts.newInventory,1);
});
test('source filter cannot silently canonicalize a duplicate from other source',()=>{
 const r=reconcile([a,b],db,{source:a.siteLead},[]);
 assert.equal(r.ambiguous.length,1);assert.equal(r.ambiguous[0].totalCandidates,2);
 assert.equal(r.matched.length,0);
});
test('duplicate candidate annotation readback and snapshot drift, identity remains unresolved',()=>{
 const ann={recordKey:'R1',snapshot:snapshotOf(a),conclusion:'其他',reason:'已退回',evidence:'單據1',confirmer:'主管',note:'去向倉庫'};
 const r=reconcile([a,b],db,{},[ann]);
 assert.equal(r.clarified.length,1);assert.equal(r.clarified[0].identityUnresolved,true);assert.equal(r.clarified[0].annotation.evidence,'單據1');assert.equal(r.ambiguous.length,1);
 const drift=reconcile([{...a,zone:'新位置'},b],db,{},[ann]);
 assert.equal(drift.clarified.length,0);assert.equal(drift.staleAnnotations.length,1);assert.equal(drift.ambiguous.length,1);
});
