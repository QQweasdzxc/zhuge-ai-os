// Read-only projection of canonical task dates. No task, Google, or WorkLog writes.
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)?value.slice(0,10):null;
export function taskDateMarkers(rows,{workspaceId,from,to}){
 const markers=new Map();
 for(const row of rows){
  if(row.workspace_id!==workspaceId||!row.id)continue;
  const start=day(row.start_date),due=day(row.due_date);
  for(const date of new Set([start,due].filter(Boolean))){
   if(date<from||date>=to)continue;
   markers.set(row.id+':'+date,{id:row.id,title:row.title,date,kind:start===date&&due===date?'both':start===date?'start':'due',identifier:row.identifier||'',completed:['completed','done'].includes(row.status_category),status:row.status});
  }
 }
 return [...markers.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
}
export async function loadTaskDueDates(listIssues,{workspaceId,from,to}){
 if(!workspaceId||!day(from)||!day(to)||from>=to)throw new Error('任務日期範圍無法確認');
 const rows=[];let offset=0;
 for(let page=0;page<100;page++){
  // Current TF date_field accepts created_at/updated_at, not task dates.
  // scheduled=true is the native start/due selector; filter calendar window locally.
  const batch=await listIssues({workspace_id:workspaceId,scheduled:true,sort_by:'position',limit:100,offset});
  if(!Array.isArray(batch.issues)||!Number.isInteger(batch.total))throw new Error('任務資料尚未完整載入');
  rows.push(...batch.issues);offset+=batch.issues.length;
  if(offset>=batch.total)return taskDateMarkers(rows,{workspaceId,from,to});
  if(!batch.issues.length)throw new Error('任務資料尚未完整載入');
 }
 throw new Error('任務資料量超過本次載入範圍，尚未顯示不完整結果');
}
