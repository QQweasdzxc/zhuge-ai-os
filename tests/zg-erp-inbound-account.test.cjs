const {test}=require('node:test'),a=require('node:assert/strict');
const {SheetsStore}=require('../ZG-ERP/erp-sheets-adapter.js');
function store(){let account='A',generation=1;const s=new SheetsStore({bridgeUrl:'https://fixture.invalid'});s._readFull=async tab=>({header:[{assets:'資產編號',batches:'行別',movements:'事件鍵'}[tab]],rows:[]});s.db={assets:[],sessions:[],records:[],movements:[],annotations:[],batches:[],meta:{codeSeq:1}};s.editAccount=()=>account;s.editAuthGeneration=()=>generation;return{s,switchTo:x=>{account=x;generation++}}}
for(const task of ['batch','receipt','confirm'])test('inbound '+task+' stops queued/subsequent appends after A-B-A and never claims synced',async()=>{const {s,switchTo}=store();const calls=[];let first;
s.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return new Promise(r=>first=()=>r({ok:true,json:async()=>({ok:true,updatedRange:new URL(url).searchParams.get('tab')+'!A2:Z2'})}))};
let entity;
if(task==='batch')entity=s.addBatch({serials:['S1','S2']});else{s.db.batches=[{id:'b',at:'2026-11-21',items:[{serial:'S1',state:task==='confirm'?'received':'pending'},{serial:'S2',state:'pending'}],unexpected:[]}];entity=task==='receipt'?s.receiveSerial('b','S1').item:s.confirmInbound('b',{site:'local',zone:'local'})[0]}
await new Promise(r=>setTimeout(r,0));a.equal(calls.length,1);switchTo('B');switchTo('A');first();await s.flush();a.equal(calls.length,1);a(entity.__unsynced);a(s.db.batches[0].__batchUncertain);a.equal(s._originalRows?.assets?.length||0,0);a.equal(s._originalRows?.batches?.length||0,0);
});
test('inbound new operation refuses unverified identity before local mutation',()=>{const {s}=store();s.editAccount=()=>'';a.throws(()=>s.addBatch({serials:['S1']}),/登入/);a.equal(s.db.batches.length,0)});
