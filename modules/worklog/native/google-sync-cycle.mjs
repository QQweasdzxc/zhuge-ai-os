// One bounded owner cycle. Durable store owns the lease and monotonic cursor.
// Worker invocation is separate; no browser timer claims background completion.
export async function runGoogleSyncCycle({connection,store,provider,sync,worklog,prepare,now=()=>new Date().toISOString()}){
 const {userId,calendarId}=connection;if(!connection.enabled)return{status:'disabled'};
 const lease=await store.acquire(userId,calendarId);if(!lease)return{status:'already-running'};
 try{
  await provider.calendar(calendarId);
  if(prepare)await prepare();
  if(!worklog.snapshot)await worklog.load(new Date(now()).getUTCFullYear());
  const state=await store.state(userId,calendarId),baseline=!state.syncToken;
  let cursor=null,count=0;const failures=[];
  // Full scans establish/recover a cursor, without importing old unbound history.
  const consume=async(token,cutoff)=>{for await(const page of provider.changes(calendarId,{syncToken:token||undefined})){
   for(const event of page.events){if(++count>10000)throw Object.assign(new Error('本次同步超過安全資料量，游標未推進'),{code:'LIMIT'});
    if(cutoff&&!(Date.parse(event.updated)>Date.parse(cutoff))&&!await store.byEvent?.(userId,calendarId,event.id))continue;
    try{const year=Number((event.start?.dateTime||event.start?.date||'').slice(0,4));if(Number.isInteger(year)&&year>=1900&&year<=2200&&worklog.snapshot?.year!==year)await worklog.load(year);await sync.importEvent(event);}catch(error){failures.push({eventId:event.id,code:error.code||'IMPORT_FAILED'});}
   }if(page.nextSyncToken)cursor=page.nextSyncToken;
  }};
  try{await consume(state.syncToken,baseline?connection.activatedAt:null);}catch(error){if(error.code!=='CURSOR_EXPIRED'||baseline)throw error;cursor=null;await consume(null,state.lastSyncedAt||connection.activatedAt);}
  // A failed import retains cursor. Stable IDs make successful replay harmless.
  if(!cursor)throw new Error('Google未回傳完整同步游標');
  const until=now();
  // Owner-filtered source query belongs to WorkLog's own worker identity/session.
  const changed=await store.changedEntries(userId,{after:state.localCursor||connection.activatedAt,through:until});
  for(const entry of changed){try{await sync.exportEntry(entry);}catch(error){failures.push({entryId:entry.cloudId,code:error.code||'EXPORT_FAILED'});}}
  if(failures.length){await store.cycleFailure(userId,calendarId,failures);return{status:'incomplete',failures};}
  await store.advance(userId,calendarId,{syncToken:cursor,localCursor:until,lease});return{status:baseline?'initialized':'synced',seen:count,exported:changed.length};
 }finally{await store.release(userId,calendarId,lease);}
}
