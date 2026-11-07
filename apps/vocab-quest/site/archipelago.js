/* Learning Archipelago V1 — shared hero, class selection and promotion exam. */
(function(){
'use strict';
const world=document.querySelector('#adventureArea')?'chengyu':'vocab';
const api='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/learning-adventure-cloud';
const roles={
warrior:{icon:'⚔️',name:'勇士',description:'勇敢挑戰，每次失敗都能再次出發'},
mage:{icon:'🪄',name:'法師',description:'運用智慧，發現隱藏在題目裡的線索'},
ranger:{icon:'🏹',name:'弓箭手',description:'細心觀察，用精準判斷破解難題'},
guardian:{icon:'🛡️',name:'守護者',description:'穩扎穩打，守護自己的學習成果'}
};
let learnerId='',hero=null,loadSequence=0,exam=null,examIndex=0,examAnswers=[],busy=false,openDialog=false;
const $=id=>document.getElementById(id);
function safe(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function token(){try{return new URLSearchParams(location.hash.replace(/^#/,'')).get('f')||''}catch(e){return ''}}
function title(lv){return lv>=30?'傳說勇者':lv>=20?'神話冒險家':lv>=12?'大師級冒險者':lv>=8?'黃金勇士':lv>=5?'白銀勇士':lv>=3?'青銅勇士':lv>=2?'正式冒險者':'見習冒險者'}
const style=document.createElement('style');
style.textContent='.universal-hero{margin:13px 0 17px;padding:15px 17px;border:1px solid #d7d8f2;border-radius:19px;background:linear-gradient(120deg,#eae6ff,#e6f8f1);color:#323d64}.universal-hero[hidden],.adventure-modal[hidden]{display:none!important}.universal-hero .hero-title{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.universal-hero .hero-title strong{font-size:18px;color:#4e38a4}.universal-hero .hero-label{font-size:12px;font-weight:900;letter-spacing:.05em;color:#6953bc}.universal-hero p{font-size:12px;margin:8px 0;color:#667690}.universal-hero .global-xp{height:11px;border-radius:18px;background:#cbcce5;overflow:hidden}.universal-hero .global-xp span{height:100%;display:block;background:linear-gradient(90deg,#6355ce,#d9a74a)}.universal-hero .island-totals{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.universal-hero .island-totals span{border:1px solid #dcd9ed;border-radius:9px;background:#fff;padding:6px 9px;font-size:12px}.universal-hero button{background:#6856d2;color:white;border:0;border-radius:12px;padding:10px 14px;font-weight:900;cursor:pointer;font-size:14px}.universal-hero button:disabled{opacity:.5}.adventure-modal{position:fixed;inset:0;z-index:10010;background:rgba(10,20,46,.9);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;overscroll-behavior:contain;padding:18px 11px 35px}.adventure-modal-card{width:min(100%,590px);margin:auto;padding:23px 20px;background:#fff;border-radius:23px;color:#283757;text-align:center;box-shadow:0 22px 70px #080e2c61}.adventure-modal-card h2{font-size:clamp(23px,5.5vw,30px);margin:10px 0}.adventure-modal-card p{color:#6e7a91;line-height:1.65;font-size:14px}.adventure-role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px;margin-top:19px}.adventure-role{border:2px solid #e2dff2;border-radius:17px;min-height:142px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;background:#f7f6ff;color:#344268;cursor:pointer}.adventure-role .icon{font-size:35px}.adventure-role strong{font-size:20px}.adventure-role small{font-size:12px;line-height:1.4;color:#6b7894}.adventure-role:hover,.adventure-role:focus-visible{border-color:#7561d8;background:#eae5ff}.adventure-role:disabled{opacity:.55}.adventure-exam-progress{font-size:13px;font-weight:900;color:#6d5cc4;margin-top:12px}.adventure-exam-choices{display:grid;gap:9px;text-align:left;margin:17px 0}.adventure-exam-choice{display:block;border:2px solid #e4e3f0;border-radius:13px;background:#f8f9ff;padding:14px;font:inherit;color:#344063;text-align:left;cursor:pointer}.adventure-exam-choice:hover{border-color:#7b69db;background:#f1efff}.adventure-exam-action{background:#6957d7;color:white;border:0;border-radius:12px;padding:12px 17px;font-weight:900;font:inherit;cursor:pointer}.adventure-exam-review{text-align:left;font-size:13px;line-height:1.8;max-height:330px;overflow-y:auto}.adventure-exam-review div{padding:9px 0;border-bottom:1px solid #eee}.adventure-exam-status{font-size:14px;color:#a54d63}.adventure-exam-close{background:transparent;border:1px solid #c8c9d8;border-radius:11px;padding:9px 15px;cursor:pointer;margin-top:15px;color:#65718c}@media(max-width:480px){.adventure-role-grid{gap:9px}.adventure-role{min-height:135px;padding:8px}.adventure-role strong{font-size:17px}.adventure-modal-card{padding:20px 15px}.universal-hero{padding:12px 13px}}';
style.textContent += '.adventure-hero-main{display:flex;align-items:center;gap:12px;min-width:0}.adventure-hero-main strong{line-height:1.5}.adventure-role-portrait{display:block;width:100%;aspect-ratio:96/61;background-image:var(--arch-role-art);background-size:200% 200%;background-repeat:no-repeat;border:2px solid #9587ce;border-radius:5px}.adventure-role-portrait.warrior{background-position:0 0}.adventure-role-portrait.mage{background-position:100% 0}.adventure-role-portrait.ranger{background-position:0 100%}.adventure-role-portrait.guardian{background-position:100% 100%}.adventure-role{min-height:190px!important;padding:8px!important;justify-content:flex-start!important}.adventure-role .icon{font-size:16px!important}.adventure-role strong{font-size:17px!important}.adventure-hero-portrait{display:block;flex:0 0 116px;width:116px;height:74px;max-width:35vw;border-radius:6px;border:2px solid #6673aa;background-image:var(--arch-role-art);background-size:200% 200%;background-repeat:no-repeat}.adventure-hero-portrait.warrior{background-position:0 0}.adventure-hero-portrait.mage{background-position:100% 0}.adventure-hero-portrait.ranger{background-position:0 100%}.adventure-hero-portrait.guardian{background-position:100% 100%}@media(max-width:450px){.adventure-hero-portrait{flex-basis:84px;width:84px;height:56px}.adventure-role{min-height:150px!important}}';
style.textContent += '.adventure-hero-portrait,.adventure-role-portrait{background-image:var(--arch-role-art-v2,var(--arch-role-art))!important;background-size:400% 200%!important}.adventure-hero-portrait.warrior,.adventure-role-portrait.warrior{background-position-x:0%!important}.adventure-hero-portrait.mage,.adventure-role-portrait.mage{background-position-x:33.333%!important}.adventure-hero-portrait.ranger,.adventure-role-portrait.ranger{background-position-x:66.666%!important}.adventure-hero-portrait.guardian,.adventure-role-portrait.guardian{background-position-x:100%!important}.adventure-hero-portrait.boy,.adventure-role-portrait.boy{background-position-y:0%!important}.adventure-hero-portrait.girl,.adventure-role-portrait.girl{background-position-y:100%!important}.island-avatar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin:15px 0}.island-avatar-option{border:3px solid #7168ae;border-radius:7px;background:#eeeafa;color:#33436d;padding:9px;font:inherit;font-weight:900;cursor:pointer;display:flex;flex-direction:column;gap:8px;align-items:center}.island-avatar-option.girl{background:#faeaf2;border-color:#c884b0}.island-avatar-option .preview{display:block;width:100%;aspect-ratio:256/180;background-image:var(--arch-role-art-v2);background-size:400% 200%;background-position-x:0%;border-radius:5px}.island-avatar-option .preview.girl{background-position-y:100%}.island-avatar-option .preview.boy{background-position-y:0%}.island-avatar-option strong{font-size:17px}@media(max-width:480px){.island-avatar-grid{gap:9px}.island-avatar-option{padding:6px}}';
document.head.append(style);
const card=document.createElement('section');card.className='universal-hero';card.id='universalHero';card.hidden=true;
const host=world==='chengyu'?document.querySelector('#adventureArea'):document.querySelector('main.shell header.top');
if(!host)return;
if(world==='vocab')host.after(card);else host.before(card);
const modal=document.createElement('div');modal.className='adventure-modal';modal.id='adventureModal';modal.hidden=true;
modal.innerHTML='<div class="adventure-modal-card" role="dialog" aria-modal="true" aria-labelledby="adventureModalTitle" id="adventureModalContent"></div>';
document.body.append(modal);
let oldOverflow='';
function showModal(html){
 if(!openDialog)oldOverflow=document.body.style.overflow;
 openDialog=true;modal.hidden=false;document.body.style.overflow='hidden';
 $('adventureModalContent').innerHTML=html;
}
function closeModal(){modal.hidden=true;openDialog=false;document.body.style.overflow=oldOverflow}
function loadingModal(){showModal('<h2 id="adventureModalTitle">⏳ 正在讀取冒險者資料</h2><p>正在確認雲端勇士身分…</p>')}
async function call(action,extra){
 const t=token();
 if(!t||!learnerId)throw new Error('請使用家庭專用網址並選擇玩家');
 const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...extra,action,token:t,world,learnerId}),cache:'no-store'});
 const data=await response.json().catch(()=>null);
 if(!response.ok||!data?.ok)throw new Error(data?.error||'雲端連線失敗');
 return data;
}
function renderHero(stats){
 if(!hero){card.hidden=true;return}
 card.hidden=false;
 const xp=Number(hero.totalXP)||0,lv=Number(hero.level)||1,base=50*(lv-1)*lv,next=Number(hero.nextXP)||100,eligible=hero.eligible;
 const pct=Math.max(0,Math.min(100,Math.round((xp-base)/(next-base)*100)));
 const r=roles[hero.profession];
 card.innerHTML='<div class="hero-label">🌏 學習群島 · 我的共用冒險者</div>'+
 '<div class="hero-title"><div class="adventure-hero-main">'+(r?'<span class="adventure-hero-portrait '+hero.profession+' '+(hero.avatarStyle||'boy')+'" role="img" aria-label="'+r.name+'角色插畫"></span>':'')+'<strong>'+(r?.icon||'⭐')+' '+safe(hero.name)+'｜Lv. '+lv+' '+title(lv)+'</strong></div><span>'+xp+' XP</span></div>'+
 '<p>'+(r?'職業：'+r.name+' · ':'尚未選擇職業 · ')+(eligible?'XP 已達標，請通過升級試煉才能正式升級':'距離下一次升級試煉還差 '+Math.max(0,next-xp)+' XP')+'</p>'+
 '<div class="global-xp"><span style="width:'+pct+'%"></span></div>'+
 '<div class="island-totals"><span>📖 成語島：'+Number(stats?.chengyu||0)+' XP</span><span>🔤 英文島：'+Number(stats?.vocab||0)+' XP</span>'+
 (eligible?'<button type="button" id="adventureExamButton">🏰 挑戰升級試煉</button>':'')+
 (hero.avatarStyle?'<button type="button" id="adventureChangeStyle">🎨 更換角色造型</button>':'<button type="button" id="adventureChangeStyle">🎨 選擇角色造型</button>')+
 (!r?'<button type="button" id="adventureChooseClass">🎭 選擇職業</button>':'')+'</div>';
 $('adventureExamButton')?.addEventListener('click',startExam);
 $('adventureChooseClass')?.addEventListener('click',showClass);
 $('adventureChangeStyle')?.addEventListener('click',showAppearance);
}
function showAppearance(){
 showModal('<h2 id="adventureModalTitle">🎨 步驟 1：選擇角色造型</h2>'+
 '<p>男生、女生都能選任何職業。更換外觀不會更動職業、Lv.、XP 或成績。</p>'+
 '<div class="island-avatar-grid">'+
 '<button type="button" class="island-avatar-option boy" data-style="boy"><span class="preview boy" role="img" aria-label="男生造型預覽"></span><strong>♂ 男生造型</strong></button>'+
 '<button type="button" class="island-avatar-option girl" data-style="girl"><span class="preview girl" role="img" aria-label="女生造型預覽"></span><strong>♀ 女生造型</strong></button>'+
 '</div><p id="adventureStyleError" role="alert"></p>');
 $('adventureModalContent').querySelectorAll('[data-style]').forEach(btn=>btn.addEventListener('click',async()=>{
  if(busy)return;busy=true;
  $('adventureModalContent').querySelectorAll('[data-style]').forEach(b=>b.disabled=true);
  try{
   const data=await call('setAvatarStyle',{avatarStyle:btn.dataset.style});
   hero=data.hero;
   closeModal();
   if(!hero.profession)showClass();
   else await refresh();
  }catch(e){
   if($('adventureStyleError'))$('adventureStyleError').textContent='⚠️ '+e.message;
   $('adventureModalContent').querySelectorAll('[data-style]').forEach(b=>b.disabled=false);
  }finally{busy=false}
 }));
}
function showClass(){
 if(!hero?.avatarStyle){showAppearance();return;}
 const choices=Object.entries(roles).map(([code,v])=>'<button type="button" class="adventure-role" data-role="'+code+'"><span class="adventure-role-portrait '+code+' '+(hero.avatarStyle||'boy')+'" role="img" aria-label="'+v.name+'角色插畫"></span><strong><span class="icon">'+v.icon+'</span> '+v.name+'</strong><small>'+safe(v.description)+'</small></button>').join('');
 showModal('<div style="font-size:40px">🌟</div><h2 id="adventureModalTitle">選擇你的冒險職業</h2><p>這是你的第一個職業！不管去英文島或成語島，都會是同一位冒險者。<br>四種職業的學習分數完全一樣。</p><div class="adventure-role-grid">'+choices+'</div><p class="adventure-exam-status" id="adventureRoleError" role="alert"></p>');
 $('adventureModalContent').querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',async()=>{
  if(busy)return;busy=true;
  $('adventureModalContent').querySelectorAll('[data-role]').forEach(x=>x.disabled=true);
  try{
   const updated=await call('chooseProfession',{profession:b.dataset.role});
   hero=updated.hero;
   closeModal();
   await refresh();
  }catch(e){
   $('adventureRoleError').textContent='⚠️ '+e.message;
   $('adventureModalContent').querySelectorAll('[data-role]').forEach(x=>x.disabled=false);
  }finally{busy=false}
 }));
}
async function refresh(){
 if(!learnerId||!token())return;
 const sequence=++loadSequence;
 try{
  const data=await call('load');
  if(sequence!==loadSequence)return;
  hero=data.hero;
  renderHero(data.islandXP);
  if(!hero.avatarStyle)showAppearance();
  else if(!hero.profession)showClass();
  else if(data.pendingExam&&!openDialog){exam=data.pendingExam;examIndex=0;examAnswers=[];}
 }catch(e){
  if(sequence!==loadSequence)return;
  card.hidden=false;
  card.textContent='⚠️ 冒險者總部連線失敗：'+e.message+'（原本學習遊戲仍可使用）';
 }
}
window.adventureProfileRefresh=function(nextWorld,nextId){
 if(nextWorld!==world||!nextId)return;
 if(nextId!==learnerId){hero=null;exam=null;loadSequence++;closeModal();learnerId=nextId}
 refresh();
};
async function startExam(){
 if(busy)return;busy=true;loadingModal();
 try{
  const data=await call('startExam');
  hero=data.hero;exam=data.exam;examIndex=0;examAnswers=[];
  renderExam();
 }catch(e){showModal('<h2 id="adventureModalTitle">無法開啟試煉</h2><p>⚠️ '+safe(e.message)+'</p><button class="adventure-exam-close" id="adventureClose">返回學習</button>');$('adventureClose').onclick=closeModal}
 finally{busy=false}
}
function renderExam(){
 if(!exam||examIndex>=exam.questions.length)return;
 const q=exam.questions[examIndex];
 const options=q.choices.map((choice,i)=>'<button type="button" class="adventure-exam-choice" data-exam-choice="'+i+'">'+String.fromCharCode(65+i)+'．'+safe(choice)+'</button>').join('');
 showModal('<div style="font-size:30px">🏰</div><h2 id="adventureModalTitle">Lv. '+exam.fromLevel+' → Lv. '+(exam.fromLevel+1)+' 晉級試煉</h2>'+
 '<div class="adventure-exam-progress">第 '+(examIndex+1)+' / 10 題 · 答對至少 8 題才能升級</div>'+
 '<p style="font-weight:800;font-size:18px;color:#263655">'+safe(q.stem)+'</p>'+
 '<div class="adventure-exam-choices">'+options+'</div>'+
 '<p class="adventure-exam-status" id="adventureExamError"></p>');
 $('adventureModalContent').querySelectorAll('[data-exam-choice]').forEach(b=>b.addEventListener('click',()=>{
  if(busy)return;
  examAnswers[examIndex]=Number(b.dataset.examChoice);
  examIndex++;
  if(examIndex>=exam.questions.length)submitExam();else renderExam();
 }));
}
async function submitExam(){
 if(busy)return;busy=true;
 showModal('<h2 id="adventureModalTitle">🎓 試煉交卷中…</h2><p>正在由雲端批改十道題目。</p>');
 try{
  const data=await call('submitExam',{examId:exam.id,answers:examAnswers});
  hero=data.hero;
  const wrong=data.review.filter(q=>!q.correct);
  const review=wrong.length?wrong.map(q=>'<div><strong>❌ '+safe(q.stem)+'</strong><div>你的答案：'+safe(q.chosen)+'</div><div>正確答案：'+safe(q.expected)+'</div></div>').join(''):'<div>十題完全正確！</div>';
  showModal('<div style="font-size:42px">'+(data.passed?'🏆':'💪')+'</div><h2 id="adventureModalTitle">'+(data.passed?'恭喜正式升級！':'差一點就成功了！')+'</h2>'+
  '<p><strong>答對 '+data.correct+' / 10 題</strong><br>'+(data.passed?'晉級成功！正式升為 Lv. '+hero.level:'至少需要 8 題正確。XP 不會被扣除，可以再挑戰。')+'</p>'+
  '<div class="adventure-exam-review">'+review+'</div>'+
  '<button class="adventure-exam-action" id="adventureReturn">返回冒險</button>'+
  (!data.passed?'<button class="adventure-exam-close" id="adventureAgain">重新挑戰</button>':''));
  $('adventureReturn').onclick=()=>{closeModal();refresh()};
  if(!data.passed)$('adventureAgain').onclick=()=>{busy=false;startExam()};
 }catch(e){showModal('<h2 id="adventureModalTitle">交卷遇到問題</h2><p>⚠️ '+safe(e.message)+'</p><button class="adventure-exam-close" id="adventureReturn">返回學習</button>');$('adventureReturn').onclick=closeModal}
 finally{busy=false}
}
})();
