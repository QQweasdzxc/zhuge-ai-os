/* Learning Archipelago - immersive isometric exploration map.
   Built with self-contained SVG for iPhone LINE browser; no 3D engine or third-party assets. */
(function(){
'use strict';
const root=document.querySelector('.world');
if(!root)return;
const style=document.createElement('style');
style.id='archipelago-isometric-world-style';
style.textContent=[
'.expedition-world{margin-top:27px}',
'.expedition-world .section-label{margin-bottom:15px}',
'.isometric-shell{background:#1e2a34;border:4px solid #3e4b5a;box-shadow:7px 8px 0 #101a2f;border-radius:11px;overflow:hidden;color:#fff}',
'.isometric-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#242226;padding:12px 15px;border-bottom:3px solid #485466}',
'.isometric-heading strong{font-size:clamp(14px,2vw,20px);letter-spacing:.06em}',
'.isometric-heading small{display:block;color:#e9a17b;font-size:11px;margin-top:3px;letter-spacing:.08em}',
'.isometric-heading .isometric-status{color:#c4dfdb;font-size:11px;border:1px solid #596d72;border-radius:5px;padding:7px 9px;white-space:nowrap}',
'.isometric-grid{display:grid;grid-template-columns:minmax(0,1fr) 275px;min-height:520px}',
'.isometric-viewport{position:relative;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;overscroll-behavior-inline:contain;-webkit-overflow-scrolling:touch;scrollbar-color:#6ac9cd #245f7a;background:#236b91}',
'.isometric-viewport:focus-visible{outline:3px solid #ffe1a3;outline-offset:-5px}',
'.isometric-stage{position:relative;min-width:870px;width:100%;aspect-ratio:1200 / 790;max-height:none;overflow:hidden}',
'.isometric-stage svg{width:100%;height:100%;display:block}',
'.isometric-stage:after{content:"";pointer-events:none;position:absolute;inset:0;background:linear-gradient(0deg,#071f4722,transparent 17%,transparent 78%,#6dcaff15)}',
'.isometric-index{background:#282126;border-left:3px solid #50444a;min-width:0;display:flex;flex-direction:column}',
'.index-head{padding:17px 17px 9px;background:#241b1e}',
'.index-head small{font-size:10px;letter-spacing:.16em;color:#ee9d71;font-weight:900}',
'.index-head h3{font-size:19px;line-height:1.35;margin:5px 0;color:#fff6e9}',
'.index-head p{color:#baaeb0;font-size:11px;line-height:1.5;margin:4px 0 0}',
'.index-scroll{padding:4px 12px 15px;display:flex;flex-direction:column;gap:2px}',
'.index-item{display:flex;gap:12px;align-items:center;min-height:69px;padding:10px 7px;text-decoration:none;color:#f5eeee;border-bottom:1px solid #594b4e;transition:background .14s}',
'.index-item.active:hover{background:#45363c;border-radius:6px}',
'.index-item strong{display:block;font-size:14px;color:inherit}',
'.index-item .index-note{color:#b2a9b0;font-size:11px;display:block;margin-top:4px}',
'.index-item .index-number{font-family:Georgia,serif;font-weight:bold;font-size:27px;font-style:italic;color:#ec8769;min-width:36px;text-align:center}',
'.index-item .index-arrow{color:#ffa27b;font-size:19px;margin-left:auto}',
'.index-item.locked{color:#9b9193;cursor:default;opacity:.78}',
'.index-item.locked .index-arrow{color:#8b8587}',
'.index-foot{border-top:1px solid #54464c;padding:11px 14px;margin-top:auto;font-size:11px;color:#c7b6af;line-height:1.7}',
'.isometric-legend{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;padding:9px 13px;background:#1d2938;border-top:2px solid #537484;font-size:11px;color:#c9e6eb}',
'.isometric-legend strong{color:#ffd39d}',
'.isometric-marker{position:absolute;z-index:3;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:5px 11px 5px 6px;border:2px solid #49515b;border-radius:28px;color:#f6f0e4;text-decoration:none;background:#26272ce8;box-shadow:3px 5px 0 #14334d88;white-space:nowrap;font-weight:900;font-size:14px;transform:translate(-50%,-50%);transition:transform .15s,background .15s;touch-action:manipulation}',
'.isometric-marker .marker-no{display:grid;place-items:center;flex:none;width:29px;height:29px;background:#e99372;color:#24242a;border-radius:50%;border:2px solid #21242c;font-size:16px;font-family:Georgia,serif}',
'.isometric-marker.live:hover{background:#37494a;transform:translate(-50%,-55%);border-color:#f8cf86}',
'.isometric-marker:focus-visible{outline:3px solid #fff1b1}',
'.isometric-marker.locked{border-color:#596571;background:#32404de3;color:#d2e1e0;cursor:default;opacity:.87;pointer-events:none}',
'.isometric-marker.locked .marker-no{background:#8e9d9e;color:#25303a}',
'.isometric-marker .marker-lock{font-size:10px;color:#fff0c0;margin-left:2px}',
'.sea-sailing-label{position:absolute;z-index:2;left:12%;top:89%;font-size:12px;color:#dbf9ef;background:#122e49b8;padding:7px 11px;border:1px solid #70adbb;border-radius:5px}',
'.isometric-viewport::-webkit-scrollbar{height:8px}',
'.isometric-viewport::-webkit-scrollbar-thumb{background:#77b8be;border-radius:12px}',
'@media(max-width:900px){.isometric-grid{grid-template-columns:1fr}.isometric-index{border-left:none;border-top:3px solid #50444a}.index-scroll{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 13px}.index-item{min-height:65px}.isometric-stage{min-width:890px}.index-foot{margin-top:4px}}',
'@media(max-width:610px){.expedition-world .section-label{flex-wrap:wrap;gap:8px}.expedition-world .section-label .pill{font-size:10px}.isometric-shell{border-width:3px}.isometric-heading{padding:11px}.isometric-heading strong{font-size:14px}.isometric-heading .isometric-status{font-size:10px}.isometric-stage{min-width:850px}.isometric-index .index-head h3{font-size:17px}.index-scroll{padding:2px 9px 12px;gap:0 8px}.index-item{min-height:64px;gap:7px}.index-item strong{font-size:12px}.index-item .index-number{min-width:26px;font-size:22px}.index-item .index-note{font-size:10px}.index-item .index-arrow{font-size:15px}.isometric-legend{font-size:10px}.sea-sailing-label{font-size:11px}}',
'@media(prefers-reduced-motion:reduce){.isometric-marker{transition:none!important}}'
].join('\n');
document.head.appendChild(style);

const destinations=[
 {key:'chengyu',title:'成語島',desc:'典故森林・成語解謎',note:'成語闖關／語意推理',open:true,x:205,y:228,no:'01',land:'#acd877',dark:'#91bd62',icon:'shrine'},
 {key:'english',title:'英文島',desc:'魔法高塔・拼字試煉',note:'單字學習／拼字試煉',open:true,x:570,y:185,no:'02',land:'#c6db86',dark:'#9dbc6c',icon:'castle'},
 {key:'chinese',title:'國語島',desc:'文字村落・注音探索',note:'國字／注音／改錯字',open:false,x:404,y:483,no:'03',land:'#c6c68d',dark:'#9eb26d',icon:'books'},
 {key:'math',title:'數學島',desc:'數字燈塔・幾何謎題',note:'算術／分數／幾何',open:false,x:872,y:381,no:'04',land:'#b9c77c',dark:'#99b066',icon:'lighthouse'},
 {key:'nature',title:'自然島',desc:'森林研究所・自然探險',note:'植物／人體／科學',open:false,x:672,y:650,no:'05',land:'#a9d48b',dark:'#86b771',icon:'forest'},
 {key:'reading',title:'閱讀島',desc:'知識圖書館・閱讀任務',note:'理解／推論／主旨',open:false,x:1062,y:628,no:'06',land:'#b5cf86',dark:'#8cad74',icon:'library'}
];

function tree(x,y,scale,tint){
 return '<g transform="translate('+x+' '+y+') scale('+scale+')">'+
  '<ellipse cx="0" cy="3" rx="15" ry="6" fill="#496c4a" opacity=".28"/>'+
  '<path d="M -4 -4 L 4 -4 L 4 8 L -4 8Z" fill="#765741"/>'+
  '<path d="M 0 -34 L -17 -8 L 16 -8Z" fill="'+(tint||'#377a55')+'" stroke="#2d674c" stroke-width="1.5"/>'+
  '<path d="M -8 -14 L 0 -33 L 8 -15Z" fill="#8ab971" opacity=".6"/>'+
 '</g>';
}
function cottage(x,y,roof){
 return '<g transform="translate('+x+' '+y+')">'+
  '<ellipse cx="1" cy="9" rx="21" ry="9" fill="#3e7848" opacity=".25"/>'+
  '<path d="M -16 -12 L 15 -12 L 15 8 L -16 8Z" fill="#f1d4a0" stroke="#beae8c" stroke-width="2"/>'+
  '<path d="M -23 -13 L -4 -30 L 23 -11 L 7 -5 Z" fill="'+(roof||'#d87954')+'" stroke="#9c563f" stroke-width="2"/>'+
  '<path d="M -2 -2 L 6 -2 L 6 8 L -2 8Z" fill="#8d624b"/>'+
 '</g>';
}
function emblem(type){
 if(type==='shrine')return '<g transform="translate(-15 -36)">'+
  '<ellipse cx="17" cy="34" rx="63" ry="15" fill="#507c52" opacity=".2"/>'+
  '<path d="M -42 26 L 57 26 L 47 38 L -32 38Z" fill="#af8d59"/>'+
  '<rect x="-27" y="-4" width="72" height="31" rx="2" fill="#f6e9cb" stroke="#ae9470" stroke-width="2"/>'+
  '<rect x="-15" y="2" width="15" height="20" fill="#3e4f55"/><rect x="15" y="2" width="18" height="20" fill="#365c63"/>'+
  '<path d="M -38 -5 L 9 -40 L 55 -7 L 42 0 L 7 -23 L -25 0Z" fill="#536e71" stroke="#293e50" stroke-width="4"/>'+
  '<path d="M -27 -15 L 10 -47 L 45 -16" fill="none" stroke="#dbbb76" stroke-width="3"/>'+
  '<path d="M 7 -50 L 7 -58" stroke="#a8624b" stroke-width="3"/>'+
 '</g>';
 if(type==='castle')return '<g transform="translate(-15 -39)">'+
  '<ellipse cx="14" cy="38" rx="65" ry="17" fill="#51683c" opacity=".24"/>'+
  '<path d="M -48 -2 L 54 -2 L 48 37 L -44 37Z" fill="#e6d9b2" stroke="#aaa27c" stroke-width="2"/>'+
  '<rect x="-46" y="-36" width="25" height="68" fill="#f4e6c1" stroke="#aa9478" stroke-width="2"/>'+
  '<rect x="24" y="-47" width="26" height="77" fill="#f5e1bc" stroke="#aa9478" stroke-width="2"/>'+
  '<path d="M -55 -36 L -33 -64 L -11 -36Z" fill="#b95053"/><path d="M 16 -46 L 37 -81 L 59 -46Z" fill="#b24a59"/>'+
  '<path d="M -10 -9 L 13 -38 L 37 -9Z" fill="#526a93"/><rect x="-6" y="-9" width="46" height="46" fill="#d9bf9b"/>'+
  '<path d="M 7 37 L 7 14 Q 19 -3 30 14 L 30 37" fill="#5c5461"/>'+
  '<rect x="-37" y="-16" width="8" height="18" fill="#648ea4"/><rect x="33" y="-23" width="8" height="18" fill="#648ea4"/>'+
  '<path d="M 37 -83 L 37 -98" stroke="#70564f" stroke-width="3"/><path d="M 38 -98 L 51 -94 L 38 -89Z" fill="#d86158"/>'+
 '</g>';
 if(type==='books')return '<g transform="translate(-8 -31)">'+
  '<ellipse rx="55" ry="12" cy="36" fill="#497852" opacity=".23"/>'+
  '<rect x="-43" y="-9" width="80" height="47" fill="#eccda1" stroke="#ae9977" stroke-width="3"/>'+
  '<path d="M -53 -9 L 0 -47 L 51 -8 L 38 0 L 0 -29 L -41 0Z" fill="#ab6852" stroke="#854f46" stroke-width="2"/>'+
  '<rect x="-33" y="7" width="16" height="30" fill="#2e7482"/><rect x="-14" y="7" width="14" height="30" fill="#e9b35b"/>'+
  '<rect x="3" y="7" width="15" height="30" fill="#66867c"/><rect x="21" y="7" width="9" height="30" fill="#8b6584"/>'+
 '</g>';
 if(type==='lighthouse')return '<g transform="translate(-5 -36)">'+
  '<ellipse rx="41" ry="12" cy="34" fill="#376b4b" opacity=".24"/>'+
  '<path d="M -18 33 L -14 -30 L 17 -30 L 24 33Z" fill="#f6e9d1" stroke="#a6a59d" stroke-width="3"/>'+
  '<path d="M -15 -19 L 18 -19 L 19 -8 L -16 -8Z M -17 6 L 21 6 L 23 18 L -18 18Z" fill="#c95353"/>'+
  '<rect x="-22" y="-43" width="45" height="14" fill="#f0d5ac" stroke="#9f8b73" stroke-width="2"/>'+
  '<path d="M -27 -44 L 1 -68 L 29 -44Z" fill="#42608b"/>'+
  '<rect x="-12" y="-43" width="26" height="13" fill="#fff19f"/>'+
  '<path d="M 1 -72 L 1 -84" stroke="#5a6270" stroke-width="3"/><path d="M 2 -82 L 20 -77 L 2 -73Z" fill="#d85b59"/>'+
 '</g>';
 if(type==='forest')return '<g transform="translate(0 -26)">'+
  tree(4,2,1.75,'#458b5b')+tree(-39,20,.78,'#5b9b62')+tree(46,17,.64,'#376f54')+
  '<path d="M -24 31 Q 0 19 23 31" stroke="#f6db9c" stroke-width="6" fill="none" stroke-dasharray="5 5"/>'+
 '</g>';
 if(type==='library')return '<g transform="translate(-8 -30)">'+
  '<ellipse rx="65" ry="14" cy="35" fill="#507a4f" opacity=".22"/>'+
  '<rect x="-44" y="-8" width="90" height="44" fill="#f2e1c0" stroke="#b6a489" stroke-width="3"/>'+
  '<path d="M -52 -10 L 0 -49 L 55 -10Z" fill="#5e7e8b" stroke="#344f61" stroke-width="3"/>'+
  '<rect x="-30" y="3" width="19" height="22" fill="#8bb9ab"/><rect x="11" y="3" width="21" height="22" fill="#8bb9ab"/>'+
  '<rect x="-4" y="11" width="11" height="25" fill="#755e51"/>'+
  '<path d="M -53 36 L 55 36" stroke="#bea480" stroke-width="5"/>'+
 '</g>';
 return '';
}
function island(p){
 const shadow='<ellipse cx="0" cy="53" rx="149" ry="43" fill="#123b5c" opacity=".28"/>';
 const top='M -140 -28 L -112 -65 L -43 -89 L 50 -86 L 125 -47 L 145 -4 L 113 47 L 39 74 L -62 68 L -131 29 Z';
 const side='<path d="'+top+' L -131 50 L -62 91 L 39 97 L 113 70 L 145 19 L 145 -4 L 113 47 L 39 74 L -62 68 L -131 29 Z" fill="#cbbd88" stroke="#e9d2a1" stroke-width="3"/>';
 const cliff='<path d="M -140 -28 L -140 -7 L -131 50 L -62 91 L -62 68 L -131 29 Z" fill="#ebdfab" opacity=".88"/>'+
 '<path d="M 39 74 L 39 97 L 113 70 L 145 19 L 145 -4 L 113 47 Z" fill="#9fa579" opacity=".48"/>';
 const land='<path d="'+top+'" fill="'+p.land+'" stroke="#f1e4ba" stroke-width="7" stroke-linejoin="round"/>'+
 '<path d="M -130 -27 L -104 -60 L -36 -82 L 40 -79 L 111 -41 L 132 -4 L 106 40 L 36 65 L -60 59 L -121 24 Z" fill="'+p.dark+'" opacity=".3"/>'+
 '<path d="M -117 -33 Q -20 -71 108 -29" fill="none" stroke="#daf3b1" stroke-width="6" opacity=".5"/>';
 const decor=tree(-98,-16,.65)+tree(87,-22,.75)+tree(-80,42,.5)+cottage(83,29,p.key==='english'?'#ce9169':'#d77952');
 const backdrop=p.open?'':'<path d="M -115 -53 L 111 -53" stroke="#f5ecd0" stroke-width="1.5" opacity=".35"/>';
 return '<g class="isometric-island '+p.key+'" transform="translate('+p.x+' '+p.y+') scale(.84)">'+shadow+side+cliff+land+decor+emblem(p.icon)+backdrop+'</g>';
}
function bridge(x1,y1,x2,y2){
 const dx=x2-x1,dy=y2-y1,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;
 let boards='';
 for(let t=9;t<length-3;t+=15){boards+='<rect x="'+t+'" y="-14" width="8" height="28" rx="1" fill="'+(Math.floor(t/15)%2?'#b48655':'#d4a66f')+'" stroke="#765a40" stroke-width="1"/>';}
 return '<g transform="translate('+x1+' '+y1+') rotate('+angle+')">'+
 '<rect y="-15" x="-5" width="'+(length+10)+'" height="31" rx="2" fill="#5f4d3d" stroke="#e0b683" stroke-width="2"/>'+
 boards+'<path d="M 0 -18 L '+length+' -18 M 0 19 L '+length+' 19" stroke="#5b6b65" stroke-width="3" stroke-dasharray="17 7"/>'+
 '</g>';
}
function boat(x,y,angle){
 return '<g transform="translate('+x+' '+y+') rotate('+angle+')">'+
 '<ellipse cy="20" rx="34" ry="10" fill="#0e426c" opacity=".25"/>'+
 '<path d="M -43 9 L 42 9 L 29 31 L -25 31Z" fill="#9c673d" stroke="#603d31" stroke-width="3"/>'+
 '<path d="M 0 -45 L 0 13" stroke="#735641" stroke-width="5"/>'+
 '<path d="M 0 -46 L 30 2 L 0 2Z" fill="#f4edce" stroke="#c8bf9e" stroke-width="3"/>'+
 '<path d="M -3 -37 L -25 4 L -3 4Z" fill="#f0d99a" stroke="#a38e71" stroke-width="2"/>'+
 '</g>';
}
function seaSVG(){
 let waves='';
 const pts=[[60,65],[325,120],[960,65],[1005,280],[750,100],[80,424],[290,390],[610,495],[1120,454],[95,720],[355,688],[1125,735]];
 for(const [x,y] of pts){waves+='<path d="M '+x+' '+y+' q 22 -13 44 0 q 22 13 44 0" fill="none" stroke="#b7ecf3" stroke-width="3" opacity=".24"/>';}
 const bridges=[
  bridge(309,183,458,172),
  bridge(283,275,358,418),
  bridge(666,227,780,337),
  bridge(507,508,564,594),
  bridge(792,428,713,578),
  bridge(791,660,961,635)
 ].join('');
 const all=destinations.map(island).join('');
 return '<svg viewBox="0 0 1200 790" preserveAspectRatio="xMidYMid meet" aria-label="海面上的六座立體學習島嶼，以木橋相連，可選擇島嶼展開探險" role="img" xmlns="http://www.w3.org/2000/svg">'+
 '<defs><linearGradient id="voyageSea" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#246b96"/><stop offset=".5" stop-color="#2a8aaf"/><stop offset="1" stop-color="#164d80"/></linearGradient>'+
 '<radialGradient id="voyageGlow"><stop stop-color="#82cfd0" stop-opacity=".23"/><stop offset="1" stop-color="#236b90" stop-opacity="0"/></radialGradient>'+
 '<pattern id="voyageDots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="12" cy="11" r="1.3" fill="#cdeff2" opacity=".18"/></pattern>'+
 '</defs><rect width="1200" height="790" fill="url(#voyageSea)"/><rect width="1200" height="790" fill="url(#voyageGlow)"/><rect width="1200" height="790" fill="url(#voyageDots)"/>'+
 waves+'<path d="M 20 704 Q 310 734 550 720 T 1160 740" fill="none" stroke="#b3e5ed" stroke-width="2" opacity=".16"/>'+
 '<g opacity=".9">'+boat(375,120,-16)+boat(1015,170,22)+boat(100,555,-30)+'</g>'+bridges+all+
 '<text x="1050" y="83" fill="#d1eefd" font-family="Georgia,serif" font-size="42" opacity=".85">✧ N ✧</text>'+
 '</svg>';
}
function domainFor(k){
 return k==='chengyu'?'https://chengyu-quest-family.onrender.com/':'https://vocab-quest-family.onrender.com/';
}
function playerHash(){
 const hash=new URLSearchParams(location.hash.slice(1));
 const t=hash.get('f'),p=hash.get('p');
 return t?'#f='+encodeURIComponent(t)+(p?'&p='+encodeURIComponent(p):''):'';
}
function links(p){
 return p.open?domainFor(p.key)+playerHash():null;
}
function mapHotspot(p){
 const x=(p.x/1200*100).toFixed(3),y=((p.y+94)/790*100).toFixed(3),label='<span class="marker-no">'+(p.open?'⛵':'🔒')+'</span>'+p.title+(p.open?'<span class="marker-lock">出航</span>':'');
 const sty='style="left:'+x+'%;top:'+y+'%"';
 return p.open?'<a '+sty+' id="'+(p.key==='chengyu'?'islandChengyu':'islandEnglish')+'" data-world="'+p.key+'" class="isometric-marker live" href="'+links(p)+'" aria-label="出航前往'+p.title+'">'+label+'</a>':
 '<span '+sty+' class="isometric-marker locked" aria-label="'+p.title+'尚未開放">'+label+'</span>';
}
function sideItem(p,i){
 return p.open?'<a class="index-item active" data-world="'+p.key+'" href="'+links(p)+'"><span class="index-number">'+p.no+'</span><span><strong>'+p.title+'</strong><span class="index-note">'+p.desc+'</span></span><span class="index-arrow">↗</span></a>':
 '<div class="index-item locked"><span class="index-number">'+p.no+'</span><span><strong>'+p.title+'</strong><span class="index-note">'+p.note+' · 尚未開放</span></span><span class="index-arrow">🔒</span></div>';
}
root.outerHTML='<section class="world expedition-world" id="worldMap" aria-label="學習冒險群島探索地圖">'+
 '<div class="section-label"><div><h2>🏝️ 學習冒險群島地圖</h2><p>航向島嶼，通過木橋，解鎖你的學習旅程</p></div><span class="pixel pill">CHAPTER 01 · THE FIRST VOYAGE</span></div>'+
 '<div class="isometric-shell">'+
 '<div class="isometric-heading"><div><strong>🏝️ THE ISLAND EXPEDITION · 群島探索</strong><small>讓知識化作旅程，從一座島走向下一座島</small></div><span class="isometric-status">⛵ 已開放 2 / 6 島</span></div>'+
 '<div class="isometric-grid">'+
 '<div class="isometric-viewport" id="isometricViewport" tabindex="0" role="region" aria-label="可左右滑動的群島探險地圖">'+
 '<div class="isometric-stage">'+seaSVG()+destinations.map(mapHotspot).join('')+
 '<div class="sea-sailing-label">🌊 木橋連接各島 · 點選島名開始挑戰</div></div></div>'+
 '<aside class="isometric-index" aria-label="島嶼索引"><header class="index-head"><small>THE ISLAND INDEX</small><h3>把重點，連成島。</h3><p>目前開放成語島、英文島，其他島陸續建造中。</p></header>'+
 '<div class="index-scroll">'+destinations.map(sideItem).join('')+'</div>'+
 '<div class="index-foot">★ 通過各島的學習挑戰，XP 將回到同一位冒險者。<br>🏰 正式升級仍須通過晉級試煉。</div></aside></div>'+
 '<div class="isometric-legend"><strong>👆 點選島嶼即可出航</strong><span>↔️ 左右滑動海面探索 · 📖 成語島 / 🔤 英文島已開放</span></div>'+
 '</div></section>';
const rail=document.getElementById('isometricViewport');
if(rail){
 if(window.matchMedia('(max-width:900px)').matches)rail.scrollLeft=85;
 rail.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight'){rail.scrollBy({left:180,behavior:'smooth'});e.preventDefault();}
  if(e.key==='ArrowLeft'){rail.scrollBy({left:-180,behavior:'smooth'});e.preventDefault();}
 });
}
})();
