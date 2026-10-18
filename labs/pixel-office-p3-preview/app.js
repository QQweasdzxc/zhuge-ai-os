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
const PERSONNEL_ROLE_BASE=[
{id:"pm",name:"PM",kind:"operator",role:"產品決策者",description:"負責需求決策、產品驗收與正式發布核准。",icon:"👨🏻‍💼"},
{id:"co",name:"Co",kind:"agent",role:"首席工程師（Codex）",description:"主要工程實作、整合、修復與品質檢查。",icon:"🧑🏻‍💻"},
{id:"gem",name:"Gem",kind:"agent",role:"第二工程師（Gemini）",description:"支援工程實作、獨立審查與交接。",icon:"👩🏻‍💻"},
{id:"gpt",name:"GPT",kind:"agent",role:"PM 助理／協作 AI",description:"協助 PM 進行需求規劃、技術審查與驗收。",icon:"🤖"},
{id:"betty",name:"Betty",kind:"resident",role:"生活型角色",description:"喜歡在 Lounge 休息、喝茶並與同伴互動。",visualActivity:"在 Lounge 休息、喝茶與閒聊。",icon:"👩🏻‍🦰"},
{id:"anan",name:"安安",kind:"resident",role:"生活型角色",description:"喜歡閱讀、整理書籍與安靜休閒。",visualActivity:"在閱讀區看書、整理書架。",icon:"👩🏻‍🏫"},
{id:"kaka",name:"卡卡",kind:"resident",role:"生活型角色",description:"個性活潑，喜歡在辦公室散步與休閒互動。",visualActivity:"在休息區附近散步、與角色打招呼。",icon:"👩🏻‍🎤"}
];
const personnelPanel=document.getElementById("personnel-panel");
const personnelRoster=document.getElementById("personnel-list");
const personnelTimeline=document.getElementById("personnel-events");
const personnelProfile=document.getElementById("personnel-detail");
const personnelSource=document.getElementById("personnel-source");
const personnelUpdated=document.getElementById("personnel-updated");
const activityToggle=document.getElementById("personnel-toggle");
const mobilePersonnelQuery=window.matchMedia("(max-width: 700px), (orientation: landscape) and (max-height: 560px) and (max-width: 900px)");
let selectedPersonnelId=null;
let cachedPersonnelEvidence=null,evidenceLoadPromise=null;
const UNKNOWN_PERSONNEL="尚無可驗證的最新狀態";
function personnelSnapshot(){
 const provider=window.P3PersonnelEvidence;
 const published=window.P3PersonnelSnapshot;
 const raw=published&&Array.isArray(published.roles)?published:(provider&&Array.isArray(provider.roles)?provider:cachedPersonnelEvidence);
 if(!raw||typeof raw!=="object")return {roles:[],events:[],refreshedAt:null,sourceStatus:null};
 return {roles:Array.isArray(raw.roles)?raw.roles:[],events:Array.isArray(raw.events)?raw.events:[],refreshedAt:raw.refreshedAt||null,sourceStatus:raw.sourceStatus??null};
}
function refreshPersonnelEvidence(){
 const provider=window.P3PersonnelEvidence;
 if(provider&&Array.isArray(provider.roles)){renderPersonnel();return Promise.resolve();}
 if(!provider||typeof provider.load!=="function"||evidenceLoadPromise)return evidenceLoadPromise||Promise.resolve();
 evidenceLoadPromise=Promise.resolve().then(()=>provider.load()).then(data=>{
  if(data&&Array.isArray(data.roles)&&Array.isArray(data.events)){cachedPersonnelEvidence=data;window.P3PersonnelSnapshot=data;window.dispatchEvent(new CustomEvent("p3-personnel-evidence-updated",{detail:data}));}
 }).catch(()=>{renderPersonnel();}).finally(()=>{evidenceLoadPromise=null;});
 return evidenceLoadPromise;
}
function safeEvidenceText(value,max=500){return typeof value==="string"?value.trim().slice(0,max):"";}
function validEvidenceUrl(value){
 if(typeof value!=="string"||!value.trim())return "";
 try{const u=new URL(value);if(u.protocol!=="https:"||u.hostname.toLowerCase()!=="github.com"||!u.pathname.startsWith("/QQweasdzxc/zhuge-ai-os/")||u.username||u.password)return "";for(const key of u.searchParams.keys())if(/token|secret|signature|(^|_)sig(nature)?($|_)|api[_-]?key|authorization/i.test(key))return "";return u.href;}catch{return "";}
}
function evidenceDate(value){if(typeof value==="number")return Number.isFinite(value)?value:null;if(typeof value!=="string")return null;const n=Date.parse(value);return Number.isFinite(n)?n:null;}
function formatEvidenceTime(value){const n=evidenceDate(value);if(n===null)return "時間未提供";try{return new Intl.DateTimeFormat("zh-TW",{dateStyle:"short",timeStyle:"short",hour12:false}).format(new Date(n));}catch{return new Date(n).toISOString();}}
function freshStatus(ev,now=Date.now()){
 if(!ev||typeof ev!=="object"||!safeEvidenceText(ev.label,300)||!safeEvidenceText(ev.sourceType,80)||!validEvidenceUrl(ev.sourceUrl))return false;
 const at=evidenceDate(ev.updatedAt);if(at===null||at>now+300000)return false;
 const validUntil=evidenceDate(ev.validUntil);
 if(validUntil!==null)return now<=validUntil&&at<=validUntil;
 const freshness=Number(ev.freshnessMs);
 return Number.isFinite(freshness)&&freshness>0&&now-at<=freshness;
}
function roleEvidence(id,snapshot=personnelSnapshot()){return snapshot.roles.find(r=>r&&r.id===id)||null;}
function eventValid(ev){return !!ev&&typeof ev==="object"&&!!safeEvidenceText(ev.label,500)&&!!safeEvidenceText(ev.sourceType,80)&&evidenceDate(ev.updatedAt)!==null&&!!validEvidenceUrl(ev.sourceUrl);}
function evidenceFreshnessLabel(ev){const freshness=safeEvidenceText(ev&&ev.freshness,40).toLowerCase();if(freshness==="fresh")return "最新證據";if(freshness==="stale")return "已過期";if(freshness==="partial")return "部分更新";return "未提供新鮮度標記";}
function roleEvents(id,snapshot){
 const role=roleEvidence(id,snapshot);const gathered=[...(role&&Array.isArray(role.events)?role.events:[]),...snapshot.events.filter(ev=>ev&&ev.roleId===id)];
 const seen=new Set();return gathered.filter(eventValid).filter(ev=>{const key=String(ev.id||"")+"|"+String(ev.sourceUrl||"")+"|"+String(ev.updatedAt);if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(evidenceDate(b.updatedAt)||0)-(evidenceDate(a.updatedAt)||0));
}
function setPersonnelOpen(open){
 if(mobilePersonnelQuery.matches){ROOT.classList.toggle("personnel-open",!!open);}
 else{ROOT.classList.toggle("personnel-collapsed",!open);ROOT.classList.remove("personnel-open");}
 const expanded=!!open;activityToggle.setAttribute("aria-expanded",String(expanded));activityToggle.setAttribute("aria-label",expanded?(mobilePersonnelQuery.matches?"收合人員動態":"收合人員動態"):(mobilePersonnelQuery.matches?"展開人員動態":"展開人員動態"));activityToggle.querySelector(".personnel-toggle-label").textContent=expanded?"動態中":"動態";
 document.getElementById("personnel-collapse").setAttribute("aria-label",mobilePersonnelQuery.matches?"收合人員動態":"收合人員動態");
}
function currentPersonnelOpen(){return mobilePersonnelQuery.matches?ROOT.classList.contains("personnel-open"):!ROOT.classList.contains("personnel-collapsed");}
function addSourceLink(parent,url,label,className="evidence-link"){
 const safe=validEvidenceUrl(url);if(!safe)return false;const a=e("a",className,label||"查看來源");a.href=safe;a.target="_blank";a.rel="noopener noreferrer";parent.append(a);return true;
}
function makeRoleStatus(role,raw,now=Date.now()){
 const status=raw&&raw.statusEvidence;
 if(role.kind==="resident")return {label:"虛擬活動 · 非真人追蹤",source:"角色設定（虛擬展示）",updated:"非即時事件資料",freshness:"非即時",activity:safeEvidenceText((raw&&raw.visualActivity)||role.visualActivity,240)||role.visualActivity};
 if(freshStatus(status,now))return {label:safeEvidenceText(status.label,300),source:safeEvidenceText(status.sourceType,80),updated:formatEvidenceTime(status.updatedAt),freshness:evidenceFreshnessLabel(status),evidence:status};
 return {label:UNKNOWN_PERSONNEL,source:status&&safeEvidenceText(status.sourceType,80)?safeEvidenceText(status.sourceType,80)+" · 狀態無效或已逾期":"尚未連線到可驗證來源",updated:status&&status.updatedAt?formatEvidenceTime(status.updatedAt):"未提供",freshness:status?"已過期":"未提供"};
}
function renderRoleList(snapshot=personnelSnapshot()){
 personnelRoster.replaceChildren();const now=Date.now();
 for(const role of PERSONNEL_ROLE_BASE){
  const raw=roleEvidence(role.id,snapshot);const status=makeRoleStatus(role,raw,now);const name=safeEvidenceText(raw&&raw.name,80)||role.name;const roleName=safeEvidenceText(raw&&raw.role,120)||role.role;
  const button=e("button","personnel-person","");button.type="button";button.dataset.roleId=role.id;button.setAttribute("aria-pressed",String(selectedPersonnelId===role.id));if(selectedPersonnelId===role.id)button.classList.add("is-selected");
  const avatar=e("span","personnel-avatar role-"+role.id,role.icon);avatar.setAttribute("aria-hidden","true");const copy=e("span","personnel-person-copy","");const head=e("span","personnel-person-head","");head.append(e("strong","",name),e("small","",roleName));const stateLine=e("span","personnel-state",status.label);const meta=e("span","personnel-meta","來源："+status.source+" · 更新："+status.updated+" · "+status.freshness);copy.append(head,stateLine,meta);
  button.append(avatar,copy);button.addEventListener("click",()=>selectPersonnel(role.id));personnelRoster.append(button);
 }
}
function renderEvidenceEvent(ev){
 const item=e("article","personnel-event","");item.append(e("strong","personnel-event-label",safeEvidenceText(ev.label,500)));const actor=PERSONNEL_ROLE_BASE.find(role=>role.id===ev.roleId);const meta=e("div","personnel-event-meta",(actor?actor.name+" · ":"")+safeEvidenceText(ev.sourceType,80)+" · "+formatEvidenceTime(ev.updatedAt)+" · "+evidenceFreshnessLabel(ev));item.append(meta);const detail=safeEvidenceText(ev.detail,500);if(detail)item.append(e("p","personnel-event-detail",detail));
 const ref=safeEvidenceText(ev.ref,120),taskId=safeEvidenceText(ev.taskId,120);if(ref||taskId)item.append(e("div","personnel-event-ref",(ref?"參照："+ref:"")+(ref&&taskId?" · ":"")+(taskId?"任務："+taskId:"")));
 if(!addSourceLink(item,ev.sourceUrl,"開啟原始來源 ↗"))item.append(e("span","personnel-no-link","未提供可驗證的來源連結"));return item;
}
function renderTimeline(snapshot=personnelSnapshot()){
 const all=[...snapshot.events,...snapshot.roles.flatMap(role=>Array.isArray(role&&role.events)?role.events:[])];const seen=new Set();const events=all.filter(eventValid).filter(ev=>{const key=String(ev.id||"")+"|"+String(ev.sourceUrl||"")+"|"+String(ev.updatedAt);if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>(evidenceDate(b.updatedAt)||0)-(evidenceDate(a.updatedAt)||0));personnelTimeline.replaceChildren();
 if(!events.length){personnelTimeline.append(e("p","personnel-empty","尚無可驗證的工程事件。沒有事件不代表角色沒有工作。"));return;}
 for(const ev of events.slice(0,12))personnelTimeline.append(renderEvidenceEvent(ev));
}
function renderPersonnelProfile(id,snapshot=personnelSnapshot()){
 const role=PERSONNEL_ROLE_BASE.find(r=>r.id===id);if(!role){personnelProfile.hidden=true;personnelProfile.replaceChildren();return;}
 const raw=roleEvidence(id,snapshot);const name=safeEvidenceText(raw&&raw.name,80)||role.name;const roleName=safeEvidenceText(raw&&raw.role,120)||role.role;const description=safeEvidenceText(raw&&raw.description,600)||role.description;
 personnelProfile.replaceChildren();personnelProfile.hidden=false;personnelProfile.dataset.roleId=id;
 const top=e("div","personnel-profile-head","");const identity=e("div","personnel-profile-copy","");identity.append(e("strong","",name),e("small","",roleName));top.append(e("span","personnel-avatar role-"+id,role.icon),identity);const close=e("button","personnel-profile-close","收起詳情");close.type="button";close.addEventListener("click",()=>selectPersonnel(null));top.append(close);personnelProfile.append(top);
 personnelProfile.append(e("p","personnel-description",description));
 if(role.kind==="resident"){
  const activity=safeEvidenceText((raw&&raw.visualActivity)||role.visualActivity,240)||role.visualActivity;
  personnelProfile.append(e("div","virtual-activity-label","虛擬活動 · 非真人追蹤"),e("p","virtual-activity",activity),e("p","personnel-meta","來源：角色設定（虛擬展示） · 更新：非即時事件資料；不追蹤真人活動或位置。"));
 }else{
  const status=makeRoleStatus(role,raw);const card=e("div","personnel-profile-status","");card.append(e("strong","",status.label),e("span","", "來源："+status.source),e("span","", "資料更新："+status.updated));if(status.evidence)card.append(e("span","", "新鮮度："+evidenceFreshnessLabel(status.evidence)));
  if(status.evidence){const ev=status.evidence;const ref=safeEvidenceText(ev.ref,120),taskId=safeEvidenceText(ev.taskId,120);if(ref||taskId)card.append(e("span","personnel-event-ref",(ref?"參照："+ref:"")+(ref&&taskId?" · ":"")+(taskId?"任務："+taskId:"")));addSourceLink(card,ev.sourceUrl,"開啟任務／狀態來源 ↗");}
  personnelProfile.append(card);
  const events=roleEvents(id,snapshot);personnelProfile.append(e("h4","personnel-detail-heading","最近已驗證事件"));if(events.length){const list=e("div","personnel-detail-events","");for(const event of events.slice(0,8))list.append(renderEvidenceEvent(event));personnelProfile.append(list);}else personnelProfile.append(e("p","personnel-empty","尚無可驗證的近期工程事件。"));
 }
}
function renderPersonnel(){
 const snapshot=personnelSnapshot();renderRoleList(snapshot);renderTimeline(snapshot);for(const node of document.querySelectorAll(".agent[data-person-id]"))node.setAttribute("aria-pressed",String(node.dataset.personId===selectedPersonnelId));
 const source=snapshot.sourceStatus;let sourceLabel="來源尚未提供";if(typeof source==="string")sourceLabel=safeEvidenceText(source,220)||sourceLabel;else if(source&&typeof source==="object"){
  const statusLabels={"not-connected":"尚未連線","fresh":"最新唯讀資料","partial":"部分唯讀資料","empty":"目前無可列事件","unavailable":"目前無法讀取","no-current-record":"沒有有效紀錄","stale":"紀錄已過期","snapshot":"靜態快照"};
  const states=[];if(source.taskflow)states.push("TaskFlow："+(statusLabels[source.taskflow]||safeEvidenceText(source.taskflow,50)));if(source.handoff)states.push("Handoff："+(statusLabels[source.handoff]||safeEvidenceText(source.handoff,50)));if(source.github)states.push("GitHub："+(statusLabels[source.github]||safeEvidenceText(source.github,50)));
  const note=safeEvidenceText(source.note||source.label||source.message,180);sourceLabel=[...states,note].filter(Boolean).join(" · ")||sourceLabel;
 }
 personnelSource.textContent="唯讀來源："+sourceLabel+(sourceLabel.endsWith("。")?"":"。")+"人員狀態只依有時效證據顯示。";
 personnelUpdated.textContent=snapshot.refreshedAt?"來源更新："+formatEvidenceTime(snapshot.refreshedAt)+" · 個別狀態仍依各自有效期限判定。":"尚未取得來源更新時間；角色動畫不代表工作狀態。";
 if(selectedPersonnelId)renderPersonnelProfile(selectedPersonnelId,snapshot);
}
function selectPersonnel(id){
 selectedPersonnelId=id||null;const isMobile=mobilePersonnelQuery.matches;
 if(id){if(isMobile)setPersonnelOpen(true);else if(ROOT.classList.contains("personnel-collapsed"))setPersonnelOpen(true);}
 renderPersonnel();for(const node of document.querySelectorAll(".agent[data-person-id]")){const selected=node.dataset.personId===selectedPersonnelId;node.classList.toggle("is-selected",selected);node.setAttribute("aria-pressed",String(selected));}
 if(id)requestAnimationFrame(()=>personnelPanel.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}));
}
function showRoster(){setPersonnelOpen(true);renderPersonnel();}
activityToggle.addEventListener("click",()=>setPersonnelOpen(!currentPersonnelOpen()));
document.getElementById("personnel-collapse").addEventListener("click",()=>setPersonnelOpen(false));
for(const person of document.querySelectorAll(".agent[data-person-id]")){
 const openProfile=()=>selectPersonnel(person.dataset.personId);
 person.addEventListener("click",openProfile);
 person.addEventListener("keydown",ev=>{if((ev.key==="Enter"||ev.key===" ")&&person.tagName!=="BUTTON"){ev.preventDefault();openProfile();}});
}
for(const query of [mobilePersonnelQuery])query.addEventListener?query.addEventListener("change",()=>{ROOT.classList.remove("personnel-open","personnel-collapsed");setPersonnelOpen(!mobilePersonnelQuery.matches);}):query.addListener(()=>{ROOT.classList.remove("personnel-open","personnel-collapsed");setPersonnelOpen(!mobilePersonnelQuery.matches);});
setPersonnelOpen(!mobilePersonnelQuery.matches);
window.addEventListener("p3-personnel-evidence-updated",event=>{
 if(event.detail&&Array.isArray(event.detail.roles)&&Array.isArray(event.detail.events)){cachedPersonnelEvidence=event.detail;window.P3PersonnelSnapshot=event.detail;}
 renderPersonnel();
});
document.addEventListener("visibilitychange",()=>{if(!document.hidden){renderPersonnel();refreshPersonnelEvidence();}});
setInterval(()=>{renderPersonnel();refreshPersonnelEvidence();},30000);
renderPersonnel();refreshPersonnelEvidence();
function showCat(){dialog("🐈‍⬛ 寵物夥伴");modalContent.append(e("div","status-line","目前夥伴："+state.cat));modalContent.append(e("p","","貓咪會在辦公室散步、休息。牠的行為是生活動畫，不是員工工作證據。"));const btn=e("button","action-pill","前往寵物商店");btn.addEventListener("click",()=>showShop(true));modalContent.append(btn);}
function zone(name){dialog("🏢 "+name);modalContent.append(e("p","","這是 P3 測試版的辦公室分區。角色可以在這個空間自由移動，將來真實工作與會議動作會以 TaskFlow / GitHub 已驗證事件驅動。"));modalContent.append(e("div","status-line","目前：展示模式，未連線真實任務派工"));}
for(const tag of document.querySelectorAll("[data-zone]"))tag.addEventListener("click",()=>zone(tag.dataset.zone));
for(const [id,fn] of [["daily-shop",()=>showShop(false)],["pet-shop",()=>showShop(true)],["help-btn",showInfo],["roster-btn",showRoster],["nav-office",()=>{if(modal.open)modal.close();tell("目前是辦公室主畫面");}],["nav-roles",showRoster],["nav-shop",()=>showShop(false)],["nav-pets",showCat],["nav-info",showInfo],["cat",showCat]])document.getElementById(id).addEventListener("click",fn);

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
document.getElementById("motion-toggle").addEventListener("click",()=>{paused=!paused;document.getElementById("motion-toggle").textContent=paused?"▶ 播放動畫":"⏸ 暫停動畫";document.getElementById("scene-state").textContent=paused?"動畫已暫停 · 測試模式":"7 位像素角色 · 動畫僅供展示";});
/* Showroom-only waypoints, never presented as real Codex/Gem/PM tasks. */
const walkers=[{el:document.getElementById("agent-pm"),route:[[560,328],[732,317],[841,275],[732,317]],time:26000},
{el:document.getElementById("agent-co"),route:[[475,380],[450,341],[413,329],[450,341],[475,380],[581,365]],time:23000},
{el:document.getElementById("agent-gem"),route:[[658,370],[745,393],[792,347],[846,312],[743,362]],time:28000},
{el:document.getElementById("agent-gpt"),route:[[723,382],[747,354],[770,379],[747,354]],time:24000},
{el:document.getElementById("agent-betty"),route:[[138,420],[164,415],[178,434],[153,443]],time:30000},
{el:document.getElementById("agent-anan"),route:[[234,460],[246,466],[242,478],[234,460]],time:38000},
{el:document.getElementById("agent-kaka"),route:[[294,394],[326,383],[333,421],[302,433],[286,411]],time:18000},
{el:document.getElementById("cat"),route:[[355,276],[317,281],[292,223],[372,197],[476,191],[439,269]],time:31000}];
let elapsed=0;
function animate(t){if(last&&!paused)elapsed+=Math.min(70,t-last);last=t;for(let k=0;k<walkers.length;k++){const a=walkers[k],part=(elapsed/a.time+k*.37)%1*a.route.length,i=Math.floor(part),f=part-i,s=f*f*(3-2*f),from=a.route[i],to=a.route[(i+1)%a.route.length];a.el.style.left=Math.round(from[0]+(to[0]-from[0])*s)+"px";a.el.style.top=Math.round(from[1]+(to[1]-from[1])*s)+"px";if(a.el.classList.contains("resident")){a.el.classList.toggle("is-resident-walking",!paused&&k===6);a.el.classList.toggle("is-resident-resting",!paused&&k===4);a.el.classList.toggle("is-resident-reading",!paused&&k===5);}else if(k===3){a.el.classList.toggle("is-walking",!paused);}if(k<3){const working=(k===1&&(i===0||i===3)||k===2&&(i===0||i===4))&&f>.7;const meeting=(k===0&&i===2||k===2&&i===3)&&f>.72;const resting=k===0&&i===0&&f>.72;a.el.classList.toggle("is-working",!paused&&working);a.el.classList.toggle("is-meeting",!paused&&meeting);a.el.classList.toggle("is-resting",!paused&&resting);a.el.classList.toggle("is-walking",!paused&&!working&&!meeting&&!resting);const cue=a.el.querySelector(".activity-pip");if(cue)cue.textContent=working?"⌨️":meeting?"💬":resting?"☕":"";}}requestAnimationFrame(animate);}requestAnimationFrame(animate);
refresh();
document.getElementById("daily-summary").textContent="今日精選："+dailySelection().map(p=>p.label).slice(0,2).join("、");
