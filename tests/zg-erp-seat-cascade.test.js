const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../ZG-ERP/erp-edit-core.js');

const A=(code,owner,department,extra={})=>({code,owner,department,project:'',...extra});
const B=(version,seat)=>({version,seat});

/* ---- planSeatCascade ---- */
test('plan: only same-version same-seat peers, only owner/department, only real changes',()=>{
  const assets=[A('P1','公用',''),A('P2','王教權','管理部'),A('OTHER','公用',''),A('OLDMAP','公用','')];
  const bindings={P1:B('v',1),P2:B('v',1),OTHER:B('v',2),OLDMAP:B('v0',1)};
  const plan=E.planSeatCascade({bindings,assets,code:'SELF',changed:{owner:'魏國峯',department:'管理部'}});
  // SELF has no binding -> no cascade at all
  assert.equal(plan.seat,null);assert.deepEqual(plan.peers,[]);
  bindings.SELF=B('v',1);
  const plan2=E.planSeatCascade({bindings,assets,code:'SELF',changed:{owner:'魏國峯',department:'管理部'}});
  assert.deepEqual(plan2.seat,{version:'v',seat:1});
  assert.deepEqual(plan2.peers,[
    {code:'P1',patch:{owner:'魏國峯',department:'管理部'},expected:{owner:'公用',department:''}},
    {code:'P2',patch:{owner:'魏國峯'},expected:{owner:'王教權'}}, // department already 管理部 -> untouched
  ]);
});

test('plan: project and other fields never cascade; occupant is never a source',()=>{
  const assets=[A('P1','公用','',{project:'X'})];
  const bindings={SELF:B('v',4),P1:B('v',4)};
  const plan=E.planSeatCascade({bindings,assets,code:'SELF',changed:{department:'管理部'}});
  assert.deepEqual(plan.fields,['department']);
  assert.deepEqual(plan.peers,[{code:'P1',patch:{department:'管理部'},expected:{department:''}}]);
  assert.ok(!('project' in plan.peers[0].patch));
  const none=E.planSeatCascade({bindings,assets,code:'SELF',changed:{project:'Y',zone:'9F',status:'維修'}});
  assert.deepEqual(none.fields,[]);assert.deepEqual(none.peers,[]);
});

test('plan: peers already consistent -> empty cascade; no fields -> empty',()=>{
  const assets=[A('P1','魏國峯','管理部')];
  const bindings={SELF:B('v',1),P1:B('v',1)};
  const plan=E.planSeatCascade({bindings,assets,code:'SELF',changed:{owner:'魏國峯'}});
  assert.deepEqual(plan.peers,[]);
});

/* ---- runSeatCascade with fake store ---- */
function fakeStore(rows,opts={}){
  const calls=[];
  const store={
    calls,
    async readAssetForEdit(code){calls.push(['read',code]);const r=rows[code];if(!r)throw new Error('找不到設備 '+code);return {...r};},
    async reserveAssetEdit(code){calls.push(['reserve',code]);if(opts.failReserve===code)throw new Error('正由其他人編輯');},
    async releaseAssetEdit(code){calls.push(['release',code]);},
    async saveAssetVerified(code,draft,base,opId){
      calls.push(['save',code,opId]);
      const r=rows[code];if(!r)throw new Error('找不到設備 '+code);
      if(opts.failSave&&opts.failSave(code,calls))throw new Error('寫入未確認');
      const normalized={...draft};if(['未指定（待確認）','未指定(待確認)','未指定'].includes(normalized.project))normalized.project=''; // mirrors adapter
      for(const k of Object.keys(normalized))if(String(normalized[k]??'')!==String(base[k]??''))r[k]=String(normalized[k]??'');
      return r;
    },
  };
  return store;
}

test('run: no peers -> primary save only',async()=>{
  const rows={SELF:A('SELF','公用','')};
  const st=fakeStore(rows);
  const res=await E.runSeatCascade(st,'SELF',A('SELF','魏國峯','管理部'),A('SELF','公用',''),{peers:[]},'OP1');
  assert.deepEqual(res,{saved:['SELF'],cascaded:[]});
  assert.equal(rows.SELF.owner,'魏國峯');
  assert.deepEqual(st.calls.map(c=>c[0]),['save']);
  assert.equal(st.calls[0][2],'OP1'); // shared operationId
});

test('run: happy path cascades all peers with one shared operationId',async()=>{
  const rows={SELF:A('SELF','公用',''),P1:A('P1','公用',''),P2:A('P2','王教權','管理部')};
  const st=fakeStore(rows);
  const plan={fields:['owner','department'],seat:{version:'v',seat:1},peers:[
    {code:'P1',patch:{owner:'魏國峯',department:'管理部'},expected:{owner:'公用',department:''}},
    {code:'P2',patch:{owner:'魏國峯'},expected:{owner:'王教權'}},
  ]};
  const res=await E.runSeatCascade(st,'SELF',A('SELF','魏國峯',''),A('SELF','公用',''),plan,'OPX');
  assert.deepEqual(res.saved,['SELF','P1','P2']);
  assert.equal(rows.P1.owner,'魏國峯');assert.equal(rows.P1.department,'管理部');
  assert.equal(rows.P2.owner,'魏國峯');assert.equal(rows.P2.department,'管理部'); // untouched value kept
  const opIds=st.calls.filter(c=>c[0]==='save').map(c=>c[2]);
  assert.deepEqual(opIds,['OPX','OPX','OPX']);
});

