/* 每日小挑戰（成語島）V1.0.0 — 自編錯別字、點字補成語、十字組詞。
   題目來自家庭雲自家題庫（chengyu_family_challenge_items），補字題由本站內建成語庫每日生成。
   成績存獨立挑戰表，不影響 XP、星星、金幣與每日任務。 */
(function(){
'use strict';
const API='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/chengyu-family-cloud';
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const home=$('screen-home'),main=document.querySelector('main.main-card');
if(!home||!main)return;

/* ---------- 樣式（沿用島上視覺語言） ---------- */
const style=document.createElement('style');
style.textContent=[
'.cg-card{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:16px;border:1px solid #e4e5ed;border-radius:20px;background:linear-gradient(120deg,#fff8e8,#eef4ff);padding:16px 18px}',
'.cg-card .cg-card-text{flex:1 1 240px;min-width:0}',
'.cg-card .cg-card-text b{font-size:17px;color:#4a3a8a}',
'.cg-card .cg-card-text p{margin:5px 0 0;font-size:13px;color:#75819a;line-height:1.6}',
'.cg-card .btn-primary{flex:none}',
'.cg-slots{display:flex;align-items:center;justify-content:center;gap:8px;margin:16px 0 6px;flex-wrap:nowrap}',
'.cg-slot{width:56px;height:56px;border:2px dashed #b9b3dd;border-radius:14px;background:#fff;font:inherit;font-size:26px;font-weight:900;color:#4a3a8a;cursor:pointer;display:grid;place-items:center;padding:0}',
'.cg-slot.filled{border-style:solid;background:#f2efff}',
'.cg-slot.correct{border:2px solid #57bd99;background:#e8f7f1;color:#1d7158}',
'.cg-slot.incorrect{border:2px solid #ec8e97;background:#fff0f1;color:#b83c4e}',
'.cg-center{width:64px;height:64px;border-radius:16px;background:#6855de;color:#fff;display:grid;place-items:center;font-size:32px;font-weight:900;box-shadow:0 6px 0 #5141ad;flex:none}',
'.cg-slot-labels{display:flex;justify-content:center;gap:120px;font-size:12px;color:#8a94a9;margin-bottom:14px}',
'.cg-chips{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:10px}',
'.cg-chip{min-width:52px;height:52px;border:2px solid #d9d4f0;border-radius:14px;background:#fff;font:inherit;font-size:24px;font-weight:900;color:#3b3f6b;cursor:pointer;padding:0 10px}',
'.cg-chip:disabled{opacity:.3;cursor:default}',
'.cg-chip:hover:not(:disabled){border-color:#8b79e3;background:#f6f4ff}',
'.cg-gloss{margin:8px 0;font-size:14px;line-height:1.7;color:#52607a}',
'.cg-gloss b{color:#2b3b60}',
'@media(max-width:470px){.cg-slot{width:48px;height:48px;font-size:22px}.cg-center{width:56px;height:56px;font-size:27px}.cg-slot-labels{gap:60px}.cg-chip{min-width:46px;height:48px;font-size:21px}}'
].join('');
document.head.append(style);

/* ---------- 每日種子（台灣日期） ---------- */
function today(){
 try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}catch(e){return new Date().toISOString().slice(0,10)}
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function shuffle(arr,rng){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

/* ---------- 狀態 ---------- */
let bank={typo:[],pairing:[]},ready=false,loadError='';
let learnerDone=null; // {correct_count,question_count}
let round=null;       // {qs:[],i,score,answers[],practice}

/* ---------- 雲端 ---------- */
function token(){try{return new URLSearchParams(location.hash.replace(/^#/,'')).get('f')||''}catch(e){return ''}}
async function api(action,extra){
 const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action,token:token()},extra||{})),cache:'no-store'});
 const d=await r.json().catch(()=>null);
 if(!r.ok||!d||!d.ok)throw new Error((d&&d.error)||'連線失敗');
 return d;
}
async function loadBank(){
 try{
  const d=await api('challenges');
  const items=Array.isArray(d.items)?d.items:[];
  bank={typo:items.filter(x=>x.mode==='typo'),pairing:items.filter(x=>x.mode==='pairing')};
  if(bank.typo.length&&bank.pairing.length){
   ready=true;loadError='';
   try{localStorage.setItem('cg-bank-'+today(),JSON.stringify({items}))}catch(e){}
   return;
  }
  loadError='題庫還在準備中';
 }catch(e){loadError='雲端連線失敗'}
 // 離線備援：用今天已抓過的快取
 try{
  const c=JSON.parse(localStorage.getItem('cg-bank-'+today())||'null');
  if(c&&Array.isArray(c.items)){
   bank={typo:c.items.filter(x=>x.mode==='typo'),pairing:c.items.filter(x=>x.mode==='pairing')};
   if(bank.typo.length&&bank.pairing.length){ready=true;loadError='';return}
  }
 }catch(e){}
 ready=false;
}
async function refreshDone(){
 learnerDone=null;
 const ps=window.chengyuProgressState?window.chengyuProgressState():null;
 if(!ps||!ps.connected||!ps.selectedId)return;
 try{
  const d=await api('load');
  const mine=(d.challenges||[]).filter(a=>a.learner_id===ps.selectedId&&a.challenge_date===today());
  if(mine.length)learnerDone=mine[0];
 }catch(e){}
}

/* ---------- 組題：3 錯別字 + 2 補字 + 1 十字組詞（共 9 格） ---------- */
function compose(seedNum){
 const rng=mulberry32(seedNum);
 const qs=[];
 shuffle(bank.typo,rng).slice(0,3).forEach(it=>{
  const p=it.payload;
  qs.push({type:'typo',level:it.level,ref:it.id,sentence:p.s,answer:p.a,options:shuffle(p.o,rng),note:p.n});
 });
 if(typeof DATA!=='undefined'&&Array.isArray(DATA)){
  const pool=DATA.filter(w=>w.level!=='進階'&&[...w.word].length===4);
  shuffle(pool,rng).slice(0,2).forEach(w=>{
   const chars=[...w.word];
   const pos=1+Math.floor(rng()*3);
   const ans=chars[pos];
   const distract=new Set();
   let guard=0;
   while(distract.size<3&&guard++<60){const c=[...pool[Math.floor(rng()*pool.length)].word][pos];if(c&&c!==ans)distract.add(c)}
   qs.push({type:'fill',level:w.level,ref:w.word,word:w,blank:chars.map((c,i)=>i===pos?'○':c).join(''),answer:ans,options:shuffle([ans,...distract],rng)});
  });
 }
 const pair=shuffle(bank.pairing,rng)[0];
 if(pair)qs.push({type:'pairing',level:pair.level,ref:pair.id,payload:pair.payload,chips:shuffle([...pair.payload.b,...pair.payload.a,...pair.payload.d],rng)});
 return qs;
}

/* ---------- 畫面 ---------- */
const card=document.createElement('div');
card.className='cg-card';
card.innerHTML='<div class="cg-card-text"><b>🌟 每日小挑戰</b><p id="cgCardStatus">讀取中…</p></div><button class="btn-primary" id="cgStart" type="button">開始挑戰</button>';
function mount(){
 if(card.isConnected)return;
 const actionRow=home.querySelector('.action-row');
 if(actionRow)actionRow.after(card);else home.append(card);
}
mount();

const screen=document.createElement('section');
screen.id='screen-challenge';
screen.className='screen quiz-screen';
screen.setAttribute('aria-label','每日小挑戰');
screen.innerHTML=
'<div class="quiz-top"><button class="backlink" type="button" id="cgQuit">‹ 回首頁</button>'+
'<div class="stats"><div class="stat">第 <strong id="cgNum">1</strong> / <span id="cgTotal">6</span> 題</div><div class="stat">得分 <strong id="cgScore">0</strong> 格</div></div></div>'+
'<div class="progress"><span id="cgFill"></span></div>'+
'<div class="quiz-mid" id="cgMid">'+
'<div class="question-head"><span class="mode-tag" id="cgModeTag"></span><span class="level-tag" id="cgLevelTag"></span></div>'+
'<div class="question-title" id="cgTitle"></div>'+
'<div class="prompt-panel"><div id="cgPrompt" class="prompt-word"></div></div>'+
'<div class="choices" id="cgChoices"></div><div id="cgPair"></div></div>'+
'<div class="quiz-dock"><div class="feedback dock-idle" id="cgFeedback">作答後，這裡會顯示結果和「下一題」按鈕。</div></div>';
main.append(screen);

function setCard(){
 mount();
 const st=$('cgCardStatus'),btn=$('cgStart');
 const ps=window.chengyuProgressState?window.chengyuProgressState():null;
 if(!token()){st.textContent='使用家庭專用連結開啟，就能玩每天換新的小挑戰。';btn.disabled=true;return}
 if(!ps||!ps.connected||!ps.selectedId){st.textContent='先從上方選好自己的名字，再來挑戰。';btn.disabled=true;return}
 btn.disabled=false;
 if(!ready){st.textContent=loadError?('☁️ '+loadError+'，請稍後再試。'):'題庫讀取中…';btn.disabled=!ready;return}
 if(learnerDone){st.textContent='今天的挑戰完成囉（答對 '+learnerDone.correct_count+' / '+learnerDone.question_count+' 格）！可以再玩一次練手。';btn.textContent='🔁 再玩一次'}
 else{st.textContent='今天的新題目準備好了：找錯字 → 補字 → 十字組詞，一共 6 題 9 格。';btn.textContent='開始挑戰'}
}
$('cgQuit').addEventListener('click',()=>{window.chengyuStopSpeaking?.();show('home');setCard()});
$('cgStart').addEventListener('click',()=>{
 const ps=window.chengyuProgressState?window.chengyuProgressState():null;
 if(!ready||!ps||!ps.selectedId)return;
 startRound(learnerDone?Date.now()%2147483647:Number(today().replace(/-/g,'')),!!learnerDone);
});

function startRound(seed,practice){
 round={qs:compose(seed),i:0,score:0,answers:[],practice};
 if(!round.qs.length)return;
 show('challenge');
 renderQ();
}
function updateHud(){
 $('cgNum').textContent=round.i+1;
 $('cgTotal').textContent=round.qs.length;
 $('cgScore').textContent=round.score;
 $('cgFill').style.width=(100*round.i/round.qs.length)+'%';
}
function resetDock(msg){
 const fb=$('cgFeedback');
 fb.className='feedback dock-idle';
 fb.textContent=msg||'作答後，這裡會顯示結果和「下一題」按鈕。';
}
function renderQ(){
 const q=round.qs[round.i];
 updateHud();
 resetDock();
 $('cgPair').innerHTML='';
 $('cgChoices').innerHTML='';
 $('cgChoices').style.display='';
 $('cgPrompt').style.display='';
 if(q.type==='typo'){
  $('cgModeTag').textContent='🔍 找出錯別字';
  $('cgLevelTag').textContent=q.level;
  $('cgTitle').textContent='句子裡有一個字寫錯了，請選出正確的字。';
  $('cgPrompt').className='prompt-long';
  $('cgPrompt').textContent=q.sentence;
  renderChoices(q,q.answer,()=>'這一題把「'+q.sentence+'」裡的錯字改正。');
 }else if(q.type==='fill'){
  $('cgModeTag').textContent='🧩 點字補成語';
  $('cgLevelTag').textContent=q.level;
  $('cgTitle').textContent='哪個字可以補進空格，變成正確的成語？';
  $('cgPrompt').className='prompt-word';
  $('cgPrompt').textContent=q.blank;
  renderChoices(q,q.answer,()=>'');
 }else{
  $('cgModeTag').textContent='✝️ 十字組詞';
  $('cgLevelTag').textContent=q.level;
  $('cgTitle').textContent='幫中間的「'+q.payload.c+'」找四個好夥伴：左邊兩格組「◯'+q.payload.c+'」，右邊兩格組「'+q.payload.c+'◯」。';
  $('cgPrompt').textContent='';
  $('cgPrompt').style.display='none';
  $('cgChoices').style.display='none';
  renderPair(q);
 }
 $('cgMid').scrollTop=0;
}
function renderChoices(q,answer,expFn){
 q.options.forEach((label,i)=>{
  const btn=document.createElement('button');
  btn.type='button';btn.className='choice';
  const letter=document.createElement('span');letter.className='letter';letter.textContent=String.fromCharCode(65+i);
  const value=document.createElement('span');value.textContent=label;
  btn.append(letter,value);
  btn.addEventListener('click',()=>{
   const ok=label===answer;
   $('cgChoices').querySelectorAll('.choice').forEach(b=>{
    b.disabled=true;
    const t=b.textContent.slice(1);
    if(t===answer)b.classList.add('correct');
   });
   if(!ok)btn.classList.add('incorrect');
   if(ok)round.score++;
   round.answers.push({mode:q.type,ref:String(q.ref),correct:ok,selected:label,expected:answer});
   updateHud();
   showFeedback(ok,q,expFn());
  });
  $('cgChoices').appendChild(btn);
 });
}
function renderPair(q){
 const p=q.payload;
 const expected=[p.b[0],p.b[1],p.a[0],p.a[1]];
 const slots=[null,null,null,null];
 const wrap=$('cgPair');
 wrap.innerHTML=
 '<div class="cg-slots">'+
 '<button class="cg-slot" data-i="0" aria-label="左邊第一格">？</button>'+
 '<button class="cg-slot" data-i="1" aria-label="左邊第二格">？</button>'+
 '<span class="cg-center">'+esc(p.c)+'</span>'+
 '<button class="cg-slot" data-i="2" aria-label="右邊第一格">？</button>'+
 '<button class="cg-slot" data-i="3" aria-label="右邊第二格">？</button></div>'+
 '<div class="cg-slot-labels"><span>◯'+esc(p.c)+' 組詞</span><span>'+esc(p.c)+'◯ 組詞</span></div>'+
 '<div class="cg-chips">'+q.chips.map(c=>'<button type="button" class="cg-chip" data-c="'+esc(c)+'">'+esc(c)+'</button>').join('')+'</div>'+
 '<div style="text-align:center;margin-top:16px"><button class="btn-primary" type="button" id="cgSubmit">✅ 填好了，送出</button></div>';
 const slotEls=[...wrap.querySelectorAll('.cg-slot')];
 const chipEls=[...wrap.querySelectorAll('.cg-chip')];
 function paint(){
  slotEls.forEach((s,i)=>{s.textContent=slots[i]||'？';s.classList.toggle('filled',!!slots[i])});
  chipEls.forEach(c=>{c.disabled=slots.includes(c.dataset.c)});
  $('cgSubmit').disabled=false;
 }
 slotEls.forEach((s,i)=>s.addEventListener('click',()=>{if(slots[i]){slots[i]=null;paint()}}));
 chipEls.forEach(c=>c.addEventListener('click',()=>{
  const i=slots.indexOf(null);
  if(i<0)return;
  slots[i]=c.dataset.c;paint();
 }));
 wrap.querySelector('#cgSubmit').addEventListener('click',()=>{
  if(slots.includes(null)){$('cgFeedback').textContent='四個格子都要填滿才能送出喔！';$('cgFeedback').className='feedback wrong';return}
  wrap.querySelectorAll('button').forEach(b=>b.disabled=true);
  let got=0;
  slots.forEach((c,i)=>{
   const ok=c===expected[i];
   if(ok)got++;
   slotEls[i].classList.add(ok?'correct':'incorrect');
   round.answers.push({mode:'pairing',ref:String(q.ref),correct:ok,selected:i<2?slots[i]+p.c:p.c+slots[i],expected:i<2?expected[i]+p.c:p.c+expected[i]});
  });
  round.score+=got;
  updateHud();
  const words=[p.b[0]+p.c,p.b[1]+p.c,p.c+p.a[0],p.c+p.a[1]];
  showFeedback(got===4,q,'正確的四個詞：'+words.map(w=>'「'+w+'」'+(p.g[w]||'')).join('、'),got);
 });
 paint();
}
function showFeedback(ok,q,extra,pairGot){
 const fb=$('cgFeedback');
 const last=round.i>=round.qs.length-1;
 let head,rows='';
 if(q.type==='pairing'){
  head=ok?'🎉 四格全對，太厲害了！':'💪 答對 '+pairGot+' / 4 格';
  rows='<div class="cg-gloss">'+Object.entries(q.payload.g).map(([w,g])=>'<b>'+esc(w)+'</b>：'+esc(g)).join('<br>')+'</div>';
 }else if(q.type==='typo'){
  head=ok?'🎉 答對了！':'💡 正確答案是「'+q.answer+'」';
  rows='<div class="explain-row"><strong>🔎 為什麼用這個字：</strong>'+esc(q.note)+'</div>';
 }else{
  head=ok?'🎉 答對了！':'💡 正確答案是「'+q.answer+'」';
  const w=q.word;
  rows='<div class="explain-word">'+esc(w.word)+'</div>'+
   '<div class="explain-row"><strong>📌 意思：</strong>'+esc(w.meaning)+'</div>'+
   '<div class="explain-row"><strong>✍️ 例句：</strong>'+esc(w.example)+'</div>'+
   '<div class="explain-row"><strong>💡 記憶提示：</strong>'+esc(w.tip)+'</div>';
 }
 fb.className='feedback'+(ok?'':' wrong');
 fb.innerHTML='<div class="feedback-header"><span>'+head+'</span></div>'+rows+
  '<div class="feedback-actions"><button type="button" class="btn-primary" id="cgNext">'+(last?'查看挑戰結果':'下一題 →')+'</button></div>';
 fb.querySelector('#cgNext').addEventListener('click',()=>{
  if(last){finishRound();return}
  round.i++;renderQ();
 });
 $('cgFill').style.width=(100*(round.i+1)/round.qs.length)+'%';
}
function finishRound(){
 const total=round.answers.length,got=round.score;
 const acc=Math.round(got/total*100);
 const icon=acc===100?'🏆':acc>=70?'🌟':'📘';
 $('cgMid').innerHTML=
 '<div class="result" style="text-align:center;padding:20px 0"><div class="result-sticker">'+icon+'</div>'+
 '<h2>'+(round.practice?'練習完成！':'今日挑戰完成！')+'</h2>'+
 '<p id="cgSaveNote" style="color:#75819a;font-size:14px"></p>'+
 '<div class="result-scores"><div class="score-box"><strong>'+got+'</strong><span>答對格數</span></div>'+
 '<div class="score-box"><strong>'+acc+'%</strong><span>正確率</span></div>'+
 '<div class="score-box"><strong>'+(total-got)+'</strong><span>答錯格數</span></div></div>'+
 '<div class="result-actions"><button class="btn-primary" type="button" id="cgAgain">🔁 再玩一次</button>'+
 '<button class="btn-secondary" type="button" id="cgHome">⌂ 回首頁</button></div></div>';
 $('cgFeedback').className='feedback dock-idle';
 $('cgFeedback').textContent='挑戰結束囉！';
 $('cgFill').style.width='100%';
 $('cgMid').querySelector('#cgAgain').addEventListener('click',()=>{restoreMid();startRound(Date.now()%2147483647,true)});
 $('cgMid').querySelector('#cgHome').addEventListener('click',()=>{restoreMid();show('home');setCard()});
 if(!round.practice){
  const ps=window.chengyuProgressState?window.chengyuProgressState():null;
  const note=$('cgSaveNote');
  note.textContent='☁️ 成績儲存中…';
  api('saveChallenge',{learnerId:ps.selectedId,challengeDate:today(),answers:round.answers}).then(r=>{
   note.textContent='☁️ 成績已存進家庭雲端！';
   learnerDone={correct_count:got,question_count:total};
  }).catch(()=>{note.textContent='☁️ 成績暫時存不上雲端，明天再試也沒關係。'});
 }
}
// finishRound 會覆蓋 cgMid；回首頁或再玩一次時還原題目容器
const midHTML=$('cgMid').innerHTML;
function restoreMid(){$('cgMid').innerHTML=midHTML}

/* ---------- 啟動 ---------- */
(async()=>{
 setCard();
 await loadBank();
 await refreshDone();
 setCard();
 // 玩家切換或雲端狀態更新時刷新卡片
 const statusEl=$('cloudStatus');
 if(statusEl)new MutationObserver(async()=>{await refreshDone();setCard()}).observe(statusEl,{childList:true,characterData:true,subtree:true});
 // 島首頁會整片重繪（星星同步、玩家切換等），卡片被清掉時自動掛回
 new MutationObserver(()=>{if(!card.isConnected)setCard()}).observe(home,{childList:true});
})();
})();
