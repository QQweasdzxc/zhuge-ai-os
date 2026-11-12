/* Learning Archipelago - voxel sunset archipelago world map (v3.4, desktop fullscreen).
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
'.expedition-world{margin-top:8px}',
'.expedition-world .section-label{margin-bottom:15px}',
'.voyage-shell{position:relative;background:#101d2e;border:4px solid #2e4a5f;box-shadow:7px 8px 0 #071022;border-radius:11px;overflow:hidden;color:#fff}',
'.voyage-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#16222f;padding:12px 15px;border-bottom:3px solid #2e4a5f}',
'.voyage-heading strong{font-size:clamp(14px,2vw,20px);letter-spacing:.06em}',
'.voyage-heading small{display:block;color:#7fd7e8;font-size:11px;margin-top:3px;letter-spacing:.08em}',
'.voyage-heading .voyage-status{color:#bff0f4;font-size:11px;border:1px solid #3d6a74;border-radius:5px;padding:7px 9px;white-space:nowrap}',
'.voyage-grid{display:grid;grid-template-columns:minmax(0,1fr) 275px;align-items:start}',
'.voyage-stage{position:relative;width:100%;aspect-ratio:1672/941;overflow:hidden;background:#0d2036}','.voyage-pan{position:relative;width:100%;height:100%;overflow:hidden}',
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
'.voyage-hot{position:absolute;transform:translate(-50%,-50%);border:0;background:transparent;cursor:pointer;text-decoration:none;z-index:3;touch-action:pan-x pan-y;-webkit-tap-highlight-color:transparent;padding:0}','.voyage-hot-board::after{content:"";position:absolute;inset:calc(-1 * var(--hit,14px))}',
'.voyage-hot:before{content:"";position:absolute;inset:-13px}',
'@keyframes voyagePulse{0%,100%{opacity:.78}50%{opacity:1}}',
'.hot-glow{position:absolute;left:50%;top:50%;width:380%;height:420%;transform:translate(-50%,-50%);background:radial-gradient(ellipse at center,rgba(255,246,214,.72) 0%,rgba(255,230,155,.38) 32%,rgba(255,224,140,.15) 55%,rgba(255,224,140,0) 75%);filter:blur(10px);mix-blend-mode:screen;opacity:0;transition:opacity .25s ease;pointer-events:none;z-index:-1}','@media(hover:hover){.voyage-hot:hover .hot-glow{opacity:1}.voyage-hot-board:hover .voyage-sign{filter:brightness(1.12)}}','.voyage-hot:focus .hot-glow,.voyage-hot:focus-visible .hot-glow{opacity:1}','.voyage-hot:active .hot-glow{opacity:1;transition-duration:.05s}','.voyage-hot.glow-on .hot-glow{opacity:1}',
'.voyage-hot:focus-visible{outline:3px solid #ffdf75;outline-offset:4px;border-radius:12px}',
'.voyage-hot-chengyu{left:15.7%;top:37.2%;width:calc(9.6% + (var(--hit,14px) * 2));height:calc(8.6% + (var(--hit,14px) * 2))}',
'.voyage-hot-english{left:89.8%;top:40.6%;width:calc(7.4% + (var(--hit,14px) * 2));height:calc(6.6% + (var(--hit,14px) * 2))}',
'.voyage-hot-board{left:69.3%;top:31.8%;width:auto;height:auto;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;box-shadow:none;animation:none}',
'.voyage-hot-board:before{inset:-10px}',
'.voyage-sign{position:relative;display:inline-flex;align-items:center;justify-content:center;padding:.34em .95em;background:linear-gradient(180deg,#cfa66f 0%,#b98a52 55%,#a87a45 100%);border:3px solid #6b4a2a;border-radius:7px;box-shadow:0 3px 0 #54371d,0 6px 12px rgba(20,10,0,.4),inset 0 1px 0 rgba(255,235,200,.45);color:#3d2712;font-weight:900;font-size:clamp(11px,1.2vw,16px);letter-spacing:.14em;white-space:nowrap;text-shadow:0 1px 0 rgba(255,230,190,.4)}',
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
'@media(prefers-reduced-motion:reduce){.voyage-bg,.voyage-mist,.voyage-glow,.voyage-sparkle,.voyage-shimmer,.voyage-hot,.voyage-sign{animation:none!important}.voyage-index .index-item{transition:none!important}.hot-glow{transition:none!important}}',
'.island-nav{min-width:0}',
'.island-nav .index-head{padding:17px 17px 9px;background:#14202e}',
'.island-nav .index-head small{font-size:10px;letter-spacing:.16em;color:#ffb64d;font-weight:900}',
'.island-nav .index-head h3{font-size:19px;line-height:1.35;margin:5px 0;color:#eaf6ff}',
'.island-nav .index-head p{color:#9fb6c4;font-size:11px;line-height:1.5;margin:4px 0 0}',
'.island-nav .index-scroll{padding:4px 12px 15px;display:flex;flex-direction:column;gap:2px}',
'.island-nav .index-item{display:flex;gap:12px;align-items:center;min-height:64px;padding:10px 7px;text-decoration:none;color:#e8f4f8;border-bottom:1px solid #2b3d4e;transition:background .14s;background:none;border-top:0;border-left:0;border-right:0;font:inherit;text-align:left;width:100%;cursor:pointer}',
'.island-nav .index-item:hover{background:#1f3145;border-radius:6px}',
'.island-nav .index-item strong{display:block;font-size:14px;color:inherit}',
'.island-nav .index-item .index-note{color:#8fa9b8;font-size:11px;display:block;margin-top:4px}',
'.island-nav .index-item .index-number{font-family:Georgia,serif;font-weight:bold;font-size:24px;font-style:italic;color:#37e6ff;min-width:36px;text-align:center}',
'.island-nav .index-item .index-arrow{color:#ffb64d;font-size:19px;margin-left:auto}',
'.island-nav .index-item:focus-visible{outline:3px solid #fff1b1;outline-offset:-3px}',
'.island-nav .index-foot{border-top:1px solid #2b3d4e;padding:11px 14px;margin-top:auto;font-size:11px;color:#a9c0cc;line-height:1.7}',
'/* v3.3.0 immersive map-first chrome */',
'.stage-chip{position:absolute;z-index:4;display:inline-flex;align-items:center;gap:6px;background:rgba(13,25,42,.78);border:2px solid #3d6a74;border-radius:7px;padding:6px 10px;font-size:11px;color:#d7e9f2;letter-spacing:.05em;pointer-events:none}',
'.stage-chip-title{left:10px;top:10px;color:#ffd39d;font-weight:900}',
'.stage-chip-status{right:10px;top:10px;color:#bff0f4}',
'.stage-chip-hint{left:10px;bottom:10px;color:#ffe6b8}',
'.island-nav{margin-top:12px;background:#101d2e;border:3px solid #2e4a5f;border-radius:9px;color:#e8f4f8;overflow:hidden}',
'.island-nav summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:11px 14px;font-size:13px;font-weight:900;color:#ffd39d}',
'.island-nav summary::-webkit-details-marker{display:none}',
'.island-nav summary:focus-visible{outline:3px solid #ffdf75;outline-offset:-3px}',
'.island-nav .index-scroll{padding:2px 9px 8px;display:flex;flex-direction:column;gap:2px}',
'.island-nav .index-foot{padding:9px 14px;border-top:2px solid #2e4a5f;font-size:11px;color:#9fc3cf}',
'@media(max-width:690px){.expedition-world{margin-left:-13px;margin-right:-13px}.voyage-shell{position:fixed;inset:0;z-index:30;border:0;border-radius:0;display:flex;flex-direction:column;justify-content:center;overflow:hidden;background:#0d2036;padding:calc(64px + env(safe-area-inset-top,0px)) 0 calc(88px + env(safe-area-inset-bottom,0px))}.voyage-stage{flex:none;width:auto;height:min(calc(100dvh - 165px),177.68vw);max-width:100%;aspect-ratio:941/1672;margin:0 auto;border:0}.voyage-bg{background-image:url("./1-archipelago-portrait.jpg");animation:none}.voyage-mist,.voyage-glow,.voyage-shimmer,#voyageSea{display:none}.voyage-hot-chengyu{left:26%;top:13.5%;width:38%;height:19%}.voyage-hot-english{left:66%;top:80%;width:52%;height:26%}.voyage-hot-board{left:70%;top:33%}.stage-chip-title,.stage-chip-status{display:none}.stage-chip-hint{font-size:10px;position:static;display:inline-block;margin:10px auto 0}.island-nav{display:none}}',
'/* v3.6.0 desktop fullscreen immersive map. Stage keeps the art ratio 1672:941; JS sizes it as a capped cover (total crop within the same cap) so the map fills the viewport edge to edge, falling back to an uncropped fit on extreme aspect ratios. The crop is biased toward the bottom (the top keeps about 30 percent of it) so the island buildings at the top of the art stay visible. The shell clips overflow so a programmatic scroll can never crop the art. A persistent top-left adventurer card mirrors the hero identity (name, LV, XP, coins); the 群島探索 chip moves below it. Islands entries, chips and the island index stay reachable. */',
'@media(min-width:691px){html.voyage-full .voyage-shell{position:fixed;inset:0;z-index:30;border:0;border-radius:0;box-shadow:none;display:flex;align-items:center;justify-content:center;background:#0d2036;overflow:hidden;overflow:clip}html.voyage-full .voyage-shell:before{content:"";position:absolute;inset:0;background:url("./archipelago-v5.jpg") center/cover no-repeat;filter:blur(34px) brightness(.48) saturate(1.3);transform:scale(1.15)}html.voyage-full .voyage-stage{flex:none;width:min(100vw,177.68vh);height:min(100dvh,56.28vw);max-width:none;aspect-ratio:1672/941;margin:0;border:0}html.voyage-full .voyage-bg{background-size:100% 100%;animation:none}html.voyage-full .island-nav{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:36;width:min(94vw,600px);margin-top:0;display:flex;flex-direction:column-reverse}html.voyage-full .island-nav .index-scroll{max-height:44vh;overflow:auto}html.voyage-full .stage-chip-title{top:112px}html.voyage-full .d-topbar{display:flex;position:fixed;top:12px;left:12px;z-index:36;pointer-events:none;align-items:stretch;gap:8px}html.voyage-full .d-player{pointer-events:auto;display:flex;align-items:center;gap:9px;background:rgba(16,26,48,.88);border:2px solid #3c4b7a;border-radius:12px;padding:6px 14px 6px 7px;color:#eaf2ff;box-shadow:0 3px 0 #0a1430;cursor:pointer;font:inherit}html.voyage-full .d-player:hover{background:rgba(24,44,70,.95)}html.voyage-full .d-player:focus-visible,html.voyage-full .d-coins:focus-visible{outline:3px solid #ffdf75;outline-offset:2px}html.voyage-full .d-face{width:40px;height:40px;border-radius:9px;overflow:hidden;background:#fff7e7;display:flex;align-items:center;justify-content:center;flex:none;color:#3c4b7a}html.voyage-full .d-face svg{width:26px;height:26px}html.voyage-full .d-face .profile-portrait{width:100%;height:100%}html.voyage-full .d-pinfo{display:flex;flex-direction:column;gap:3px;min-width:148px}html.voyage-full .d-pinfo strong{font-size:13px;color:#fff;line-height:1.2}html.voyage-full .d-lvline{display:flex;align-items:center;gap:7px;font-size:10.5px;color:#9fb8e8;white-space:nowrap}html.voyage-full .d-xpbar{flex:1;min-width:70px;height:7px;border-radius:4px;background:#243356;overflow:hidden}html.voyage-full .d-xpbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7fd0ff,#3f8fe0);border-radius:4px}html.voyage-full .d-xptext{font-size:10px;color:#7f97c4;min-height:1em}html.voyage-full .d-coins{pointer-events:auto;display:flex;align-items:center;gap:5px;background:rgba(16,26,48,.88);border:2px solid #3c4b7a;border-radius:12px;padding:6px 12px;color:#ffd873;font-weight:900;font-size:13px;box-shadow:0 3px 0 #0a1430;cursor:pointer;font:inherit}html.voyage-full .d-coins:hover{background:rgba(24,44,70,.95)}html.voyage-full .d-coins svg{width:17px;height:17px}html.voyage-full .d-coins span{font-size:10px;color:#d9b45a;font-weight:700}html.voyage-full .d-pinfo{max-width:220px}html.voyage-full .d-pinfo strong{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}',
'.voyage-fit-btn,.voyage-fs-btn{position:absolute;right:10px;z-index:5;display:none;align-items:center;gap:5px;background:rgba(13,25,42,.78);border:2px solid #3d6a74;border-radius:7px;padding:7px 11px;font:inherit;font-size:11px;font-weight:700;color:#ffe6b8;cursor:pointer;letter-spacing:.06em}',
'.voyage-fit-btn{top:46px}.voyage-fs-btn{top:84px}',
'@media(min-width:691px){.voyage-fit-btn{display:inline-flex}html.voyage-full .voyage-fs-btn{display:inline-flex}}',
'.voyage-fit-btn:hover,.voyage-fs-btn:hover{background:rgba(24,44,70,.95)}',
'.voyage-fit-btn:focus-visible,.voyage-fs-btn:focus-visible{outline:3px solid #ffdf75;outline-offset:2px}',
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
 '<div class="voyage-shell">'+
 '<div class="voyage-stage" role="img" aria-label="夕陽下的立體方塊群島:左邊是成語島的東方書院,右邊是英文島的魔法高塔,中央主島有孩子們的遊樂場、小小的 TRQN 字母地標與英雄榜燈塔">'+
 '<div class="voyage-pan">'+
 '<div class="voyage-bg"></div>'+
 '<div class="voyage-shimmer"></div>'+
 '<div class="voyage-mist vm1"></div><div class="voyage-mist vm2"></div><div class="voyage-mist vm3"></div><div class="voyage-mist vm4"></div>'+
 '<div class="voyage-glow vg1"></div><div class="voyage-glow vg2"></div><div class="voyage-glow vg3"></div><div class="voyage-glow vg4"></div><div class="voyage-glow vg5"></div><div class="voyage-glow vg6"></div><div class="voyage-glow vg7"></div>'+
 '<div id="voyageSea"></div>'+
 '<a class="voyage-hot voyage-hot-chengyu" id="islandChengyu" data-world="chengyu" href="'+domainFor('chengyu')+playerHash()+'" aria-label="前往成語島"><span class="hot-glow" aria-hidden="true"></span></a>'+
 '<a class="voyage-hot voyage-hot-english" id="islandEnglish" data-world="english" href="'+domainFor('english')+playerHash()+'" aria-label="前往英文島"><span class="hot-glow" aria-hidden="true"></span></a>'+
 '<button class="voyage-hot voyage-hot-board" id="heroBoardBtn" type="button" aria-label="打開英雄榜"><span class="hot-glow" aria-hidden="true"></span><span class="voyage-sign">英雄榜</span></button>'+
 '</div>'+
 '</div>'+
 '<span class="stage-chip stage-chip-title">'+IC.island+'群島探索</span>'+
 '<span class="stage-chip stage-chip-status">'+IC.sail+'已開放 2 島</span>'+
 '<span class="stage-chip stage-chip-hint">'+IC.point+'點選島嶼即可前往</span>'+
 '<button class="voyage-fit-btn" id="voyageFitBtn" type="button" aria-pressed="true" title="切換地圖滿版或原始大小">還原</button>'+
 '<button class="voyage-fs-btn" id="voyageFsBtn" type="button" aria-pressed="false" title="瀏覽器全螢幕">全螢幕</button>'+
 '</div>'+
 '<details class="island-nav"><summary>'+IC.compass+'島嶼目錄 · 成語島 / 英文島 / 英雄榜</summary>'+
 '<div class="index-scroll">'+
 '<a class="index-item" data-world="chengyu" href="'+domainFor('chengyu')+playerHash()+'"><span class="index-number">01</span><span><strong>成語島</strong><span class="index-note">典故森林・成語解謎</span></span><span class="index-arrow">↗</span></a>'+
 '<a class="index-item" data-world="english" href="'+domainFor('english')+playerHash()+'"><span class="index-number">02</span><span><strong>英文島</strong><span class="index-note">魔法高塔・拼字試煉</span></span><span class="index-arrow">↗</span></a>'+
 '<button class="index-item" id="heroBoardBtn2" type="button"><span class="index-number">'+IC.trophy+'</span><span><strong>英雄榜</strong><span class="index-note">燈塔英雄榜 · 兩島分開排名</span></span><span class="index-arrow">↗</span></button>'+
 '</div>'+
 '<div class="index-foot">★ 各島的學習成績與 XP 由各島分別記錄。<br>'+IC.castle+'正式升級仍須通過晉級試煉。</div>'+
 '</details>'+
 '<div class="hb-overlay" id="heroBoardOverlay" hidden><div class="hb-card" role="dialog" aria-modal="true" aria-label="英雄榜" id="heroBoardCard"></div></div>'+
 '</section>';

