// Proposed reuse of session rows. Column N is explicit marker, not inferred from date or old open state.
export const SHARED_MARKER='erp-shared-round-v1';
export const SHARED_HEADER='共同盤點識別';
export function sharedRoundPlan({sessions,sites},{site,newId,actor,at}){
 if(typeof site!=='string'||!site.trim()||!sites.includes(site))throw Error('SHARED_SITE_INVALID');
 const open=sessions.filter(r=>r[1]===site&&r[10]==='進行中'&&r[13]===SHARED_MARKER);
 if(open.length>1)throw Error('SHARED_ROUND_AMBIGUOUS');
 if(open.length===1)return{join:true,row:open[0],changed:false};
 if(!/^round-[a-f0-9-]{36}$/i.test(newId))throw Error('SHARED_ROUND_ID_INVALID');
 return{join:false,changed:true,row:[newId,site,'','','','','','',actor,at,'進行中','','',SHARED_MARKER]};
}
export function sharedSiteKey(site){return 'shared-site:'+JSON.stringify([site]);}
// Server-controlled creation/close must both reserve sharedSiteKey before fresh read and verified append.
// Old generic append/update must not be allowed to manufacture/reopen shared marker rows.
// New observations must verify marker under the same selected shared session; old page joins cannot be inferred.
export function sharedSessionRequired(sessions,id){const found=sessions.filter(r=>r[0]===id);if(found.length!==1||found[0][10]!=='進行中'||found[0][13]!==SHARED_MARKER)throw Error('JOIN_CURRENT_SHARED_ROUND');return found[0]}

export function roundKey(id){if(typeof id!=='string'||!id.trim()||id.length>160)throw Error('SHARED_ROUND_ID_INVALID');return 'shared-round:'+JSON.stringify([id]);}
export function closeRoundPlan({sessions},{sessionId,site,confirmed,at}){
 if(confirmed!==true)throw Error('SHARED_CLOSE_CONFIRMATION_REQUIRED');
 const hits=sessions.map((row,index)=>({row,index})).filter(x=>x.row[0]===sessionId);
 if(hits.length!==1||hits[0].row[13]!==SHARED_MARKER||hits[0].row[1]!==site)throw Error('SHARED_ROUND_MISMATCH');
 const {row,index}=hits[0];if(row[10]==='已結束')return {row:[...row],rowNumber:index+2,replayed:true};
 if(row[10]!=='進行中')throw Error('SHARED_ROUND_STATE_INVALID');
 const next=[...row];next[10]='已結束';next[11]=at;return {row:next,rowNumber:index+2,replayed:false};
}
