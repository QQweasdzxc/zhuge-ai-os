import "./seat-map-core.js";
/* Single intent planner: scan record + asset observation + optional seat binding. */
export function scanPlan(db,input,actor,at){
 const code=String(input.code||'').trim(),zone=String(input.zone||'').trim();if(!code||code.length>200)throw Error('SCAN_CODE_INVALID');
 const occName=String(input.occupantName||'').trim().slice(0,200);
 // Optional vendor payload is checked against the same fresh locked database as the write.
 if(input.scanSource==='vendor'){
  const raw=input.scanRaw,format=input.scanFormat;
  if(typeof raw!=='string'||!raw.length||raw.length>4096||typeof format!=='string'||!['Code128','Code39','EAN13','EAN8','ITF','DataMatrix','PDF417','Aztec'].includes(format))throw Error('SCAN_VENDOR_INVALID');
  const matched=db.assets.filter(r=>r[0]===raw||r[3]===raw);
  if(matched.length!==1||matched[0][0]!==code)throw Error('SCAN_VENDOR_UNRESOLVED');
 }
 const sessions=db.sessions.map((r,i)=>({r,i})).filter(x=>x.r[0]===input.sessionId);if(sessions.length!==1||sessions[0].r[10]!=='進行中')throw Error('SCAN_SESSION_INVALID');
 const session=sessions[0].r,site=session[1],project=['','全部','全部專案','未指定','未指定（待確認）','未指定(待確認)'].includes(String(session[7]||'').trim())?'':String(session[7]).trim(),department=String(session[12]||'').trim();
 const hits=db.assets.map((r,i)=>({r,i})).filter(x=>x.r[0]===code);if(hits.length>1)throw Error('SCAN_ASSET_DUPLICATE');const found=hits[0],asset=found?[...found.r]:[code,'','','',site,zone,occName,project,'使用中','','未確認','','','','','','','盤點',at,actor,at,department,'','','',''];
 const status=!found?'none':asset[4]!==site?'site':asset[5]!==zone?'zone':'ok',blocked=found&&['待修','維修中','已報廢'].includes(asset[8]);
 const original=found?[...found.r]:null,changes={};let metadataIssue='';
 if(!blocked){
  if(found){if(department&&!asset[21])changes[21]=department;if(project&&['','未指定','未指定（待確認）','未指定(待確認)'].includes(String(asset[7]||'').trim()))changes[7]=project;if(asset[4]!==site||zone&&asset[5]!==zone){changes[4]=site;changes[5]=zone||asset[5]||'';}}
  const legacy=(db.legacy||[]).filter(r=>r.code===code);if(legacy.length===1){const l=legacy[0];let enriched=false;for(const[k,c]of[['name',1],['model',2],['serial',3],['purchase',14]])if(!String(asset[c]||'').trim()&&l[k]){if(found)changes[c]=l[k];else asset[c]=l[k];enriched=true;}if(enriched){const proof={22:l.recordKey||'',23:l.provenance||'',24:JSON.stringify(l),25:at};if(found)Object.assign(changes,proof);else for(const[c,v]of Object.entries(proof))asset[c]=v;}}else if(legacy.length>1)metadataIssue='舊帳同完整編號多筆，未自動帶入';
 }
 if(found&&Object.keys(changes).length)changes[20]=at;for(const[c,v]of Object.entries(changes))asset[c]=v;
 const prev=db.records.map((r,i)=>({r,i})).filter(x=>x.r[0]===input.sessionId&&x.r[1]===code);if(prev.length>1)throw Error('SCAN_RECORD_DUPLICATE');
 const record=prev.length?[...prev[0].r]:[input.sessionId,code,status,site,zone,at,1,'',department,project,actor];if(prev.length)record[6]=(Number(record[6])||1)+1;
 let binding=null,bindingConflict='';
 if(input.seatTarget){const target=input.seatTarget;if(!Number.isInteger(target.seat)||target.seat<1||target.seat>500)throw Error('SCAN_SEAT_INVALID');const map=globalThis.ErpSeatMapCore.reduce(db.seats).find(m=>m.id===target.map&&m.site===site&&m.zone===zone);if(!map)throw Error('SCAN_MAP_INVALID');
 if(!map.seats?.some(s=>s.number===target.seat))throw Error('SCAN_SEAT_UNKNOWN');const old=db.seats.filter(r=>['binding','placement'].includes(r[1])&&r[6]===code);const elsewhere=old.find(r=>r[2]!==target.map||Number(r[5])!==target.seat);
 if(blocked||asset[4]!==site||asset[5]!==zone)throw Error('SCAN_BLOCKED_ASSET_SEAT');
 const id='binding:'+input.sessionId+':'+code,prior=db.seats.filter(r=>r[0]===id);
 // Binding conflict: keep the scan observation (record above already carries code/site/zone/time), skip the seat write, flag for reconciliation. Never silently relocate.
 if(elsewhere){bindingConflict='座位綁定差異：此設備已登記在「'+elsewhere[3]+'／'+elsewhere[4]+'」座位 '+elsewhere[5]+'，本次在座位 '+target.seat+' 掃到；掃描已保存，未改綁定，待管理端確認。';}
 else if(prior.length>1||(prior.length===1&&(prior[0][2]!==target.map||Number(prior[0][5])!==target.seat))){bindingConflict='座位綁定差異：本場次既有綁定座位與本次座位 '+target.seat+' 不同；掃描已保存，未改綁定，待管理端確認。';}
 else if(!prior.length)binding=[id,'binding',target.map,site,zone,target.seat,code,JSON.stringify({sessionId:input.sessionId}),at,actor];
 if(bindingConflict&&record[2]==='ok')record[2]='seat';
 }else if(db.seats.some(r=>r[1]==='map'&&r[3]===site&&r[4]===zone))throw Error('SCAN_SEAT_REQUIRED');
 return{code,asset,original,assetRow:found?found.i+2:null,changes,record,recordRow:prev.length?prev[0].i+2:null,binding,bindingConflict,exception:blocked?'既有狀態「'+asset[8]+'」，不因掃描自動改回可用':'',metadataIssue,assignedProject:changes[7]||'',departmentMismatch:!!(department&&original?.[21]&&original[21]!==department)};
}
export function scanBatch(ids,plan){
 const cell=v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v??'')}}),append=(tab,row)=>({appendCells:{sheetId:ids[tab],rows:[{values:row.map(cell)}],fields:'userEnteredValue'}}),put=(tab,row,col,value)=>({updateCells:{start:{sheetId:ids[tab],rowIndex:row-1,columnIndex:col},rows:[{values:[cell(value)]}],fields:'userEnteredValue'}});
 if(!['資產','盤點紀錄','座位圖'].every(k=>Number.isInteger(ids[k])))throw Error('SCAN_SHEET_INVALID');const requests=[];
 if(plan.assetRow)for(const[c,v]of Object.entries(plan.changes))requests.push(put('資產',plan.assetRow,Number(c),v));else requests.push(append('資產',plan.asset));
 if(plan.recordRow)requests.push(put('盤點紀錄',plan.recordRow,6,plan.record[6]));else requests.push(append('盤點紀錄',plan.record));if(plan.binding)requests.push(append('座位圖',plan.binding));return{requests};
}