/* v3.6.0 desktop fullscreen: default immersive viewport map, one-click browser fullscreen, restorable boxed layout. Mobile is untouched. The stage is sized in JS as a capped cover so the map really fills the viewport, the cover crop is biased toward the bottom so the top buildings stay in frame, and the shell is clipped + scroll-reset so a stray programmatic scroll can never crop the art. */
(function(){
 const shell=document.querySelector('.voyage-shell');if(!shell)return;
 const fitBtn=document.getElementById('voyageFitBtn'),fsBtn=document.getElementById('voyageFsBtn');
 if(!fitBtn||!fsBtn)return;
 const stage=shell.querySelector('.voyage-stage');
 const KEY='voyage-desktop-layout';
 const mq=window.matchMedia('(min-width:691px)');
 const ART=1672/941,MAXCROP=0.09;
 function stored(){try{return localStorage.getItem(KEY)}catch(e){return null}}
 function save(v){try{localStorage.setItem(KEY,v)}catch(e){}}
 function fitStage(){
  if(!stage)return;
  if(!document.documentElement.classList.contains('voyage-full')||!mq.matches){stage.style.width='';stage.style.height='';stage.style.transform='';return}
  const vw=shell.clientWidth,vh=shell.clientHeight;if(!vw||!vh)return;
  let w=vw,h=w/ART;if(h<vh){h=vh;w=h*ART}
  const cx=(w-vw)/2/w,cy=(h-vh)/2/h;
  if(cx>MAXCROP||cy>MAXCROP){stage.style.width='';stage.style.height='';stage.style.transform='';return}
  stage.style.width=w.toFixed(1)+'px';stage.style.height=h.toFixed(1)+'px';
  const biasY=Math.max(0,(h-vh)*0.2);
  stage.style.transform=biasY>0.5?'translateY('+biasY.toFixed(1)+'px)':'';
 }
 function resetScroll(){shell.scrollLeft=0;shell.scrollTop=0}
 function apply(){
  const full=mq.matches&&stored()!=='boxed';
  document.documentElement.classList.toggle('voyage-full',full);
  fitBtn.textContent=full?'⤡ 還原':'⛶ 滿版';
  fitBtn.setAttribute('aria-pressed',full?'true':'false');
  fsBtn.hidden=!full;
  if(!full&&document.fullscreenElement)document.exitFullscreen().catch(()=>{});
  resetScroll();
  fitStage();
 }
 fitBtn.addEventListener('click',()=>{save(document.documentElement.classList.contains('voyage-full')?'boxed':'full');apply()});
 function syncFs(){const on=!!document.fullscreenElement;fsBtn.textContent=on?'✕ 離開全螢幕':'⛶ 全螢幕';fsBtn.setAttribute('aria-pressed',on?'true':'false')}
 fsBtn.addEventListener('click',()=>{
  if(document.fullscreenElement){document.exitFullscreen().catch(()=>{});return}
  const p=document.documentElement.requestFullscreen?document.documentElement.requestFullscreen():null;
  if(p&&p.catch)p.catch(()=>{fsBtn.textContent='瀏覽器不支援全螢幕'});
 });
 document.addEventListener('fullscreenchange',()=>{syncFs();resetScroll();requestAnimationFrame(fitStage)});
 window.addEventListener('resize',()=>{if(document.documentElement.classList.contains('voyage-full'))fitStage()});
 if(mq.addEventListener)mq.addEventListener('change',apply);else if(mq.addListener)mq.addListener(apply);
 apply();syncFs();
})();

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

