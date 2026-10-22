/**
 * Experimental native client for GitHub Pages — never fake success when the
 * real Render API is unavailable. This is an incremental engineering artifact,
 * NOT TaskFlow production parity or an approved launch.
 */
import {createTaskFlowPagesTransport, readZhugeAccessToken, TaskFlowPagesError} from "./taskflow-api.mjs";
import {markExplicitReturn} from "./login-return.mjs";
import {
  DISPATCH_METADATA_KEYS,
  DISPATCH_STATE_LABELS,
  buildGithubMetadata,
  buildIssuePayload,
  buildMetadata,
  evidenceSummary,
  isExactSha,
  requiredGithubUrl,
  requiredHttpsUrl
} from "./dispatch-contract.mjs";
import {buildPmInboxEntries, createDispatchAdapter, normalizeDispatchIssue} from "./dispatch-workbench.mjs";

const transport=createTaskFlowPagesTransport({getAccessToken:()=>readZhugeAccessToken(localStorage)});
const dispatchAdapter=createDispatchAdapter(transport);
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
  projects:document.querySelector("#tf-projects"),
  createOpen:document.querySelector("#tf-create-open"),
  create:document.querySelector("#tf-create"),
  createForm:document.querySelector("#tf-create-form"),
  createCancel:document.querySelector("#tf-create-cancel"),
  createStatus:document.querySelector("#tf-create-status"),
  dispatch:document.querySelector("#tf-dispatch"),
  dispatchCards:document.querySelector("#tf-dispatch-cards"),
  dispatchMeta:document.querySelector("#tf-dispatch-meta"),
  dispatchExecutor:document.querySelector("#tf-dispatch-executor"),
  dispatchNotice:document.querySelector("#tf-dispatch-notice"),
  pmInbox:document.querySelector("#tf-pm-inbox"),
  aiBoard:document.querySelector("#tf-ai-board"),
  aiBoardTitle:document.querySelector("#tf-ai-board-title"),
  aiBoardNotice:document.querySelector("#tf-ai-board-notice"),
  aiKanban:document.querySelector("#tf-ai-kanban"),
  aiExecutor:document.querySelector("#tf-ai-executor"),
  aiProjects:document.querySelector("#tf-ai-projects"),
  aiProjectEntries:document.querySelector("#tf-ai-project-entries")
};
let state={workspace:null,workspaces:[],issues:[],projects:[],statuses:[],total:0,loading:false,agents:[],agentsWorkspace:null,agentsError:null};
if(refs.createOpen)refs.createOpen.hidden=true;

