'use strict';
// Isolated close-only candidate. No network, persistence, or live-provider registration.
function validDate(raw) {
  const s=String(raw??'').replace(/\D/g,'');
  let y,m,d;
  if(s.length===7){y=Number(s.slice(0,3))+1911;m=Number(s.slice(3,5));d=Number(s.slice(5));}
  else if(s.length===8){y=Number(s.slice(0,4));m=Number(s.slice(4,6));d=Number(s.slice(6));}
  else return null;
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
function price(raw){if(typeof raw!=='string'&&typeof raw!=='number')return null;const s=String(raw).trim();if(!/^\d+(?:\.\d+)?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}
const sources=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
function dailyClose(rows,{venue,symbol,receivedAt}={}){
 if(!sources[venue])throw new Error('Explicit supported venue required');
 if(!Array.isArray(rows))throw new Error('Array payload required');
 if(!/^[0-9A-Z]{4,6}$/.test(String(symbol??'')))throw new Error('Explicit security code required');
 if(!Number.isFinite(Date.parse(receivedAt)))throw new Error('Received timestamp required');
 const code=venue==='TWSE'?'Code':'SecuritiesCompanyCode';
 const candidates=rows.filter(r=>r&&String(r[code])===symbol).map(r=>({date:validDate(r.Date),price:price(r[venue==='TWSE'?'ClosingPrice':'Close'])})).filter(r=>r.date).sort((a,b)=>b.date.localeCompare(a.date));
 const latest=candidates[0];
 const conflicts=latest&&candidates.filter(r=>r.date===latest.date).some(r=>r.price!==latest.price);
 // A missing or conflicting latest close must not fall back to an older close.
 const value=latest&&!conflicts?latest.price:null;
 return Object.freeze({contract:'zhuge-investment-quote-v1',symbol,market:'TW',venue,currency:'TWD',price:value,available:value!==null,provider:venue.toLowerCase()+'-daily-close',source:venue+' Daily Close OpenAPI',sourceUrl:sources[venue],asOf:latest?.date||'',receivedAt,quoteType:'daily_close',delayed:true,realtime:false,error:conflicts?'CONFLICTING_LATEST_CLOSE':value===null?'DAILY_CLOSE_UNAVAILABLE':null});
}
module.exports={dailyClose,validDate};
