"use client";
import React,{useEffect,useState,useRef} from 'react';
import {useAuthStore} from '@multica/core/auth';
import {useWorkspaceSlug} from '@multica/core/paths';
import {TaskFlowWorklog} from './taskflow-worklog';
import {WorklogConnection} from './worklog-connection.mjs';
import {WorklogService,supabaseRequest} from './worklog-service.mjs';
const enabled=process.env.NEXT_PUBLIC_TASKFLOW_WORKLOG_ENABLED==='true';
const calendarEnabled=process.env.NEXT_PUBLIC_TASKFLOW_WORKLOG_CALENDAR_ENABLED==='true';
const supabaseUrl=process.env.NEXT_PUBLIC_TASKFLOW_WORKLOG_SUPABASE_URL||'';
const anonKey=process.env.NEXT_PUBLIC_TASKFLOW_WORKLOG_ANON_KEY||'';
const library='https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=library';
function connection(userId:string){return new WorklogConnection({userId,supabaseUrl,anonKey,enabled,calendarEnabled,storage:window.localStorage,location:{origin:window.location.origin,href:window.location.href,assign:(url:string)=>window.location.assign(url),replaceHistory:(path:string)=>window.history.replaceState(null,'',path)}})}
export function TaskFlowWorklogPage(){
 const userId=useAuthStore(s=>s.user?.id),slug=useWorkspaceSlug();
 const [service,setService]=useState<WorklogService|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refreshSignal,setRefreshSignal]=useState(0),[calendar,setCalendar]=useState<{status:string;calendarName?:string;error?:string}|null>(null);
 useEffect(()=>{setService(null);setError('');if(!enabled||!userId||!supabaseUrl||!anonKey)return;try{const auth=connection(userId);setService(new WorklogService({userId,request:supabaseRequest({baseUrl:supabaseUrl,anonKey,expectedUserId:userId,getSession:()=>auth.getSession()}),resourceFetch:(path,options)=>fetch('/worklog-assets/'+String(path).replace(/^resources\//,''),options)}))}catch{setError('工時連線設定尚未完成；既有資料沒有更改。')}},[userId]);
 const calendarAction=async(action:string)=>{if(!userId||!calendarEnabled)throw new Error('Google 日曆雙向同步尚未開放；目前不會建立或更改日曆事件。');const session=await connection(userId).getSession();const response=await fetch(new URL('/functions/v1/worklog-google-sync',supabaseUrl),{method:'POST',headers:{apikey:anonKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action}),cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.message||'Google 工時日曆同步未完成');if(action==='status')setCalendar(result);return result;};
 useEffect(()=>{if(!service||!calendarEnabled)return;let alive=true;void calendarAction('status').catch(()=>{if(alive)setCalendar(null)});return()=>{alive=false}},[service]);
 const syncAfterSave=async()=>{if(!calendarEnabled||calendar?.status!=='connected')return;try{const result=await calendarAction('run');if(result.status==='synced'||result.status==='initialized'){await calendarAction('status');setRefreshSignal(v=>v+1);setNotice('工時已儲存，Google 工時日曆已同步。');}else setNotice('工時已儲存；Google 日曆同步尚未完成，原工時保留。');}catch{setNotice('工時已儲存；Google 日曆同步未完成，請重試或重新連線。');}};
 const connectGoogle=async()=>{if(!userId||!slug)return;if(!calendarEnabled){setNotice('Google 日曆雙向同步尚未開放；目前不會建立或更改日曆事件。');return}try{await connection(userId).start('/'+encodeURIComponent(slug)+'/worklog',{calendar:true})}catch(e){setNotice(e instanceof Error?e.message:'日曆連線未完成')}};
 const connect=async()=>{if(!userId||!slug)return;try{await connection(userId).start('/'+encodeURIComponent(slug)+'/worklog')}catch(e){setError(e instanceof Error?e.message:'無法開始連線')}};
 if(!service)return <section className="p-6"><h1>工時與月報</h1><p>{error||(!userId?'請先登入 TF。':!enabled?'原生工時整合尚未開放。既有工時、工作知識與月報仍保留在原入口。':'正在準備工時連線…')}</p><a href={library}>開啟既有我的工作與工時</a></section>;
 return <div className="taskflow-worklog-host">{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}<button onClick={()=>setNotice('')}>關閉</button></p>}{calendar?.status==='connected'&&<p role="status">Google 工時日曆：{calendar.calendarName}{calendar.error?' · '+calendar.error:''}<button onClick={()=>void syncAfterSave()}>同步</button><button onClick={()=>void calendarAction('disconnect').then(()=>calendarAction('status')).catch(()=>setNotice('連線正在同步，請稍後再試'))}>中斷同步</button></p>}<TaskFlowWorklog refreshSignal={refreshSignal} onAfterSave={syncAfterSave} onConnectData={connect} service={service} onOpenLibrary={()=>window.location.assign(library)} onConnectGoogle={connectGoogle}/></div>;
}
export function TaskFlowWorklogConnect(){
 const started=useRef(false);const userId=useAuthStore(s=>s.user?.id),status=useAuthStore(s=>s.status),[message,setMessage]=useState('正在確認工時連線…');
 useEffect(()=>{if(!enabled){window.history.replaceState(null,'','/auth/worklog');setMessage('工時連線尚未開放，沒有更改原有登入。');return}if(!userId){if(status==='unauthenticated')setMessage('請先登入 TF，再從工時頁重新連線。');return}if(started.current)return;started.current=true;connection(userId).finish().then(path=>window.location.replace(path)).catch(e=>setMessage(e instanceof Error?e.message:'工時連線未完成'))},[userId,status]);
 return <section className="p-6"><h1>工時連線</h1><p role="status">{message}</p></section>;
}