test('run: preflight drift aborts before any write',async()=>{
  const rows={SELF:A('SELF','公用',''),P1:A('P1','已變更','')};
  const st=fakeStore(rows);
  const plan={fields:['owner'],seat:{version:'v',seat:1},peers:[{code:'P1',patch:{owner:'魏國峯'},expected:{owner:'公用'}}]};
  await assert.rejects(()=>E.runSeatCascade(st,'SELF',A('SELF','魏國峯',''),A('SELF','公用',''),plan,'OP'),/已被改動/);
  assert.equal(rows.SELF.owner,'公用');assert.equal(rows.P1.owner,'已變更');
  assert.ok(!st.calls.some(c=>c[0]==='save'));
});

test('run: reserve failure aborts before any write and releases partial reservations',async()=>{
  const rows={SELF:A('SELF','公用',''),P1:A('P1','公用',''),P2:A('P2','公用','')};
  const st=fakeStore(rows,{failReserve:'P2'});
  const plan={fields:['owner'],seat:{version:'v',seat:1},peers:[
    {code:'P1',patch:{owner:'魏國峯'},expected:{owner:'公用'}},
    {code:'P2',patch:{owner:'魏國峯'},expected:{owner:'公用'}},
  ]};
  await assert.rejects(()=>E.runSeatCascade(st,'SELF',A('SELF','魏國峯',''),A('SELF','公用',''),plan,'OP'),/無法取得編輯權/);
  assert.ok(!st.calls.some(c=>c[0]==='save'));
  assert.ok(st.calls.some(c=>c[0]==='release'&&c[1]==='P1'));
  assert.equal(rows.SELF.owner,'公用');assert.equal(rows.P1.owner,'公用');
});

test('run: mid-cascade peer failure rolls back every write including primary',async()=>{
  const rows={SELF:A('SELF','公用',''),P1:A('P1','公用',''),P2:A('P2','公用','')};
  const st=fakeStore(rows,{failSave:(code)=>code==='P2'});
  const plan={fields:['owner','department'],seat:{version:'v',seat:1},peers:[
    {code:'P1',patch:{owner:'魏國峯',department:'管理部'},expected:{owner:'公用',department:''}},
    {code:'P2',patch:{owner:'魏國峯',department:'管理部'},expected:{owner:'公用',department:''}},
  ]};
  await assert.rejects(
    ()=>E.runSeatCascade(st,'SELF',A('SELF','魏國峯','管理部'),A('SELF','公用',''),plan,'OP'),
    /已回復本次全部寫入（SELF、P1）/);
  assert.deepEqual(rows.SELF,{code:'SELF',owner:'公用',department:'',project:''});
  assert.deepEqual(rows.P1,{code:'P1',owner:'公用',department:'',project:''});
  assert.deepEqual(rows.P2,{code:'P2',owner:'公用',department:'',project:''});
});

test('run: rollback failure is surfaced with the diverging device',async()=>{
  const rows={SELF:A('SELF','公用',''),P1:A('P1','公用','')};
  const perCode={};
  const st=fakeStore(rows,{failSave:(code,calls)=>{perCode[code]=(perCode[code]||0)+1;return code==='P1'||(code==='SELF'&&perCode.SELF===2);}});
  const plan={fields:['owner'],seat:{version:'v',seat:1},peers:[{code:'P1',patch:{owner:'魏國峯'},expected:{owner:'公用'}}]};
  await assert.rejects(
    ()=>E.runSeatCascade(st,'SELF',A('SELF','魏國峯',''),A('SELF','公用',''),plan,'OP'),
    /未能回復.*SELF/);
  assert.equal(rows.SELF.owner,'魏國峯'); // primary write stays, divergence is honestly reported
  assert.equal(rows.P1.owner,'公用');
});

test('run: project normalization mirror keeps primary rollback faithful',async()=>{
  const rows={SELF:A('SELF','公用','',{project:''}),P1:A('P1','公用','')};
  const st=fakeStore(rows,{failSave:(code)=>code==='P1'});
  const draft=A('SELF','魏國峯','',{project:'未指定（待確認）'}),base=A('SELF','公用','',{project:''});
  const plan={fields:['owner'],seat:{version:'v',seat:1},peers:[{code:'P1',patch:{owner:'魏國峯'},expected:{owner:'公用'}}]};
  await assert.rejects(()=>E.runSeatCascade(st,'SELF',draft,base,plan,'OP'),/已回復/);
  assert.equal(rows.SELF.owner,'公用');assert.equal(rows.SELF.project,'');
});
