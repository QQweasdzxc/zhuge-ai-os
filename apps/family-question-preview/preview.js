(()=>{'use strict';
const frame=document.getElementById('preview'),status=document.getElementById('status'),notice=document.getElementById('notice'),login=document.getElementById('login'),retry=document.getElementById('retry'),identity=document.getElementById('identity'),titleEl=document.querySelector('h1');
let epoch=0,loadedSignature='',poll=null,autoRetried=false;
const fileKey='trqn_private_question_preview_file_v1';
const gradeKey='trqn_private_question_preview_grade_v1';
// 無 #file= 深連時，以登入者本人 Drive 裡這個精確檔名找唯一一份私人預覽；檔名不含存取權，ID 不進 repo。
const PREVIEW_FILE_NAME='題庫呈現預覽-可互動.html';
// 群島學校島年級銜接：1 國小→小三（#grade=elem）、4 國中→國二（#grade=junior）。只過濾既有混合題的呈現，不拆檔、不擴題。
const GRADES={elem:{prefix:'國小',label:'小三'},junior:{prefix:'國中',label:'國二'}};
const signature=()=>['zhuge_ai_os_google_auth_session_v1','zhuge_ai_os_session_v1'].map(k=>localStorage.getItem(k)||'').join('|');
function clear(){frame.hidden=true;frame.removeAttribute('srcdoc');identity.textContent='';loadedSignature='';if(poll){clearInterval(poll);poll=null}}
function message(text,canLogin=false){notice.hidden=false;status.textContent=text;login.hidden=!canLogin;retry.hidden=false}
function params(){
  const h=new URLSearchParams(location.hash.slice(1));
  const f=h.get('file'),g=h.get('grade');
  const fOk=typeof f==='string'&&/^[\w-]{10,160}$/.test(f);
  const hasG=typeof g==='string'&&g.length>0;
  if(fOk)sessionStorage.setItem(fileKey,f);
  if(hasG&&GRADES[g])sessionStorage.setItem(gradeKey,g);
  // 明確 file 深連且未帶 grade＝要看完整預覽：清掉先前殘留的年級過濾，避免只顯單一年級。
  if(fOk&&!hasG)sessionStorage.removeItem(gradeKey);
  // 未知 grade 明確安全處理：不寫入、並清掉殘留過濾，退回完整呈現。
  if(hasG&&!GRADES[g])sessionStorage.removeItem(gradeKey);
  if(fOk||hasG)history.replaceState(null,'',location.pathname+location.search);
  return{id:sessionStorage.getItem(fileKey)||'',grade:sessionStorage.getItem(gradeKey)||''};
}
// 唯一精確本人檔案查找：只接受恰好一份同名且本人擁有的檔案；多份同名明確報錯，絕不自動任選（不取最新、不默讀錯檔）。
async function resolveFileId(headers,email){
  const q="name = '"+PREVIEW_FILE_NAME.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"' and trashed = false and 'me' in owners";
  const r=await fetch('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(q)+'&fields=files(id,name,owners(emailAddress))&pageSize=10',{headers,cache:'no-store',credentials:'omit'});
  if(r.status===401)return{authExpired:true};
  if(!r.ok)throw Error('暫時無法查找私人預覽檔案。');
  const list=((await r.json()).files||[]).filter(f=>f.name===PREVIEW_FILE_NAME&&(f.owners||[]).some(o=>String(o.emailAddress||'').toLowerCase()===email));
  if(!list.length)return{id:''};
  if(list.length>1)throw Error('這個 Google 帳戶的 Drive 裡有多份同名「'+PREVIEW_FILE_NAME+'」，無法確認要讀哪一份，已停止讀取；請只保留一份，或改用私人預覽連結。');
  return{id:list[0].id};
}
// 年級過濾呈現：只重寫 const D 陣列與標題計數，原檔其餘部分（題型互動、附圖、解說）原樣保留。
function filterGrade(html,grade){
  const m=html.match(/const D=(\[[\s\S]*?\]);const app=/);
  if(!m)throw Error('這份檔案不是目前的題庫預覽格式。');
  let all;
  try{all=JSON.parse(m[1])}catch(e){throw Error('題庫預覽內容暫時無法解析。')}
  if(!Array.isArray(all))throw Error('題庫預覽內容暫時無法解析。');
  if(!grade)return{html,count:all.length,label:''};
  const g=GRADES[grade],list=all.filter(q=>q&&typeof q.meta==='string'&&q.meta.indexOf(g.prefix)===0);
  if(!list.length)throw Error('這份題庫目前沒有'+g.prefix+'的題目可以試看。');
  return{html:html.replace(/const D=\[[\s\S]*?\];const app=/,'const D='+JSON.stringify(list)+';const app='),count:list.length,label:g.label};
}
login.onclick=()=>signInWithGoogle().catch(()=>message('目前無法開啟 Google 登入，請稍後重試。',true));
retry.onclick=load;
// 首訪 auth 競態：尚未成功載入時若登入狀態被更新（首次進入時的 session 寫回），自動重讀一次，不再要求手動按「重新讀取」；已成功載入後仍清除私人題文並提示。
window.addEventListener('storage',()=>{epoch++;const had=loadedSignature;clear();if(!had&&!autoRetried){autoRetried=true;notice.hidden=false;status.textContent='登入狀態已更新，正在重新讀取…';login.hidden=true;retry.hidden=true;load()}else{message('登入狀態已變更，私人題文已清除。請重新讀取。',true)}});
window.addEventListener('pagehide',()=>{epoch++;clear()});
window.addEventListener('pageshow',e=>{if(e.persisted)load()});
async function load(){
  const run=++epoch;clear();login.hidden=true;retry.hidden=true;notice.hidden=false;status.textContent='正在確認既有登入與私人題庫存取權…';
  try{
    const p=params();
    const auth=await getSupabaseAuthUser();if(run!==epoch)return;
    if(!auth?.user?.email){message('請用原有 Google 帳號登入後，回到這份家庭預覽。',true);return}
    session=supabaseSessionFromUser(auth.user,auth.authSession,auth.provider);persistAiOsSessionOnly();
    const before=signature(),token=currentGoogleProviderToken();
    if(!token){message('Google Drive 授權需要更新。使用原有 Google 登入後會回到這份預覽，不用下載或匯入。',true);return}
    const headers={Authorization:'Bearer '+token};
    const account=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers,cache:'no-store',credentials:'omit'});
    if(run!==epoch||signature()!==before)throw Error('登入帳戶已變更，請重新讀取。');
    if(account.status===401){message('Google Drive 登入已過期，請更新既有 Google 登入。',true);return}
    if(!account.ok)throw Error('暫時無法確認 Google Drive 帳戶。');
    const who=await account.json(),email=auth.user.email.toLowerCase();
    if(String(who.user?.emailAddress||'').toLowerCase()!==email)throw Error('Google Drive 與 TRQN 登入帳戶不一致，未讀取題文。');
    let id=p.id;
    if(!id){
      const found=await resolveFileId(headers,email);
      if(run!==epoch||signature()!==before)throw Error('登入帳戶已變更，請重新讀取。');
      if(found.authExpired){message('Google Drive 登入已過期，請更新既有 Google 登入。',true);return}
      if(!found.id){message('請從與助理的私人對話開啟這份預覽連結。題目不在公開網站內。');return}
      id=found.id;
    }
    const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{headers,cache:'no-store',credentials:'omit'});
    if(run!==epoch||signature()!==before)throw Error('登入帳戶已變更，請重新讀取。');
    if(r.status===401){message('Google Drive 登入已過期，請更新既有 Google 登入。',true);return}
    if(r.status===403||r.status===404)throw Error('這個 Google 帳戶沒有這份私人預覽的讀取權。請使用原帳戶，不會改變分享設定。');
    if(!r.ok)throw Error('私人題庫暫時無法讀取，請稍後重試。');
    let html=await r.text();
    if(run!==epoch||signature()!==before)throw Error('登入帳戶已變更，請重新讀取。');
    if(html.length>500000||!html.includes('const D=[')||!html.includes('id=app'))throw Error('這份檔案不是目前的題庫預覽格式。');
    const out=filterGrade(html,p.grade);
    html=out.html.replace('題庫呈現預覽（真實題目，非正式站）','題庫呈現試看 · '+(out.label?out.label+' ':'')+out.count+'題').replace('版面是這份預覽自己的','版面是自家學習站的預覽');
    if(titleEl&&out.label)titleEl.textContent=out.label+'題庫試看';
    const csp="<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";
    frame.srcdoc=csp+html;frame.hidden=false;notice.hidden=true;
    identity.textContent='已登入 '+auth.user.email+' · 私人讀取 · 不記錄作答';
    loadedSignature=before;
    poll=setInterval(()=>{if(signature()!==loadedSignature){epoch++;clear();message('登入狀態已變更，私人題文已清除。請重新讀取。',true)}},500);
  }catch(e){clear();message(e.message||'預覽暫時無法開啟。')}
}
load();})();
