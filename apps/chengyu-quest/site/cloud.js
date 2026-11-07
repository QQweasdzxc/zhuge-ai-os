// Chengyu Quest V1.1 — results are cloud-only; the family capability stays in the URL fragment.
(function(){
'use strict';
var endpoint='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/chengyu-family-cloud';
var params=new URLSearchParams((location.hash||'').replace(/^#/,''));
var state={token:params.get('f')||'',connected:false,learners:[],attempts:[],learnerId:'',filter:'all',busy:false};
var arrivalName=params.get('p')||'';
var el=function(id){return document.getElementById(id)};
var escapeHtml=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var labelMode={mixed:'綜合隨機',meaning:'成語選解釋',context:'情境填空',reverse:'解釋選成語'};
var css=document.createElement('style');
css.textContent='.cloud-panel{grid-column:1/-1;background:#eaf8f5;border:1px solid #c8e7e1;border-radius:18px;padding:17px 20px;margin-top:19px;color:#294f57}.cloud-panel h3{margin:0 0 8px;font-size:19px}.cloud-status{font-size:13px;line-height:1.6;margin:6px 0 12px}.cloud-controls{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.cloud-controls input,.cloud-controls select,.cloud-report-head select{background:white;border:1.5px solid #c7dcd8;border-radius:11px;padding:10px 12px;min-height:43px;color:#243b52;font-size:15px}.cloud-controls select{min-width:180px;max-width:100%}.cloud-controls input{width:145px;max-width:100%}.cloud-controls button{background:#fff;border:1px solid #b3ccc9;border-radius:11px;padding:10px 14px;min-height:43px;color:#275c69;font-weight:800;cursor:pointer}.cloud-controls button:hover{background:#f7ffff}.cloud-note{font-size:12px;color:#59777d;margin-top:10px;line-height:1.6}.save-status{background:#f5f9fe;border-radius:13px;padding:12px;margin:18px auto 0;max-width:520px;font-weight:700;line-height:1.6}.report-card{padding:15px;border:1px solid #e5eaf3;border-radius:14px;background:#fff;margin:11px 0}.report-card summary{cursor:pointer;font-weight:800;line-height:1.7}.report-card .wrong{color:#bd4054}.report-card .pass{color:#19795a}.cloud-report-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.report-stats{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.report-stats>div{padding:14px 18px;background:#f3f2ff;border-radius:15px;min-width:120px}.report-stats strong{display:block;font-size:25px;color:#5540bb}.report-stats small{font-size:12px;color:#66708c}.report-wrong{background:#fffbf1;border-radius:15px;padding:15px;line-height:2}.report-wrong span{display:inline-block;margin:4px;background:#fff;border:1px solid #ecdfc5;border-radius:10px;padding:3px 9px}.report-detail{font-size:13px;line-height:1.8;margin-top:8px;color:#4e5b72}.report-empty{padding:23px;color:#79859e;text-align:center}@media(max-width:500px){.cloud-panel{padding:14px}.cloud-controls input{width:100%;flex:1}.cloud-controls select{width:100%}.cloud-controls button{flex:1}}';
css.textContent+=`
.cloud-panel{padding:15px 20px;margin-top:16px}.player-summary{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}.player-summary h3{margin:0 0 5px}.player-summary .cloud-status{margin:0}.player-summary .cloud-controls button{background:#fff;border-color:#b1cec9;font-size:14px}
.player-gate[hidden],.player-add-form[hidden],.player-picks[hidden]{display:none!important}
.player-gate{position:fixed;inset:0;z-index:9999;background:rgba(12,20,44,.85);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;padding:24px 15px 40px;overscroll-behavior:contain}
.player-gate-card{background:#fff;border-radius:27px;padding:27px 24px 22px;margin:auto;width:min(100%,510px);box-shadow:0 25px 75px rgba(7,13,41,.4);color:#283759;text-align:center}
.player-gate-icon{font-size:41px}.player-gate-eyebrow{font-size:13px;font-weight:800;color:#7059bd;margin:5px 0 8px}.player-gate-card h2{font-size:clamp(25px,6vw,33px);line-height:1.3;margin:7px 0 10px;letter-spacing:-.02em}.player-gate-intro{font-size:15px;color:#64718b;line-height:1.7;margin:0}.player-gate-status{font-size:13px;color:#627d75;margin:13px 0 15px;min-height:18px}
.player-picks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;text-align:center}
.player-choice{background:#f7f5ff;border:2px solid #e3dcfb;border-radius:18px;min-height:125px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:11px;cursor:pointer;font-size:19px;font-weight:900;color:#384667;word-break:break-word}
.player-choice:hover,.player-choice:focus-visible{background:#ece8ff;border-color:#7f6ce0;outline-offset:2px}
.player-choice small{font-size:12px;font-weight:600;color:#75809c}.player-avatar{font-size:30px}.player-new{background:#effbf8;border-style:dashed;border-color:#79b9ad;color:#246d61}.player-new small{color:#4f897d}
.player-add-form{margin-top:17px;text-align:left;background:#f6f7fd;border-radius:17px;padding:15px}
.player-add-form label{display:block;font-weight:800;color:#354260;margin-bottom:11px;font-size:16px}
.player-add-form input{font:inherit;font-size:19px;width:100%;min-height:53px;border-radius:13px;border:2px solid #c5c7dd;padding:10px 13px;background:#fff}
.player-add-form button[type=submit]{display:block;width:100%;border:0;border-radius:13px;background:#6a56d4;color:white;font-weight:900;font-size:17px;min-height:53px;margin-top:12px;cursor:pointer}
.player-add-form button[type=submit]:disabled{opacity:.6;cursor:wait}
#playerCancel{display:block;border:0;background:transparent;color:#67718b;text-decoration:underline;padding:12px;margin:5px auto 0;cursor:pointer}
.player-form-error{min-height:17px;color:#b1405b;font-size:13px;margin:4px 0}.player-gate-foot{font-size:12px;color:#79839b;line-height:1.6;margin:18px 0 0}
@media(max-width:480px){.player-gate{padding:13px 11px 23px}.player-gate-card{padding:22px 16px 18px;border-radius:21px}.player-picks{gap:9px}.player-choice{min-height:116px;font-size:17px;padding:10px 6px}.player-avatar{font-size:27px}.cloud-panel{padding:14px}.player-summary .cloud-controls{width:100%}.player-summary .cloud-controls button{flex:1}}
`;
document.head.appendChild(css);
var panel=document.createElement('section');panel.className='cloud-panel';
panel.innerHTML='<div class="player-summary"><div><h3 id="playerGreeting">👋 今天換誰來闖關？</h3><p class="cloud-status" id="cloudStatus" role="status">☁️ 正在連線家庭雲端…</p></div><div class="cloud-controls"><button type="button" id="cloudSwitch">👤 選名字／新增玩家</button><button type="button" id="cloudReport">📊 家長成績</button></div></div><p class="cloud-note">每個人的成績分開紀錄在雲端，不會存到手機。分享給家人即可，請勿公開張貼包含 #f= 的家庭專用連結。</p>';
document.querySelector('.setup-grid').after(panel);
var report=document.createElement('section');report.className='screen library';report.id='screen-report';report.setAttribute('aria-label','家長雲端成績報表');
report.innerHTML='<div class="cloud-report-head"><div><span class="eyebrow">☁️ 跨裝置同步</span><h2 style="margin:10px 0">家長成績報表</h2></div><button class="btn-secondary" type="button" id="reportBack">‹ 返回首頁</button></div><p style="color:#7a86a0">歷史闖關、完成率、正確率與常錯成語（均來自 Supabase）。</p><div class="cloud-controls"><label for="reportWho">查看對象：</label><select id="reportWho"><option value="all">全部測驗者</option></select><button type="button" id="refreshReport">↻ 重新同步</button></div><div id="reportContent"></div>';
document.querySelector('.main-card').appendChild(report);
var status=function(text){el('cloudStatus').textContent=text};
var playerGate=document.createElement('div');
playerGate.className='player-gate';playerGate.id='playerGate';playerGate.hidden=!state.token;
playerGate.innerHTML='<div class="player-gate-card" role="dialog" aria-modal="true" aria-labelledby="playerGateTitle"><div class="player-gate-icon">🎮</div><p class="player-gate-eyebrow">成語闖關王 · 家庭玩家</p><h2 id="playerGateTitle">嗨！今天是誰來闖關？</h2><p class="player-gate-intro">找到自己的名字，點一下就可以開始玩囉！</p><p class="player-gate-status" id="playerGateStatus" role="status">☁️ 正在載入家人的名字…</p><div class="player-picks" id="playerPicks"></div><form class="player-add-form" id="playerAddForm" hidden><label for="playerNewName">我是第一次玩，請輸入我的名字</label><input id="playerNewName" type="text" maxlength="24" autocomplete="off" placeholder="例如：安安、卡卡、小明" required><button type="submit" id="playerCreate">✨ 加入並開始闖關</button><button type="button" id="playerCancel">返回選擇名字</button><p id="playerFormError" class="player-form-error" role="alert"></p></form><p class="player-gate-foot">不用登入或設定密碼。你的闖關成績會自動存進家庭雲端。</p></div>';
document.body.appendChild(playerGate);
var gateOpen=!!state.token,previousBodyOverflow=document.body.style.overflow;
if(gateOpen)document.body.style.overflow='hidden';
function setGate(open){
 gateOpen=open;playerGate.hidden=!open;
 document.body.style.overflow=open?'hidden':previousBodyOverflow;
 el('playerPicks').hidden=false;el('playerAddForm').hidden=true;
 el('playerFormError').textContent='';
 if(open){renderGate();setTimeout(function(){var first=el('playerPicks').querySelector('button');if(first)first.focus()},0)}
}
function renderGate(){
 if(!state.token)return;
 var list=el('playerPicks'),info=el('playerGateStatus');
 if(!state.connected){info.textContent='☁️ 正在連接雲端…';list.innerHTML='<button type="button" id="playerReload">↻ 重試連線</button>';return}
 info.textContent=state.learners.length?'👇 點自己的名字，成績就不會記錯人':'歡迎第一位玩家！先幫自己取個名字吧！';
 var avatars=['🦊','🐨','🐼','🐰','🐬','🦁','🐯','🐻'];
 list.innerHTML=state.learners.map(function(p,i){return '<button type="button" class="player-choice" data-player="'+escapeHtml(p.id)+'"><span class="player-avatar" aria-hidden="true">'+avatars[i%avatars.length]+'</span><span>'+escapeHtml(p.name)+'</span><small>我是 '+escapeHtml(p.name)+'</small></button>'}).join('')+
 '<button type="button" class="player-choice player-new" id="playerShowAdd"><span class="player-avatar" aria-hidden="true">➕</span><span>我是第一次玩</span><small>新增我的名字</small></button>';
}
function selectPlayer(id){
 var p=state.learners.find(function(l){return l.id===id});
 if(!p)return;
 state.learnerId=id;
 try{history.replaceState(null,'',location.pathname+location.search+'#f='+encodeURIComponent(state.token)+'&p='+encodeURIComponent(p.name))}catch(e){}
 renderNames();setGate(false);
 if(el('screen-report').classList.contains('active'))show('home');
 status('☁️ '+p.name+' 的成績會自動儲存在雲端');window.chengyuProgressRefresh?.();window.adventureProfileRefresh?.('chengyu',state.learnerId);
}
function showPlayerAdd(){
 if(!state.connected){el('playerGateStatus').textContent='⚠️ 雲端尚未連線，請重新整理後再試。';return}
 el('playerPicks').hidden=true;
 el('playerAddForm').hidden=false;
 el('playerNewName').value='';
 el('playerFormError').textContent='';
 el('playerNewName').focus();
}
function hidePlayerAdd(){
 el('playerAddForm').hidden=true;
 el('playerPicks').hidden=false;
 el('playerFormError').textContent='';
}
playerGate.addEventListener('click',function(e){
 var p=e.target.closest('[data-player]');
 if(p){selectPlayer(p.dataset.player);return}
 if(e.target.closest('#playerShowAdd')){showPlayerAdd();return}
 if(e.target.closest('#playerCancel'))hidePlayerAdd();
 if(e.target.closest('#playerReload'))sync();
});
el('cloudSwitch').addEventListener('click',function(){setGate(true)});
el('playerAddForm').addEventListener('submit',function(e){e.preventDefault();addLearner()});

function renderNames(){
 var filter=el('reportWho');
 var options=state.learners.map(function(l){return '<option value="'+escapeHtml(l.id)+'">'+escapeHtml(l.name)+'</option>'}).join('');
 filter.innerHTML='<option value="all">全部測驗者</option>'+options;filter.value=state.filter;
 var p=state.learners.find(function(l){return l.id===state.learnerId});
 el('playerGreeting').textContent=p?'👋 '+p.name+'，準備好來闖關了嗎？':'👋 今天換誰來闖關？';
}
async function call(action,extra){
 if(!state.token)throw Error('未使用家庭專用連結');
 var r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({token:state.token,action:action},extra||{})),cache:'no-store'});
 var response=await r.json().catch(function(){return null});
 if(!r.ok||!response||!response.ok)throw Error(response&&response.error||'網路或雲端連線失敗');
 return response;
}
async function sync(){
 if(!state.token){status('⚠️ 這是公開試玩網址，成績不會儲存。請使用家庭專用連結。');return}
 status('☁️ 正在同步雲端成績…');
 try{
  var response=await call('load');
  state.connected=true;state.learners=response.learners||[];state.attempts=response.attempts||[];
  if(state.learnerId&&!state.learners.some(function(l){return l.id===state.learnerId}))state.learnerId='';
  renderNames();
  if(gateOpen){var arriving=arrivalName&&state.learners.find(function(x){return x.name===arrivalName});arrivalName='';if(arriving)selectPlayer(arriving.id);else renderGate()};window.chengyuProgressRefresh?.();if(state.learnerId)window.adventureProfileRefresh?.('chengyu',state.learnerId);
  status('✅ 雲端已連線・'+state.learners.length+' 位測驗者・'+state.attempts.length+' 筆歷史成績');
  if(el('screen-report').classList.contains('active'))renderReport();
 }catch(error){state.connected=false;status('⚠️ '+error.message+'。請重新整理後再試。');if(gateOpen){el('playerGateStatus').textContent='⚠️ 雲端連線失敗，請按重試。';el('playerPicks').innerHTML='<button type="button" id="playerReload">↻ 重試連線</button>'}}
}
async function addLearner(){
 if(!state.connected){alert('請先使用家庭專用網址連線');return}
 var name=el('playerNewName').value.trim();
 if(!name){el('playerFormError').textContent='先輸入你的名字吧！';el('playerNewName').focus();return}
 if(Array.from(name).length>24){el('playerFormError').textContent='名字請不要超過 24 個字';return}
 el('playerCreate').disabled=true;el('playerCreate').textContent='☁️ 正在加入雲端…';
 el('playerFormError').textContent='';
 try{
  var result=await call('addLearner',{name:name});
  if(!state.learners.some(function(p){return p.id===result.learner.id}))state.learners.push(result.learner);
  selectPlayer(result.learner.id);
 }catch(err){el('playerFormError').textContent='無法新增：'+err.message}
 finally{el('playerCreate').disabled=false;el('playerCreate').textContent='✨ 加入並開始闖關'}
}
window.chengyuCloudReady=function(){
 if(!state.token)return confirm('目前是試玩模式，作答不會存成績。要繼續嗎？');
 if(!state.connected){alert('雲端尚未連線，請稍候重新整理，避免成績遺失。');return false}
 if(!state.learnerId){setGate(true);return false}
 return true;
};
window.chengyuCloudStart=function(g){
 g.cloudLearnerId=state.connected?state.learnerId:null;
 g.cloudRunId=crypto.randomUUID();
 g.cloudAnswers=[];
};
window.chengyuCloudAnswer=function(g,q,selected,correct){
 if(!Array.isArray(g.cloudAnswers))return;
 g.cloudAnswers.push({word:q.word.word,kind:q.kind,correct:correct,selected:String(q.choices[selected]),expected:String(q.choices[q.answer])});
};
window.chengyuProgressState=function(){return {connected:state.connected,selectedId:state.learnerId,learners:state.learners.slice(),attempts:state.attempts.slice()}};
var saving=null;
async function save(snapshot){
 if(!snapshot)return;
 var box=el('cloudSaveStatus');
 if(saving)return saving;
 box.textContent='☁️ 正在將本回合成績儲存至 Supabase…';
 saving=call('saveAttempt',snapshot).then(async function(response){
  var gained=Number(response.attempt&&response.attempt.xp_earned)||0;
  box.textContent='✅ 成績已儲存雲端！⚔️ +'+gained+' XP';
  await sync();
  window.chengyuAdventureAfterFinish?.(snapshot,box);
 }).catch(function(err){
  box.innerHTML='⚠️ 儲存失敗：'+escapeHtml(err.message)+'　<button type="button" id="cloudRetry">重新儲存</button>';
  el('cloudRetry').addEventListener('click',function(){save(snapshot)});
 }).finally(function(){saving=null});
 return saving;
}
window.chengyuCloudFinish=function(g){
 var box=el('cloudSaveStatus');
 if(!g.cloudLearnerId||!state.token){box.textContent='⚠️ 這回合是試玩，沒有儲存成績。';return}
 var snap={clientRunId:g.cloudRunId,learnerId:g.cloudLearnerId,level:g.cloudLevel||config.level,mode:g.cloudMode||config.mode,plannedCount:g.items.length,resultStatus:g.hearts===0?'game_over':'completed',zone:g.cloudZone??null,answers:g.cloudAnswers||[]};
 save(snap);
};
function fmtDate(v){try{return new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}catch(e){return String(v)}}
function renderReport(){
 var list=state.attempts.filter(function(a){return state.filter==='all'||a.learner_id===state.filter});
 var total=list.reduce(function(v,a){return v+(a.question_count||0)},0);
 var good=list.reduce(function(v,a){return v+(a.correct_count||0)},0);
 var wrongCount={};
 list.forEach(function(a){(a.answers||[]).forEach(function(ans){if(!ans.correct){var w=String(ans.word||'');if(w)wrongCount[w]=(wrongCount[w]||0)+1}})});
 var wrong=Object.keys(wrongCount).sort(function(a,b){return wrongCount[b]-wrongCount[a]}).slice(0,15);
 var html='<div class="report-stats"><div><strong>'+list.length+'</strong><small>歷史闖關次數</small></div><div><strong>'+total+'</strong><small>累計作答題數</small></div><div><strong>'+(total?Math.round(good/total*100):0)+'%</strong><small>累計答對率</small></div><div><strong>'+list.filter(function(a){return a.result_status==='game_over'}).length+'</strong><small>Game Over 次數</small></div></div>';
 if(wrong.length)html+='<h3>📝 常錯成語</h3><div class="report-wrong">'+wrong.map(function(w){return '<span>'+escapeHtml(w)+' × '+wrongCount[w]+'</span>'}).join('')+'</div>';
 html+='<h3>📅 歷史成績</h3>';
 if(!list.length)html+='<p class="report-empty">目前還沒有成績，完成一次闖關就會顯示在這裡。</p>';
 html+=list.slice(0,100).map(function(a){
  var learner=state.learners.find(function(u){return u.id===a.learner_id}), name=learner?learner.name:'測驗者';
  var ratio=a.question_count?Math.round(a.correct_count/a.question_count*100):0;
  var bad=(a.answers||[]).filter(function(ans){return !ans.correct});
  return '<details class="report-card"><summary>'+escapeHtml(name)+'　'+escapeHtml(a.level)+'　'+escapeHtml(labelMode[a.mode]||a.mode)+'　<span class="'+(ratio>=70?'pass':'wrong')+'">'+ratio+'%</span><div style="font-size:12px;color:#6f7b90">'+fmtDate(a.created_at)+'・答對 '+a.correct_count+'/'+a.question_count+'・'+(a.result_status==='game_over'?'💔 Game Over':'🏆 完成')+'</div></summary><div class="report-detail">'+(bad.length?'<b>答錯成語與答案：</b>'+bad.map(function(x){return '<div>• '+escapeHtml(x.word)+'（選：'+escapeHtml(x.selected)+'；正解：'+escapeHtml(x.expected)+'）</div>'}).join(''):'✅ 本回合全部答對')+'</div></details>'
 }).join('');
 el('reportContent').innerHTML=html;
}
var saveBox=document.createElement('div');saveBox.id='cloudSaveStatus';saveBox.className='save-status';saveBox.setAttribute('role','status');
saveBox.textContent='☁️ 闖關完成後將同步雲端成績';
document.querySelector('#screen-result .result-actions').before(saveBox);
el('cloudReport').addEventListener('click',function(){if(!state.connected){alert('尚未連上家庭雲端，請使用家庭專用連結');return}show('report');renderReport()});
el('reportBack').addEventListener('click',function(){show('home')});
el('refreshReport').addEventListener('click',sync);
el('reportWho').addEventListener('change',function(e){state.filter=e.target.value;renderReport()});
var foot=document.querySelector('.footer');if(foot)foot.insertAdjacentHTML('beforeend','<div>成語闖關王 V1.7.1 · 2026/11/07 · 男／女雙造型・四職業・跨島雲端角色</div>');
sync();
})();
