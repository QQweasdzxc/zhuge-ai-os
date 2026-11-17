'use strict';
const {validDate}=require('./daily-close.cjs');
const DAY=86400000;
const SOURCES=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
function taipeiDay(now){if(!Number.isFinite(now))throw Error('CLOCK_REQUIRED');return new Date(now+8*3600000).toISOString().slice(0,10);}
function parseTwseCalendar(payload,{year,receivedAt,sourceUrl}={}){
 if(payload?.stat!=='ok'||payload.date!==`${year}0101`||!Array.isArray(payload.data)||payload.total!==payload.data.length||payload.data.length<10||payload.fields?.[0]!=='日期'||payload.fields?.[1]!=='名稱')throw Error('CALENDAR_RESPONSE_INVALID');
 const closed=[],opened=[],seen=new Set();
 for(const row of payload.data){const date=validDate(row?.[0]);if(!date||!date.startsWith(`${year}-`)||seen.has(date)||typeof row[1]!=='string'||!row[1])throw Error('CALENDAR_ROW_INVALID');seen.add(date);if(/開始交易日|最後交易日/.test(row[1]))opened.push(date);else closed.push(date);}
 if(!opened.length||!closed.length)throw Error('CALENDAR_COVERAGE_INVALID');
 return Object.freeze({venue:'TWSE',year,closed:Object.freeze(closed),opened:Object.freeze(opened),receivedAt,sourceUrl});
}
function latestExpectedClose(calendar,{now=Date.now(),publicationCutoffHour=18}={}){
 // 18:00 Taipei is a conservative application cutoff, not a claimed exchange
 // publication guarantee. Prior daily close may be shown before it with date.
 const today=taipeiDay(now),received=Date.parse(calendar?.receivedAt);
 if(!Number.isFinite(received)||received>now+60000||now-received>DAY||calendar.year!==Number(today.slice(0,4))||!Array.isArray(calendar.closed)||!Array.isArray(calendar.opened))throw Error('CURRENT_YEAR_CALENDAR_REQUIRED');
 const localHour=new Date(now+8*3600000).getUTCHours();
 let day=Date.parse(today+'T00:00:00Z')-(localHour<publicationCutoffHour?DAY:0);
 for(let i=0;i<32;i++,day-=DAY){const date=new Date(day).toISOString().slice(0,10),weekday=new Date(day).getUTCDay();if(!date.startsWith(`${calendar.year}-`))throw Error('PRIOR_YEAR_CALENDAR_REQUIRED');if(calendar.opened.includes(date)||(!calendar.closed.includes(date)&&weekday!==0&&weekday!==6))return date;}
 throw Error('CALENDAR_LOOKBACK_EXCEEDED');
}
function validateVenue(rows,{venue,sourceUrl,receivedAt,calendar,now=Date.now()}={}){
 const fail=reason=>Object.freeze({valid:false,reason,venue});
 if(!SOURCES[venue]||sourceUrl!==SOURCES[venue]||calendar?.venue!==venue)return fail('SOURCE_PROVENANCE_REQUIRED');
 const time=Date.parse(receivedAt);if(!Number.isFinite(time)||time>now+60000||now-time>15*60000)return fail('PUBLIC_RESPONSE_TOO_OLD');
 let expected;try{expected=latestExpectedClose(calendar,{now});}catch(e){return fail(e.message);}
 if(!Array.isArray(rows)||!rows.length)return fail('EMPTY_OR_NON_ARRAY');
 const minimumRows=venue==='TWSE'?1000:10000;if(rows.length<minimumRows)return fail('TRUNCATION_GUARD');
 const code=venue==='TWSE'?'Code':'SecuritiesCompanyCode',close=venue==='TWSE'?'ClosingPrice':'Close',seen=new Map();
 let dataDate='';
 for(const row of rows){if(!row||typeof row!=='object'||!Object.hasOwn(row,close)||typeof row[code]!=='string'||!/^[0-9A-Z]{4,6}$/.test(row[code]))return fail('ROW_SCHEMA_INVALID');const date=validDate(row.Date);if(!date)return fail('DATA_DATE_INVALID');if(dataDate&&dataDate!==date)return fail('MIXED_DATA_DATES');dataDate=date;const previous=seen.get(row[code]);if(previous&&previous!==JSON.stringify(row))return fail('DUPLICATE_CODE_CONFLICT');seen.set(row[code],JSON.stringify(row));}
 if(seen.size<minimumRows)return fail('UNIQUE_CODE_TRUNCATION_GUARD');
 if(dataDate>taipeiDay(now))return fail('FUTURE_DATA');
 if(dataDate!==expected)return fail(dataDate<expected?'STALE_DAILY_DATA':'UNEXPECTED_SESSION_DATE');
 return Object.freeze({valid:true,venue,dataDate,expectedDate:expected,receivedAt,rowCount:rows.length,uniqueCodes:seen.size,sourceUrl,completeness:'transport-array-validated-not-universe-guaranteed'});
}
async function verifiedCalendar(venue,payload,{manifest,receivedAt,cryptoImpl=globalThis.crypto}={}){
 const entry=manifest?.[venue];
 if(!entry||manifest.year!==2026||payload?.stat!=='ok'||!Number.isFinite(Date.parse(receivedAt)))throw Error('CALENDAR_PROVENANCE_REQUIRED');
 let value;
 if(venue==='TWSE'){if(payload.date!==`${manifest.year}0101`||payload.total!==payload.data?.length)throw Error('CALENDAR_YEAR_OR_TOTAL');value=JSON.stringify(payload.data);}
 else if(venue==='TPEX'){if(payload.endDate!==`${manifest.year}0101`||typeof payload.data?.html!=='string')throw Error('CALENDAR_YEAR_OR_TOTAL');value=payload.data.html;}
 else throw Error('CALENDAR_VENUE_REQUIRED');
 const digest=[...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==entry.digest)throw Error('CALENDAR_CONTENT_CHANGED');
 return Object.freeze({venue,year:manifest.year,closed:Object.freeze(entry.closed.slice()),opened:Object.freeze(entry.opened.slice()),sourceUrl:entry.sourceUrl,receivedAt,digest});
}
module.exports={taipeiDay,parseTwseCalendar,latestExpectedClose,validateVenue,verifiedCalendar,SOURCES};
