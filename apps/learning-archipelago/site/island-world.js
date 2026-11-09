/* Learning Archipelago - voxel sunset archipelago world map (v3).
   Original self-made scene (archipelago-v5.jpg): 成語島 / 英文島 entries + lighthouse hero-board.
   Ambient motion (mist drift, sea sparkles, lantern breathing, sunset shimmer, gentle sway).
   Contract preserved: #f= family key + &p= player passthrough, ids islandChengyu/islandEnglish,
   data-world links re-set by the hub's setLinks(), #worldMap scroll target. */
(function(){
'use strict';
const root=document.querySelector('.world');
if(!root)return;
const style=document.createElement('style');
style.id='archipelago-voyage-world-style';
style.textContent=[
'.expedition-world{margin-top:27px}',
'.expedition-world .section-label{margin-bottom:15px}',
'.voyage-shell{background:#101d2e;border:4px solid #2e4a5f;box-shadow:7px 8px 0 #071022;border-radius:11px;overflow:hidden;color:#fff}',
'.voyage-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#16222f;padding:12px 15px;border-bottom:3px solid #2e4a5f}',
'.voyage-heading strong{font-size:clamp(14px,2vw,20px);letter-spacing:.06em}',
'.voyage-heading small{display:block;color:#7fd7e8;font-size:11px;margin-top:3px;letter-spacing:.08em}',
'.voyage-heading .voyage-status{color:#bff0f4;font-size:11px;border:1px solid #3d6a74;border-radius:5px;padding:7px 9px;white-space:nowrap}',
'.voyage-grid{display:grid;grid-template-columns:minmax(0,1fr) 275px;align-items:start}',
'.voyage-stage{position:relative;width:100%;aspect-ratio:1672/941;overflow:hidden;background:#0d2036}',
'.voyage-bg{position:absolute;inset:0;background:url("./archipelago-v5.jpg") center/cover no-repeat;animation:voyageSway 26s ease-in-out infinite alternate;will-change:transform}',
'@keyframes voyageSway{from{transform:scale(1.015) translate3d(-.35%,0,0)}to{transform:scale(1.015) translate3d(.35%,.3%,0)}}',
'.voyage-mist{position:absolute;border-radius:50%;pointer-events:none;mix-blend-mode:screen;background:radial-gradient(ellipse at center,rgba(255,244,225,.34) 0%,rgba(255,244,225,0) 65%);filter:blur(2px);will-change:transform}',
'.vm1{width:46%;height:15%;left:-8%;top:6%;animation:voyageDrift 74s ease-in-out infinite alternate}',
'.vm2{width:38%;height:12%;left:52%;top:16%;animation:voyageDrift 92s ease-in-out infinite alternate-reverse;opacity:.8}',
'.vm3{width:52%;height:14%;left:16%;top:1%;animation:voyageDrift 110s ease-in-out infinite alternate;opacity:.6}',
'.vm4{width:60%;height:11%;left:-12%;top:86%;animation:voyageDrift 66s ease-in-out infinite alternate-reverse;opacity:.5}',
'@keyframes voyageDrift{from{transform:translate3d(-4%,0,0)}to{transform:translate3d(9%,-1%,0)}}',
'.voyage-glow{position:absolute;border-radius:50%;pointer-events:none;mix-blend-mode:screen;will-change:opacity,transform;background:radial-gradient(circle,rgba(255,214,130,.85) 0%,rgba(255,180,90,.32) 38%,rgba(255,180,90,0) 70%)}',
'@keyframes voyageBreathe{0%,100%{opacity:.45;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}}',
'.vg1{left:3.2%;top:25.5%;width:3.2%;aspect-ratio:1;animation:voyageBreathe 3.6s ease-in-out infinite}',
'.vg2{left:16%;top:20.5%;width:3%;aspect-ratio:1;animation:voyageBreathe 4.4s ease-in-out infinite .8s}',
'.vg3{left:62.2%;top:12%;width:4%;aspect-ratio:1;animation:voyageBreathe 5.2s ease-in-out infinite .4s}',
'.vg4{left:40.2%;top:47%;width:2.6%;aspect-ratio:1;animation:voyageBreathe 3.1s ease-in-out infinite .2s}',
'.vg5{left:57.6%;top:44.5%;width:2.6%;aspect-ratio:1;animation:voyageBreathe 3.8s ease-in-out infinite .9s}',
'.vg6{left:89.2%;top:20%;width:3%;aspect-ratio:1;animation:voyageBreathe 4s ease-in-out infinite 1.1s}',
'.vg7{left:91%;top:28%;width:2.6%;aspect-ratio:1;animation:voyageBreathe 3.2s ease-in-out infinite .5s}',
'.voyage-sparkle{position:absolute;width:3px;height:3px;border-radius:50%;pointer-events:none;mix-blend-mode:screen;background:#eaf7ff;box-shadow:0 0 6px 1px rgba(200,235,255,.9);will-change:opacity,transform;animation:voyageTw 3s ease-in-out infinite}',
'@keyframes voyageTw{0%,100%{opacity:0;transform:scale(.6)}50%{opacity:.95;transform:scale(1.25)}}',
'.voyage-shimmer{position:absolute;left:34%;top:33%;width:12%;height:26%;pointer-events:none;mix-blend-mode:screen;background:linear-gradient(180deg,rgba(255,220,150,.16),rgba(255,220,150,0) 80%);animation:voyageShim 7s ease-in-out infinite alternate;will-change:opacity}',
'@keyframes voyageShim{from{opacity:.25}to{opacity:.7}}',
'.voyage-hot{position:absolute;transform:translate(-50%,-50%);border:0;background:transparent;cursor:pointer;text-decoration:none;z-index:3;touch-action:manipulation;-webkit-tap-highlight-color:transparent;padding:0}','.voyage-hot-chengyu::before,.voyage-hot-english::before{content:"";position:absolute;inset:var(--hit,14px);border:3px solid rgba(255,223,117,.95);border-radius:9px;background:rgba(15,28,55,.08);box-shadow:0 0 16px rgba(255,223,117,.5),inset 0 0 10px rgba(255,223,117,.28);animation:voyagePulse 2.4s ease-in-out infinite}','.voyage-hot-board::after{content:"";position:absolute;inset:calc(-1 * var(--hit,14px))}',
'.voyage-hot:before{content:"";position:absolute;inset:-13px}',
'@keyframes voyagePulse{0%,100%{opacity:.78}50%{opacity:1}}',
'.voyage-hot:hover{background:rgba(15,28,55,.18)}',
'.voyage-hot:focus-visible{outline:3px solid #ffdf75;outline-offset:4px;border-radius:12px}',
'.voyage-hot-chengyu{left:15.7%;top:37.2%;width:calc(9.6% + (var(--hit,14px) * 2));height:calc(8.6% + (var(--hit,14px) * 2))}',
'.voyage-hot-english{left:89.8%;top:40.6%;width:calc(7.4% + (var(--hit,14px) * 2));height:calc(6.6% + (var(--hit,14px) * 2))}',
'.voyage-hot-board{left:69.3%;top:31.8%;width:auto;height:auto;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;box-shadow:none;animation:none}',
'.voyage-hot-board:before{inset:-10px}',
'.voyage-sign{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:.34em .95em;background:linear-gradient(180deg,#cfa66f 0%,#b98a52 55%,#a87a45 100%);border:3px solid #6b4a2a;border-radius:7px;box-shadow:0 3px 0 #54371d,0 6px 12px rgba(20,10,0,.4),inset 0 1px 0 rgba(255,235,200,.45),0 0 16px rgba(255,223,117,.5);color:#3d2712;font-weight:900;font-size:clamp(11px,1.2vw,16px);letter-spacing:.14em;white-space:nowrap;text-shadow:0 1px 0 rgba(255,230,190,.4);animation:voyagePulse 2.4s ease-in-out infinite}',
'.voyage-sign:before,.voyage-sign:after{content:"";position:absolute;top:5px;width:5px;height:5px;border-radius:50%;background:#54371d;box-shadow:inset 0 1px 1px rgba(0,0,0,.5)}',
'.voyage-sign:before{left:6px}.voyage-sign:after{right:6px}',
'.voyage-index{background:#182230;border-left:3px solid #2e4a5f;min-width:0;display:flex;flex-direction:column}',
'.voyage-index .index-head{padding:17px 17px 9px;background:#14202e}',
'.voyage-index .index-head small{font-size:10px;letter-spacing:.16em;color:#ffb64d;font-weight:900}',
'.voyage-index .index-head h3{font-size:19px;line-height:1.35;margin:5px 0;color:#eaf6ff}',
'.voyage-index .index-head p{color:#9fb6c4;font-size:11px;line-height:1.5;margin:4px 0 0}',
'.voyage-index .index-scroll{padding:4px 12px 15px;display:flex;flex-direction:column;gap:2px}',
'.voyage-index .index-item{display:flex;gap:12px;align-items:center;min-height:64px;padding:10px 7px;text-decoration:none;color:#e8f4f8;border-bottom:1px solid #2b3d4e;transition:background .14s;background:none;border-top:0;border-left:0;border-right:0;font:inherit;text-align:left;width:100%;cursor:pointer}',
'.voyage-index .index-item:hover{background:#1f3145;border-radius:6px}',
'.voyage-index .index-item strong{display:block;font-size:14px;color:inherit}',
'.voyage-index .index-item .index-note{color:#8fa9b8;font-size:11px;display:block;margin-top:4px}',
'.voyage-index .index-item .index-number{font-family:Georgia,serif;font-weight:bold;font-size:24px;font-style:italic;color:#37e6ff;min-width:36px;text-align:center}',
'.voyage-index .index-item .index-arrow{color:#ffb64d;font-size:19px;margin-left:auto}',
'.voyage-index .index-item:focus-visible{outline:3px solid #fff1b1;outline-offset:-3px}',
'.voyage-index .index-foot{border-top:1px solid #2b3d4e;padding:11px 14px;margin-top:auto;font-size:11px;color:#a9c0cc;line-height:1.7}',
'.voyage-legend{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;padding:9px 13px;background:#12283f;border-top:2px solid #2e4a5f;font-size:11px;color:#bfe3ec}',
'.voyage-legend strong{color:#ffd39d}',
'.hb-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(6,12,26,.72)}',
'.hb-card{background:#fdf6e3;color:#3a3f5a;border:4px solid #d8c793;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);max-width:430px;width:100%;padding:20px 20px 16px;max-height:86vh;overflow:auto}',
'.hb-card h2{margin:0 0 2px;font-size:22px;letter-spacing:.05em;color:#2c3a6b}',
'.hb-card .hb-sub{font-size:12px;color:#8a7f5f;margin-bottom:12px}',
'.hb-card table{width:100%;border-collapse:collapse;font-size:14px}',
'.hb-card th{font-size:11px;color:#8a7f5f;text-align:right;padding:4px 6px;border-bottom:2px solid #e3d9bd;font-weight:700}',
'.hb-card th:first-child,.hb-card td:first-child{text-align:left}',
'.hb-card td{padding:8px 6px;border-bottom:1px dashed #e3d9bd;text-align:right}',
'.hb-card td:first-child{font-weight:700}',
'.hb-card{width:min(100%,720px);max-width:720px}',
'.hb-boards{display:grid;grid-template-columns:1fr 1fr;gap:18px}',
'.hb-boards h3{margin:0 0 6px;font-size:15px;color:#314468}',
'.hb-boards td:first-child{white-space:nowrap}',
'.hb-ava{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;color:#fff;font-size:13px;font-weight:800;vertical-align:-6px;margin-right:6px;box-shadow:inset 0 -3px 0 rgba(0,0,0,.25)}',
'.hb-rank{display:inline-block;min-width:20px;color:#b08a2e;font-weight:900}',
'.hb-note{margin-top:12px;font-size:11px;color:#8a7f5f;line-height:1.6}',
'.hb-state{padding:18px 6px;font-size:13px;color:#6b7590;text-align:center;line-height:1.8}',
'.hb-close{margin-top:14px;width:100%;min-height:44px;padding:.7em;border:0;border-radius:9px;background:#18274d;color:#ffe9b8;font-weight:700;font-size:15px;cursor:pointer}',
'@media(max-width:900px){.voyage-grid{grid-template-columns:1fr}.voyage-index{border-left:none;border-top:3px solid #2e4a5f}.voyage-index .index-scroll{padding:2px 9px 12px}.voyage-index .index-item{min-height:56px}}',
'@media(max-width:610px){.voyage-stage{--hit:22px}.hb-boards{grid-template-columns:1fr}.expedition-world .section-label{flex-wrap:wrap;gap:8px}.expedition-world .section-label .pill{font-size:10px}.voyage-shell{border-width:3px}.voyage-heading{padding:11px}.voyage-heading strong{font-size:14px}.voyage-heading .voyage-status{font-size:10px}.voyage-sign{font-size:11px;padding:.3em .7em}.voyage-index .index-head h3{font-size:17px}.voyage-legend{font-size:10px}.hb-card{padding:16px 14px 12px}}',
'.ic{display:inline-block;width:1em;height:1em;vertical-align:-0.13em;margin-right:.18em}',
'@media(prefers-reduced-motion:reduce){.voyage-bg,.voyage-mist,.voyage-glow,.voyage-sparkle,.voyage-shimmer,.voyage-hot,.voyage-sign{animation:none!important}.voyage-index .index-item{transition:none!important}}'
].join('\n');
document.head.appendChild(style);

function domainFor(k){
 return k==='chengyu'?'https://chengyu-quest-family.onrender.com/':'https://vocab-quest-family.onrender.com/';
}
function playerHash(){
 try{
  const hash=new URLSearchParams(location.hash.slice(1));
  const t=hash.get('f'),p=hash.get('p');
  return t?'#f='+encodeURIComponent(t)+(p?'&p='+encodeURIComponent(p):''):'';
 }catch(e){return ''}
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}


/* Inline SVG icons: render identically on every device (no emoji-font dependency). */
const IC={
 island:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 3 2.5 5 5.4 5.6-1.3.4-2.4.4-3.5.1 1.7 1.2 2.9 2.9 3.4 5h-4.3v2.3h5.4l1.6 3.3H4l1.6-3.3H11v-2.3H6.7c.5-2.1 1.7-3.8 3.4-5-1.1.3-2.2.3-3.5-.1 2.9-.6 4.8-2.6 5.4-5.6z" fill="currentColor"/></svg>',
 sail:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 2l5.5 10h-5.5V2zm-2 0v10H4l6.5-10zM3 14h18l-2.6 5.5a2 2 0 0 1-1.8 1.1H7.4a2 2 0 0 1-1.8-1.1L3 14z" fill="currentColor"/></svg>',
 trophy:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10v2h4v4a5 5 0 0 1-5 5h-.35A6 6 0 0 1 13 15.92V18h3v2H8v-2h3v-2.08A6 6 0 0 1 8.35 13H8a5 5 0 0 1-5-5V4h4V2zm-2 4v2a3 3 0 0 0 2 2.83V6H5zm14 0h-2v4.83A3 3 0 0 0 19 8V6z" fill="currentColor"/></svg>',
 book:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5A3.5 3.5 0 0 0 8.5 3H3v14h5.5a3.5 3.5 0 0 1 3.5 2 3.5 3.5 0 0 1 3.5-2H21V3h-5.5A3.5 3.5 0 0 0 12 5.5z" fill="currentColor"/></svg>',
 abc:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="15.5" text-anchor="middle" font-size="8.5" font-weight="800" fill="currentColor">ABC</text></svg>',
 castle:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V9l2 2V7h3v2h2V7h4v2h2V7h3v4l2-2v12h-6v-4a3 3 0 0 0-6 0v4H3z" fill="currentColor"/></svg>',
 compass:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2z" fill="currentColor"/></svg>',
 cloud:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.7 8.6 4.3 4.3 0 0 1 17.5 19H7z" fill="currentColor"/></svg>',
 rain:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.7 4.6 4.3 4.3 0 0 1 17.5 15H7z" fill="currentColor"/><path d="M8 17.5l-1 3m5-3l-1 3m5-3l-1 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
 point:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3l13 8.5-5.5.8 3 6.2-2.6 1.2-2.9-6.2L6.5 17 6 3z" fill="currentColor"/></svg>',
 hourglass:'<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v2c0 3-2 5-4 6 2 1 4 3 4 6v2H6v-2c0-3 2-5 4-6-2-1-4-3-4-6V2zm3 16h6c-.4-1.8-1.6-3-3-3.6-1.4.6-2.6 1.8-3 3.6z" fill="currentColor"/></svg>'
};

root.outerHTML='<section class="world expedition-world" id="worldMap" aria-label="學習冒險群島探索地圖">'+
 '<div class="section-label"><div><h2>'+IC.island+'學習冒險群島地圖</h2><p>和孩子一起，航向今天的知識冒險</p></div><span class="pixel pill">CHAPTER 01 · THE FIRST VOYAGE</span></div>'+
 '<div class="voyage-shell">'+
 '<div class="voyage-heading"><div><strong>'+IC.island+'THE ISLAND EXPEDITION · 群島探索</strong><small>點地圖上的島嶼出航，或登上燈塔看看英雄榜</small></div><span class="voyage-status">'+IC.sail+'已開放 2 島</span></div>'+
 '<div class="voyage-grid">'+
 '<div class="voyage-stage" role="img" aria-label="夕陽下的立體方塊群島：左邊是成語島的東方書院，右邊是英文島的魔法高塔，中央主島有孩子們的遊樂場、小小的 TRQN 字母地標與英雄榜燈塔">'+
 '<div class="voyage-bg"></div>'+
 '<div class="voyage-shimmer"></div>'+
 '<div class="voyage-mist vm1"></div><div class="voyage-mist vm2"></div><div class="voyage-mist vm3"></div><div class="voyage-mist vm4"></div>'+
 '<div class="voyage-glow vg1"></div><div class="voyage-glow vg2"></div><div class="voyage-glow vg3"></div><div class="voyage-glow vg4"></div><div class="voyage-glow vg5"></div><div class="voyage-glow vg6"></div><div class="voyage-glow vg7"></div>'+
 '<div id="voyageSea"></div>'+
 '<a class="voyage-hot voyage-hot-chengyu" id="islandChengyu" data-world="chengyu" href="'+domainFor('chengyu')+playerHash()+'" aria-label="出航前往成語島"></a>'+
 '<a class="voyage-hot voyage-hot-english" id="islandEnglish" data-world="english" href="'+domainFor('english')+playerHash()+'" aria-label="出航前往英文島"></a>'+
 '<button class="voyage-hot voyage-hot-board" id="heroBoardBtn" type="button" aria-label="打開英雄榜"><span class="voyage-sign">英雄榜</span></button>'+
 '</div>'+
 '<aside class="voyage-index isometric-index" aria-label="島嶼索引"><header class="index-head"><small>THE ISLAND INDEX</small><h3>今天的冒險，從哪座島開始？</h3><p>成語島和英文島已經開放，更多島嶼還在興建中。</p></header>'+
 '<div class="index-scroll">'+
 '<a class="index-item" data-world="chengyu" href="'+domainFor('chengyu')+playerHash()+'"><span class="index-number">01</span><span><strong>成語島 · 出航</strong><span class="index-note">典故森林・成語解謎</span></span><span class="index-arrow">↗</span></a>'+
 '<a class="index-item" data-world="english" href="'+domainFor('english')+playerHash()+'"><span class="index-number">02</span><span><strong>英文島 · 出航</strong><span class="index-note">魔法高塔・拼字試煉</span></span><span class="index-arrow">↗</span></a>'+
 '<button class="index-item" id="heroBoardBtn2" type="button"><span class="index-number">'+IC.trophy+'</span><span><strong>英雄榜</strong><span class="index-note">燈塔上的家庭冒險總榜</span></span><span class="index-arrow">↗</span></button>'+
 '</div>'+
 '<div class="index-foot">★ 通過各島的學習挑戰，XP 將回到同一位冒險者。<br>'+IC.castle+'正式升級仍須通過晉級試煉。</div></aside></div>'+
 '<div class="voyage-legend"><strong>'+IC.point+'點選島嶼即可出航</strong><span>'+IC.book+'成語島 / '+IC.abc+'英文島已開放 · '+IC.trophy+'燈塔英雄榜</span></div>'+
 '</div>'+
 '<div class="hb-overlay" id="heroBoardOverlay" hidden><div class="hb-card" role="dialog" aria-modal="true" aria-label="英雄榜" id="heroBoardCard"></div></div>'+
 '</section>';

/* Sea sparkles (deterministic, tuned to the v5 art's water areas) */
(function(){
 let seed=42;
 function rnd(){seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}
 const sea=document.getElementById('voyageSea');
 if(!sea)return;
 const bands=[{x:[0.02,0.30],y:[0.55,0.92]},{x:[0.68,0.97],y:[0.52,0.92]},{x:[0.05,0.95],y:[0.80,0.97]}];
 for(let i=0;i<64;i++){
  const b=bands[i%bands.length];
  const s=document.createElement('div');s.className='voyage-sparkle';
  s.style.left=((b.x[0]+rnd()*(b.x[1]-b.x[0]))*100).toFixed(2)+'%';
  s.style.top=((b.y[0]+rnd()*(b.y[1]-b.y[0]))*100).toFixed(2)+'%';
  const d=(2+rnd()*3).toFixed(2);
  s.style.animationDuration=d+'s';s.style.animationDelay=(-rnd()*d).toFixed(2)+'s';
  sea.appendChild(s);
 }
})();

/* Hero board (lighthouse): family-only, real cloud data, total-XP order. Weekly board is a future proposal. */
(function(){
 const API='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/learning-adventure-cloud';
 const overlay=document.getElementById('heroBoardOverlay');
 const card=document.getElementById('heroBoardCard');
 if(!overlay||!card)return;
 /* Ranking basis approved 11/9 (user 1794193497.537179): SEPARATE cumulative per-island boards
   (成語島 by islandXP.chengyu, 英文島 by islandXP.vocab). Not combined, not weekly. */
 const RANK_BASIS_APPROVED=true;
 /* Activation held 11/9: real-data integration/isolation verification pending backend access route.
   Until live, the board shows an honest preparation state and makes ZERO cloud calls. */
 const HERO_BOARD_LIVE=false;
 const AVA_COLORS=['#e8833a','#7a6ce0','#3fa56b','#d0577e','#3d8fc4','#c4a23d','#8a6ce0','#4aa88f'];
 function token(){
  try{const t=new URLSearchParams(location.hash.slice(1)).get('f')||'';return /^[A-Za-z0-9_-]{40,128}$/.test(t)?t:''}catch(e){return ''}
 }
 async function call(action,more){
  const body=Object.assign({action:action,world:'chengyu',token:token()},more||{});
  const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body)});
  const data=await res.json().catch(()=>null);
  if(!res.ok||!data||data.ok!==true)throw new Error((data&&data.error)||'雲端連線暫時失敗');
  return data;
 }
 function head(title,sub){return '<h2>'+IC.trophy+esc(title)+'</h2><div class="hb-sub">'+esc(sub)+'</div>'}
 function renderState(title,sub,msg){
  card.innerHTML=head(title,sub)+'<div class="hb-state">'+msg+'</div><button class="hb-close" type="button" id="hbClose">關閉</button>';
  wireClose();
 }
 function wireClose(){
  const b=document.getElementById('hbClose');
  if(b)b.onclick=hide;
 }
 function hide(){overlay.hidden=true;document.body.style.overflow=''}
 function show(){
  overlay.hidden=false;document.body.style.overflow='hidden';
  const tk=token();
  if(!tk){renderState('英雄榜','燈塔上的家庭冒險總榜',IC.compass+'請從家庭專屬網址（網址含 #f= 金鑰）進入總部，<br>就能看到家人彼此的冒險排名喔！');return}
  if(!HERO_BOARD_LIVE){renderState('英雄榜','燈塔上的家庭冒險總榜',IC.hourglass+'英雄榜正在準備中！<br>排名方式已經決定好了：成語島、英文島會分開排名；等資料連線完成，這裡就會即時顯示家人的冒險成績。');return}
  if(!RANK_BASIS_APPROVED){renderState('英雄榜','燈塔上的家庭冒險總榜',IC.hourglass+'排名方式正在和家人確認中（分島榜或合計總榜）；確認後，這裡就會即時顯示家人的冒險成績。<br>「每週挑戰榜」需要新的記錄方式才會公平，確定後才會推出。');return}
  card.innerHTML=head('英雄榜','燈塔上的家庭冒險總榜')+'<div class="hb-state">'+IC.cloud+'正在從家庭雲端讀取冒險者的 XP…</div><button class="hb-close" type="button" id="hbClose">關閉</button>';
  wireClose();
  load(tk);
 }
 async function load(tk){
  try{
   const data=await call('listPlayers');
   const players=(data.players||[]).slice(0,8);
   if(!players.length){renderState('英雄榜','燈塔上的家庭冒險總榜','還沒有冒險者加入。選好玩家、完成一座島的挑戰後，名字就會登上燈塔！');return}
   const rows=[];
   for(const p of players){
    try{
     const s=await call('load',{learnerId:p.id});
     const h=s.hero||{};
     rows.push({name:h.name||p.name||'冒險者',lv:Number(h.level)||1,xp:Number(h.totalXP)||0,cy:Number(s.islandXP&&s.islandXP.chengyu)||0,vo:Number(s.islandXP&&s.islandXP.vocab)||0});
    }catch(e){
     rows.push({name:p.name||'冒險者',lv:null,xp:null,cy:null,vo:null});
    }
   }
   rows.forEach((r,i)=>{r.color=AVA_COLORS[i%AVA_COLORS.length]});
   function board(icon,label,key){
    const list=rows.slice().sort((a,b)=>(b[key]||0)-(a[key]||0));
    let h='<div class="hb-board"><h3>'+icon+esc(label)+'</h3><table><tr><th>冒險者</th><th>XP</th><th>總等級</th></tr>';
    list.forEach((r,i)=>{
     const initial=esc((r.name||'?').slice(0,1));
     h+='<tr><td><span class="hb-rank">'+(i+1)+'</span><span class="hb-ava" style="background:'+r.color+'">'+initial+'</span>'+esc(r.name)+'</td>'+
      '<td><strong>'+(r[key]==null?'—':r[key])+'</strong></td><td>'+(r.lv==null?'—':'Lv.'+r.lv)+'</td></tr>';
    });
    return h+'</table></div>';
   }
   let html=head('英雄榜','燈塔上的家庭冒險總榜 · 成語、英文分開排名');
   html+='<div class="hb-boards">'+board(IC.book,'成語島','cy')+board(IC.abc,'英文島','vo')+'</div>';
   html+='<p class="hb-note">依各島累積 XP 分開排名，從家庭雲端即時讀取，只有家人看得見。「每週挑戰榜」是未來的提議：需要新增每週記錄方式才會公平，確定後才會上線。</p>';
   html+='<button class="hb-close" type="button" id="hbClose">關閉</button>';
   card.innerHTML=html;
   wireClose();
  }catch(e){
   renderState('英雄榜','燈塔上的家庭冒險總榜',IC.rain+'雲端連線暫時失敗：'+esc(e.message)+'<br>稍後再點一次燈塔試試。');
  }
 }
 const b1=document.getElementById('heroBoardBtn');
 const b2=document.getElementById('heroBoardBtn2');
 if(b1)b1.addEventListener('click',show);
 if(b2)b2.addEventListener('click',show);
 overlay.addEventListener('click',e=>{if(e.target===overlay)hide()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)hide()});
})();
})();
