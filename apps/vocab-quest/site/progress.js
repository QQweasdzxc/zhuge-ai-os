/* Vocabulary Quest V2.5: XP hero rank, cloud skill badges and level progress. */
(function(){
'use strict';
const bridge=window.vocabProgressState;if(!bridge)return;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function getLevel(xp){let lv=1;while(lv<100&&xp>=50*lv*(lv+1))lv++;return lv}
function title(lv){return lv>=30?'傳說單字王':lv>=20?'神話學者':lv>=12?'單字大師':lv>=8?'黃金騎士':lv>=5?'白銀勇士':lv>=3?'青銅劍士':lv>=2?'單字冒險家':'見習勇士'}
const style=document.createElement('style');
style.textContent='.vocab-xp-board{background:linear-gradient(120deg,#eae7ff,#e5f8f1);border:1px solid #d6daf0;border-radius:18px;padding:15px 17px;margin:0 0 18px;color:#344264;box-shadow:0 7px 20px #6166b117}.vocab-xp-board[hidden]{display:none}.vocab-xp-head{display:flex;justify-content:space-between;align-items:center;gap:9px;flex-wrap:wrap}.vocab-xp-head strong{font-size:18px;color:#4b3ea1}.vocab-xp-head .xp-count{font-size:14px;font-weight:900;color:#6155b2}.vocab-xp-sub{color:#6e7891;font-size:12px;margin:8px 0 7px}.vocab-xp-track{height:10px;background:#d8d8e9;border-radius:20px;overflow:hidden}.vocab-xp-track span{display:block;background:linear-gradient(90deg,#7460dc,#eca64e);height:100%;border-radius:20px}.vocab-xp-awards{display:flex;gap:7px;margin-top:11px;flex-wrap:wrap}.vocab-xp-awards span{font-size:12px;font-weight:700;background:white;border:1px solid #b7d9d1;padding:6px 9px;border-radius:99px}.vocab-xp-awards span.locked{color:#7a849b;background:#f3f4fa;border-color:#dce0ea}.vocab-xp-note{font-size:12px;margin-top:9px;color:#76839a}';
document.head.append(style);
const board=document.createElement('section');board.className='vocab-xp-board';board.id='vocabXpBoard';board.setAttribute('aria-label','單字勇士能力值');
document.querySelector('main.shell header.top')?.after(board);
function render(){
 const data=bridge();
 if(!data?.selectedId){board.hidden=true;return}
 const p=data.learners.find(x=>x.id===data.selectedId);
 if(!p){board.hidden=true;return}
 const attempts=data.attempts.filter(x=>x.learner_id===p.id);
 const xp=Number(p.xp)||0,lv=getLevel(xp);
 const from=50*(lv-1)*lv,to=50*lv*(lv+1);
 const percent=Math.max(0,Math.min(100,Math.round((xp-from)/(to-from)*100)));
 const modes=[['meaning','中英配對'],['spelling','英文拼字'],['sentence','句子填空']];
 const done=new Set();
 for(const a of attempts){
  if(a.result_status!=='completed'||!a.question_count||a.correct_count/a.question_count<.8)continue;
  if(a.mode==='all')modes.forEach(x=>done.add(x[0]));else done.add(a.mode);
 }
 const medals=modes.map(([mode,label])=>'<span class="'+(done.has(mode)?'':'locked')+'">'+(done.has(mode)?'🏅 ':'🔒 ')+label+'</span>').join('');
 board.hidden=false;
 board.innerHTML='<div class="vocab-xp-head"><strong>🔤 英文島｜練習成長值</strong><span class="xp-count">'+xp+' XP</span></div>'+ 
 '<div class="vocab-xp-sub">'+esc(p.name)+' 的英文學習經驗。正式總 Lv. 請看「共用冒險者」卡片。</div>'+ 
 '<div class="vocab-xp-track"><span style="width:'+percent+'%"></span></div>'+
 '<div class="vocab-xp-awards">'+medals+'</div>'+
 '<div class="vocab-xp-note">🎯 每題答對 +10 XP，通關 +20 XP；單關答對率達 80% 取得徽章。正式升級須通過 10 題綜合試煉。</div>';
}
window.vocabProgressRefresh=render;
render();
})();
