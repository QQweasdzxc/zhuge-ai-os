"use client";
/** Native Run readback through the existing TaskFlow authenticated API.
 * Read-only: never creates an agent, approval, GitHub comment or cloud task.
 */
import { useEffect, useState } from "react";
import { api } from "@multica/core/api";

type NativeRun = {
  id:string; engineer:"co"|"gem"; state:string; github_pr:number;
  checkpoint_sha:string; created_at:string; provider_thread_id:string|null;
  last_evidence_sha:string|null; revision:number;
};
type View = {phase:"loading"|"unavailable"|"ready";runs:NativeRun[]};
const STATUS:Record<string,string>={
  approved:"PM 已核准・等待安全派工",
  claim_pending:"正在確認單一工程師工作權",
  provider_ack_pending:"已送出・等待 Codex 官方確認",
  running:"已啟動・執行中",
  blocked:"執行受阻・等待處理",
  review_pending:"已回報・等待驗收",
  completed:"完成",
  failed:"執行失敗",
  cancelled:"已取消",
};
function safeRun(value:unknown):value is NativeRun {
  if(!value||typeof value!=="object")return false;
  const x=value as Partial<NativeRun>;
  return typeof x.id==="string"&&/^[a-f0-9-]{36}$/.test(x.id)&&
    (x.engineer==="co"||x.engineer==="gem")&&
    typeof x.state==="string"&&Object.hasOwn(STATUS,x.state)&&
    Number.isSafeInteger(x.github_pr)&&typeof x.checkpoint_sha==="string"&&
    /^[a-f0-9]{40}$/.test(x.checkpoint_sha)&&typeof x.created_at==="string"&&
    Number.isSafeInteger(x.revision);
}
export function TaskFlowAIRunReadback({workspaceId,issueId}:{
  workspaceId:string;issueId:string;
}) {
  const [reload,setReload]=useState(0);
  const [view,setView]=useState<View>({phase:"loading",runs:[]});
  useEffect(()=>{
    const controller=new AbortController();
    setView({phase:"loading",runs:[]});
    const run=async()=>{
      try {
        const base=api.getBaseUrl();
        const token=api.getToken();
        if(!base||!/^[0-9a-f-]{36}$/i.test(issueId)||!/^[0-9a-f-]{36}$/i.test(workspaceId))
          throw Error("native identity unavailable");
        const target=new URL(base.replace(/\/$/,"")+"/api/issues/"+
          encodeURIComponent(issueId)+"/zhuge-ai/runs");
        target.searchParams.set("workspace_id",workspaceId);
        // TaskFlow ApiClient is the sole token owner; never store/log a bearer
        // and never use any destination beyond its configured API origin.
        const headers:Record<string,string>={Accept:"application/json"};
        if(token)headers.Authorization="Bearer "+token;
        const response=await fetch(target.toString(),{
          method:"GET",headers,credentials:"include",cache:"no-store",signal:controller.signal
        });
        if(response.status!==200)throw Error("native Run API not available");
        const payload:unknown=await response.json();
        const data=payload as {runs?:unknown;dispatch_enabled?:unknown};
        if(!data||!Array.isArray(data.runs)||data.runs.length>20||
          data.dispatch_enabled!==false||!data.runs.every(safeRun))
          throw Error("invalid native Run evidence");
        if(!controller.signal.aborted)setView({phase:"ready",runs:data.runs});
      }catch{
        if(!controller.signal.aborted)setView({phase:"unavailable",runs:[]});
      }
    };
    void run();
    return ()=>controller.abort();
  },[workspaceId,issueId,reload]);
  return <section aria-label="TaskFlow 原生 AI Run 紀錄" className="space-y-1">
    <div className="flex items-center justify-between">
      <span>工程執行紀錄</span>
      <button type="button" className="text-muted-foreground underline"
        onClick={()=>setReload(value=>value+1)} aria-label="重新讀取 TaskFlow AI Run">
        更新狀態
      </button>
    </div>
    {view.phase==="loading"&&<p className="text-muted-foreground">正在讀取正式 Run 紀錄…</p>}
    {view.phase==="unavailable"&&<p className="text-muted-foreground">正式 Run 服務尚未接通，不能確認 Co 已啟動。</p>}
    {view.phase==="ready"&&view.runs.length===0&&
      <p className="text-muted-foreground">尚無 TaskFlow 已核實的執行紀錄。</p>}
    {view.phase==="ready"&&view.runs.map(run=><div key={run.id}
      className="rounded border p-2 space-y-1">
      <div>{run.engineer==="co"?"Co｜Codex":"Gem｜Gemini"}：{STATUS[run.state]}</div>
      <div>GitHub PR #{run.github_pr} · Commit {run.checkpoint_sha.slice(0,8)}</div>
      <div className="text-muted-foreground">
        {run.provider_thread_id?"執行緒："+run.provider_thread_id:"尚無官方執行緒收據"}
      </div>
    </div>)}
  </section>;
}
