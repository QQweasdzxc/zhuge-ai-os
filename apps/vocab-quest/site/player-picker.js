/* Vocabulary Quest family player gateway — same UX as Chengyu Quest, cloud-only identity. */
(function(){
"use strict";
const bridge=window.vocabPlayerBridge;
if(!bridge)return;
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&#39;"}[c]));
const avatars=["🦊","🐨","🐼","🐰","🐬","🦁","🐯","🐻"];
let active=false,busy=false,preOverflow="";
const styles=document.createElement("style");
styles.textContent=".vpg[hidden],.vpg-form[hidden],.vpg-options[hidden]{display:none!important}.vpg{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;background:rgba(14,24,51,.88);padding:20px 13px 30px;overscroll-behavior:contain}.vpg-card{background:white;border-radius:27px;padding:27px 23px 23px;box-shadow:0 20px 70px #11132f66;width:min(100%,510px);margin:auto;text-align:center;color:#283658}.vpg-icon{font-size:43px}.vpg-eyebrow{color:#705ac1;font-weight:900;font-size:13px;margin:7px 0}.vpg-title{font-size:clamp(25px,6vw,33px);line-height:1.32;margin:10px 0}.vpg-intro{font-size:15px;color:#6a7692;line-height:1.7;margin:0}.vpg-status{color:#698178;font-size:13px;margin:13px 0 17px;min-height:19px}.vpg-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.vpg-choice{min-height:122px;padding:10px 6px;border:2px solid #e1daf9;background:#f8f6fe;border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-weight:900;font-size:18px;color:#364665;cursor:pointer;overflow-wrap:anywhere}.vpg-choice .avatar{font-size:30px}.vpg-choice small{color:#77849c;font-weight:600;font-size:12px}.vpg-choice:hover,.vpg-choice:focus-visible{background:#f1ecff;border-color:#8876e2}.vpg-choice.add{background:#effaf8;border:2px dashed #86c2b7;color:#2b7565}.vpg-choice.add small{color:#668c83}.vpg-form{text-align:left;padding:16px;margin-top:16px;background:#f7f8fe;border-radius:16px}.vpg-form label{display:block;font-weight:800;margin-bottom:9px}.vpg-form input{width:100%;border:2px solid #bec7e5;border-radius:13px;padding:12px;font-size:18px;background:white}.vpg-form .join{border:0;border-radius:13px;min-height:52px;background:#6756d6;color:white;font-weight:900;font-size:16px;width:100%;margin-top:12px;cursor:pointer}.vpg-form .join:disabled{opacity:.55}.vpg-form .back{border:0;background:transparent;color:#63718e;text-decoration:underline;display:block;margin:6px auto 0;padding:10px}.vpg-error{color:#bc405c;font-size:13px;margin:5px 0}.vpg-foot{color:#7a8398;font-size:12px;line-height:1.8;margin:18px 0 0}@media(max-width:490px){.vpg{padding:13px 11px 25px}.vpg-card{padding:22px 16px 18px;border-radius:21px}.vpg-options{gap:9px}.vpg-choice{min-height:111px;font-size:17px;padding:8px 4px}.vpg-choice .avatar{font-size:27px}}";
document.head.append(styles);
const popup=document.createElement("div");
popup.className="vpg";popup.id="vocabPlayerGate";popup.hidden=true;
popup.innerHTML='<section class="vpg-card" role="dialog" aria-modal="true" aria-labelledby="vpgTitle">'+
'<div class="vpg-icon">🎮</div><p class="vpg-eyebrow">英文單字闖關王 · 家庭玩家</p>'+
'<h2 class="vpg-title" id="vpgTitle">嗨！今天是誰來闖關？</h2>'+
'<p class="vpg-intro">找到自己的名字，點一下就可以開始玩囉！</p>'+
'<p class="vpg-status" id="vpgStatus" role="status">☁️ 正在載入家人的名字…</p>'+
'<div class="vpg-options" id="vpgOptions"></div>'+
'<form class="vpg-form" id="vpgForm" hidden>'+
'<label for="vpgName">我是第一次玩，請輸入我的名字</label>'+
'<input id="vpgName" name="name" maxlength="24" placeholder="例如：安安、卡卡、小明" required autocomplete="off">'+
'<button class="join" type="submit" id="vpgJoin">✨ 加入並開始闖關</button>'+
'<button class="back" type="button" id="vpgCancel">返回選擇名字</button>'+
'<p class="vpg-error" id="vpgError" role="alert"></p></form>'+
'<p class="vpg-foot">不用登入或設定密碼。闖關成績會自動存進家庭雲端。</p></section>';
document.body.append(popup);
const $=id=>document.getElementById(id);
function formMode(show){
 $("vpgForm").hidden=!show;
 $("vpgOptions").hidden=show;
 $("vpgError").textContent="";
 if(show){$("vpgName").value="";$("vpgName").focus()}
}
function render(){
 if(!active)return;
 const state=bridge.snapshot(),options=$("vpgOptions"),msg=$("vpgStatus");
 if(!state.connected){
  const loading=(state.status||"").includes("正在載入")||!state.status;
  msg.textContent=loading?"☁️ 正在載入家庭雲端…":"⚠️ "+(state.status||"無法連接雲端");
  options.innerHTML=loading?"":'<button type="button" class="vpg-choice add" id="vpgRetry">↻ 重試連線</button>';
  return;
 }
 msg.textContent=state.learners.length?"👇 點自己的名字，成績就不會記錯人":"歡迎第一位玩家！先新增自己的名字吧！";
 options.innerHTML=state.learners.map((p,i)=>
  '<button type="button" class="vpg-choice" data-vpg-person="'+esc(p.id)+'"><span class="avatar" aria-hidden="true">'+avatars[i%avatars.length]+'</span><span>'+esc(p.name)+'</span><small>我是 '+esc(p.name)+'</small></button>'
 ).join("")+'<button type="button" class="vpg-choice add" id="vpgAdd"><span class="avatar" aria-hidden="true">➕</span><span>我是第一次玩</span><small>新增我的名字</small></button>';
}
function open(){
 if(!bridge.snapshot().token)return;
 if(!active)preOverflow=document.body.style.overflow;
 active=true;popup.hidden=false;document.body.style.overflow="hidden";
 formMode(false);render();
}
function close(){
 active=false;popup.hidden=true;document.body.style.overflow=preOverflow;
}
async function select(id){
 if(busy)return;
 const state=bridge.snapshot(),person=state.learners.find(p=>p.id===id);
 if(!person||!state.connected)return;
 busy=true;$("vpgStatus").textContent="☁️ 正在選擇 "+person.name+"…";
 try{
  await bridge.select(person.name);
  const next=bridge.snapshot();
  if(next.selectedId===id)close();
  else $("vpgStatus").textContent="⚠️ 無法選擇玩家，請再試一次";
 }catch(err){$("vpgStatus").textContent="⚠️ 雲端選人失敗，請再試一次"}
 finally{busy=false}
}
async function add(){
 if(busy)return;
 const name=$("vpgName").value.trim();
 if(!name){$("vpgError").textContent="先輸入你的名字吧！";return}
 if(!bridge.snapshot().connected){$("vpgError").textContent="雲端尚未連線";return}
 busy=true;$("vpgJoin").disabled=true;$("vpgJoin").textContent="☁️ 正在加入雲端…";
 $("vpgError").textContent="";
 try{
  await bridge.select(name);
  const next=bridge.snapshot();
  if(next.selectedName===name&&next.selectedId)close();
  else $("vpgError").textContent="沒有成功加入，請再試一次";
 }catch(err){$("vpgError").textContent="新增失敗，請再試一次"}
 finally{busy=false;$("vpgJoin").disabled=false;$("vpgJoin").textContent="✨ 加入並開始闖關"}
}
popup.addEventListener("click",e=>{
 const person=e.target.closest("[data-vpg-person]");
 if(person){select(person.dataset.vpgPerson);return}
 if(e.target.closest("#vpgAdd")){formMode(true);return}
 if(e.target.closest("#vpgCancel")){formMode(false);return}
 if(e.target.closest("#vpgRetry")){bridge.reload()}
});
$("vpgForm").addEventListener("submit",e=>{e.preventDefault();add()});
window.vocabPlayerOpen=open;window.vocabPlayerRefresh=render;
if(bridge.snapshot().token)open();
})();