function element(tag,{text,className,attrs}={}){
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=String(text);
  if(className)n.className=className;
  for(const [name,value] of Object.entries(attrs||{}))n.setAttribute(name,String(value));
  return n;
}
function formValue(form,name){
  const field=form?.elements?.namedItem(name);
  return typeof field?.value==="string"?field.value.trim():"";
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
  if(refs.createOpen)refs.createOpen.hidden=true;
  if(["UNAUTHORIZED","SIGN_IN_REQUIRED","AUTH_REQUIRED"].includes(error?.code))refs.login.hidden=false;
}
function routeFor({section="issues",issueId=null}={}){
  const u=new URL(location.href);
  const parts=["",section];
  if(issueId)parts.push(encodeURIComponent(issueId));
  u.hash="#/tf"+parts.join("/");
  return u.href;
}
function currentRoute(){
  const hash=decodeURIComponent(location.hash||"");
  const match=hash.match(/^#\/tf\/(issues|projects|dispatch|ai-projects|ai-tasks)(?:\/([a-zA-Z0-9_-]{1,100}))?$/);
  return match?{section:match[1],issueId:match[2]||null}:{section:"issues",issueId:null};
}
function workspaceSlug(){return state.workspace?.slug||"";}
function responseArray(value,key){
  if(Array.isArray(value))return value;
  if(Array.isArray(value?.[key]))return value[key];
  return [];
}
function agentLabel(agent){
  const runtime=agent?.runtime_bound?"runtime 已綁定":agent?.runtime_availability?`runtime ${agent.runtime_availability}`:"runtime 未確認";
  return `${agent?.name||agent?.id||"未命名 Agent"} · ${runtime}`;
}
function issueDispatchStatus(issue){
  const value=String(issue?.metadata?.[DISPATCH_METADATA_KEYS.dispatchStatus]||"").toUpperCase();
  return value&&DISPATCH_STATE_LABELS[value]?DISPATCH_STATE_LABELS[value]:issue?.status_name||issue?.status||"—";
}
function linkNode(href,label){
  if(!href)return element("span",{text:"—"});
  return element("a",{text:label||href,className:"tf-evidence-link",attrs:{href,target:"_blank",rel:"noreferrer"}});
}
function renderDispatchCards(items){
  refs.dispatchCards.replaceChildren();
  if(!items.length){refs.dispatchCards.append(element("p",{text:"目前沒有可顯示的真實派工案件；未顯示模擬資料。",className:"tf-empty"}));return;}
  for(const item of items){
    const card=element("article",{className:"tf-dispatch-card"});
    const issueLink=item.id?element("a",{className:"tf-dispatch-card-link",attrs:{href:routeFor({issueId:item.id}),"aria-label":`開啟 ${item.title} 的原生 TaskFlow 任務明細`}}):null;
    const head=element("div",{className:"tf-dispatch-card-head"});
    const identity=element("div");
    identity.append(element("small",{text:item.identifier||item.workCode||item.id||"TaskFlow issue",className:"tf-id"}));
    identity.append(element("strong",{text:item.title}));
    head.append(identity,element("span",{text:DISPATCH_STATE_LABELS[item.status]||item.status||"未知",className:"tf-status-tag"}));
    if(issueLink){issueLink.append(head,element("p",{text:`Executor：${item.executor||"未確認"}`}));issueLink.addEventListener("click",event=>{event.preventDefault();history.pushState(null,"",issueLink.href);renderRoute();});card.append(issueLink);}
    else card.append(head);
    const evidence=element("div",{className:"tf-dispatch-card-evidence"});
    evidence.append(element("small",{text:`Executor：${item.executor||"未確認"}`}));
    evidence.append(element("small",{text:`TaskFlow task ID：${item.taskId||"未取得"} · Provider Run ID：${item.providerRunId||"未取得"}`}));
    evidence.append(element("small",{text:`Provider ACK：${item.providerAck||"未驗證"} · Source：${item.evidenceSource||"未取得"}`}));
    if(item.reason)evidence.append(element("small",{text:`原因：${item.reason}`,className:"tf-error"}));
    const links=element("div",{className:"tf-dispatch-evidence-links"});
    if(item.prUrl)links.append(linkNode(item.prUrl,"GitHub PR"));
    if(item.ciUrl)links.append(linkNode(item.ciUrl,"CI 證據"));
    if(item.sha)links.append(element("code",{text:item.sha}));
    if(links.childNodes.length)evidence.append(links);
    card.append(evidence);
    refs.dispatchCards.append(card);
  }
}
function renderPmInbox(items,{error=null}={}){
  if(!refs.pmInbox)return;
  refs.pmInbox.replaceChildren();
  refs.pmInbox.dataset.state=error?"error":"ready";
  if(error){
    refs.pmInbox.append(element("p",{text:`PM Inbox 讀取失敗：${errMessage(error)}；未以空資料取代錯誤。`,className:"tf-error"}));
    return;
  }
  const entries=buildPmInboxEntries(items);
  if(!entries.length){refs.pmInbox.append(element("p",{text:"目前沒有可驗證的 PM 待處理案件；未顯示模擬資料。",className:"tf-empty"}));return;}
  const summary=element("p",{text:`${entries.length} 筆待處理案件（僅依原生 TaskFlow／Runtime 證據分類）。`,className:"tf-inbox-summary"});
  refs.pmInbox.append(summary);
  const list=element("ul",{className:"tf-inbox-list"});
  for(const item of entries){
    const row=element("li",{className:"tf-inbox-item"});
    const link=item.id?element("a",{text:`${item.identifier||item.workCode||item.id}｜${item.title}`,className:"tf-inbox-link",attrs:{href:routeFor({issueId:item.id}),"aria-label":`開啟 ${item.title} 的 PM 待處理案件`}}):element("span",{text:item.title});
    if(item.id)link.addEventListener("click",event=>{event.preventDefault();history.pushState(null,"",link.href);renderRoute();});
    row.append(link,element("span",{text:item.categoryLabel,className:"tf-status-tag"}));
    if(item.reason)row.append(element("small",{text:item.reason,className:"tf-help"}));
    list.append(row);
  }
  refs.pmInbox.append(list);
}
async function loadDispatch(){
  if(!state.workspace||!refs.dispatchCards)return;
  refs.dispatchNotice.textContent="僅顯示原生 TaskFlow API 證據；沒有 Provider ACK 不顯示執行中。";
  try{
    const items=await dispatchAdapter.list(workspaceSlug(),{executor:refs.dispatchExecutor?.value||""});
    renderDispatchCards(items);
    renderPmInbox(items);
    refs.dispatchMeta.textContent=`已讀取 ${items.length} 筆原生案件；Provider 狀態未經 ACK 不會推論。`;
  }catch(error){
    refs.dispatchCards.replaceChildren(element("p",{text:errMessage(error),className:"tf-error"}));
    renderPmInbox([], {error});
    refs.dispatchMeta.textContent="資料讀取失敗，未顯示模擬資料。";
  }
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
    const right=element("span",{className:"tf-status-tag",text:issueDispatchStatus(issue)});
    a.append(main,right);
    a.addEventListener("click",event=>{
      event.preventDefault();
      history.pushState(null,"",a.href);
      renderRoute();
    });
    refs.issues.append(a);
  }
}
async function ensureAgents({silent=false}={}){
  if(!state.workspace)return [];
  if(state.agentsWorkspace===workspaceSlug())return state.agents;
  state.agentsWorkspace=workspaceSlug();
  state.agentsError=null;
  try{
    const value=await transport.listAgents(workspaceSlug());
    state.agents=responseArray(value,"agents");
    return state.agents;
  }catch(error){
    state.agents=[];
    state.agentsError=error;
    if(!silent)setStatus("原生 Agent 清單讀取失敗："+errMessage(error),"error");
    return [];
  }
}
function renderAgentOptions(select,currentId=""){
  select.replaceChildren();
  select.append(element("option",{text:"未綁定原生 Agent（不可啟動）",attrs:{value:""}}));
  for(const agent of state.agents){
    const option=element("option",{text:agentLabel(agent),attrs:{value:agent.id}});
    if(agent.id===currentId)option.selected=true;
    select.append(option);
  }
}
function closeCreate(){refs.create.hidden=true;refs.createStatus.textContent="";refs.createForm.reset();}
function openCreate(){
  refs.create.hidden=false;
  refs.createStatus.textContent="正在讀取可用的原生 Agent…";
  void ensureAgents({silent:true}).then(()=>{
    const select=refs.createForm.elements.namedItem("agentId");
    renderAgentOptions(select);
    refs.createStatus.textContent=state.agentsError?"目前無法取得原生 Agent；仍可建立卡，但不會假造啟動。":"可選擇原生 Agent；未選擇時卡片仍會保留責任代碼與待派工狀態。";
  });
  refs.create.scrollIntoView({behavior:"smooth",block:"start"});
}
function readCreateForm(){
  const form=refs.createForm;
  const sourceEvidence=requiredHttpsUrl(formValue(form,"sourceEvidence"),"來源證據");
  if(!sourceEvidence)throw new Error("來源證據必須填寫完整的 https:// URL");
  const github={
    issueUrl:requiredGithubUrl(formValue(form,"githubIssueUrl"),"GitHub Issue URL"),
    prUrl:requiredGithubUrl(formValue(form,"githubPrUrl"),"GitHub PR URL"),
    commitUrl:requiredGithubUrl(formValue(form,"githubCommitUrl"),"GitHub Commit URL"),
    ciUrl:requiredHttpsUrl(formValue(form,"githubCiUrl"),"CI 證據 URL"),
    sha:formValue(form,"githubSha")
  };
  if(github.sha&&!isExactSha(github.sha))throw new Error("exact SHA 必須是完整 40 或 64 位十六進位字串");
  return {
    workCode:formValue(form,"workCode"),
    title:formValue(form,"title"),
    owner:formValue(form,"owner"),
    priority:formValue(form,"priority"),
    agentId:formValue(form,"agentId"),
    nextStep:formValue(form,"nextStep"),
    sourceEvidence,
    acceptance:formValue(form,"acceptance"),
    github
  };
}
async function writeMetadata(issueId,metadata){
  for(const [key,value] of Object.entries(metadata)){
    if(value!==undefined&&value!==null&&String(value)!=="")await transport.setMetadata(workspaceSlug(),issueId,key,value);
  }
}
async function readNativePullRequests(issueId){
  const value=await transport.listPullRequests(workspaceSlug(),issueId);
  return responseArray(value,"pull_requests");
}
function sameUrl(left,right){
  try{return new URL(left).href.replace(/\/$/,"")===new URL(right).href.replace(/\/$/,"");}catch{return left===right;}
}
async function linkAndReadGithub(issueId,github){
  const warnings=[];
  if(github.prUrl){
    try{
      await transport.linkPullRequest(workspaceSlug(),issueId,github.prUrl);
      const pullRequests=await readNativePullRequests(issueId);
      const native=pullRequests.find(pr=>sameUrl(pr.html_url||"",github.prUrl));
      if(native?.head_sha){
        await transport.setMetadata(workspaceSlug(),issueId,DISPATCH_METADATA_KEYS.githubSha,native.head_sha);
        await transport.setMetadata(workspaceSlug(),issueId,DISPATCH_METADATA_KEYS.githubShaSource,"native_github_mirror");
      }else if(!github.sha){
        warnings.push("PR 已關聯，但 native readback 尚未提供 head SHA");
      }
    }catch(error){
      warnings.push("PR 尚未完成 native 關聯："+(error?.message||"TaskFlow API error"));
    }
  }
  return warnings;
}
async function createNativeIssue(event){
  event.preventDefault();
  refs.createStatus.textContent="";
  const button=refs.createForm.querySelector("button[type=submit]");
  button.disabled=true;
  let issue=null;
  try{
    const form=readCreateForm();
    const payload=buildIssuePayload(form);
    issue=await transport.createIssue(workspaceSlug(),payload);
    if(!issue?.id)throw new TaskFlowPagesError("TaskFlow create response missing issue ID","INVALID_RESPONSE");
    const metadata=buildMetadata(form,{dispatchStatus:"ASSIGNED",observedAt:new Date().toISOString()});
    await writeMetadata(issue.id,metadata);
    const warnings=await linkAndReadGithub(issue.id,form.github);
    closeCreate();
    const message=warnings.length?`已建立原生卡 ${issue.identifier||issue.id}；${warnings.join("；")}`:`已建立原生 TaskFlow 卡 ${issue.identifier||issue.id}，目前狀態為已指派。`;
    setStatus(message,warnings.length?"info":"success");
    await loadData();
    history.pushState(null,"",routeFor({issueId:issue.id}));
    renderRoute();
  }catch(error){
    const prefix=issue?.id?`原生卡 ${issue.identifier||issue.id} 已建立，但欄位尚未完整寫入：`:"";
    refs.createStatus.textContent=prefix+(error?.message||errMessage(error));
    refs.createStatus.dataset.kind="error";
  }finally{button.disabled=false;}
}
function appendEvidenceRow(box,label,value,{link=false}={}){
  const row=element("div",{className:"tf-evidence-row"});
  row.append(element("dt",{text:label}));
  row.append(element("dd",{text:link?undefined:value||"未取得"}));
  if(link)row.lastChild.replaceChildren(linkNode(value));
  box.append(row);
}
function renderDispatchEvidence(container,issue,runs,trustedRuntime){
  const evidence=evidenceSummary(issue);
  const runtime=normalizeDispatchIssue(issue,runs,Date.now(),trustedRuntime);
  const status=runtime.status;
  const panel=element("section",{className:"tf-subpanel",attrs:{"aria-label":"TaskFlow 派工與執行證據"}});
  const heading=element("div",{className:"tf-subpanel-heading"});
  heading.append(element("h3",{text:"派工與執行證據"}));
  heading.append(element("span",{text:DISPATCH_STATE_LABELS[status]||status,className:"tf-status-tag tf-dispatch-status"}));
  panel.append(heading);
  const grid=element("dl",{className:"tf-evidence-grid"});
  appendEvidenceRow(grid,"工作編號",evidence.workCode||"由標題確認");
  appendEvidenceRow(grid,"負責人",evidence.owner);
  appendEvidenceRow(grid,"下一步",evidence.nextStep);
  appendEvidenceRow(grid,"來源證據",evidence.sourceEvidence,{link:true});
  appendEvidenceRow(grid,"驗收條件",evidence.acceptance);
  appendEvidenceRow(grid,"TaskFlow task ID",evidence.taskId);
  appendEvidenceRow(grid,"Provider（受保護讀回）",runtime.provider||"未驗證");
  appendEvidenceRow(grid,"Provider Run ID（受保護讀回）",runtime.providerRunId||"未取得（不可用 TaskFlow task ID 代替）");
  if(evidence.providerRunId)appendEvidenceRow(grid,"未驗證填報資料：Run ID",evidence.providerRunId);
  appendEvidenceRow(grid,"觀測時間（受保護讀回）",runtime.observedAt);
  appendEvidenceRow(grid,"CTO 授權（受保護讀回）",runtime.authorizedBy||"未驗證");
  appendEvidenceRow(grid,"Provider ACK",runtime.providerAck||"未驗證");
  appendEvidenceRow(grid,"Quota",runtime.quotaState||"未取得");
  appendEvidenceRow(grid,"Checkpoint",runtime.checkpoint||"未取得");
  appendEvidenceRow(grid,"Evidence Source",runtime.evidenceSource||"未取得");
  if(runtime.reason)appendEvidenceRow(grid,"阻擋原因",runtime.reason);
  if(evidence.providerError)appendEvidenceRow(grid,"錯誤",evidence.providerError);
  panel.append(grid);
  const actions=element("div",{className:"tf-inline-actions"});
  const start=element("button",{text:issue.assignee_type==="agent"&&issue.assignee_id?"要求啟動原生 Agent":"要求啟動（需原生 Agent）",attrs:{type:"button"}});
  start.disabled=!(issue.assignee_type==="agent"&&issue.assignee_id);
  if(start.disabled)start.title="尚未綁定原生 Agent，不能宣稱已啟動";
  start.addEventListener("click",()=>void requestNativeStart(issue,start));
  actions.append(start);
  const refresh=element("button",{text:"重新讀取執行證據",attrs:{type:"button"}});
  refresh.addEventListener("click",()=>void renderDetail(issue.id));
  actions.append(refresh);
  panel.append(actions);
  const note=element("p",{className:"tf-help"});
  note.textContent=start.disabled?"UNSUPPORTED／BLOCKED：此卡尚未綁定可呼叫的原生 Agent。畫面不會以留言、動畫或假 Run ID 代替執行證據。":"啟動請求會走 TaskFlow 原生 rerun；202 ACK 只代表 TaskFlow 接受 task，Provider Run ID 仍須等待真實 provider 回報。";
  panel.append(note);
  container.append(panel);
}
async function requestNativeStart(issue,button){
  button.disabled=true;
  try{
    const response=await transport.requestStart(workspaceSlug(),issue.id,{});
    if(!response?.id)throw new TaskFlowPagesError("TaskFlow accepted response missing task ID","INVALID_RESPONSE");
    const providerRunId=typeof response.provider_run_id==="string"?response.provider_run_id:"";
    let evidenceError=null;
    try{
      await writeMetadata(issue.id,{
        [DISPATCH_METADATA_KEYS.dispatchStatus]:"ACK_PENDING",
        [DISPATCH_METADATA_KEYS.statusSource]:"taskflow_native_rerun",
        [DISPATCH_METADATA_KEYS.observedAt]:new Date().toISOString(),
        [DISPATCH_METADATA_KEYS.taskId]:response.id,
        ...(typeof response.provider==="string"&&response.provider?{[DISPATCH_METADATA_KEYS.provider]:response.provider}:{}),
        ...(providerRunId?{[DISPATCH_METADATA_KEYS.providerRunId]:providerRunId}: {})
      });
      if(!providerRunId)await transport.deleteMetadata(workspaceSlug(),issue.id,DISPATCH_METADATA_KEYS.providerRunId);
    }catch(error){evidenceError=error;}
    const suffix=evidenceError?`；ACK 證據回寫未完整：${evidenceError.message||"metadata error"}`:"";
    setStatus(`TaskFlow 已 ACK task ${response.id}；Provider Run ID ${providerRunId||"尚未取得"}${suffix}。`,evidenceError?"error":"success");
  }catch(error){
    try{
      await writeMetadata(issue.id,{
        [DISPATCH_METADATA_KEYS.dispatchStatus]:"BLOCKED",
        [DISPATCH_METADATA_KEYS.statusSource]:"taskflow_native_rerun",
        [DISPATCH_METADATA_KEYS.observedAt]:new Date().toISOString(),
        [DISPATCH_METADATA_KEYS.providerError]:error?.message||"TaskFlow start failed"
      });
    }catch { /* preserve the original dispatch failure in the visible notice */ }
    setStatus("原生啟動被阻擋／不支援："+(error?.message||errMessage(error)),"error");
  }finally{
    button.disabled=false;
    await renderDetail(issue.id);
  }
}
async function assignNativeAgent(issue,select,button){
  const agentId=select.value;
  if(!agentId)return;
  button.disabled=true;
  try{
    await transport.updateIssue(workspaceSlug(),issue.id,{assignee_type:"agent",assignee_id:agentId,suppress_run:true});
    try{
      await writeMetadata(issue.id,{
        [DISPATCH_METADATA_KEYS.dispatchStatus]:"ASSIGNED",
        [DISPATCH_METADATA_KEYS.statusSource]:"taskflow_native_assignment",
        [DISPATCH_METADATA_KEYS.observedAt]:new Date().toISOString()
      });
      setStatus("原生 Agent 已指派；尚未啟動執行。","success");
    }catch(error){setStatus("原生 Agent 已指派，但派工 metadata 回寫未完整："+(error?.message||"metadata error"),"error");}
    await renderDetail(issue.id);
  }catch(error){setStatus("原生 Agent 指派失敗："+(error?.message||errMessage(error)),"error");}
  finally{button.disabled=false;}
}
async function renderAssignment(container,issue){
  const panel=element("section",{className:"tf-subpanel",attrs:{"aria-label":"TaskFlow 原生 Agent 指派"}});
  panel.append(element("h3",{text:"原生 Agent 指派"}));
  const form=element("form",{className:"tf-inline-form"});
  const select=element("select",{attrs:{name:"agentId",ariaLabel:"選擇原生 Agent"}});
  renderAgentOptions(select,issue.assignee_id||"");
  const button=element("button",{text:"儲存指派",attrs:{type:"submit"}});
  form.append(select,button);
  form.addEventListener("submit",event=>{event.preventDefault();void assignNativeAgent(issue,select,button);});
  panel.append(form);
  if(state.agentsError)panel.append(element("p",{text:"原生 Agent 清單目前不可讀取，未提供模擬選項。",className:"tf-help tf-error"}));
  container.append(panel);
}
async function saveGithubEvidence(event,issue,form){
  event.preventDefault();
  const button=form.querySelector("button[type=submit]");
  button.disabled=true;
  try{
    const github={
      issueUrl:requiredGithubUrl(formValue(form,"githubIssueUrl"),"GitHub Issue URL"),
      prUrl:requiredGithubUrl(formValue(form,"githubPrUrl"),"GitHub PR URL"),
      commitUrl:requiredGithubUrl(formValue(form,"githubCommitUrl"),"GitHub Commit URL"),
      ciUrl:requiredHttpsUrl(formValue(form,"githubCiUrl"),"CI 證據 URL"),
      sha:formValue(form,"githubSha")
    };
    if(github.sha&&!isExactSha(github.sha))throw new Error("exact SHA 必須是完整 40 或 64 位十六進位字串");
    await writeMetadata(issue.id,buildGithubMetadata(github));
    const warnings=await linkAndReadGithub(issue.id,github);
    setStatus(warnings.length?warnings.join("；"):"GitHub 證據已寫入原生 TaskFlow 卡。",warnings.length?"info":"success");
    await renderDetail(issue.id);
  }catch(error){setStatus("GitHub 證據寫入失敗："+(error?.message||errMessage(error)),"error");}
  finally{button.disabled=false;}
}
function renderGithubEvidence(container,issue,pullRequests){
  const evidence=evidenceSummary(issue);
  const panel=element("section",{className:"tf-subpanel",attrs:{"aria-label":"GitHub 交付證據"}});
  panel.append(element("h3",{text:"GitHub 交付證據"}));
  const form=element("form",{className:"tf-evidence-form"});
  const fields=[
    ["githubIssueUrl","GitHub Issue URL",evidence.githubIssueUrl,"https://github.com/.../issues/..."],
    ["githubPrUrl","GitHub PR URL",evidence.githubPrUrl,"https://github.com/.../pull/..."],
    ["githubCommitUrl","GitHub Commit URL",evidence.githubCommitUrl,"https://github.com/.../commit/..."],
    ["githubCiUrl","CI 證據 URL",evidence.githubCiUrl,"https://github.com/.../actions/runs/..."],
    ["githubSha","exact SHA",evidence.githubSha,"40 或 64 位完整 SHA"]
  ];
  for(const [name,label,value,placeholder] of fields){
    const labelNode=element("label",{className:"tf-form-field"});
    labelNode.append(element("span",{text:label}));
    labelNode.append(element("input",{attrs:{name,id:`tf-detail-${name}`,type:"text",value,placeholder,autocomplete:"off"}}));
    form.append(labelNode);
  }
  const submit=element("button",{text:"寫入 GitHub 證據／關聯 PR",attrs:{type:"submit"}});
  form.append(submit);
  form.addEventListener("submit",event=>void saveGithubEvidence(event,issue,form));
  panel.append(form);
  const list=element("div",{className:"tf-native-prs"});
  if(!pullRequests.length)list.append(element("p",{text:"目前沒有可讀取的 native PR mirror；PR 需先由 TaskFlow GitHub integration 同步。"}));
  for(const pr of pullRequests){
    const row=element("article",{className:"tf-native-pr"});
    row.append(linkNode(pr.html_url,`${pr.repo_owner||""}/${pr.repo_name||""}#${pr.number||"?"}`));
    row.append(element("span",{text:`${pr.state||"unknown"} · ${pr.checks_conclusion||"CI 未判定"}`}));
    row.append(element("small",{text:pr.head_sha?`head_sha ${pr.head_sha}`:"head_sha 未取得",className:"tf-id"}));
    list.append(row);
  }
  panel.append(list);
  container.append(panel);
}
async function renderDetail(id){
  refs.detail.hidden=false;
  refs.detail.replaceChildren(element("p",{text:"正在讀取原生任務資料…"}));
  try{
    const issue=await transport.getIssue(workspaceSlug(),id);
    if(currentRoute().issueId!==id)return;
    await ensureAgents({silent:true});
    const [commentsResult,runsResult,prsResult,runtimeResult]=await Promise.allSettled([
      transport.listComments(workspaceSlug(),id),
      transport.listTaskRuns(workspaceSlug(),id,{active:false}),
      transport.listPullRequests(workspaceSlug(),id),
      transport.getDispatchRuntime(workspaceSlug(),id)
    ]);
    if(runtimeResult.status!=="fulfilled")throw runtimeResult.reason;
    const trustedRuntime=runtimeResult.value?.runtime||runtimeResult.value?.read_model||runtimeResult.value;
    if(!trustedRuntime||typeof trustedRuntime!=="object")throw new TaskFlowPagesError("TaskFlow Runtime Readback response invalid","INVALID_RESPONSE");
    const comments=commentsResult.status==="fulfilled"?responseArray(commentsResult.value,"comments"):[];
    const runs=runsResult.status==="fulfilled"?responseArray(runsResult.value,"tasks"):[];
    const pullRequests=prsResult.status==="fulfilled"?responseArray(prsResult.value,"pull_requests"):[];
    refs.detail.replaceChildren();
    const close=element("button",{text:"← 返回任務列表",className:"tf-back",attrs:{type:"button"}});
    close.addEventListener("click",()=>{history.pushState(null,"",routeFor());renderRoute();});
    refs.detail.append(close);
    refs.detail.append(element("p",{text:issue.identifier||issue.id,className:"tf-id"}));
    refs.detail.append(element("h2",{text:issue.title||"未命名任務"}));
    const info=element("div",{className:"tf-issue-info"});
    const assignedAgent=state.agents.find(agent=>agent.id===issue.assignee_id);
    const dispatchState=normalizeDispatchIssue(issue,runs,Date.now(),trustedRuntime).status;
    for(const [label,value] of [
      ["原生狀態",issue.status_name||issue.status],
      ["派工狀態",DISPATCH_STATE_LABELS[dispatchState]||dispatchState],
      ["優先順序",issue.priority],
      ["負責 Agent",assignedAgent?.name||(issue.assignee_id?issue.assignee_id:"未綁定")],
      ["到期日",issue.due_date],
      ["所屬專案",state.projects.find(p=>p.id===issue.project_id)?.name||"—"]
    ])info.append(element("span",{text:label+": "+(value||"—")}));
    refs.detail.append(info);
    refs.detail.append(element("h3",{text:"任務說明"}));
    refs.detail.append(element("div",{text:issue.description||"尚無說明",className:"tf-description"}));
    renderDispatchEvidence(refs.detail,issue,runs,trustedRuntime);
    await renderAssignment(refs.detail,issue);
    renderGithubEvidence(refs.detail,issue,pullRequests);
    refs.detail.append(element("h3",{text:"TaskFlow 執行歷史"}));
    const runBox=element("div",{className:"tf-comments"});
    if(runsResult.status!=="fulfilled")runBox.append(element("p",{text:"執行歷史讀取失敗："+errMessage(runsResult.reason)}));
    else if(!runs.length)runBox.append(element("p",{text:"尚無原生 task run；此卡尚未取得啟動 ACK。"}));
    for(const run of runs.slice(0,20))runBox.append(element("article",{text:`${run.status||"unknown"} · task ${run.id||"—"} · ${run.started_at||run.created_at||"時間未取得"}`,className:"tf-comment"}));
    refs.detail.append(runBox);
    refs.detail.append(element("h3",{text:"留言"}));
    const commentsBox=element("div",{className:"tf-comments"});
    if(commentsResult.status!=="fulfilled")commentsBox.append(element("p",{text:"留言讀取失敗："+errMessage(commentsResult.reason)}));
    else if(!comments.length)commentsBox.append(element("p",{text:"尚無留言。"}));
    for(const comment of comments)commentsBox.append(element("article",{text:typeof comment.content==="string"?comment.content:(comment.body||"留言"),className:"tf-comment"}));
    refs.detail.append(commentsBox);
  }catch(error){refs.detail.replaceChildren(element("p",{text:errMessage(error),className:"tf-error"}));}
}
function nativeStatusLabel(status){
  const key=String(status||"").toLowerCase();
  const found=state.statuses.find(item=>String(item.id||item.slug||item.key||"").toLowerCase()===key||String(item.name||item.title||"").toLowerCase()===key);
  return found?.name||found?.title||status||"未分類";
}
function renderAiKanban(items){
  refs.aiKanban.replaceChildren();
  const columns=state.statuses.map(item=>({id:item.id||item.slug||item.key,name:item.name||item.title||item.id}));
  const groups=columns.length?columns:["待規劃","待辦","進行中","稽核中","已阻塞","已完成"].map(name=>({id:name,name}));
  for(const group of groups){
    const column=element("section",{className:"tf-ai-column",attrs:{"aria-label":group.name}});
    column.append(element("h3",{text:group.name}));
    const cards=items.filter(item=>String(item.raw?.status_id||item.raw?.status||item.raw?.status_name||"").toLowerCase()===String(group.id).toLowerCase()||nativeStatusLabel(item.raw?.status_name||item.raw?.status)===group.name);
    if(!cards.length)column.append(element("p",{text:"沒有原生卡",className:"tf-empty"}));
    for(const item of cards){
      const card=element("a",{className:"tf-ai-card",attrs:{href:routeFor({issueId:item.id}),"aria-label":`開啟 ${item.title} 原生任務`}});
      card.append(element("small",{text:item.identifier||item.id,className:"tf-id"}),element("strong",{text:item.title}),element("span",{text:`負責 AI：${item.executor||"未確認"}`,className:"tf-ai-owner"}));
      card.addEventListener("click",event=>{event.preventDefault();history.pushState(null,"",card.href);renderRoute();});
      column.append(card);
    }
    refs.aiKanban.append(column);
  }
  if(!items.length)refs.aiBoardNotice.textContent="目前沒有具備原生 AI 派工證據的 Issue；未將一般 TaskFlow 任務偽裝成 AI 案件。";
}
async function loadAiBoard(){
  if(!state.workspace)return;
  try{
    const route=currentRoute();
    const executor=route.section==="ai-projects"&&route.issueId?route.issueId:(refs.aiExecutor?.value||"");
    const items=await dispatchAdapter.list(workspaceSlug(),{executor});
    renderAiKanban(items);
    refs.aiBoardNotice.textContent=`已讀取 ${items.length} 張原生 AI Issue；專案與任務入口共用相同 Issue ID。`;
  }catch(error){refs.aiKanban.replaceChildren(element("p",{text:errMessage(error),className:"tf-error"}));refs.aiBoardNotice.textContent="原生 TaskFlow API 讀取失敗，未顯示模擬看板。";}
}
function renderAiProjectEntries(){
  const executors=["CO-01","CO-02","CO-03","GEM-01","GH-HELPER"];
  const workspaceId=String(state.workspace?.id||"");
  refs.aiProjectEntries.replaceChildren();
  for(const executor of executors){
    const matches=state.projects.filter(item=>{
      const mappedExecutor=String(item?.executor_id||item?.executor||"").trim().toUpperCase();
      return mappedExecutor===executor && Boolean(item?.id) && workspaceId &&
        String(item?.workspace_id||"")===workspaceId &&
        item?.acl_allowed===true && item?.access_allowed===true;
    });
    const project=matches.length===1?matches[0]:null;
    if(!project){
      const missing=element("div",{className:"tf-ai-project-entry tf-ai-project-entry-disabled",attrs:{"aria-label":`${executor} 原生專案尚未接通`}});
      missing.append(element("strong",{text:executor}),element("span",{text:"GAP：Executor、Workspace、ACL 的 Native Project 對應缺失或不唯一"}));
      refs.aiProjectEntries.append(missing); continue;
    }
    const webUrl=globalThis.ZhugeTaskFlowConfig?.webUrl||"https://zhuge-taskflow-web.onrender.com";
    const href=`${webUrl}/${encodeURIComponent(workspaceSlug())}/projects/${encodeURIComponent(project.id)}`;
    const link=element("a",{className:"tf-ai-project-entry",attrs:{href,"aria-label":`開啟 ${executor} 原生專案`}});
    link.append(element("strong",{text:executor}),element("span",{text:`Native Project：${project.id}`}));
    refs.aiProjectEntries.append(link);
  }
}
function renderRoute(){
  if(!state.workspace)return;
  const route=currentRoute();
  if(refs.dispatch)refs.dispatch.hidden=route.section!=="dispatch";
  if(refs.aiProjects)refs.aiProjects.hidden=!(route.section==="ai-projects"&&!route.issueId);
  if(route.section==="ai-projects"&&!route.issueId)renderAiProjectEntries();
  if(refs.aiBoard)refs.aiBoard.hidden=!(["ai-projects","ai-tasks"].includes(route.section));
  if(refs.aiBoard&&route.section==="ai-projects"&&!route.issueId)refs.aiBoard.hidden=true;
  if(refs.aiBoard&&["ai-projects","ai-tasks"].includes(route.section)){refs.aiBoardTitle.textContent=route.section==="ai-projects"?"AI 派工中心｜原生專案":"AI 任務中心｜原生任務";void loadAiBoard();}
  if(route.section==="dispatch"){
    refs.detail.hidden=true;
    refs.detail.replaceChildren();
    void loadDispatch();
    return;
  }
  refs.detail.hidden=!(route.section==="issues"&&route.issueId);
  if(route.section==="issues"&&route.issueId)void renderDetail(route.issueId);
  else{refs.detail.hidden=true;refs.detail.replaceChildren();renderIssues(route.section==="projects"?route.issueId:null);}
}
async function loadData(){
  if(!state.workspace)return;
  state.loading=true;
  refs.refresh.disabled=true;
  setStatus("正在從 TaskFlow 正式 API 讀取工作區資料…");
  try{
    const slug=workspaceSlug();
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
    refs.meta.textContent="已載入 "+issues.issues.length+" / "+issues.total+" 筆任務 · 原生 TaskFlow API · 可建立 DM-00～DM-03 原生卡";
    renderProjects();
    renderRoute();
    setStatus("已連接正式 TaskFlow 工作區","success");
  }catch(error){state.issues=[];state.total=0;refs.issues.replaceChildren();refs.detail.replaceChildren();fail(error);}
  finally{state.loading=false;refs.refresh.disabled=false;}
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
    state.agentsWorkspace=null;
    renderWorkspaceSelect();
    refs.login.hidden=true;
    if(refs.createOpen)refs.createOpen.hidden=false;
    await loadData();
  }catch(error){fail(error);}finally{refs.refresh.disabled=false;}
}
refs.workspace.addEventListener("change",async event=>{
  state.workspace=state.workspaces.find(w=>w.slug===event.target.value)||null;
  if(state.workspace)sessionStorage.setItem("tf-pages-active-slug",state.workspace.slug);
  state.agentsWorkspace=null;
  history.replaceState(null,"",routeFor());
  await loadData();
});
document.querySelector("#tf-login-action").addEventListener("click",()=>markExplicitReturn(sessionStorage));
refs.refresh.addEventListener("click",()=>void bootstrap());
refs.createOpen?.addEventListener("click",openCreate);
refs.createCancel?.addEventListener("click",closeCreate);
refs.createForm?.addEventListener("submit",event=>void createNativeIssue(event));
refs.dispatchExecutor?.addEventListener("change",()=>void loadDispatch());
refs.aiExecutor?.addEventListener("change",()=>void loadAiBoard());
let searchDelay;
refs.filter.addEventListener("input",()=>{
  clearTimeout(searchDelay);
  searchDelay=setTimeout(()=>void loadData(),350);
});
window.addEventListener("popstate",renderRoute);
window.addEventListener("hashchange",renderRoute);
void bootstrap();
