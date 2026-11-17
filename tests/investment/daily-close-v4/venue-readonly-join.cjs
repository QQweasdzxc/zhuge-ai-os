'use strict';
const {validDate}=require('./daily-close.cjs');
const SOURCES=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
// Read-only join over caller-supplied official daily datasets. A quote with no
// price can establish membership, but never establishes a usable close.
function resolveVenue(position,datasets,{receivedAt}={}){
 const fail=reason=>Object.freeze({resolved:false,reason,venue:null,evidence:[]});
 if(position?.market!=='TW'||position?.currency!=='TWD')return fail('OUTSIDE_TW_TWD_SCOPE');
 if(!/^[0-9A-Z]{4,6}$/.test(position.symbol||''))return fail('EXACT_CODE_REQUIRED');
 if(!Number.isFinite(Date.parse(receivedAt)))return fail('READ_TIME_REQUIRED');
 if(!Array.isArray(datasets?.TWSE)||!Array.isArray(datasets?.TPEX))return fail('BOTH_OFFICIAL_DATASETS_REQUIRED');
 const evidence=[];
 for(const venue of ['TWSE','TPEX']){
  const key=venue==='TWSE'?'Code':'SecuritiesCompanyCode';
  const rows=datasets[venue].filter(r=>r&&r[key]===position.symbol);
  if(rows.length){const dates=rows.map(r=>validDate(r.Date));if(dates.some(d=>!d))return fail('INVALID_MEMBERSHIP_DATE');const date=dates.sort().at(-1);if(date>new Date(Date.parse(receivedAt)+8*60*60*1000).toISOString().slice(0,10))return fail('FUTURE_MEMBERSHIP_DATE');evidence.push(Object.freeze({venue,symbol:position.symbol,sourceUrl:SOURCES[venue],dataDate:date,receivedAt}));}
 }
 if(evidence.length!==1)return fail(evidence.length?'AMBIGUOUS_MEMBERSHIP':'CODE_NOT_FOUND');
 if(position.venue&&position.venue!==evidence[0].venue)return fail('EXISTING_VENUE_CONFLICT');
 return Object.freeze({resolved:true,reason:'EXACT_OFFICIAL_MEMBERSHIP',venue:evidence[0].venue,evidence:Object.freeze(evidence)});
}
function overlayVenues(positions,datasets,options){return positions.map(position=>{const match=resolveVenue(position,datasets,options);return Object.freeze({position:Object.freeze({...position,...(match.resolved?{venue:match.venue}:{venue:''})}),resolution:match});});}
module.exports={resolveVenue,overlayVenues};
