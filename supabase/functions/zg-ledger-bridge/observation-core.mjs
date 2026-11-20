/* Field observations are not asset registrations or legacy matches. */
export const OBSERVATION_HEADER=['觀察鍵','場次鍵','據點','區域','圖版本','座位編號','標籤狀態','掃碼原文','設備序號','型號','備註','掃描時間','保存時間','經手人','核對狀態'];
const txt=(v,max=200)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max)throw Error('OBSERVATION_TEXT_INVALID');return v.trim();};
export function observationPlan(db,input,actor,at){
 const id=txt(input.observationId,80),sessionId=txt(input.sessionId),zone=txt(input.zone),map=txt(input.seatTarget?.map),seat=input.seatTarget?.seat;
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw Error('OBSERVATION_ID_INVALID');
 if(!Number.isInteger(seat)||seat<1||seat>500)throw Error('OBSERVATION_SEAT_INVALID');
 const sessions=db.sessions.filter(r=>r[0]===sessionId);if(sessions.length!==1||sessions[0][10]!=='進行中')throw Error('OBSERVATION_SESSION_INVALID');
 const site=String(sessions[0][1]||'');if(!site||!zone)throw Error('OBSERVATION_LOCATION_REQUIRED');
 const matched=db.maps.filter(m=>m.id===map&&m.site===site&&m.zone===zone);if(matched.length!==1||!matched[0].seats.some(s=>s.number===seat))throw Error('OBSERVATION_MAP_INVALID');
 const label=txt(input.labelStatus,20),raw=txt(input.scanRaw,4096),serial=txt(input.serial),model=txt(input.model),note=txt(input.note,2000),captured=txt(input.capturedAt,40);
 if(!['有QR','沒有QR'].includes(label)||label==='有QR'&&!raw||label==='沒有QR'&&raw)throw Error('OBSERVATION_LABEL_INVALID');
 if(!captured||!Number.isFinite(Date.parse(captured)))throw Error('OBSERVATION_TIME_INVALID');
 const row=[id,sessionId,site,zone,map,seat,label,raw,serial,model,note,captured,at,actor,'待核實'];
 const prior=db.observations.filter(r=>r[0]===id);if(prior.length>1)throw Error('OBSERVATION_DUPLICATE_ID');
 if(prior.length){if(row.some((v,c)=>![12,13,14].includes(c)&&String(v)!==String(prior[0][c]??'')))throw Error('OBSERVATION_ID_CONFLICT');return{row:prior[0],replayed:true,warnings:[]};}
 const duplicate=label==='有QR'?db.observations.filter(r=>r[1]===sessionId&&r[6]==='有QR'&&String(r[7]??'').trim()===raw):[];
 if(duplicate.length>1)throw Error('OBSERVATION_EXISTING_DUPLICATES');
 if(duplicate.length===1)return {row:duplicate[0],replayed:false,duplicate:true,warnings:[]};
 const related=serial?db.observations.filter(r=>String(r[8]||'')===serial):[];
 const warnings=[];if(related.some(r=>r[1]===sessionId&&r[4]===map&&Number(r[5])===seat))warnings.push('同場次同座位已有相同序號，保留為獨立觀察，待核對是否重複。');
 if(related.some(r=>r[4]!==map||Number(r[5])!==seat))warnings.push('相同序號曾在其他位置登記，未移動任何既有設備或觀察。');
 return{row,replayed:false,warnings};
}

// Shared across positions and devices, bounded length for row-control primary key.
export async function observationLockKeys(input){
 const id=txt(input.observationId,80),session=txt(input.sessionId),raw=txt(input.scanRaw,4096),label=txt(input.labelStatus,20);
 const keys=['observation:'+JSON.stringify([id])];
 if(label==='有QR'&&raw){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([session,raw])));keys.push('observation-qr:'+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join(''))}
 return keys.sort();
}
