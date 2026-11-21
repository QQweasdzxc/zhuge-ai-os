const {test}=require('node:test'),a=require('node:assert/strict'),{SheetsStore}=require('../ZG-ERP/erp-sheets-adapter.js');
for(const offset of [0,1])test('actual bridge RAW append/read and physical asset offset '+offset+' preserve full inbound manifests',async()=>{
 const {ASSET_HEADER}=await import('../supabase/functions/zg-ledger-bridge/asset-layout-core.mjs');
 const tables={'資產':[offset?['對應座位編號',...ASSET_HEADER]:[...ASSET_HEADER,'對應座位編號']],'座位圖':[['事件鍵']],'進貨批次':[['行別']],'流轉紀錄':[['事件鍵']]},calls=[];
 const trim=r=>{r=[...r];while(r.length&&r.at(-1)==='')r.pop();return r};
 const bridge=await require('./erp-cutover/fixture-handler.cjs')({sessions:[],observations:[],envOverride:{ZG_ERP_PRIVATE_UPDATES_ENABLED:'false'},googleFetch:async(raw,init={})=>{
  const u=new URL(raw);a.equal(u.hostname,'sheets.googleapis.com');const range=decodeURIComponent(u.pathname.split('/values/')[1]),tab=range.split('!')[0];a(tables[tab],'unexpected table '+tab);calls.push({range,method:init.method||'GET',query:u.search});
  if(init.method==='POST'){a.equal(u.searchParams.get('valueInputOption'),'RAW');a.equal(u.searchParams.get('insertDataOption'),'INSERT_ROWS');const row=JSON.parse(init.body).values[0],physical=tab==='資產'&&offset?['',...row]:row;tables[tab].push(physical);const n=tables[tab].length;return Response.json({updates:{updatedRange:tab+'!'+(tab==='資產'&&offset?'B':'A')+n+':'+(tab==='資產'&&offset?'AA':tab==='資產'?'Z':'O')+n}})}
  a.equal(u.searchParams.get('valueRenderOption'),'UNFORMATTED_VALUE');let data=range.endsWith('A1:AA1')?[tables[tab][0]]:tables[tab];if(range==='資產!AA1:AA10000')data=tables[tab].map(r=>[r[26]??'']);if(range==='資產!A1:A10000')data=tables[tab].map(r=>[r[0]??'']);return Response.json({values:data.map(trim)});
 }});
 const s=new SheetsStore({bridgeUrl:'https://fixture.invalid',fetchImpl:async(url,init)=>{const r=await bridge.request(url,init?.method||'GET',init?.body?JSON.parse(init.body):undefined);if(!r.ok)console.error(url,await r.clone().text());return r}});s.db={assets:[],sessions:[],records:[],movements:[],annotations:[],batches:[],meta:{codePrefix:'FIXTURE',codeSeq:1}};
 const b=s.addBatch({serials:['0000123'],po:'00017',vendor:'隔離驗證',mfgYear:'2026',model:'Fixture'});const plans=[structuredClone(b.__inboundPlan)];await s.flush();a.equal(s.syncStatus().unsynced,0,JSON.stringify(s._unsynced?.map(x=>x.error)));a.equal(await s.verifyInboundPlan(plans[0]),true);
 const receipt=s.receiveSerial(b.id,'0000123');plans.push(structuredClone(receipt.item.__inboundPlan));await s.flush();a.equal(await s.verifyInboundPlan(plans[1]),true);
 const made=s.confirmInbound(b.id,{site:'隔離據點',zone:'01F'});plans.push(structuredClone(made.__inboundPlan));await s.flush();a.equal(s.syncStatus().unsynced,0,JSON.stringify(s._unsynced?.map(x=>x.error)));a.equal(await s.verifyInboundPlan(plans[2]),true);a.equal(tables['資產'][1][offset+3],'0000123');a.equal(tables['資產'][1][offset+19],'11111111-1111-4111-8111-111111111111');const before=calls.filter(x=>x.method==='POST').length;for(const plan of plans)a.equal(await s.verifyInboundPlan(plan),true);a.equal(calls.filter(x=>x.method==='POST').length,before);a.equal(before,6);
 // This uses actual bridge helpers and adapter, with isolated Google HTTP responses.
 // It is not a real Sheets write or an on-site acceptance claim.
});
