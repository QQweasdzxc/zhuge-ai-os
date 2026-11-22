// Candidate contract. No network, timers or production connection is started here.
import {VERIFIED_EVENT,isVerifiedObservation} from '../../supabase/functions/zg-ledger-bridge/live-event-core.mjs';
export const HINT_TOPIC='zg-erp-ledger-invalidate-v1';
export const HINT_EVENT='invalidate';
export const HINT_PAYLOAD=Object.freeze({v:1});
export function isHint(topic,event,payload){return topic===HINT_TOPIC&&event===HINT_EVENT&&payload&&Object.keys(payload).length===1&&payload.v===1;}
export function privateHintSession({transport,identity,approved,currentToken,onInvalidate,onVerified,onState}){
 let epoch=0,channel=null,stopped=false,who=null;
 async function disconnect(){epoch++;const old=channel;channel=null;who=null;if(old)await old.leave();}
 async function connect(){await disconnect();if(stopped||!identity()||!approved())return;const e=epoch,account=identity();who=account;onState?.('CONNECTING');const token=await currentToken();if(e!==epoch||account!==identity()||!approved())return;if(!token){onState?.('TOKEN_REQUIRED');return;}
  const joined=await transport.join({topic:HINT_TOPIC,private:true,token,receive:({topic,event,payload})=>{if(e!==epoch||account!==identity()||!approved()||topic!==HINT_TOPIC)return;if(isHint(topic,event,payload))Promise.resolve(onInvalidate('hint')).catch(()=>onState?.('read-failed'));else if(event===VERIFIED_EVENT&&isVerifiedObservation(payload))onVerified?.(payload)},status:status=>{if(e!==epoch)return;onState?.(status);if(status==='SUBSCRIBED'&&account===identity()&&approved())Promise.resolve(onInvalidate('connected')).catch(()=>onState?.('read-failed'));}});
  if(e!==epoch||account!==identity()||!approved()){if(joined)await joined.leave();return;}channel=joined;
 }
 return{connect,async authChanged(){return connect()},async tokenChanged(){return connect()},async stop(){stopped=true;await disconnect()}};
}
// Called only after durable write/readback success. A failed hint never changes write outcome or replays it.
export async function afterVerifiedSave(result,{serverApproved,send}){
 if(!serverApproved||result?.verified!==true)return {attempted:false};
 try{await send({topic:HINT_TOPIC,private:true,event:HINT_EVENT,payload:HINT_PAYLOAD});return{attempted:true,hinted:true}}catch{return{attempted:true,hinted:false}}
}
