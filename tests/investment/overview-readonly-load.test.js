const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../modules/investment/services/investment-module.js'),'utf8');
const start=source.indexOf('    async function load() {');
const end=source.indexOf('\n    onRoot("click",',start);
const loadSource=source.slice(start,end);
test('private overview load and refresh never activate board repair or sync, including provider failure',async()=>{
 for(const activePage of ['dashboard','overview','receivables','portfolio'])for(const providerState of ['success','missing','error']){
  const calls=[],updates=[];
  const repository=new Proxy({}, {get:(_,name)=>{
   if(name==='repairIvtkIdentity'||name==='syncIvtkProjection')return async()=>{calls.push(name);throw Error('UNAUTHORIZED_WRITE');};
   if(name==='loadIvtkBoard')return async()=>{calls.push(name);return{readOnly:true};};
   return async()=>{calls.push(name);return name==='loadPortfolio'?{}:[];};
  }});
  const context=vm.createContext({repository,dailyConsumer:{assertBoundSession:()=>{}},identity:{},store:{update:s=>updates.push(s),getState:()=>({activePage})},renderPage:()=>{},
   loadIntelligence:async()=>{if(providerState==='error')throw Error('PROVIDER_DOWN');return providerState==='missing'?null:{quotes:[],news:[]};},
   dependencies:{calculation:{applyQuotes:positions=>positions}},enrichIntelligenceWithPortfolio:x=>x});
  const load=vm.runInContext('('+loadSource.trim()+')',context);
  await load();await load();
  assert.equal(calls.filter(x=>x==='loadIvtkBoard').length,2);
  assert.ok(!calls.some(x=>x==='repairIvtkIdentity'||x==='syncIvtkProjection'));
  assert.equal(updates.at(-1).ivtk.projectionStatus,'read_only');
 }
});
