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
const safeRead=()=>{try{const j=JSON.parse(localStorage.getItem("zhuge-p3-lab-v1")||"{}");return {coins:Number.isFinite(j.coins)&&j.coins>=0?j.coins:0,claimed:!!j.claimed,owned:Array.isArray(j.owned)?j.owned.filter(x=>typeof x==="string"):[],cat:j.cat||"小黑"};}catch{return {coins:0,claimed:false,owned:[],cat:"小黑"};}};
const state=safeRead();
const write=()=>{try{localStorage.setItem("zhuge-p3-lab-v1",JSON.stringify(state));}catch{}};
const money=(v)=>new Intl.NumberFormat("zh-TW").format(v);
let toastTimer=null;
function tell(msg){toast.textContent=msg;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),2600);}
function refresh(){walletValue.textContent=money(state.coins);claim.disabled=state.claimed;claim.textContent=state.claimed?"✓ 已領取":"領取獎勵";document.querySelector(".cat-name").textContent="🐾 "+state.cat;const decor=document.getElementById("decor-sprite");const furniture=state.owned.filter(x=>["plant","sofa","lamp","console","rug","coffee"].includes(x));decor.style.display=furniture.length?"block":"none";decor.textContent=furniture.includes("plant")?"🪴":furniture.includes("lamp")?"💡":furniture.includes("coffee")?"☕":"🪴";}
claim.addEventListener("click",()=>{if(state.claimed)return;state.claimed=true;state.coins+=500;write();refresh();tell("🏆 P2 正式上線獎勵 +500 金幣（本機測試版）");});
function e(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function dialog(title){modalTitle.textContent=title;modalContent.replaceChildren();modal.showModal();}
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
function rowFor(p,pet=false){const row=e("div","product");row.append(e("span","emoji",p.icon));const details=e("div","details");details.append(e("strong","",p.label),e("small","",p.desc));row.append(details);const owned=pet?state.cat===p.label:(state.owned.includes(p.id));const btn=e("button","",owned?"使用中／已購":"✦ "+money(p.price));btn.disabled=owned;btn.addEventListener("click",()=>{if(state.coins<p.price){tell("測試金幣不足，先領取 P2 上線獎勵");return;}state.coins-=p.price;if(pet){state.cat=p.label;}else{state.owned.push(p.id);}write();refresh();tell("🎉 已獲得："+p.label);showShop(pet);});row.append(btn);return row;}
function showShop(pet=false){dialog(pet?"🐾 寵物商店":"🏪 每日商店");modalContent.append(e("div","status-line","✦ 測試錢包："+money(state.coins)+" 金幣 · 不涉及真實金錢"));const desc=e("p","",pet?"貓咪會在辦公室自由走動。小黑為免費初始寵物；這裡不提供付費抽卡。":"每日以台灣日期輪換 3 件商品，購買狀態只儲存在這台裝置的瀏覽器。");modalContent.append(desc);for(const p of pet?pets:dailySelection())modalContent.append(rowFor(p,pet));}
function showInfo(){dialog("ℹ️ P3 獨立測試區");const lines=["本頁是尚未發布的 P3 互動原型，正式首頁 0.9.0-alpha.9.76 不受影響。","人物的走動、喝咖啡、開會是展示動畫，不代表 Codex、Gem 或 PM 真的正在執行任務。","唯一顯示的實績里程碑為 P2 正式上線（GitHub PR #63，SHA a9db9b2f），獎勵是本機測試金幣，並未寫入 TaskFlow 或真實帳戶。","每日商店與寵物收藏只存在這台裝置的 localStorage，不收費、不傳送資料。","手機直式可以橫向拖曳辦公室；手機橫式、桌機橫式、窄視窗會自動調整顯示比例。","日後替換正式首頁必須由 PM 另行明確核准，本測試分支不能自行部署至 main。"];for(const l of lines)modalContent.append(e("p","",l));const link=e("a","","查看已正式上線的 P2");link.href="https://qqweasdzxc.github.io/zhuge-ai-os/";link.target="_blank";link.rel="noopener noreferrer";link.style.color="#85d8ff";modalContent.append(link);}
function showRoster(){dialog("👥 三位 AI 辦公室角色");modalContent.append(e("div","status-line","目前僅有角色展示與生活動畫；非真實 CLI / Co / Gem 工作紀錄。"));for(const r of [{name:"PM",icon:"👨🏻‍💼",desc:"需求決策、驗收與正式發布核准"},{name:"Co",icon:"🧑🏻‍💻",desc:"首席工程師 · Codex 開發、修復與 QA"},{name:"Gem",icon:"👩🏻‍💻",desc:"第二工程師 · 獨立任務、審查與交接"}]){const row=e("div","product");row.append(e("span","emoji",r.icon));const b=e("div","details");b.append(e("strong","",r.name),e("small","",r.desc));row.append(b);modalContent.append(row);}}
function showCat(){dialog("🐈‍⬛ 寵物夥伴");modalContent.append(e("div","status-line","目前夥伴："+state.cat));modalContent.append(e("p","","貓咪會在辦公室散步、休息。牠的行為是生活動畫，不是員工工作證據。"));const btn=e("button","action-pill","前往寵物商店");btn.addEventListener("click",()=>showShop(true));modalContent.append(btn);}
function zone(name){dialog("🏢 "+name);modalContent.append(e("p","","這是 P3 測試版的辦公室分區。角色可以在這個空間自由移動，將來真實工作與會議動作會以 TaskFlow / GitHub 已驗證事件驅動。"));modalContent.append(e("div","status-line","目前：展示模式，未連線真實任務派工"));}
for(const tag of document.querySelectorAll("[data-zone]"))tag.addEventListener("click",()=>zone(tag.dataset.zone));
for(const [id,fn] of [["daily-shop",()=>showShop(false)],["pet-shop",()=>showShop(true)],["help-btn",showInfo],["roster-btn",showRoster],["nav-office",()=>{modal.close();tell("目前是辦公室主畫面");}],["nav-roles",showRoster],["nav-shop",()=>showShop(false)],["nav-pets",showCat],["nav-info",showInfo],["cat",showCat]])document.getElementById(id).addEventListener("click",fn);
for(const person of document.querySelectorAll(".agent"))person.addEventListener("click",()=>{showRoster();tell(person.dataset.person+" · 展示角色")});
function resize(){const w=pan.clientWidth,h=pan.clientHeight;const portrait=w<650&&innerHeight>innerWidth;const targetScale=portrait?Math.max(.73,Math.min(.85,h/650)):Math.max(.5,Math.min(1.42,Math.min(w/1100,h/650)));const scale=Math.round(targetScale*1000)/1000;const prev=Number(world.dataset.scale||0);const center=prev?(pan.scrollLeft+w/2)/prev:545;world.dataset.scale=String(scale);world.style.transform="scale("+scale+")";shell.style.width=Math.ceil(1100*scale)+"px";shell.style.height=Math.ceil(650*scale)+"px";pan.scrollLeft=Math.max(0,center*scale-w/2);document.getElementById("scene-hint").hidden=shell.clientWidth<=pan.clientWidth+4;}
new ResizeObserver(resize).observe(pan);window.addEventListener("orientationchange",()=>setTimeout(resize,90));
const movement=window.matchMedia("(prefers-reduced-motion: reduce)");
let paused=movement.matches,last=0;
document.getElementById("motion-toggle").textContent=paused?"▶ 播放動畫":"⏸ 暫停動畫";
document.getElementById("motion-toggle").addEventListener("click",()=>{paused=!paused;document.getElementById("motion-toggle").textContent=paused?"▶ 播放動畫":"⏸ 暫停動畫";document.getElementById("scene-state").textContent=paused?"動畫已暫停 · 測試模式":"3 位角色 · 展示動畫";});
const people=[{el:document.getElementById("agent-pm"),x:560,y:330,start:0,range:105,speed:.00042,axis:"x"},{el:document.getElementById("agent-co"),x:475,y:380,start:1,range:65,speed:.00028,axis:"y"},{el:document.getElementById("agent-gem"),x:658,y:370,start:2,range:74,speed:.00033,axis:"x"},{el:document.getElementById("cat"),x:355,y:276,start:3,range:155,speed:.00025,axis:"x"}];
let clock=0;function animate(t){if(last&&!paused)clock+=Math.min(50,t-last);last=t;for(const a of people){const dx=Math.sin(clock*a.speed+a.start)*a.range;const dy=Math.sin(clock*a.speed*.6+a.start)*12;a.el.style.transform="translate("+Math.round(a.axis==="x"?dx:dy)+"px,"+Math.round(a.axis==="y"?dx:dy)+"px)";}requestAnimationFrame(animate);}requestAnimationFrame(animate);
refresh();
document.getElementById("daily-summary").textContent="今日精選："+dailySelection().map(p=>p.label).slice(0,2).join("、");
