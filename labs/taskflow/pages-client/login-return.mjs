/**
 * Explicit one-time return to canonical Pages Dashboard after Zhuge login.
 * Does not intercept or replace OAuth callback processing. No token ever
 * enters the location, a third-party URL, or a log message.
 */
export const RETURN_KEY="tf-pages-explicit-login-return-v1";
export const HOME="https://qqweasdzxc.github.io/zhuge-ai-os/";
export const STATUS_CLASSIC=HOME+"status-classic.html";
const TIMEOUT_MS=3*60*1000;
export function hasFreshZhugeSession(storage,now=Date.now()){
 for(const key of ["zhuge_ai_os_google_auth_session_v1","zhuge_ai_os_session_v1"]){
  try{
   const record=JSON.parse(storage?.getItem(key)||"null");
   const token=record?.access_token;
   if(typeof token!=="string")continue;
   const payload=token.split(".")[1];
   if(!payload)continue;
   const json=atob(payload.replace(/-/g,"+").replace(/_/g,"/"));
   const claims=JSON.parse(json);
   if(Number.isFinite(claims.exp)&&claims.exp*1000>now+30000)return true;
  }catch{}
 }
 return false;
}
export function markExplicitReturn(sessionStore,now=Date.now(),target=HOME){
 sessionStore.setItem(RETURN_KEY,JSON.stringify({created_at:now,target}));
}
export function pendingExplicitReturn(sessionStore,now=Date.now()){
 try{
  const value=JSON.parse(sessionStore.getItem(RETURN_KEY)||"null");
  return [HOME,STATUS_CLASSIC].includes(value?.target)&&Number.isFinite(value.created_at)&&
     value.created_at<=now&&value.created_at>now-TIMEOUT_MS;
 }catch{return false;}
}
export function startReturnMonitor({
 sessionStore=sessionStorage,localStore=localStorage,now=()=>Date.now(),
 navigate=(url)=>location.replace(url),schedule=(callback,period)=>setInterval(callback,period),
 cancel=(id)=>clearInterval(id),
}={}){
 if(!pendingExplicitReturn(sessionStore,now()))return {active:false,stop(){}};
 let active=true,timer=null;
 const stop=()=>{active=false;if(timer!==null)cancel(timer);};
 const check=()=>{
  if(!active)return;
  if(!pendingExplicitReturn(sessionStore,now())){sessionStore.removeItem(RETURN_KEY);stop();return;}
  if(!hasFreshZhugeSession(localStore,now()))return;
  const {target}=JSON.parse(sessionStore.getItem(RETURN_KEY));
  sessionStore.removeItem(RETURN_KEY);
  stop();
  navigate(target);
 };
 check();
 if(active)timer=schedule(check,450);
 return {active,stop};
}
