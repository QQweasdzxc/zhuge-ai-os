/* Seat inventory snapshots. Append-only field evidence, never asset custody. */
import { reduceInputs as legacyInputs, inputObservationRow } from './reinput-core.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clone=x=>JSON.parse(JSON.stringify(x));
const placeKey=c=>JSON.stringify([c.map,c.site,c.zone,Number(c.seat)]);
const rowPlace=r=>JSON.stringify([r[2],r[3],r[4],Number(r[5])]);
const fail=m=>{throw Error(m)};
const text=(s,max=200)=>typeof s==='string'&&s.length<=max?s.trim():fail('INVENTORY_TEXT');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const identity=x=>x.label==='有QR'?'qr:'+x.raw:'observation:'+x.id;
const item=(id,label,raw,serial,model,note,capturedAt,at,actor,sessionId)=>({id,label,raw,serial,model,note,capturedAt,at,actor,sessionId,key:label==='有QR'?'qr:'+raw:'observation:'+id});
function legacySources(db,c,sessionId){
 const old=legacyInputs(db.seats).current.get(placeKey(c));
 if(old&&!old.closed)return {type:'input',epoch:old.epoch,revision:old.last,items:[...old.items.values()].map(x=>({...x,sessionId:old.sessionId,key:identity(x)}))};
 const rows=(db.observations||[]).filter(r=>r[1]===sessionId&&r[2]===c.site&&r[3]===c.zone&&r[4]===c.map&&Number(r[5])===c.seat);
 return {type:'observations',epoch:sessionId,revision:stable(rows.map(r=>r[0]).sort()),items:rows.map(r=>item(r[0],r[6],r[7],r[8]||'',r[9]||'',r[10]||'',r[11],r[12],r[13],r[1]))};
}
function adopted(db,c,d){
 if(!d.adopt)return [];
 let source;
 if(d.adopt.type==='input'){
  const ids=new Set(d.adopt.ids);
  source=db.seats.filter(r=>r[1]==='input-item'&&ids.has(r[0])).map(r=>inputObservationRow(r));
 }else source=(db.observations||[]).filter(r=>d.adopt.ids.includes(r[0]));
 if(source.length!==d.adopt.ids.length||new Set(source.map(r=>r[0])).size!==source.length)fail('INVENTORY_SOURCE_MISSING');
 return source.map(r=>{
  if(r.length<15||!r[0]||!['有QR','沒有QR'].includes(r[6])||typeof r[7]!=='string'||r[6]==='有QR'&&!r[7].trim()||r[6]==='沒有QR'&&r[7]||!Number.isFinite(Date.parse(r[11]))||!Number.isFinite(Date.parse(r[12]))||!r[13])fail('INVENTORY_SOURCE_INVALID');
  if(r[2]!==c.site||r[3]!==c.zone||r[4]!==c.map||Number(r[5])!==c.seat)fail('INVENTORY_SOURCE_LOCATION');
  return item(r[0],r[6],r[7],r[8]||'',r[9]||'',r[10]||'',r[11],r[12],r[13],r[1]);
 });
}
function issueId(baseline,round,old){return ['inventory-issue',baseline,round,old.id].join(':')}
function differences(state,round){
 if(!round.baselineId)return [];
 const previous=state.rounds.find(r=>r.sealId===round.baselineId);
 if(!previous)return [];
 const keys=new Set(round.items.map(identity));
 return previous.items.filter(x=>!keys.has(identity(x))).map(x=>({id:issueId(previous.sealId,round.id,x),baselineId:previous.sealId,roundId:round.id,place:clone(state.place),item:clone(x),provisional:!round.sealed}));
}
export function reduceInventory(db,c){
 const state={place:clone(c),head:'',current:null,rounds:[],notes:new Map(),events:new Map(),cancelled:new Map()};
 const relevant=db.seats.filter(r=>Array.isArray(r)&&r.length===10&&String(r[1]).startsWith('inventory-')&&rowPlace(r)===placeKey(c));
 const globally=new Map();for(const r of db.seats)if(String(r[1]).startsWith('inventory-'))globally.set(r[0],(globally.get(r[0])||0)+1);
 for(const r of relevant){
  if(!UUID.test(r[0])||globally.get(r[0])!==1||!r[9]||!Number.isFinite(Date.parse(r[8])))fail('INVENTORY_HISTORY_ID');
  let d;try{d=JSON.parse(r[7])}catch{fail('INVENTORY_HISTORY_JSON')}
  if(d.schema!==1||d.previous!==state.head)fail('INVENTORY_HISTORY_CHAIN');
  const round=state.current;
  if(state.cancelled.has(r[0]))fail('INVENTORY_CANCELLED_EVENT:'+r[0]+':座位紀錄互相衝突，已停止本位置寫入；請保留原紀錄供查核，不可清除或重送。');
  if(r[1]==='inventory-cancel'){
   if(!UUID.test(d.originalId)||d.originalActor!==r[9]||state.events.has(d.originalId)||state.cancelled.has(d.originalId))fail('INVENTORY_HISTORY_CANCEL');
   state.cancelled.set(d.originalId,{row:r,actor:r[9]});
  }else if(r[1]==='inventory-open'){
   if(round&&!round.sealed||d.baselineId!==(state.rounds.filter(x=>x.sealed).at(-1)?.sealId||''))fail('INVENTORY_HISTORY_OPEN');
   const seeds=adopted(db,c,d),keys=new Set();for(const x of seeds){if(keys.has(identity(x)))fail('INVENTORY_SOURCE_DUPLICATE');keys.add(identity(x))}
   state.current={id:r[0],baselineId:d.baselineId,openedAt:r[8],actor:r[9],sessionId:d.sessionId,revision:r[0],items:seeds,sealed:false,sealId:'',sealedAt:'',sealedBy:''};
   state.rounds.push(state.current);
  }else if(r[1]==='inventory-item'){
   if(!round||round.sealed||d.roundId!==round.id||round.items.some(x=>identity(x)===identity({id:r[0],label:d.label,raw:d.raw})))fail('INVENTORY_HISTORY_ITEM');
   if(!['有QR','沒有QR'].includes(d.label)||d.label==='有QR'&&!d.raw||d.label==='沒有QR'&&d.raw)fail('INVENTORY_HISTORY_LABEL');
   round.items.push(item(r[0],d.label,d.raw,d.serial,d.model,d.note,d.capturedAt,r[8],r[9],d.sessionId));round.revision=r[0];
  }else if(r[1]==='inventory-seal'){
   if(!round||round.sealed||d.roundId!==round.id||d.revision!==round.revision||d.confirmed!==true||!round.items.length&&d.confirmedEmpty!==true||stable(d.itemIds)!==stable(round.items.map(x=>x.id).sort()))fail('INVENTORY_HISTORY_SEAL');
   round.sealed=true;round.sealId=r[0];round.sealedAt=r[8];round.sealedBy=r[9];
  }else if(r[1]==='inventory-note'){
   const valid=state.rounds.flatMap(x=>differences(state,x)).find(x=>x.id===d.issueId)||state.notes.get(d.issueId)?.basis;
   if(!valid||(state.notes.get(d.issueId)?.entries.at(-1)?.id||'')!==d.previousNote)fail('INVENTORY_HISTORY_NOTE');
   const record=state.notes.get(d.issueId)||{basis:clone(valid),entries:[]};
   record.entries.push({id:r[0],status:d.status,destination:d.destination,note:d.note,evidence:d.evidence,at:r[8],actor:r[9]});state.notes.set(d.issueId,record);
  }else fail('INVENTORY_HISTORY_TYPE');
  state.head=r[0];state.events.set(r[0],{row:r,data:d});
 }
 return state;
}
export function inventoryView(db,c,sessionId=''){
 const state=reduceInventory(db,c),issues=new Map();
 for(const round of state.rounds)for(const x of differences(state,round))issues.set(x.id,x);
 for(const [id,n]of state.notes)if(!issues.has(id))issues.set(id,{...clone(n.basis),provisional:false,noLongerMissing:true});
 const allIssues=[...issues.values()].map(x=>{const n=state.notes.get(x.id),latest=n?.entries.at(-1);return {...x,status:latest?.status||'待查',entries:clone(n?.entries||[]),currentFound:!!state.current?.items.some(i=>identity(i)===identity(x.item))}});
 const current=state.current&&clone(state.current),latest=state.rounds.filter(r=>r.sealed).at(-1),source=state.current?null:legacySources(db,c,sessionId);
 return {place:clone(c),head:state.head,current,latestFinalized:latest?clone(latest):null,rounds:clone(state.rounds),issues:allIssues,legacySource:source&&{type:source.type,epoch:source.epoch,revision:source.revision,count:source.items.length},assetsUntouched:true};
}
export function inventoryManaged(seats,c){return seats.some(r=>r[1]==='inventory-open'&&rowPlace(r)===placeKey(c))}
export function inventoryLocks(c){return ['position-input:'+placeKey(c)]}
export function planInventory(db,input,actor,at){
 if(JSON.stringify(input).length>16000)fail('INVENTORY_SIZE');
 const c={map:text(input.map),site:text(input.site),zone:text(input.zone),seat:input.seat};
 if(!UUID.test(input.eventId)||!actor||!Number.isFinite(Date.parse(at)))fail('INVENTORY_IDENTITY');
 if(!Number.isInteger(c.seat)||!db.maps.some(m=>m.id===c.map&&m.site===c.site&&m.zone===c.zone&&m.seats.some(s=>s.number===c.seat)))fail('INVENTORY_LOCATION');
 const command=Object.fromEntries(['eventId','action','map','site','zone','seat','sessionId','roundId','baselineId','revision','confirmed','confirmedEmpty','itemIds','adopt','sourceRevision','sourceEpoch','label','raw','serial','model','note','capturedAt','issueId','previousNote','status','destination','evidence','originalId'].filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
 const state=reduceInventory(db,c),old=db.seats.filter(r=>r[0]===input.eventId);
 if(old.length){const e=state.events.get(input.eventId);if(old.length!==1||!e||e.row[9]!==actor||stable(e.data.command)!==stable(command))fail('INVENTORY_ID_CONFLICT');return {row:e.row,replayed:true,historical:!!state.current&&e.data.roundId!==state.current.id&&e.row[0]!==state.current.id}}
 const sessionId=text(input.sessionId||'');
 if(!['note','cancel'].includes(input.action)&&db.sessions.filter(r=>r[0]===sessionId&&r[1]===c.site&&r[10]==='進行中'&&r[13]==='erp-shared-round-v1').length!==1)fail('INVENTORY_SESSION');
 const pack=(kind,d)=>({row:[input.eventId,'inventory-'+kind,c.map,c.site,c.zone,c.seat,'',JSON.stringify({schema:1,previous:state.head,...d,command}),at,actor]});
 if(input.action==='cancel'){
  if(!UUID.test(input.originalId)||input.confirmed!==true)fail('INVENTORY_CANCEL_CONFIRM');
  const original=state.events.get(input.originalId);if(original){if(original.row[9]!==actor)fail('INVENTORY_CANCEL_ACTOR');return {row:original.row,unchanged:true,settled:true}}
  const prior=state.cancelled.get(input.originalId);if(prior){if(prior.actor!==actor)fail('INVENTORY_CANCEL_ACTOR');return {row:prior.row,unchanged:true,cancelled:true}}
  return {...pack('cancel',{originalId:input.originalId,originalActor:actor}),cancelled:true};
 }
 if(state.cancelled.has(input.eventId))fail('INVENTORY_COMMAND_CANCELLED');
 if(input.action==='open'){
  if(state.current&&!state.current.sealed)return {row:state.events.get(state.current.id).row,joined:true,unchanged:true};
  const baselineId=state.rounds.filter(r=>r.sealed).at(-1)?.sealId||'';
  if(input.baselineId!==baselineId||input.confirmed!==true)fail('INVENTORY_OPEN_CONFIRM_OR_CHANGED');
  let adopt;
  if(!state.current){const source=legacySources(db,c,sessionId);if(source.items.length){if(input.adopt!==true||input.sourceRevision!==source.revision||input.sourceEpoch!==source.epoch)fail('INVENTORY_ADOPTION_CONFIRM_REQUIRED');adopt={type:source.type,epoch:source.epoch,ids:source.items.map(x=>x.id)};}}
  if(adopt){const seeds=adopted(db,c,{adopt}),keys=seeds.map(identity);if(new Set(keys).size!==keys.length)fail('INVENTORY_SOURCE_DUPLICATE')}
  return pack('open',{baselineId,sessionId,...(adopt?{adopt}:{})});
 }
 if(input.action==='note'){
  const issue=inventoryView(db,c).issues.find(x=>x.id===input.issueId);if(!issue)fail('INVENTORY_ISSUE_NOT_FOUND');
  const last=state.notes.get(issue.id)?.entries.at(-1)?.id||'';if(input.previousNote!==last)fail('INVENTORY_NOTE_CHANGED');
  const status=text(input.status,20),note=text(input.note||'',2000),destination=text(input.destination||'',200),evidence=text(input.evidence||'',2000);
  if(!['待查','追查中','已查明'].includes(status)||!note||status==='已查明'&&(input.confirmed!==true||!evidence))fail('INVENTORY_NOTE_CONFIRM_OR_REQUIRED');
  return pack('note',{issueId:issue.id,previousNote:last,status,note,destination,evidence});
 }
 const round=state.current;if(!round||round.id!==input.roundId||round.sealed)fail('INVENTORY_ROUND_CLOSED_OR_CHANGED');
 if(input.action==='capture'){
  const label=text(input.label,20),raw=text(input.raw||'',4096),serial=text(input.serial||''),model=text(input.model||''),note=text(input.note||'',2000),capturedAt=text(input.capturedAt||at,40);
  if(!['有QR','沒有QR'].includes(label)||label==='有QR'&&!raw||label==='沒有QR'&&raw||!Number.isFinite(Date.parse(capturedAt)))fail('INVENTORY_LABEL');
  const duplicate=label==='有QR'&&round.items.find(x=>x.key==='qr:'+raw);if(duplicate)return {row:state.events.get(duplicate.id)?.row||null,duplicate:true,unchanged:true,item:clone(duplicate)};
  return pack('item',{roundId:round.id,sessionId,label,raw,serial,model,note,capturedAt});
 }
 if(input.action==='seal'){
  if(input.confirmed!==true||input.revision!==round.revision||!Array.isArray(input.itemIds)||stable(input.itemIds)!==stable(round.items.map(x=>x.id).sort())||!round.items.length&&input.confirmedEmpty!==true)fail('INVENTORY_SEAL_CONFIRM_OR_CHANGED');
  return pack('seal',{roundId:round.id,revision:round.revision,itemIds:input.itemIds,confirmed:true,confirmedEmpty:!round.items.length});
 }
 fail('INVENTORY_ACTION');
}
export function inventoryObservationRows(db,c){const s=reduceInventory(db,c);return (s.current?.items||[]).map(x=>[x.id,x.sessionId,c.site,c.zone,c.map,c.seat,x.label,x.raw,x.serial,x.model,x.note,x.capturedAt,x.at,x.actor,'待核實',s.current.id])}
export function projectInventoryObservations(observations,seats){const db={observations,seats},places=new Map();for(const r of seats)if(r[1]==='inventory-open'){const c={map:r[2],site:r[3],zone:r[4],seat:Number(r[5])};places.set(placeKey(c),c)}return observations.filter(r=>!places.has(JSON.stringify([r[4],r[2],r[3],Number(r[5])]))).concat([...places.values()].flatMap(c=>inventoryObservationRows(db,c)))}
