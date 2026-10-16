"use client";

/**
 * First native-view composition for the GitHub Pages TF Dashboard.
 * Reuses ORIGINAL Multica TaskFlow view components, not a re-created
 * read-only lookalike. Parent must have initialized CoreProvider with a
 * verified TF user, workspace and in-memory bearer.
 * Source only. Do not deploy without native UI compilation and E2E parity.
 */
import {useEffect,type ReactNode} from "react";
import {WorkspaceSlugProvider} from "@multica/core/paths";
import {setCurrentWorkspace} from "@multica/core/platform";
import {DashboardLayout} from "@multica/views/layout";
import {DashboardPage} from "@multica/views/dashboard";
import {IssuesPage,IssueDetailRoute} from "@multica/views/issues/components";
import {ProjectsPage} from "@multica/views/projects/components";
import {SettingsPage} from "@multica/views/settings";

function WorkspaceContext({workspace,children}:{
 workspace:{id:string;slug:string};children:ReactNode
}){
 useEffect(()=>{
   setCurrentWorkspace(workspace.slug,workspace.id);
   return ()=>setCurrentWorkspace(null,null);
 },[workspace.id,workspace.slug]);
 return <WorkspaceSlugProvider slug={workspace.slug}>{children}</WorkspaceSlugProvider>;
}

/**
 * Workspace must be selected from authenticated native GET /api/workspaces.
 * Dashboard is mapped to the exact canonical GitHub Pages root.
 * Child routes are encoded in Pages-safe hash URLs.
 */
export function TaskFlowPagesNativeSurface({workspace,nativePath}:{
 workspace:{id:string;slug:string};nativePath:string
}){
 const pieces=nativePath.split("?")[0].replace(/^\\/+|\\/+$/g,"").split("/").filter(Boolean);
 let screen:ReactNode=null;
 if(nativePath==="/" || pieces.length===1 && pieces[0]===workspace.slug){
   screen=<DashboardPage/>;
 }else if(pieces[0]===workspace.slug){
   switch(pieces[1]){
    case "issues":
      screen=pieces.length===2?<IssuesPage/>:
        pieces.length===3?<IssueDetailRoute routeId={pieces[2]}/>:null;
      break;
    case "projects":
      screen=pieces.length===2?<ProjectsPage/>:null;
      break;
    case "settings":
      screen=<SettingsPage/>;
      break;
    default:
      screen=null;
   }
 }
 if(!screen) return (
  <main role="alert" className="p-6 text-sm">
   此 TaskFlow 路由尚未通過 Pages 原生功能驗收，沒有執行導向 Render 的替代跳轉。
  </main>
 );
 return (
  <WorkspaceContext workspace={workspace}>
   <DashboardLayout>{screen}</DashboardLayout>
  </WorkspaceContext>
 );
}
