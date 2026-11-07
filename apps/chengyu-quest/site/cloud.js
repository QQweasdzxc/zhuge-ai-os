// Chengyu Quest V1.1 — results are cloud-only; the family capability stays in the URL fragment.
(function(){
'use strict';
var endpoint='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/chengyu-family-cloud';
var params=new URLSearchParams((location.hash||'').replace(/^#/,''));
var state={token:params.get('f')||'',connected:false,learners:[],attempts:[],learnerId:'',filter:'all',busy:false};
var el=function(id){return document.getElementById(id)};
var escapeHtml=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var labelMode={mixed:'綜合隨機',meaning:'成語選解釋',context:'情境填空',reverse:'解釋選成語'};
var css=document.createElement('style');
css.textContent='.cloud-panel{grid-column:1/-1;background:#eaf8f5;border:1px solid #c8e7e1;border-radius:18px;padding:17px 20px;margin-top:19px;color:#294f57}.cloud-panel h3{margin:0 0 8px;font-size:19px}.cloud-status{font-size:13px;line-height:1.6;margin:6px 0 12px}.cloud-controls{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.cloud-controls input,.cloud-controls select,.cloud-report-head select{background:white;border:1.5px solid #c7dcd8;border-radius:11px;padding:10px 12px;min-height:43px;color:#243b52;font-size:15px}.cloud-controls select{min-width:180px;max-width:100%}.cloud-controls input{width:145px;max-width:100%}.cloud-controls button{background:#fff;border:1px solid #b3ccc9;border-radius:11px;padding:10px 14px;min-height:43px;color:#275c69;font-weight:800;cursor:pointer}.cloud-controls button:hover{background:#f7ffff}.cloud-note{font-size:12px;color:#59777d;margin-top:10px;line-height:1.6}.save-status{background:#f5f9fe;border-radius:13px;padding:12px;margin:18px auto 0;max-width:520px;font-weight:700;line-height:1.6}.report-card{padding:15px;border:1px solid #e5eaf3;border-radius:14px;background:#fff;margin:11px 0}.report-card summary{cursor:pointer;font-weight:800;line-height:1.7}.report-card .wrong{color:#bd4054}.report-card .pass{color:#19795a}.cloud-report-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.report-stats{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.report-stats>div{padding:14px 18px;background:#f3f2ff;border-radius:15px;min-width:120px}.report-stats strong{display:block;font-size:25px;color:#5540bb}.report-stats small{font-size:12px;color:#66708c}.report-wrong{background:#fffbf1;border-radius:15px;padding:15px;line-height:2}.report-wrong span{display:inline-block;margin:4px;background:#fff;border:1px solid #ecdfc5;border-radius:10px;padding:3px 9px}.report-detail{font-size:13px;line-height:1.8;margin-top:8px;color:#4e5b72}.report-empty{padding:23px;color:#79859e;text-align:center}@media(max-width:500px){.cloud-panel{padding:14px}.cloud-controls input{width:100%;flex:1}.cloud-controls select{width:100%}.cloud-controls button{flex:1}}';
document.head.appendChild(css);
var panel=document.createElement('section');panel.className='cloud-panel';
panel.innerHTML='<h3>☁️ 家庭雲端成績</h3><p class="cloud-status" id="cloudStatus" role="status">正在確認雲端連線…</p><div class="cloud-controls"><select id="cloudLearner" aria-label="選擇測驗者"><option value="">選擇測驗者</option></select><input type="text" id="cloudNewName" maxlength="24" placeholder="新增測驗者暱稱" aria-label="新增測驗者暱稱"><button type="button" id="cloudAdd">＋ 新增</button><button type="button" id="cloudReport">📊 家長成績報表</button></div><p class="cloud-note">成績僅存 Supabase 雲端，不存放在這台手機。請先選擇測驗者；家庭專用網址包含私人存取金鑰，請勿公開分享。</p>';
document.querySelector('.setup-grid').after(panel);
var report=document.createElement('section');report.className='screen library';report.id='screen-report';report.setAttribute('aria-label','家長雲端成績報表');
report.innerHTML='<div class="cloud-report-head"><div><span class="eyebrow">☁️ 跨裝置同步</span><h2 style="margin:10px 0">家長成績報表</h2></div><button class="btn-secondary" type="button" id="reportBack">‹ 返回首頁</button></div><p style="color:#7a86a0">歷史闖關、完成率、正確率與常錯成語（均來自 Supabase）。</p><div class="cloud-controls"><label for="reportWho">查看對象：</label><select id="reportWho"><option value="all">全部測驗者</option></select><button type="button" id="refreshReport">↻ 重新同步</button></div><div id="reportContent"></div>';
document.querySelector('.main-card').appendChild(report);
var status=function(text){el('cloudStatus').textContent=text};
function renderNames(){
 var selection=el('cloudLearner'),filter=el('reportWho');
 var options=state.learners.map(function(l){return '<option value="'+escapeHtml(l.id)+'">'+escapeHtml(l.name)+'</option>'}).join('');
 selection.innerHTML='<option value="">選擇測驗者</option>'+options;selection.value=state.learnerId||'';
 filter.innerHTML='<option value="all">全部測驗者</option>'+options;filter.value=state.filter;
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
  if(!state.learnerId&&state.learners.length===1)state.learnerId=state.learners[0].id;
  renderNames();
  status('✅ 雲端已連線・'+state.learners.length+' 位測驗者・'+state.attempts.length+' 筆歷史成績');
  if(el('screen-report').classList.contains('active'))renderReport();
 }catch(error){state.connected=false;status('⚠️ '+error.message+'。請重新整理後再試。')}
}
async function addLearner(){
 if(!state.connected){alert('請先使用家庭專用網址連線');return}
 var name=el('cloudNewName').value.trim();
 if(!name){alert('請輸入暱稱');return}
 el('cloudAdd').disabled=true;
 try{
  var result=await call('addLearner',{name:name});
  if(!state.learners.some(function(p){return p.id===result.learner.id}))state.learners.push(result.learner);
  state.learnerId=result.learner.id;el('cloudNewName').value='';renderNames();
  status('✅ 已選擇「'+name+'」，闖關完成後會自動儲存成績');
 }catch(err){alert('無法新增測驗者：'+err.message)}
 finally{el('cloudAdd').disabled=false}
}
window.chengyuCloudReady=function(){
 if(!state.token)return confirm('目前是試玩模式，作答不會存成績。要繼續嗎？');
 if(!state.connected){alert('雲端尚未連線，請稍候重新整理，避免成績遺失。');return false}
 if(!state.learnerId){alert('請先選擇測驗者，成績才能保存到雲端。');el('cloudLearner').focus();return false}
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
var saving=null;
async function save(snapshot){
 if(!snapshot)return;
 var box=el('cloudSaveStatus');
 if(saving)return saving;
 box.textContent='☁️ 正在將本回合成績儲存至 Supabase…';
 saving=call('saveAttempt',snapshot).then(async function(){
  box.textContent='✅ 成績已儲存雲端！可以在家長報表查看。';
  await sync();
 }).catch(function(err){
  box.innerHTML='⚠️ 儲存失敗：'+escapeHtml(err.message)+'　<button type="button" id="cloudRetry">重新儲存</button>';
  el('cloudRetry').addEventListener('click',function(){save(snapshot)});
 }).finally(function(){saving=null});
 return saving;
}
window.chengyuCloudFinish=function(g){
 var box=el('cloudSaveStatus');
 if(!g.cloudLearnerId||!state.token){box.textContent='⚠️ 這回合是試玩，沒有儲存成績。';return}
 var snap={clientRunId:g.cloudRunId,learnerId:g.cloudLearnerId,level:g.cloudLevel||config.level,mode:g.cloudMode||config.mode,plannedCount:g.items.length,resultStatus:g.hearts===0?'game_over':'completed',answers:g.cloudAnswers||[]};
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
el('cloudLearner').addEventListener('change',function(e){state.learnerId=e.target.value});
el('cloudNewName').addEventListener('keydown',function(e){if(e.key==='Enter')addLearner()});
el('cloudAdd').addEventListener('click',addLearner);
el('cloudReport').addEventListener('click',function(){if(!state.connected){alert('尚未連上家庭雲端，請使用家庭專用連結');return}show('report');renderReport()});
el('reportBack').addEventListener('click',function(){show('home')});
el('refreshReport').addEventListener('click',sync);
el('reportWho').addEventListener('change',function(e){state.filter=e.target.value;renderReport()});
var foot=document.querySelector('.footer');if(foot)foot.insertAdjacentHTML('beforeend','<div>成語闖關王 V1.2.0 · 2026/11/07 15:36 · 自然語音・雲端成績</div>');
sync();
})();
