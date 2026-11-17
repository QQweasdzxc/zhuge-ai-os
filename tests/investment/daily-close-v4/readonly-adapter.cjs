'use strict';
const {overlayVenues}=require('./venue-readonly-join.cjs');
function safeSession(getSession){let s;try{s=getSession();}catch{throw Error('SESSION_UNVERIFIABLE');}if(!s||s.authenticated!==true||!s.ownerId||!s.generation||s.aal!=='aal2')throw Error('SESSION_REQUIRED');return {ownerId:s.ownerId,generation:s.generation};}
function createReadOnlyOverlay({getSession,loadPublicSnapshot,validatePublicSnapshot,clock=Date.now}={}){
 if([getSession,loadPublicSnapshot,validatePublicSnapshot].some(f=>typeof f!=='function'))throw Error('READ_ONLY_DEPENDENCIES_REQUIRED');
 // No fallback permission or completeness policy. Snapshot validation must be
 // provided by the separate official-source transport/calendar implementation.
 return async function enrichRawPositions(rows){
  const start=safeSession(getSession),guard=()=>{const current=safeSession(getSession);if(current.ownerId!==start.ownerId||current.generation!==start.generation)throw Error('SESSION_CHANGED');};
  if(!Array.isArray(rows))throw Error('RAW_ROWS_REQUIRED');
  const original=JSON.stringify(rows);
  const unpriced=rows.map(stripSnapshotValuation);
  let snapshot,valid=false,reason='PUBLIC_SOURCE_NOT_VALIDATED';
  try{snapshot=await loadPublicSnapshot();guard();valid=await validatePublicSnapshot(snapshot,{now:clock()});guard();}
  catch(error){guard();reason='PUBLIC_SOURCE_UNAVAILABLE';}
  if(valid!==true){guard();return Object.freeze(unpriced.map(row=>Object.freeze({...row,venue:'',venueResolution:Object.freeze({resolved:false,venue:null,reason,evidence:[]})})));}
  const results=overlayVenues(unpriced,{TWSE:snapshot.TWSE,TPEX:snapshot.TPEX},{receivedAt:snapshot.receivedAt});guard();
  if(JSON.stringify(rows)!==original)throw Error('SOURCE_ROWS_MUTATED');
  return Object.freeze(results.map(({position,resolution})=>Object.freeze({...position,venueResolution:resolution})));
 };
}
function buildDailyRequests(positions){
 const accepted=[],blocked=[],seen=new Set();
 for(const p of positions||[]){
  if(p.positionStatus==='history'||Number(p.quantity||0)<=0)continue;
  const resolution=p.venueResolution;
  if(p.market!=='TW'||p.currency!=='TWD'||!['TWSE','TPEX'].includes(p.venue)||resolution?.resolved!==true||resolution.venue!==p.venue){blocked.push(Object.freeze({sourceId:p.sourceId||p.id||'',symbol:p.symbol||'',reason:'DAILY_SOURCE_UNRESOLVED'}));continue;}
  const key=[p.market,p.venue,p.currency,p.symbol].join(':');if(seen.has(key))continue;seen.add(key);
  accepted.push(Object.freeze({symbol:p.symbol,market:'TW',currency:'TWD',venue:p.venue,name:p.name||''}));
 }
 return Object.freeze({accepted:Object.freeze(accepted),blocked:Object.freeze(blocked)});
}
function stripSnapshotValuation(row){
 const historicalValuation=Object.freeze({lastPrice:row.lastPrice??row.last_price??null,marketValue:row.marketValue??row.market_value??null,unrealizedPnl:row.unrealizedPnl??row.unrealized_pnl??null,unrealizedPercent:row.unrealizedPercent??row.unrealized_pct??null,effectiveAt:row.effectiveAt??row.effective_at??row.snapshot_at??null,kind:'historical_snapshot_not_current_quote'});
 return Object.freeze({...row,lastPrice:null,last_price:null,marketValue:null,market_value:null,unrealizedPnl:null,unrealized_pnl:null,unrealizedPercent:null,unrealized_pct:null,returnRate:null,return_rate:null,historicalValuation});
}
module.exports={createReadOnlyOverlay,buildDailyRequests,stripSnapshotValuation};
