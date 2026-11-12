/* Chengyu Quest V1.7: cloud-powered hero XP and sequential adventure map. Stage cards use the compact demo anatomy - left stage name, intro and one short status line; right side stars plus a compact summary-exam button only when earned - so the map is the single progress view. */
(function(){
'use strict';
const zones=[
['🏡','新手村','最常見的生活成語','國小'],
['🌳','成語森林','比喻和生活情境','國小'],
['🏯','智慧古堡','意思和相近成語','國中'],
['🧩','典故迷宮','複雜語意與用法','國中'],
['⚔️','勇士試煉','進階與易混淆成語','進階'],
['🐉','傳說山脈','抽象與少見成語','進階'],
['👑','王者挑戰','全題庫隨機綜合','全部'],
['🌅','出村新征途','換情境，判斷成語的用法','全部']
];
const easy=new Set(['一心一意','人山人海','東張西望','目不轉睛','三心二意','半途而廢','迫不及待','同心協力','全力以赴','一目了然','言而有信','一舉兩得','大公無私','飲水思源','腳踏實地','急中生智']);
const $=id=>document.getElementById(id);
const escapeHtml=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function pool(zone){
 if(zone===8)return DATA.filter(x=>VILLAGE_EIGHT.some(q=>q.w===x.word));
 if(zone===7)return DATA;
 let group=zone<=2?'國小':zone<=4?'國中':'進階';
 let items=DATA.filter(x=>x.level===group);
 if(zone===1)return items.filter(x=>easy.has(x.word));
 if(zone===2)return items.filter(x=>!easy.has(x.word));
 return items.slice(zone%2===1?0:16,zone%2===1?16:32);
}
function lvOf(xp){let lv=1;while(lv<100&&xp>=50*lv*(lv+1))lv++;return lv}
function rank(lv){return lv>=30?'傳說成語王':lv>=20?'神話勇者':lv>=12?'成語大師':lv>=8?'黃金騎士':lv>=5?'白銀騎士':lv>=3?'青銅勇士':lv>=2?'成語冒險家':'見習勇士'}
const grid=document.querySelector('.setup-grid'),levelField=$('levels')?.parentElement;
if(!grid||!levelField)return;
levelField.style.display='none';
const style=document.createElement('style');
style.textContent='.adventure-area{margin-bottom:22px;background:#fff;border:1px solid #e4e5ed;border-radius:20px;padding:19px;color:#2c3957}.adventure-head{display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}.adventure-head h2{margin:9px 0;font-size:24px}.adventure-head p,.adventure-hint{font-size:13px;color:#758199;line-height:1.7}.adventure-hero{flex:1 1 230px;padding:14px;background:linear-gradient(120deg,#ebe5ff,#e6f7ee);border-radius:16px}.adventure-hero strong{color:#4a3ab2;font-size:18px}.adventure-hero p{margin:5px 0;font-size:12px}.adventure-xp{height:10px;border-radius:20px;background:#dedde9;overflow:hidden}.adventure-xp span{display:block;height:100%;background:linear-gradient(90deg,#7762e3,#f0ab54);border-radius:20px}.adventure-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px;margin:17px 0}.adventure-stage{min-height:104px;border:2px solid #e5e3f0;background:#fafaff;border-radius:16px;padding:12px 14px;cursor:pointer;display:flex;align-items:center;text-align:left;gap:10px;color:#34425d;font:inherit}.adventure-stage .stage-main{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0}.adventure-stage .stage-side{margin-left:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;flex:none}.adventure-stage .stage-icon{font-size:24px;line-height:1.1}.adventure-stage strong{font-size:15px}.adventure-stage small{font-size:12px;color:#77829a;line-height:1.4}.adventure-stage .state{font-size:12px;font-weight:800;color:#6454b7;margin-top:2px}.adventure-stage[aria-pressed=true]{border-color:#7664d9;background:#f0edff}.adventure-stage:disabled{cursor:not-allowed;opacity:.55}.adventure-stage .stars{font-size:16px;letter-spacing:2px;color:#e8a93c;line-height:1.3}.adventure-stage .stars-off{color:#c9cfdd}.adventure-stage .stage-exam{width:68px;min-height:56px;border:0;border-radius:12px;padding:8px 6px;font:inherit;font-size:13px;font-weight:800;line-height:1.3;color:#fff;background:#0f7d8c;cursor:pointer;text-align:center}.adventure-stage .stage-exam:hover{background:#0b6572}.adventure-stage .stage-pass{color:#1a9e4b;font-size:15px;font-weight:900;white-space:nowrap}.adventure-stage .stage-exam-retake{border:0;background:none;padding:0;font-size:11px;font-weight:700;color:#8a94a9;text-decoration:underline;cursor:pointer}.adventure-stage .stage-exam-retake:hover{color:#5a49c4}.stage-help{margin:0 0 14px;font-size:12px;color:#758199;line-height:1.7}.stage-help summary{cursor:pointer;font-weight:800;color:#6554c7}.stage-help p{margin:6px 0}.stage-pager{display:flex;align-items:center;justify-content:center;gap:12px;margin:-4px 0 14px}.stage-pager button{border:1.5px solid #7664d9;background:#fff;border-radius:9px;padding:8px 14px;font:inherit;font-size:12px;font-weight:800;color:#5a49c4;cursor:pointer}.stage-pager button:disabled{opacity:.45;cursor:default}.stage-pager span{font-size:12px;color:#758199;font-weight:700}.adventure-stage.stage-page-hide{display:none}@media(min-width:681px){.stage-pager{display:none}}.adventure-stage:focus-visible{outline:3px solid #ffca62;outline-offset:3px}.adventure-stage[aria-disabled=true]{cursor:not-allowed;opacity:.68}.adventure-hint{margin:0}.adventure-hint a{color:#6554c7;text-decoration:underline}@media(max-width:680px){.adventure-stages{grid-template-columns:minmax(0,1fr)}}@media(max-width:470px){.adventure-area{padding:13px}.adventure-stages{gap:8px}.adventure-stage{padding:10px 12px;min-height:96px}.adventure-stage strong{font-size:14px}}';
document.head.append(style);
const section=document.createElement('section');section.id='adventureArea';section.className='adventure-area';
section.innerHTML='<div class="adventure-head"><div><span class="eyebrow">⚔️ 成語勇士養成</span><h2>我的冒險地圖</h2><p>從簡單到困難。混合練習後，通過本關90%總結測驗解鎖下一張地圖！</p></div><div class="adventure-hero" id="adventureHero" role="status"></div></div><div class="adventure-stages" id="adventureStages"></div><p class="adventure-hint">🎯 答對 +10 XP，完成 +20 XP；Game Over 也保留學到的 XP。練習至少5題達80%取得第一星；第2星要同關3個詞各答對兩種角度，第3星要另一天再過關；總結測驗90%開下一關。本站題目為自編，尚未逐條與 <a href="https://dict.idioms.moe.edu.tw/" rel="noopener noreferrer" target="_blank">教育部《成語典》</a>核對。</p>';
grid.before(section);
config.zone=1;
let lastPlayer=null,available=1;
function progress(){
 const data=window.chengyuProgressState?.()||{learners:[],attempts:[],selectedId:''};
 const player=data.learners.find(x=>x.id===data.selectedId);
 const attempts=data.attempts.filter(x=>x.learner_id===data.selectedId);
 let next=1;
 const stars=window.learningVillageProgress;
 if(stars)for(let zone=1;zone<=6;zone++){if((stars.stagePassed||[]).includes(zone))next=zone+1;else break;}
 return {player,attempts,next};
}
let stagePage=0;
function paintStagePage(){
 const grid=$('adventureStages');if(!grid)return;
 const mq=window.matchMedia('(max-width:680px)');
 const cards=[...grid.children],per=4,pages=Math.max(1,Math.ceil(cards.length/per));
 if(stagePage>pages-1)stagePage=pages-1;if(stagePage<0)stagePage=0;
 cards.forEach((c,i)=>c.classList.toggle('stage-page-hide',mq.matches&&Math.floor(i/per)!==stagePage));
 const pg=$('stagePager');
 if(pg){const hid=!mq.matches;if(pg.hidden!==hid)pg.hidden=hid;const t='第 '+(stagePage+1)+' / '+pages+' 頁',sp=pg.querySelector('span');if(sp.textContent!==t)sp.textContent=t;const b0=pg.querySelector('[data-pg="-1"]'),b1=pg.querySelector('[data-pg="1"]'),d0=stagePage===0,d1=stagePage===pages-1;if(b0.disabled!==d0)b0.disabled=d0;if(b1.disabled!==d1)b1.disabled=d1}
}
function render(){
 const p=progress();available=window.learningVillagePassed?8:p.next;
 if((p.player?.id||'')!==lastPlayer){lastPlayer=p.player?.id||'';config.zone=1}
 if(config.zone>available)config.zone=available;
 config.level=zones[config.zone-1][3];
 const xp=Number(p.player?.xp)||0;
 const percentage=Math.round((available-1)/6*100);
 $('adventureHero').innerHTML='<strong>📖 成語島｜'+xp+' XP</strong><p>'+escapeHtml(p.player?.name||'先選自己的名字')+' 的成語探索累積經驗。已開放到第 '+available+' 關；總 Lv. 請看「共用冒險者」卡片。</p><div class="adventure-xp"><span style="width:'+percentage+'%"></span></div>';
 const starsData=window.learningVillageProgress;
 const passed=new Set((starsData?.stages||[]).filter(x=>x.first_star).map(x=>x.zone));
 const examPassed=new Set(starsData?.stagePassed||[]);
 $('adventureStages').innerHTML=zones.map((z,i)=>{
  const n=i+1,locked=n===8?!window.learningVillagePassed:n>available;
  const unlocked8=n===8&&!!starsData?.villageExamUnlocked,done8=n===8&&!!window.learningVillagePassed;
  const status=n===8?(done8?'✅ 出村考驗已通過':unlocked8?'🎯 出村大考驗開放':'🔒 集滿 21 星開放 · 90 分通過'):examPassed.has(n)?'✅ PASS 已通關':passed.has(n)?'✔ 練習完成':locked?'🔒 未解鎖':n===config.zone?'🎯 挑戰中':'▶ 前往挑戰';
  let extra='';
  if(n<=7){
   const s=(starsData?.stages||[]).find(x=>x.zone===n),st=s?s.stars:0;
   const examOpen=!!s&&!!s.first_star&&(n===1||examPassed.has(n-1));
   extra='<span class="stars" aria-label="本關 '+st+' 星，共 3 星">'+'★'.repeat(st)+'<span class="stars-off">'+'☆'.repeat(3-st)+'</span></span>'+(examPassed.has(n)?'<span class="stage-pass">✓PASS</span><button type="button" class="stage-exam-retake" data-stage-exam="'+n+'">再測一次</button>':examOpen?'<button type="button" class="stage-exam" data-stage-exam="'+n+'">總結測驗</button>':'');
  }else{
   extra='<span class="stars" aria-label="新手村集星 '+(starsData?starsData.total:'…')+' / 21">'+(starsData?starsData.total:'…')+'/21</span>'+(done8?'<span class="stage-pass">✓PASS</span>':unlocked8?'<button type="button" class="stage-exam" data-village-exam>出村大考驗</button>':'');
  }
  return '<div class="adventure-stage" data-zone="'+n+'" role="button" tabindex="'+(locked?'-1':'0')+'" aria-disabled="'+(locked?'true':'false')+'" aria-pressed="'+(config.zone===n)+'"><div class="stage-main"><span class="stage-icon">'+z[0]+'</span><strong>第 '+n+' 關｜'+z[1]+'</strong><small>'+z[2]+'・'+pool(n).length+' 則</small><span class="state">'+status+'</span></div><div class="stage-side">'+extra+'</div></div>'
 }).join('');
 if(!document.getElementById('stageHelp')){const h=document.createElement('details');h.id='stageHelp';h.className='stage-help';h.innerHTML='<summary>集星與測驗說明</summary><p>第1星：過關（至少5題、80%）。第2星：同關3則成語各答對兩種角度。第3星：另一天再過關。新賽季從第一關開始，舊紀錄與金幣保留。</p><p>每關先混合練習，再做本關總結測驗；達90%開下一關，三星另記學習進度。集滿21星開放出村大考驗，90分通過才開放第8關。</p>';$('adventureStages').insertAdjacentElement('afterend',h)}
 if(!document.getElementById('stagePager')){const pg=document.createElement('div');pg.id='stagePager';pg.className='stage-pager';pg.hidden=true;pg.innerHTML='<button type="button" data-pg="-1">‹ 上一頁</button><span></span><button type="button" data-pg="1">下一頁 ›</button>';$('adventureStages').insertAdjacentElement('afterend',pg);pg.addEventListener('click',e=>{const b=e.target.closest('[data-pg]');if(!b)return;stagePage+=Number(b.dataset.pg);paintStagePage()});try{window.matchMedia('(max-width:680px)').addEventListener('change',paintStagePage)}catch(e){}}
 stagePage=Math.floor(Math.max(0,Math.min(7,(config.zone||1)-1))/4);
 paintStagePage();
}
window.chengyuAdventurePool=(all,zone)=>pool(Number(zone)||1);
window.chengyuAdventureCanStart=(review)=>{
 if(Array.isArray(review))return true;
 config.mode='mixed';
 if(config.zone===8&&!window.learningVillagePassed){alert('通過21星出村考驗後才開放第八關');return false}
 if(config.zone!==8&&config.zone>progress().next){alert('請先通過前一關90%總結測驗！');return false}
 return true;
};
window.chengyuProgressRefresh=render;
window.chengyuAdventureAfterFinish=(snapshot,box)=>{
 if(snapshot.zone==null)return;
 if(Number(snapshot.zone)===8){box.insertAdjacentText('beforeend','　出村新征途已記錄。');render();return;}
 const score=snapshot.answers.filter(x=>x.correct).length/snapshot.answers.length;
 if(snapshot.resultStatus==='completed'&&snapshot.answers.length>=5&&score>=.8){
  const next=zones[Number(snapshot.zone)];
  box.insertAdjacentText('beforeend','　練習完成！回到關卡做總結測驗，達90%開下一關。');
 }
 render();
};
$('adventureStages').addEventListener('click',e=>{if(e.target.closest('[data-stage-exam],[data-village-exam]'))return;const b=e.target.closest('[data-zone]');if(!b||b.getAttribute('aria-disabled')==='true')return;config.zone=Number(b.dataset.zone);render()});
$('adventureStages').addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;if(e.target.closest('[data-stage-exam],[data-village-exam]'))return;const b=e.target.closest('[data-zone]');if(!b||b.getAttribute('aria-disabled')==='true')return;e.preventDefault();config.zone=Number(b.dataset.zone);render()});
render();
})();
