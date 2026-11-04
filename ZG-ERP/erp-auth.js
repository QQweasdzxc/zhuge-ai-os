/* ERP entry uses the existing shared Google/Supabase identity, not a new account. */
(function(global){
 'use strict';
 const RETURN_KEY='zg-erp-login-return-v1';
 const base=new URL('./',location.href),safePath=base.pathname;
 let status='checking',error='',identity=null;
 function safeReturn(value){try{const u=new URL(value,location.origin);if(u.origin!==location.origin||![safePath,safePath+'index.html'].includes(u.pathname))return base.href;for(const k of ['code','state','error','error_code','error_description','access_token','refresh_token'])u.searchParams.delete(k);if(/access_token|refresh_token/.test(u.hash))u.hash='';return u.href;}catch{return base.href;}}
 function notify(){global.dispatchEvent(new CustomEvent('erp-auth-change'));}
 async function verify(){
  status='checking';error='';notify();
  try{
   session=readJson(AI_OS_SESSION_KEY,null);
   if(new URLSearchParams(location.search).has('code')&&!getStoredCodeVerifier()){cleanAuthCallbackUrl();throw new Error('登入回傳驗證未完成，請重新使用 Google 登入。');}
   const result=await getSupabaseAuthUser();
   if(!result){if(new URLSearchParams(location.search).has('code')){cleanAuthCallbackUrl();status='error';error='登入回傳驗證未完成，請重新使用 Google 登入。';return false;}status=getStoredAuthSession()?.access_token?'error':'signed-out';error=getStoredOAuthError()?.message||(status==='error'?'登入驗證暫時無法完成，請重試。':'');return false;}
   const response=await fetch(AUTH_CONFIG.supabaseUrl+'/rest/v1/rpc/is_app_access_approved',{method:'POST',headers:authHeaders(result.authSession.access_token),body:'{}'});
   if(!response.ok)throw new Error('權限檢查暫時無法完成，尚未載入設備資料。');
   const approved=await response.json();if(typeof approved!=='boolean')throw new Error('權限檢查回應異常，尚未載入設備資料。');
   identity=supabaseSessionFromUser(result.user,result.authSession,result.provider);
   session=identity;persistAiOsSessionOnly();
   if(approved!==true){status='denied';return false;}
   status='ready';
   const pending=sessionStorage.getItem(RETURN_KEY);
   if(pending){sessionStorage.removeItem(RETURN_KEY);const target=safeReturn(pending);if(target!==location.href)history.replaceState(null,'',target);}
   return true;
  }catch(e){status='error';error=String(e.message||'登入驗證失敗，請重試。');return false;}
  finally{notify();}
 }
 async function login(){
  try{sessionStorage.setItem(RETURN_KEY,safeReturn(location.href));history.replaceState(null,'',base.pathname);error='';await signInWithGoogle();}
  catch(e){status='error';error=String(e.message||'無法開始 Google 登入。');notify();}
 }
 global.ErpAuth={state:()=>({status,error,identity}),verify,login,safeReturn,refresh:async()=>{const s=await refreshAuthSession(true);return s?.access_token||null;}};
 global.ErpAuth.ready=verify();
})(window);
