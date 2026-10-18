"use strict";
/* No network, no external accounts, no actual task execution: isolated P3 visual prototype. */
const ROOT=document.getElementById("app");
const pan=document.getElementById("scene-pan");
const world=document.getElementById("world");
const shell=document.getElementById("world-shell");
const modal=document.getElementById("panel");
const modalTitle=document.getElementById("dialog-title");
const modalContent=document.getElementById("dialog-content");
const walletValue=document.getElementById("wallet-value");
const claim=document.getElementById("claim-reward");
const toast=document.getElementById("toast");
const safeRead=()=>{try{const j=JSON.parse(localStorage.getItem("zhuge-p3-lab-v1")||"{}");const cat=typeof j.cat==="string"?j.cat:"小黑";const legacy=cat==="橘子"?"orangecat":cat==="花花"?"calico":"blackcat";return {coins:Number.isSafeInteger(j.coins)&&j.coins>=0&&j.coins<=100000000?j.coins:0,claimed:!!j.claimed,owned:Array.isArray(j.owned)?[...new Set(j.owned.filter(x=>typeof x==="string"))]:[],ownedPets:[...new Set(["blackcat",...(Array.isArray(j.ownedPets)?j.ownedPets:[]),legacy])],cat};}catch{return {coins:0,claimed:false,owned:[],ownedPets:["blackcat"],cat:"小黑"};}};
const state=safeRead();
const write=()=>{try{localStorage.setItem("zhuge-p3-lab-v1",JSON.stringify(state));}catch{}};
const money=(v)=>new Intl.NumberFormat("zh-TW").format(v);
let toastTimer=null;
function tell(msg){toast.textContent=msg;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),2600);}
function refresh(){walletValue.textContent=money(state.coins);claim.disabled=state.claimed;claim.textContent=state.claimed?"✓ 已領取":"領取獎勵";document.querySelector(".cat-name").textContent="🐾 "+state.cat;const petNode=document.getElementById("cat");petNode.classList.toggle("pet-orange",state.cat==="橘子");petNode.classList.toggle("pet-calico",state.cat==="花花");const decor=document.getElementById("decor-sprite");const furniture=state.owned.filter(x=>["plant","sofa","lamp","console","rug","coffee"].includes(x));decor.style.display=furniture.length?"block":"none";decor.textContent=furniture.includes("plant")?"🪴":furniture.includes("lamp")?"💡":furniture.includes("coffee")?"☕":"🪴";}
claim.addEventListener("click",()=>{if(state.claimed)return;state.claimed=true;state.coins+=500;write();refresh();tell("🏆 P2 正式上線獎勵 +500 金幣（本機測試版）");});
function e(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function dialog(title){modalTitle.textContent=title;modalContent.replaceChildren();if(!modal.open)modal.showModal();}
document.getElementById("panel-close").addEventListener("click",()=>modal.close());
modal.addEventListener("click",ev=>{if(ev.target===modal)modal.close();});
const products=[
{id:"plant",label:"蕨類盆栽",icon:"🪴",price:90,desc:"讓辦公室增加一點綠意"},
{id:"sofa",label:"復古沙發",icon:"🛋️",price:250,desc:"舒適休息區裝飾"},
{id:"lamp",label:"黃銅桌燈",icon:"💡",price:110,desc:"溫暖像素照明"},
{id:"console",label:"工作電腦",icon:"🖥️",price:230,desc:"新增桌面裝飾"},
{id:"rug",label:"紫色地毯",icon:"🟪",price:130,desc:"點綴 Lounge"},
{id:"coffee",label:"咖啡機",icon:"☕",price:180,desc:"每日一杯活力"}];
const pets=[{id:"blackcat",label:"小黑",icon:"🐈‍⬛",price:0,desc:"初始伙伴 · 免費陪伴"},{id:"orangecat",label:"橘子",icon:"🐈",price:350,desc:"溫暖親人的橘貓"},{id:"calico",label:"花花",icon:"🐱",price:350,desc:"偶爾出現在休息區"}];
function dailySelection(){const iso=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const seed=Array.from(iso).reduce((v,c)=>v+c.charCodeAt(0),0);const jump=seed%products.length;return [0,2,4].map(x=>products[(jump+x)%products.length]);}
function rowFor(p,pet=false){const row=e("div","product");row.append(e("span","emoji",p.icon));const details=e("div","details");details.append(e("strong","",p.label),e("small","",p.desc));row.append(details);const owned=pet?state.ownedPets.includes(p.id):state.owned.includes(p.id);const active=pet&&state.cat===p.label;const btn=e("button","",active?"✓ 陪伴中":owned?(pet?"切換寵物":"✓ 已購買"):"✦ "+money(p.price));btn.disabled=active||(!pet&&owned);btn.addEventListener("click",()=>{if(!owned&&state.coins<p.price){tell("測試金幣不足，先領取 P2 上線獎勵");return;}if(!owned){state.coins-=p.price;if(pet)state.ownedPets.push(p.id);else state.owned.push(p.id);}if(pet)state.cat=p.label;write();refresh();tell((owned?"🐾 已切換：":"🎉 已獲得：")+p.label);showShop(pet);});row.append(btn);return row;}
function showShop(pet=false){dialog(pet?"🐾 寵物商店":"🏪 每日商店");modalContent.append(e("div","status-line","✦ 測試錢包："+money(state.coins)+" 金幣 · 不涉及真實金錢"));const desc=e("p","",pet?"貓咪會在辦公室自由走動。小黑為免費初始寵物；這裡不提供付費抽卡。":"每日以台灣日期輪換 3 件商品，購買狀態只儲存在這台裝置的瀏覽器。");modalContent.append(desc);for(const p of pet?pets:dailySelection())modalContent.append(rowFor(p,pet));}
function showInfo(){dialog("ℹ️ P3 獨立測試區");const lines=["本頁是尚未發布的 P3 互動原型，正式首頁 0.9.0-alpha.9.76 不受影響。","人物的走動、喝咖啡、開會是展示動畫，不代表 Codex、Gem 或 PM 真的正在執行任務。","唯一顯示的實績里程碑為 P2 正式上線（GitHub PR #63，SHA a9db9b2f），獎勵是本機測試金幣，並未寫入 TaskFlow 或真實帳戶。","每日商店與寵物收藏只存在這台裝置的 localStorage，不收費、不傳送資料。","手機直式可以橫向拖曳辦公室；手機橫式、桌機橫式、窄視窗會自動調整顯示比例。","日後替換正式首頁必須由 PM 另行明確核准，本測試分支不能自行部署至 main。"];for(const l of lines)modalContent.append(e("p","",l));const link=e("a","","查看已正式上線的 P2");link.href="https://qqweasdzxc.github.io/zhuge-ai-os/";link.target="_blank";link.rel="noopener noreferrer";link.style.color="#85d8ff";modalContent.append(link);}
function showRoster(){dialog("👥 三位 AI 辦公室角色");modalContent.append(e("div","status-line","目前僅有角色展示與生活動畫；非真實 CLI / Co / Gem 工作紀錄。"));for(const r of [{name:"PM",icon:"👨🏻‍💼",desc:"需求決策、驗收與正式發布核准"},{name:"Co",icon:"🧑🏻‍💻",desc:"首席工程師 · Codex 開發、修復與 QA"},{name:"Gem",icon:"👩🏻‍💻",desc:"第二工程師 · 獨立任務、審查與交接"}]){const row=e("div","product");row.append(e("span","emoji",r.icon));const b=e("div","details");b.append(e("strong","",r.name),e("small","",r.desc));row.append(b);modalContent.append(row);}}
function showCat(){dialog("🐈‍⬛ 寵物夥伴");modalContent.append(e("div","status-line","目前夥伴："+state.cat));modalContent.append(e("p","","貓咪會在辦公室散步、休息。牠的行為是生活動畫，不是員工工作證據。"));const btn=e("button","action-pill","前往寵物商店");btn.addEventListener("click",()=>showShop(true));modalContent.append(btn);}
function zone(name){dialog("🏢 "+name);modalContent.append(e("p","","這是 P3 測試版的辦公室分區。角色可以在這個空間自由移動，將來真實工作與會議動作會以 TaskFlow / GitHub 已驗證事件驅動。"));modalContent.append(e("div","status-line","目前：展示模式，未連線真實任務派工"));}
for(const tag of document.querySelectorAll("[data-zone]"))tag.addEventListener("click",()=>zone(tag.dataset.zone));
for(const [id,fn] of [["daily-shop",()=>showShop(false)],["pet-shop",()=>showShop(true)],["help-btn",showInfo],["roster-btn",showRoster],["nav-office",()=>{if(modal.open)modal.close();tell("目前是辦公室主畫面");}],["nav-roles",showRoster],["nav-shop",()=>showShop(false)],["nav-pets",showCat],["nav-info",showInfo],["cat",showCat]])document.getElementById(id).addEventListener("click",fn);
for(const person of document.querySelectorAll(".agent")){const onPerson=()=>{showRoster();tell(person.dataset.person+" · 展示角色")};person.addEventListener("click",onPerson);person.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();onPerson();}});}
let userScale=null;
function fitScale(){const w=Math.max(1,pan.clientWidth),h=Math.max(1,pan.clientHeight);const portrait=w<650&&innerHeight>innerWidth;const fit=Math.min(w/1100,h/650);return portrait?Math.max(.82,Math.min(1.04,h/620)):(w>=1050?Math.max(.86,Math.min(1.23,w/1100)):Math.max(.58,Math.min(1.6,fit)));}
function setScale(value,keepCenter=true){const w=pan.clientWidth,h=pan.clientHeight;if(!w||!h)return;const previous=Number(world.dataset.scale||0),cx=keepCenter&&previous?(pan.scrollLeft+w/2)/previous:550,cy=keepCenter&&previous?(pan.scrollTop+h/2)/previous:325,scale=Math.max(.45,Math.min(2.15,value));world.dataset.scale=scale.toFixed(3);world.style.transform="scale("+scale+")";shell.style.width=Math.ceil(1100*scale)+"px";shell.style.height=Math.ceil(650*scale)+"px";pan.scrollLeft=Math.max(0,cx*scale-w/2);pan.scrollTop=Math.max(0,cy*scale-h/2);document.getElementById("scene-hint").hidden=shell.clientWidth<=w+4;}
function resize(){setScale(userScale??fitScale());}
new ResizeObserver(resize).observe(pan);
const immersiveButton=document.getElementById("immersive-toggle");
immersiveButton.addEventListener("click",()=>{
 const enabled=ROOT.classList.toggle("is-immersive");
 immersiveButton.textContent=enabled?"⛶ 返回一般":"⛶ 全景";
 immersiveButton.setAttribute("aria-pressed",String(enabled));
 userScale=null;
 requestAnimationFrame(()=>{resize();tell(enabled?"🏙 已開啟大畫面辦公室":"已返回一般版型");});
});
const roomFocus={"休息區":[188,198],"工作座位":[565,350],"會議室":[929,212]};
for(const button of document.querySelectorAll("[data-focus-room]")){
 button.addEventListener("click",()=>{
  const xy=roomFocus[button.dataset.focusRoom]; if(!xy)return;
  const scale=Number(world.dataset.scale||fitScale());
  pan.scrollTo({left:Math.max(0,xy[0]*scale-pan.clientWidth/2),top:Math.max(0,xy[1]*scale-pan.clientHeight/2),behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  tell("📍 "+button.dataset.focusRoom+" · 展示場景");
 });
}
window.addEventListener("orientationchange",()=>setTimeout(()=>{userScale=null;resize();},90));
for(const [id,delta] of [["zoom-in",.16],["zoom-out",-.16]])document.getElementById(id).addEventListener("click",()=>{userScale=Math.max(.45,Math.min(2.15,Number(world.dataset.scale||fitScale())+delta));setScale(userScale);});
document.getElementById("zoom-reset").addEventListener("click",()=>{userScale=null;setScale(fitScale(),false);tell("已恢復適合比例");});
pan.addEventListener("keydown",ev=>{if(ev.target!==pan)return;if(ev.key==="+"||ev.key==="="){document.getElementById("zoom-in").click();ev.preventDefault();}if(ev.key==="-"){document.getElementById("zoom-out").click();ev.preventDefault();}});
let pinchDistance=0,pinchScale=0;
pan.addEventListener("touchstart",ev=>{if(ev.touches.length===2){pinchDistance=Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX,ev.touches[0].clientY-ev.touches[1].clientY);pinchScale=Number(world.dataset.scale||fitScale());}},{passive:true});
pan.addEventListener("touchmove",ev=>{if(ev.touches.length===2&&pinchDistance){const dist=Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX,ev.touches[0].clientY-ev.touches[1].clientY);userScale=Math.max(.45,Math.min(2.15,pinchScale*dist/pinchDistance));setScale(userScale);ev.preventDefault();}},{passive:false});
pan.addEventListener("touchend",ev=>{if(ev.touches.length<2)pinchDistance=0;},{passive:true});
const movement=window.matchMedia("(prefers-reduced-motion: reduce)");
let paused=movement.matches,last=0;
document.getElementById("motion-toggle").textContent=paused?"▶ 播放動畫":"⏸ 暫停動畫";
document.getElementById("motion-toggle").addEventListener("click",()=>{paused=!paused;document.getElementById("motion-toggle").textContent=paused?"▶ 播放動畫":"⏸ 暫停動畫";document.getElementById("scene-state").textContent=paused?"動畫已暫停 · 測試模式":"3 位角色 · 展示動畫";});
/* Showroom-only waypoints, never presented as real Codex/Gem/PM tasks. */
const walkers=[{el:document.getElementById("agent-pm"),route:[[560,328],[732,317],[841,275],[732,317]],time:26000},
{el:document.getElementById("agent-co"),route:[[475,380],[450,341],[413,329],[450,341],[475,380],[581,365]],time:23000},
{el:document.getElementById("agent-gem"),route:[[658,370],[745,393],[792,347],[846,312],[743,362]],time:28000},
{el:document.getElementById("cat"),route:[[355,276],[317,281],[292,223],[372,197],[476,191],[439,269]],time:31000}];
let elapsed=0;
function animate(t){if(last&&!paused)elapsed+=Math.min(70,t-last);last=t;for(let k=0;k<walkers.length;k++){const a=walkers[k],part=(elapsed/a.time+k*.37)%1*a.route.length,i=Math.floor(part),f=part-i,s=f*f*(3-2*f),from=a.route[i],to=a.route[(i+1)%a.route.length];a.el.style.left=Math.round(from[0]+(to[0]-from[0])*s)+"px";a.el.style.top=Math.round(from[1]+(to[1]-from[1])*s)+"px";if(k<3){const working=(k===1&&(i===0||i===3)||k===2&&(i===0||i===4))&&f>.7;const meeting=(k===0&&i===2||k===2&&i===3)&&f>.72;const resting=k===0&&i===0&&f>.72;a.el.classList.toggle("is-working",!paused&&working);a.el.classList.toggle("is-meeting",!paused&&meeting);a.el.classList.toggle("is-resting",!paused&&resting);a.el.classList.toggle("is-walking",!paused&&!working&&!meeting&&!resting);const cue=a.el.querySelector(".activity-pip");if(cue)cue.textContent=working?"⌨️":meeting?"💬":resting?"☕":"";}}requestAnimationFrame(animate);}requestAnimationFrame(animate);
refresh();
document.getElementById("daily-summary").textContent="今日精選："+dailySelection().map(p=>p.label).slice(0,2).join("、");
