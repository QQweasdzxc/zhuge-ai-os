/**
 * Experimental native client for GitHub Pages — never fake success when the
 * real Render API is unavailable. This is an incremental engineering artifact,
 * NOT TaskFlow production parity or an approved launch.
 */
import {createTaskFlowPagesTransport, readZhugeAccessToken,TaskFlowPagesError} from "./taskflow-api.mjs";
import {markExplicitReturn} from "./login-return.mjs";
const ROOT="/zhuge-ai-os/";
const transport=createTaskFlowPagesTransport({getAccessToken:()=>readZhugeAccessToken(localStorage)});
const refs={
  status:document.querySelector("#tf-status"),
  workspace:document.querySelector("#tf-workspace"),
  title:document.querySelector("#tf-title"),
  issues:document.querySelector("#tf-issues"),
  meta:document.querySelector("#tf-meta"),
  detail:document.querySelector("#tf-detail"),
  filter:document.querySelector("#tf-search"),
  refresh:document.querySelector("#tf-refresh"),
  login:document.querySelector("#tf-login"),
  projects:document.querySelector("#tf-projects")
};
let state={workspace:null,workspaces:[],issues:[],projects:[],statuses:[],total:0,loading:false};
function element(tag,{text,className,attrs}={}){
 const n=document.createElement(tag);
 if(text!==undefined)n.textContent=String(text);
 if(className)n.className=className;
 for(const [name,value] of Object.entries(attrs||{}))n.setAttribute(name,String(value));
 return n;
}
function setStatus(message,type="info") {
 refs.status.textContent=message;
 refs.status.dataset.kind=type;
}
function errMessage(error) {
 if(error?.code==="NETWORK_OR_CORS")return "無法連線 TaskFlow API 或尚未授權此網站來源（CORS）。請由管理端確認設定。";
 if(error?.code==="SIGN_IN_REQUIRED"||error?.code==="UNAUTHORIZED")return "登入已失效，請先使用既有 Zhuge AI OS 身分登入。";
 if(error?.code==="FORBIDDEN")return "沒有此工作區的 TaskFlow 存取權限。";
 return "TaskFlow API 發生錯誤："+(error?.message||"Unknown");
}
function fail(error) {
 setStatus(errMessage(error),"error");
 refs.meta.textContent="資料讀取失敗，未顯示模擬資料。";
 if(["UNAUTHORIZED","SIGN_IN_REQUIRED","AUTH_REQUIRED"].includes(error?.code))refs.login.hidden=false;
}
function routeFor({section="issues",issueId=null}={}) {
 const u=new URL(location.href);
 const parts=["",section];
 if(issueId)parts.push(encodeURIComponent(issueId));
 u.hash="#/tf"+parts.join("/");
 return u.href;
}
function currentRoute() {
 const hash=decodeURIComponent(location.hash||"");
 const match=hash.match(/^#\/tf\/(issues|projects)(?:\/([a-zA-Z0-9_-]{1,100}))?$/);
 return match?{section:match[1],issueId:match[2]||null}:{section:"issues",issueId:null};
}
function renderWorkspaceSelect(){
 refs.workspace.replaceChildren();
 for(const ws of state.workspaces){
   const opt=element("option",{text:ws.name||ws.slug,attrs:{value:ws.slug}});
   refs.workspace.append(opt);
 }
 refs.workspace.value=state.workspace?.slug??"";
}
function renderProjects(){
 refs.projects.replaceChildren();
 const top=element("button",{text:"所有任務",className:"tf-project",attrs:{type:"button"}});
 top.addEventListener("click",()=>{history.replaceState(null,"",routeFor());renderRoute();});
 refs.projects.append(top);
 for(const p of state.projects){
   const button=element("button",{text:p.name||p.title||"未命名專案",className:"tf-project",attrs:{type:"button"}});
   button.addEventListener("click",()=>{
     history.pushState(null,"",routeFor({section:"projects",issueId:p.id}));
     renderRoute();
   });
   refs.projects.append(button);
 }
}
function category(issue) {
 if(issue.status_category)return String(issue.status_category);
 const value=String(issue.status||"");
 if(["done","completed"].includes(value))return "已完成";
 if(["canceled","cancelled"].includes(value))return "已取消";
 if(["in_progress","in_review"].includes(value))return "進行中";
 return "待辦";
}
function renderIssues(filter=null){
 const issues=filter?state.issues.filter(issue=>issue.project_id===filter):state.issues;
 refs.issues.replaceChildren();
 refs.title.textContent=filter?(state.projects.find(p=>p.id===filter)?.name||state.projects.find(p=>p.id===filter)?.title||"專案任務"):"TaskFlow Dashboard";
 if(issues.length===0){
   refs.issues.append(element("p",{text:state.total>0&&filter?"目前載入的任務沒有屬於此專案的資料。":"此工作區目前沒有符合條件的任務。",className:"tf-empty"}));
   return;
 }
 for(const issue of issues){
   const a=element("a",{className:"tf-issue",attrs:{href:routeFor({issueId:issue.id})}});
   const main=element("span",{className:"tf-issue-main"});
   main.append(element("small",{text:issue.identifier||issue.id,className:"tf-id"}));
   main.append(element("strong",{text:issue.title||"未命名任務"}));
   const right=element("span",{className:"tf-status-tag",text:issue.status_name||issue.status||"—"});
   a.append(main,right);
   a.addEventListener("click",event=>{
     event.preventDefault();
     history.pushState(null,"",a.href);
     renderRoute();
   });
   refs.issues.append(a);
 }
}
async function renderDetail(id){
 refs.detail.hidden=false;
 refs.detail.replaceChildren(element("p",{text:"正在讀取原生任務資料…"}));
 try{
   const issue=await transport.getIssue(state.workspace.slug,id);
   if(currentRoute().issueId!==id)return;
   refs.detail.replaceChildren();
   const close=element("button",{text:"← 返回任務列表",className:"tf-back",attrs:{type:"button"}});
   close.addEventListener("click",()=>{
     history.pushState(null,"",routeFor());renderRoute();
   });
   refs.detail.append(close);
   refs.detail.append(element("p",{text:issue.identifier||issue.id,className:"tf-id"}));
   refs.detail.append(element("h2",{text:issue.title||"未命名任務"}));
   const info=element("div",{className:"tf-issue-info"});
   for(const [label,value] of [["狀態",issue.status_name||issue.status],["優先順序",issue.priority],["到期日",issue.due_date],["所屬專案",state.projects.find(p=>p.id===issue.project_id)?.name||"—"]]){
     info.append(element("span",{text:label+": "+(value||"—")}));
   }
   refs.detail.append(info);
   refs.detail.append(element("h3",{text:"任務說明"}));
   refs.detail.append(element("div",{text:issue.description||"尚無說明",className:"tf-description"}));
   refs.detail.append(element("h3",{text:"留言"}));
   const commentsBox=element("div",{className:"tf-comments"});
   refs.detail.append(commentsBox);
   try {
     const comments=await transport.listComments(state.workspace.slug,id);
     if(currentRoute().issueId!==id)return;
     if(!Array.isArray(comments)||comments.length===0)commentsBox.append(element("p",{text:"尚無留言。"}));
     for(const comment of Array.isArray(comments)?comments:[]){
       commentsBox.append(element("article",{text:typeof comment.content==="string"?comment.content:(comment.body||"留言"),className:"tf-comment"}));
     }
   }catch(error){commentsBox.append(element("p",{text:"留言讀取失敗："+errMessage(error)}));}
 }catch(error){
   refs.detail.replaceChildren(element("p",{text:errMessage(error),className:"tf-error"}));
 }
}
function renderRoute(){
 if(!state.workspace)return;
 const route=currentRoute();
 refs.detail.hidden=!(route.section==="issues" && route.issueId);
 if(route.section==="issues" && route.issueId) {
   void renderDetail(route.issueId);
 }else {
   refs.detail.hidden=true;
   refs.detail.replaceChildren();
   renderIssues(route.section==="projects"?route.issueId:null);
 }
}
async function loadData(){
 if(!state.workspace)return;
 state.loading=true;
 refs.refresh.disabled=true;
 setStatus("正在從 TaskFlow 正式 API 讀取工作區資料…");
 try{
   const slug=state.workspace.slug;
   const [issues,projects,statuses]=await Promise.all([
     transport.listIssues(slug,{limit:100,query:refs.filter.value||""}),
     transport.listProjects(slug),
     transport.listStatuses(slug)
   ]);
   if(!Array.isArray(issues?.issues)||typeof issues.total!=="number")throw new TaskFlowPagesError("TaskFlow issue response invalid","INVALID_RESPONSE");
   state.issues=issues.issues;
   state.total=issues.total;
   state.projects=Array.isArray(projects)?projects:Array.isArray(projects?.projects)?projects.projects:[];
   state.statuses=Array.isArray(statuses)?statuses:Array.isArray(statuses?.statuses)?statuses.statuses:[];
   refs.meta.textContent="已載入 "+issues.issues.length+" / "+issues.total+" 筆任務 · 原生 TaskFlow API";
   renderProjects();
   renderRoute();
   setStatus("已連接正式 TaskFlow 工作區","success");
 }catch(error) {
   state.issues=[];state.total=0;refs.issues.replaceChildren();refs.detail.replaceChildren();
   fail(error);
 }finally{state.loading=false;refs.refresh.disabled=false;}
}
async function bootstrap(){
 refs.refresh.disabled=true;
 setStatus("驗證正式 Zhuge AI OS 身分中…");
 try{
   await transport.connect();
   const workspaces=await transport.listWorkspaces();
   if(!Array.isArray(workspaces)||!workspaces.length)throw new TaskFlowPagesError("此帳號沒有可存取的工作區","NO_WORKSPACE");
   state.workspaces=workspaces;
   const remembered=sessionStorage.getItem("tf-pages-active-slug");
   state.workspace=workspaces.find(w=>w.slug===remembered)||workspaces[0];
   renderWorkspaceSelect();
   refs.login.hidden=true;
   await loadData();
 }catch(error){fail(error);}finally{refs.refresh.disabled=false;}
}
refs.workspace.addEventListener("change",async event=>{
 state.workspace=state.workspaces.find(w=>w.slug===event.target.value)||null;
 if(state.workspace)sessionStorage.setItem("tf-pages-active-slug",state.workspace.slug);
 history.replaceState(null,"",routeFor());
 await loadData();
});
document.querySelector("#tf-login-action").addEventListener("click",()=>markExplicitReturn(sessionStorage));
refs.refresh.addEventListener("click",()=>void bootstrap());
let searchDelay;
refs.filter.addEventListener("input",()=>{
 clearTimeout(searchDelay);
 searchDelay=setTimeout(()=>void loadData(),350);
});
window.addEventListener("popstate",renderRoute);
window.addEventListener("hashchange",renderRoute);
void bootstrap();