/* Family-only lighthouse board. User-approved separate cumulative island XP and earned coins. */
(function(){
 const API='https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/learning-adventure-cloud';
 const overlay=document.getElementById('heroBoardOverlay'),card=document.getElementById('heroBoardCard');
 if(!overlay||!card)return;
 const modes=[{key:'vocabXP',label:'英文',unit:'XP'},{key:'chengyuXP',label:'成語',unit:'XP'},{key:'earnedCoins',label:'累積獲得金幣',unit:'金幣'}];
 let generation=0,rows=null,active=0,opener=null;
 const extra=document.createElement('style');extra.textContent='.hb-tabs{display:flex;gap:6px;margin:14px 0}.hb-tabs button{flex:1;min-height:44px;border:1px solid #c7b57d;border-radius:9px;background:#eee3c5;color:#4b5270;font-size:13px;font-weight:700;padding:8px 6px;cursor:pointer}.hb-tabs button[aria-selected="true"]{background:#25365e;color:#fff2cb;border-color:#25365e}.hb-board td:first-child{overflow-wrap:anywhere;white-space:normal}.hb-board th:nth-child(2),.hb-board td:nth-child(2){white-space:nowrap}.hb-board tr.hb-tied .hb-rank{color:#8b6b28}.hb-card:focus{outline:none}.hb-card .hb-sub{line-height:1.6}.hb-note{line-height:1.7}.hb-board caption{text-align:left;margin:0 0 10px;font-weight:700;color:#314468;font-size:14px}';document.head.appendChild(extra);
 function token(){try{const t=new URLSearchParams(location.hash.slice(1)).get('f')||'';return /^[A-Za-z0-9_-]{40,128}$/.test(t)?t:''}catch(e){return ''}}
 function head(){return '<h2>'+IC.trophy+'英雄榜</h2><div class="hb-sub">家庭燈塔 · 各自累積，不混合比較</div>'}
 function closeButton(){return '<button class="hb-close" type="button" id="hbClose">關閉</button>'}
 function wireClose(){document.getElementById('hbClose').onclick=hide}
 function hide(){generation++;overlay.hidden=true;document.body.style.overflow='';if(opener)opener.focus()}
 function state(msg){card.innerHTML=head()+'<div class="hb-state" role="status">'+msg+'</div>'+closeButton();wireClose();document.getElementById('hbClose').focus()}
 function render(focusTab=false){
  const mode=modes[active],list=rows.slice().sort((a,b)=>b[mode.key]-a[mode.key]||a.order-b.order);
  let html=head()+'<div class="hb-tabs" role="tablist" aria-label="排行榜類別">';
  modes.forEach((m,i)=>html+='<button type="button" role="tab" id="hbTab'+i+'" aria-controls="hbPanel" aria-selected="'+(active===i)+'" tabindex="'+(active===i?0:-1)+'" data-hb-tab="'+i+'">'+esc(m.label)+'</button>');
  html+='</div><div class="hb-board" id="hbPanel" role="tabpanel" aria-labelledby="hbTab'+active+'"><table><caption>'+esc(mode.label)+(active===2?'':'島 · 累積 XP')+'</caption><thead><tr><th scope="col">勇者</th><th scope="col">'+esc(mode.unit)+'</th></tr></thead><tbody>';
  let last=null,rank=0;
  list.forEach((r,i)=>{const value=r[mode.key];if(value!==last)rank=i+1;last=value;html+='<tr><td><span class="hb-rank">'+rank+'</span><span class="hb-ava" style="background:#526e99">'+esc(Array.from(r.name)[0]||'?')+'</span>'+esc(r.name)+'</td><td><strong>'+value.toLocaleString('zh-TW')+'</strong></td></tr>'});
  if(!list.length)html+='<tr><td colspan="2" class="hb-state">還沒有勇者完成角色連結。選好玩家後再來看看。</td></tr>';
  html+='</tbody></table></div><p class="hb-note">'+(active===2?'只計登入、通關與每日任務實際獲得的金幣。兌換不扣排名，退還的金幣也不會重複加分。':'依這座島的累積 XP 排名，不和另一座島相加。')+'同分並列；只顯示這個家庭。每次打開燈塔會重新讀取。</p>'+closeButton();
  card.innerHTML=html;wireClose();
  card.querySelectorAll('[data-hb-tab]').forEach(btn=>{btn.onclick=()=>{active=Number(btn.dataset.hbTab);render(true)};btn.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();active=e.key==='Home'?0:e.key==='End'?2:(active+(e.key==='ArrowRight'?1:2))%3;render(true)}});
  if(focusTab)document.getElementById('hbTab'+active).focus();
 }
 async function show(e){
  opener=e?.currentTarget||document.activeElement;const current=++generation;rows=null;active=0;overlay.hidden=false;document.body.style.overflow='hidden';
  const tk=token();if(!tk){state('請先從自己的家庭入口進入並選擇玩家。<br>這裡不提供公開或跨家庭的榜單。');return}
  state(IC.cloud+'正在讀取家庭排行榜…');
  try{const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({action:'leaderboard',world:'chengyu',token:tk})});const data=await res.json();
   if(current!==generation||overlay.hidden)return;
   if(!res.ok||data.ok!==true||!Array.isArray(data.players))throw Error('unavailable');
   rows=data.players.map((r,i)=>{if(typeof r.name!=='string'||modes.some(m=>!Number.isSafeInteger(r[m.key])||r[m.key]<0))throw Error('incomplete');return {...r,order:i}});render(true);
  }catch(e){if(current!==generation||overlay.hidden)return;state('暫時讀不到完整的家庭榜單。<br>沒有把缺少的資料當成 0 分，請稍後再打開燈塔。')}
 }
 document.addEventListener('keydown',e=>{if(overlay.hidden||e.key!=='Tab')return;const all=[...card.querySelectorAll('button:not([tabindex="-1"])')],first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
 /* mobile: whole archipelago visible on open (no pan); hint mentions tapping */
(function(){
 const stage=document.querySelector('.voyage-stage'),pan=document.querySelector('.voyage-pan');
 if(!stage||!pan)return;
 const mShell=document.querySelector('.voyage-shell'),mNav=document.querySelector('.island-nav');
 if(mShell&&mNav&&window.innerWidth<=690){mShell.appendChild(mNav);mNav.open=true}
 let centered=false;
 function centerPan(){
  if(centered||window.innerWidth>690)return;
  const max=pan.offsetWidth-stage.clientWidth;
  if(max>0){
   const hb=document.getElementById('heroBoardBtn');
   let target=max/2;
   if(hb){const hbC=hb.offsetLeft+hb.offsetWidth/2;target=Math.min(Math.max(Math.round(hbC-stage.clientWidth*0.62),0),max)}
   stage.scrollLeft=target;centered=true
  }
  const hint=document.querySelector('.stage-chip-hint');
  if(hint)hint.lastChild.textContent='點選島嶼即可前往';
 }
 let userScrolled=false;
 stage.addEventListener('pointerdown',()=>{userScrolled=true;centered=true},{passive:true});
 stage.addEventListener('touchstart',()=>{userScrolled=true;centered=true},{passive:true});
 if(document.readyState==='complete')centerPan();else window.addEventListener('load',()=>requestAnimationFrame(centerPan));
 [300,900,1800,3500].forEach(t=>setTimeout(()=>{if(!userScrolled){centered=false;centerPan()}},t));
})();
/* touch/press glow feedback: class-driven so it works on touch without fake hover */
 document.querySelectorAll('.voyage-hot').forEach(function(h){
  const on=function(){h.classList.add('glow-on')};
  const off=function(){h.classList.remove('glow-on')};
  h.addEventListener('pointerdown',on);
  h.addEventListener('pointerup',off);
  h.addEventListener('pointercancel',off);
  h.addEventListener('pointerleave',off);
 });
 const b1=document.getElementById('heroBoardBtn');
 const b2=document.getElementById('heroBoardBtn2');
 if(b1)b1.addEventListener('click',show);
 if(b2)b2.addEventListener('click',show);
 overlay.addEventListener('click',e=>{if(e.target===overlay)hide()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)hide()});
})();
})();

