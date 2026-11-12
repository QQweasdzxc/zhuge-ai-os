// Executable sync coordinator with injected owner-scoped storage and provider.
// Native activation is disabled until durable storage/provider wiring is installed.
import {planSelectedCalendarEvent,proposedActualEvent} from './calendar-mapping-candidate.mjs';
export class GoogleWorklogSync {
 constructor({worklog,provider,store,userId,calendarId,enabled=false}){if(!worklog||!provider||!store||!userId||!calendarId)throw new Error('Owner-scoped sync dependencies required');Object.assign(this,{worklog,provider,store,userId,calendarId,enabled});}
 async importEvent(event,{historical=false}={}){
  if(!this.enabled)throw new Error('工時日曆同步尚未啟用，沒有改動資料');
  if(historical)return {status:'skipped-history'};
  const binding=await this.store.byEvent(this.userId,this.calendarId,event.id);
  // Stable operation identities come from durable store, not title/time matching.
  const operation=await this.store.operation(this.userId,this.calendarId,event.id);
  let entry=binding?await this.store.entry(this.userId,binding.entryId):operation.entryId?await this.store.entry(this.userId,operation.entryId):this.store.entryByOperation?await this.store.entryByOperation(this.userId,operation.id):null;
  const plan=planSelectedCalendarEvent({entry,event,binding,entries:this.worklog.snapshot?.entries||[],userId:this.userId,calendarId:this.calendarId,selectedCalendarId:this.calendarId,profile:this.worklog.snapshot?.profile,operationId:operation.id,defaultEcpTask:(this.worklog.snapshot?.ecpTasks||[]).find(name=>event.summary&&event.summary.includes(name))||this.worklog.snapshot?.ecpTasks?.[0]||''});
  if(plan.action==='conflict'){await this.store.failure(this.userId,operation.id,'CONFLICT');await this.store.saveConflict({userId:this.userId,calendarId:this.calendarId,...plan.conflict});throw Object.assign(new Error(plan.message),{code:'CONFLICT'});}
  // A decided plan supersedes any older pending conflict for the same operation.
  if(binding&&plan.action!=='error')await this.store.clearConflict(this.userId,this.calendarId,operation.id);
  if(plan.action==='local-newer'){await this.store.bind({...binding,eventEtag:event.etag});return {status:'local-newer'};}
  if(['unchanged','remote-deleted','local-deleted'].includes(plan.action))return {status:plan.action};
  if(plan.action==='error'){await this.store.failure(this.userId,operation.id,plan.code);throw Object.assign(new Error(plan.message),{code:plan.code});}
  try{await this.store.assertLease?.();const[saved]=await this.worklog.saveBatch([plan.proposed],plan.proposed.date);await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:event.id,eventEtag:event.etag,entryId:saved.cloudId,entryUpdatedAt:saved.updatedAt,operationId:operation.id});return {status:'synced',entry:saved};}
  catch(error){await this.store.failure(this.userId,operation.id,'IMPORT_FAILED');throw error;}
 }
 async listConflicts(){
  if(!this.enabled)throw new Error('工時日曆同步尚未啟用，沒有改動資料');
  return this.store.conflicts(this.userId,this.calendarId);
 }
 // Owner-reviewed choice for a recorded both-sides-changed conflict. Every live
 // version must still equal the reviewed snapshot; otherwise nothing is written
 // and the conflict must be reloaded. Conditional writes keep their own guards:
 // Google If-Match on the event etag, work_entries updated_at on the TF save.
 async resolveConflict({operationId,choice,eventEtag,entryUpdatedAt}){
  if(!this.enabled)throw new Error('工時日曆同步尚未啟用，沒有改動資料');
  if(choice!=='keep-local'&&choice!=='keep-remote')throw Object.assign(new Error('請選擇要保留的版本'),{code:'CHOICE_REQUIRED'});
  const conflict=await this.store.conflict(this.userId,this.calendarId,operationId);
  if(!conflict||conflict.status!=='pending')throw Object.assign(new Error('這個衝突已處理或不存在'),{code:'CONFLICT_GONE'});
  if(conflict.eventEtag!==eventEtag||String(conflict.entryUpdatedAt||'')!==String(entryUpdatedAt||''))throw Object.assign(new Error('衝突內容已有更新，請重新確認'),{code:'CONFLICT_CHANGED'});
  const binding=await this.store.byEvent(this.userId,this.calendarId,conflict.eventId);
  const year=Number(String(conflict.remote?.date||'').slice(0,4));
  if(Number.isInteger(year)&&year>=1900&&year<=2200&&this.worklog.snapshot?.year!==year)await this.worklog.load(year);
  const entry=await this.store.entry(this.userId,conflict.entryId);
  let event=null;
  try{event=await this.provider.get(this.calendarId,conflict.eventId);}catch(error){if(error?.status!==404)throw error;}
  if(!binding||binding.entryId!==conflict.entryId||!entry||entry.status==='deleted'||!event||event.status==='cancelled'||event.etag!==conflict.eventEtag||(entry.updatedAt||null)!==(conflict.entryUpdatedAt||null))throw Object.assign(new Error('版本已有新的變動，請重新確認差異'),{code:'CONFLICT_CHANGED'});
  await this.store.assertLease?.();
  if(choice==='keep-local'){
   const desired=proposedActualEvent(entry,{userId:this.userId,eventId:conflict.eventId});
   const remote=await this.provider.update(this.calendarId,desired,event.etag);
   if(!remote?.id||!remote.etag)throw new Error('日曆沒有回傳完整儲存結果');
   await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:remote.id,eventEtag:remote.etag,entryId:entry.cloudId,entryUpdatedAt:entry.updatedAt,operationId:binding.operationId||operationId});
  }else{
   // binding:null maps the reviewed remote values onto the same entry while the
   // original storage rules keep local notes, task links, kind and identity.
   const plan=planSelectedCalendarEvent({entry,event,binding:null,entries:this.worklog.snapshot?.entries||[],userId:this.userId,calendarId:this.calendarId,selectedCalendarId:this.calendarId,profile:this.worklog.snapshot?.profile,operationId});
   if(plan.action!=='update-entry')throw Object.assign(new Error(plan.message||'日曆版本無法套用，原資料保留'),{code:plan.code||'CONFLICT_CHANGED'});
   const[saved]=await this.worklog.saveBatch([plan.proposed],plan.proposed.date);
   await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:event.id,eventEtag:event.etag,entryId:saved.cloudId,entryUpdatedAt:saved.updatedAt,operationId});
  }
  await this.store.clearConflict(this.userId,this.calendarId,operationId,{eventEtag:conflict.eventEtag,entryUpdatedAt:conflict.entryUpdatedAt});
  return {status:'resolved',choice,operationId};
 }
 // Only a new owner-confirmed deletion intent may remove its exact durable
 // binding. Old tombstones, title matches and unbound events are never swept.
 async deleteLinkedEvent(entry){
  if(!entry.googleDeleteRequestedAt)return {status:'local-deleted'};
  const binding=await this.store.byEntry(this.userId,this.calendarId,entry.cloudId);
  if(!binding)return {status:'local-only'};
  if(binding.userId!==this.userId||binding.calendarId!==this.calendarId||binding.entryId!==entry.cloudId||!binding.eventId||!binding.eventEtag)throw Object.assign(new Error('工時日曆綁定無法核實，沒有刪除事件'),{code:'DELETE_BINDING_INVALID'});
  if(binding.entryUpdatedAt===entry.updatedAt)return {status:'delete-synced',eventId:binding.eventId};
  try{
   await this.store.assertLease?.();
   const current=await this.store.entry(this.userId,entry.cloudId);
   if(!current||current.status!=='deleted'||current.updatedAt!==entry.updatedAt||current.googleDeleteRequestedAt!==entry.googleDeleteRequestedAt)throw Object.assign(new Error('刪除要求已有變動，日曆事件保留'),{code:'DELETE_CHANGED'});
   let event;try{event=await this.provider.get(this.calendarId,binding.eventId);}catch(error){if(![404,410].includes(error.status))throw error;}
   if(event&&event.status!=='cancelled'){
    if(event.id!==binding.eventId||event.etag!==binding.eventEtag)throw Object.assign(new Error('日曆事件已被修改，沒有刪除，請先確認該事件'),{code:'DELETE_REMOTE_CHANGED'});
    await this.store.assertLease?.();
    await this.provider.remove(this.calendarId,binding.eventId,binding.eventEtag);
   }
   // Keep the binding as a tombstone. A lost DELETE response retries safely;
   // a delayed Google notification cannot turn the local deletion into a new row.
   await this.store.bind({...binding,entryUpdatedAt:entry.updatedAt});
   if(binding.operationId)await this.store.clearConflict?.(this.userId,this.calendarId,binding.operationId);
   return {status:'delete-synced',eventId:binding.eventId};
  }catch(error){if(error.code==='REMOTE_CHANGED')error.code='DELETE_REMOTE_CHANGED';if(!String(error.code||'').startsWith('DELETE_'))error.code='DELETE_FAILED';await this.store.failure(this.userId,binding.operationId||entry.cloudId,error.code);throw error;}
 }
 async exportEntry(entry){
  if(!this.enabled)throw new Error('工時日曆同步尚未啟用，沒有改動資料');
  if(!entry?.cloudId)return {status:'local-deleted'};
  if(entry.status==='deleted')return this.deleteLinkedEvent(entry);
  const binding=await this.store.byEntry(this.userId,this.calendarId,entry.cloudId);
  if(binding?.entryUpdatedAt===entry.updatedAt)return {status:'unchanged'};
  const identity=await this.store.eventIdentity(this.userId,this.calendarId,entry.cloudId);
  const desired=proposedActualEvent(entry,{userId:this.userId,eventId:binding?.eventId||identity.eventId});
  try{await this.store.assertLease?.();const remote=binding?await this.provider.update(this.calendarId,desired,binding.eventEtag):await this.provider.insert(this.calendarId,desired);if(!remote?.id||!remote.etag)throw new Error('日曆沒有回傳完整儲存結果');await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:remote.id,eventEtag:remote.etag,entryId:entry.cloudId,entryUpdatedAt:entry.updatedAt,operationId:identity.id});return {status:'synced',eventId:remote.id};}
  catch(error){await this.store.failure(this.userId,identity.id,'EXPORT_FAILED');throw error;}
 }
}
