import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAuthStore, registerAuthStore } from "@multica/core/auth";
import { setApiInstance } from "@multica/core/api";
import { I18nProvider } from "@multica/core/i18n/react";
import { WorkspaceSlugProvider } from "@multica/core/paths";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { setCurrentWorkspace } from "@multica/core/platform";
import { getIssueSurfaceViewStore } from "@multica/core/issues/stores/surface-view-store";
import { ViewStoreProvider } from "@multica/core/issues/stores/view-store-context";
import { TaskFlowProjectStatusScopeProvider } from "@multica/core/issue-statuses/taskflow-project-status-scope";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { visibleStatusKeys } from "@multica/core/issues";
import { BoardColumn } from "../../../packages/views/issues/components/board-column";
import { TaskFlowProjectStatusSettings } from "../../../packages/views/issues/components/taskflow-project-status-settings";
import { RESOURCES } from "@multica/views/locales";
import { TooltipProvider } from "@multica/ui/components/ui/tooltip";
import { Toaster } from "sonner";
import { createFixtureApi, memoryStorage, user, workspace } from "./product-fixtures";
import "./styles.css";
const projects=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"];
const base=createFixtureApi(()=>"en");
const writes: unknown[]=[];
const api=new Proxy(base,{get(target,key){
 if(key==="getIssueViewPreference") return async (scope:any)=>JSON.parse(localStorage.getItem("fixture-pref:"+scope.scope_id)??"null")??{...scope,prefs:{hidden:[],order:[],unrelated:"keep",taskflow_hidden_statuses:["cancelled"]},updated_at:""};
 if(key==="putIssueViewPreference") return async (input:any)=>{ if((window as any).fixtureFailSave) throw new Error("fixture rejected save");writes.push(input);localStorage.setItem("fixture-pref:"+input.scope_id,JSON.stringify(input));return structuredClone(input); };
 if(key==="listIssueStatuses") return async()=>({statuses:["backlog","todo","in_progress","in_review","blocked","done","cancelled"].map((key,index)=>({id:key,workspace_id:workspace.id,key,name:{backlog:"Backlog",todo:"Todo",in_progress:"In Progress",in_review:"In Review",blocked:"Blocked",done:"Done",cancelled:"Cancelled"}[key],category:["done","cancelled"].includes(key)?key==="done"?"done":"closed":["in_progress","in_review","blocked"].includes(key)?"started":"unstarted",description:"",color:"#777777",is_system:true,position:index,archived_at:null,created_at:"",updated_at:""})),total:7,categories:[]});
 return Reflect.get(target,key);
}});
setApiInstance(api);const storage=memoryStorage();const auth=createAuthStore({api,storage});auth.setState({user,isLoading:false,status:"authenticated"});registerAuthStore(auth);setCurrentWorkspace(workspace.slug,workspace.id);
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});queryClient.setQueryData(workspaceKeys.list(),[workspace]);
const store=getIssueSurfaceViewStore("column-order-browser-fixture");store.setState({viewMode:"board"});
Object.assign(window,{fixtureWrites:writes,fixtureCards:[{id:"original-card",status:"todo"}]});
function Board({projectId}:{projectId:string}){const catalog=useIssueStatuses(workspace.id);const keys=visibleStatusKeys([], ["cancelled"],catalog);return <><TaskFlowProjectStatusSettings projectId={projectId}/><div data-board-scroller="" style={{display:"flex",gap:16,overflowX:"auto",height:500,padding:8}}>{keys.map(status=><BoardColumn key={status} group={{id:status,status,title:status}} issueIds={[]} issueMap={new Map()} projectId={projectId}/>)}</div></>;}
function App(){const [project,setProject]=useState(projects[0]!);return <QueryClientProvider client={queryClient}><I18nProvider locale="zh-Hant" resources={RESOURCES}><WorkspaceSlugProvider slug={workspace.slug}><TooltipProvider><div className="dark" style={{background:"#071720",color:"white",height:"100vh",padding:16}}><button onClick={()=>setProject(project===projects[0]?projects[1]!:projects[0]!)}>切換專案</button><p data-testid="project">{project}</p><TaskFlowProjectStatusScopeProvider key={project} projectId={project}><ViewStoreProvider store={store}><Board projectId={project}/></ViewStoreProvider></TaskFlowProjectStatusScopeProvider></div><Toaster/></TooltipProvider></WorkspaceSlugProvider></I18nProvider></QueryClientProvider>;}
createRoot(document.getElementById("root")!).render(<App/>);
