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
  const plan=planSelectedCalendarEvent({entry,event,binding,entries:this.worklog.snapshot?.entries||[],userId:this.userId,calendarId:this.calendarId,selectedCalendarId:this.calendarId,profile:this.worklog.snapshot?.profile,operationId:operation.id});
  if(plan.action==='local-newer'){await this.store.bind({...binding,eventEtag:event.etag});return {status:'local-newer'};}
  if(['unchanged','remote-deleted','local-deleted'].includes(plan.action))return {status:plan.action};
  if(plan.action==='error'){await this.store.failure(this.userId,operation.id,plan.code);throw Object.assign(new Error(plan.message),{code:plan.code});}
  try{await this.store.assertLease?.();const[saved]=await this.worklog.saveBatch([plan.proposed],plan.proposed.date);await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:event.id,eventEtag:event.etag,entryId:saved.cloudId,entryUpdatedAt:saved.updatedAt,operationId:operation.id});return {status:'synced',entry:saved};}
  catch(error){await this.store.failure(this.userId,operation.id,'IMPORT_FAILED');throw error;}
 }
 async exportEntry(entry){
  if(!this.enabled)throw new Error('工時日曆同步尚未啟用，沒有改動資料');
  if(!entry?.cloudId||entry.status==='deleted')return {status:'local-deleted'};
  const binding=await this.store.byEntry(this.userId,this.calendarId,entry.cloudId);
  if(binding?.entryUpdatedAt===entry.updatedAt)return {status:'unchanged'};
  const identity=await this.store.eventIdentity(this.userId,this.calendarId,entry.cloudId);
  const desired=proposedActualEvent(entry,{userId:this.userId,eventId:binding?.eventId||identity.eventId});
  try{await this.store.assertLease?.();const remote=binding?await this.provider.update(this.calendarId,desired,binding.eventEtag):await this.provider.insert(this.calendarId,desired);if(!remote?.id||!remote.etag)throw new Error('日曆沒有回傳完整儲存結果');await this.store.bind({userId:this.userId,calendarId:this.calendarId,eventId:remote.id,eventEtag:remote.etag,entryId:entry.cloudId,entryUpdatedAt:entry.updatedAt,operationId:identity.id});return {status:'synced',eventId:remote.id};}
  catch(error){await this.store.failure(this.userId,identity.id,'EXPORT_FAILED');throw error;}
 }
}
