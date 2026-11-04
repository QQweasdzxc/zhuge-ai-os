const test = require('node:test');
const assert = require('node:assert/strict');
const {SheetsStore,HEADERS,TABS} = require('../ZG-ERP/erp-sheets-adapter.js');
function fixture(ready=true, seed={}) {
  const calls=[];
  const tabs=Object.fromEntries(Object.entries(TABS).map(([k,t])=>[t,{header:ready?HEADERS[k]:[],rows:seed[t]||[]}]));
  const store=new SheetsStore({bridgeUrl:'https://isolated.test',actor:'verified-fixture-user',fetchImpl:async(url,opts)=>{
    const u=new URL(url), t=u.searchParams.get('tab'), action=u.searchParams.get('action');
    if(action==='read') return {ok:true,json:async()=>tabs[t]||{header:[],rows:[]}};
    const body=JSON.parse(opts.body); calls.push({t,action,...body});
    if(action==='append') { const rows=tabs[t].rows; rows.push(body.row); return {ok:true,json:async()=>({ok:true,updatedRange:t+'!A'+(rows.length+1)+':V'+(rows.length+1)})}; }
    return {ok:true,json:async()=>({ok:true})};
  }});
  return {store,calls,tabs};
}
test('department saves separately in session, asset and record, then reloads',async()=>{
 const f=fixture(); await f.store.init();
 const s=f.store.startSession('現場',null,null,null,'計畫A','','管理部'); await s.__write;
 const r=f.store.addRecord(s,{code:'REAL-QR-01',zone:'10F'}); await r.__write;
 const a=f.store.observeAsset(s,'REAL-QR-01','10F').asset; await a.__write;
 assert.equal(f.tabs.盤點場次.rows[0][12],'管理部');
 assert.equal(f.tabs.資產.rows[0][21],'管理部'); assert.equal(f.tabs.資產.rows[0][7],'計畫A'); assert.equal(f.tabs.資產.rows[0][6],'');
 assert.deepEqual(f.tabs.盤點紀錄.rows[0].slice(8),['管理部','計畫A','verified-fixture-user']);
 f.store.db=null; await f.store.init(); assert.equal(f.store.state().assets.find(a=>a.code==='REAL-QR-01').department,'管理部');
 assert.equal(f.store.state().sessions[0].department,'管理部'); assert.equal(f.store.state().records[0].department,'管理部');
});
test('legacy blank department/author stays blank without retroactive attribution; conflicting department preserved',async()=>{
 const row=['QR','', '', '', '現場','10F','公用','其他專案','使用中','','','','','','','','','盤點','old','','','工程部'];
 const f=fixture(true,{'資產':[row]}); await f.store.init();
 const s=f.store.startSession('現場',null,null,null,'計畫A','','管理部'); await s.__write;
 const out=f.store.observeAsset(s,'QR','10F'); assert.equal(out.departmentMismatch,true);
 assert.equal(out.asset.department,'工程部'); assert.equal(out.asset.project,'其他專案');
 f.store.saveAsset('QR',{serial:'confirmed-later'}); await out.asset.__write;
 const update=f.calls.find(x=>x.t==='資產'&&x.action==='update'); assert.equal(update.row[19],'');
});
test('pre-migration schema refuses department before creating a session',async()=>{
 const f=fixture(false); await f.store.init(); assert.equal(f.store.departmentReady,false);
 assert.throws(()=>f.store.startSession('現場',null,null,null,'','','管理部'),/尚未就緒/);
 assert.equal(f.store.state().sessions.length,0); assert.equal(f.calls.length,0);
});
test('unique legacy import fills only descriptive blanks with source snapshot through column Z',async()=>{
 const row=['REAL','','','','現場','10F','公用','現場專案','使用中'];
 const f=fixture(true,{'資產':[row]}); await f.store.init();
 f.store._legacyRows=[{code:'REAL',recordKey:'R1',name:'螢幕',model:'VS2209',serial:'',zone:'PT',place:'1',project:'歷史專案',owner:'歷史人',provenance:'10F 第6列'}];
 const result=f.store.importLegacyMetadata('REAL'); await result.asset.__write;
 assert.equal(result.asset.name,'螢幕'); assert.equal(result.asset.serial,''); assert.equal(result.asset.project,'現場專案'); assert.equal(result.asset.owner,'公用'); assert.equal(result.asset.zone,'10F');
 const write=f.calls.find(x=>x.t==='資產'&&x.action==='update'); assert.equal(write.row.length,26); assert.equal(write.row[22],'R1'); assert.ok(write.row[25]); assert.equal(JSON.parse(write.row[24]).zone,'PT');
 assert.equal(write.row[19],''); // no historical author fabrication
 result.asset.name='現場不同'; const again=f.store.legacyMetadata('REAL'); assert.match(again.issue,/保留新帳/); assert.equal(again.patch.name,undefined);
 f.store._legacyRows.push({...f.store._legacyRows[0],recordKey:'R2'}); assert.match(f.store.legacyMetadata('REAL').issue,/同編號多筆/);
});
test('new scans inherit legacy metadata without importing historical project/owner/position',async()=>{
 const f=fixture(); await f.store.init();
 f.store._legacyRows=[{code:'NEW-QR',recordKey:'R10',name:'螢幕',model:'VS2209',serial:'',zone:'PT',place:'1',project:'歷史專案',owner:'舊保管',provenance:'10F 第6列'}];
 const s=f.store.startSession('現場',null,null,null,'本次專案','','管理部'); await s.__write;
 const o=f.store.observeAsset(s,'NEW-QR','10F'); await o.asset.__write;
 assert.equal(o.asset.model,'VS2209'); assert.equal(o.asset.owner,''); assert.equal(o.asset.department,'管理部'); assert.equal(o.asset.project,'本次專案'); assert.equal(o.asset.zone,'10F'); assert.equal(o.asset.legacyKey,'R10');
 assert.equal(s.operator,'verified-fixture-user');
});
