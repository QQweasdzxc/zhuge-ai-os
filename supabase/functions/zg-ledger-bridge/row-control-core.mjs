/* Shared pure model for reservation custody and server-derived logical keys. */
export const IDLE_MS=300000;
export function canTake(row,now){return !row || row.phase==='EDITING'&&row.expiresAt<=now;}
export function assertOwner(row,actor,token,now){if(!row||row.actor!==actor||row.token!==token||row.phase!=='EDITING'||row.expiresAt<=now)throw Error('EDIT_PERMISSION_EXPIRED');}
export function mayRelease(row,attempts){return row.phase==='EDITING';}
export function logicalKeys(tab,row,prior){
 if(!Array.isArray(row))throw Error('ROW_REQUIRED');const text=v=>String(v??'').trim();const key=(prefix,...v)=>prefix+':'+JSON.stringify(v.map(text));
 const asset=v=>{if(!text(v))throw Error('ASSET_KEY_REQUIRED');return key('asset',v)};
 if(tab==='資產'){if(prior&&text(prior[0])!==text(row[0]))throw Error('ASSET_ID_IMMUTABLE');return [asset((prior||row)[0]),...([...new Set([text(row[3]),text(prior?.[3])].filter(Boolean))].map(v=>key('serial',v)))].sort()}
 if(tab==='盤點場次'){if(!text(row[0]))throw Error('SESSION_KEY_REQUIRED');return [key('session',row[0])]}
 if(tab==='盤點紀錄'){if(!text(row[0]))throw Error('SESSION_KEY_REQUIRED');return [asset(row[1]),key('record',row[0],row[1])].sort()}
 if(tab==='流轉紀錄')return [asset(row[3]),key('movement',row[0])].sort();
 if(tab==='釐清標示'){if(!text(row[0]))throw Error('LEGACY_KEY_REQUIRED');return [key('clarification',row[0]),...(text(row[1])?[asset(row[1])]:[]),...(text(row[10])?[asset(row[10])]:[])].sort()}
 if(tab==='進貨批次'){if(!text(row[1]))throw Error('BATCH_KEY_REQUIRED');return [key('batch',row[1]),...(text(row[12])?[key('serial',row[12])]:[]),...(text(row[14])?[asset(row[14])]:[])].sort()}
 if(tab==='位置表'){if(!text(row[0]))throw Error('SITE_KEY_REQUIRED');return [key('site',row[0]),key('zone',row[0],row[1])].sort()}
 if(tab==='座位圖'){const kind=text(row[1]);if(!['part','map','occupant','binding','placement','check'].includes(kind))throw Error('SEAT_KIND_REQUIRED');if(!text(row[2])||!text(row[3])||!text(row[4]))throw Error('SEAT_KEY_REQUIRED');return [...new Set([...(kind==='map'?[key('seatmap',row[3],row[4])]:kind==='part'?[key('seatpart',row[2],row[0])]:[key('seat',row[2],row[5])]),...(kind==='binding'||kind==='placement'?[asset(row[6])]:[])])].sort()}
 throw Error('UNGUARDED_TAB');
}
export async function trackedAttempt(custody,send){
 const id=await custody.beforeSend(); // durable WRITING+unique attempt BEFORE network
 let response;
 let bytes;
 try{response=await send();bytes=await response.arrayBuffer()}catch(error){await custody.uncertain(id);throw error}
 // An HTTP gateway/server failure can follow an applied write. Never infer no effect.
 // Conservatively quarantine every non-2xx mutation response until explicit reconciliation.
 if(response.status<200||response.status>=300)await custody.uncertain(id);
 else await custody.completed(id,response.status);
 return new Response(bytes,{status:response.status,headers:response.headers});
}

export function validOperationId(id,now=Date.now()){if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))return false;const at=parseInt(id.slice(0,8)+id.slice(9,13),16);return at<=now+60000&&at>=now-900000;}
