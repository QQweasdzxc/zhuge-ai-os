'use strict';
const {createReadOnlyOverlay,buildDailyRequests,stripSnapshotValuation}=require('./readonly-adapter.cjs');
const {validatePublicSnapshot}=require('./daily-snapshot-transport.cjs');
const {dailyClose}=require('./daily-close.cjs');
function createDailyConsumer({getSession,invokeFunction,normalizeQuote=x=>x,clock=Date.now,timeoutMs=12000}={}){
 if(typeof getSession!=='function'||typeof invokeFunction!=='function')throw Error('DAILY_CONSUMER_DEPENDENCIES_REQUIRED');
 const initial=getSession();
 if(!initial?.ownerId||!initial.generation)throw Error('SESSION_REQUIRED');
 function assertBoundSession(){const current=getSession();if(current?.authenticated!==true||current.ownerId!==initial.ownerId||current.generation!==initial.generation)throw Error('SESSION_CHANGED');return current;}
 let snapshot=null,inFlight=null;
 async function loadPublicSnapshot(){
  if(snapshot&&Number.isFinite(Date.parse(snapshot.receivedAt))&&clock()-Date.parse(snapshot.receivedAt)<300000)return snapshot;
  if(inFlight)return inFlight;
  const controller=new AbortController();
  let timer;
  const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('DAILY_SOURCE_TIMEOUT');reject(error);controller.abort(error);},Math.max(1,Number(timeoutMs)||12000));});
  const request=Promise.resolve().then(()=>invokeFunction('investment-daily-close-read',{mode:'official_daily_close'},{signal:controller.signal}));
  inFlight=Promise.race([request,timedOut]).then(value=>{assertBoundSession();snapshot=value;return value;}).catch(error=>{snapshot=null;throw error;}).finally(()=>{clearTimeout(timer);inFlight=null;});
  return inFlight;
 }
 const overlay=createReadOnlyOverlay({getSession:assertBoundSession,loadPublicSnapshot,validatePublicSnapshot,clock});
 async function enrichRawPositions(rows){
  const s=assertBoundSession();
  // AAL1 requires the resolved Creator read policy. The Edge independently
  // checks the saved server policy; client state never grants server access.
  if(s?.authenticated===true&&s.ownerId&&s.generation&&s.aal==='aal1'&&s.readMfaBypassed!==true)return Object.freeze(rows.map(row=>Object.freeze({...stripSnapshotValuation(row),venue:'',venueResolution:Object.freeze({resolved:false,venue:null,reason:'AAL2_REQUIRED_FOR_DAILY_SOURCE',evidence:[]})})));
  return overlay(rows);
 }
 function load(positions=[]){
  const s=assertBoundSession();if(!s||s.authenticated!==true||!(s.aal==='aal2'||(s.aal==='aal1'&&s.readMfaBypassed===true)))return pack([],positions,'DAILY_SOURCE_AAL2_REQUIRED');
  if(!validatePublicSnapshot(snapshot,{now:clock()}))return pack([],positions,'OFFICIAL_DAILY_SOURCE_NOT_CURRENT');
  const {accepted}=buildDailyRequests(positions);
  const quotes=accepted.map(p=>normalizeQuote(dailyClose(snapshot[p.venue],{venue:p.venue,symbol:p.symbol,receivedAt:snapshot.receivedAt}),clock()));
  return pack(quotes,positions,null);
 }
 function pack(quotes,positions,error){const gate=buildDailyRequests(positions);return Object.freeze({generatedAt:snapshot?.contract==='investment-official-daily-snapshot-v1'?snapshot.receivedAt:null,quotes:Object.freeze(quotes),fx:null,news:Object.freeze([]),contexts:Object.freeze([]),analyses:Object.freeze([]),strategyScans:Object.freeze([]),volumeConfirmations:Object.freeze([]),homeworkPacks:Object.freeze([]),quality:Object.freeze({dailyClose:Object.freeze({error,available:quotes.filter(q=>q.available).length,requested:gate.accepted.length,blocked:gate.blocked.length,sourceQuality:snapshot?.quality||{}})}),error});}
 return Object.freeze({enrichRawPositions,load,assertBoundSession});
}
module.exports={createDailyConsumer};
