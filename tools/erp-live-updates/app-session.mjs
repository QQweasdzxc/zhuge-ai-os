import{dualRefresh}from'./dual-refresh.mjs';import{privateHintSession}from'./private-hint.mjs';
// Explicit integration seam. No credentials persisted and no polling loop; incoming observations are coalesced.
export function installUpdates({store,observations,auth,transport,window,document,isSafe,render,onState,onVerified,onSnapshot,onIdentity,onReadStart}){
 let generation=0,disposed=false;
 const read=dualRefresh({store,observations,identity:auth.identity,editGeneration:()=>generation,isSafe,isVisible:()=>document.visibilityState==='visible',render,onState,onSnapshot,onReadStart});
 const session=privateHintSession({transport,identity:auth.identity,approved:auth.approved,currentToken:auth.token,onInvalidate:()=>read.invalidate(),onVerified:payload=>{onVerified?.(payload);read.invalidateInventory()},onState:state=>onState?.(state)});
 const touch=()=>{generation++};
 const activate=()=>{if(!disposed){onIdentity?.(auth.approved()?auth.identity():'');session.authChanged().catch(e=>onState?.('disconnected',e))}};
 const storage=event=>{if(!event||event.key===null||['zhuge_ai_os_session_v1','zhuge_ai_os_google_auth_session_v1'].includes(event.key))activate()};
 const visible=()=>{if(document.visibilityState==='visible')read.invalidate()};
 const safePoint=()=>{if(!disposed)read.flush()};
 // Capturing all interactions errs toward preserving old snapshot. Call safePoint after state cleanup/render.
 for(const event of['input','change','click','keydown'])document.addEventListener(event,touch,true);
 window.addEventListener('erp-auth-change',activate);window.addEventListener('erp-auth-token-change',activate);
 window.addEventListener('storage',storage);window.addEventListener('online',activate);document.addEventListener('visibilitychange',visible);
 return{start:activate,safePoint,markStateChange:touch,async stop(){disposed=true;read.stop();for(const e of['input','change','click','keydown'])document.removeEventListener(e,touch,true);window.removeEventListener('erp-auth-change',activate);window.removeEventListener('erp-auth-token-change',activate);window.removeEventListener('storage',storage);window.removeEventListener('online',activate);document.removeEventListener('visibilitychange',visible);await session.stop()}};
}
