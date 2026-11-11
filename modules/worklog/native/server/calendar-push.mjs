// Owner-scoped Google Events push lifecycle. Notifications carry no event body.
// Only a matching random channel nonce hash + resource ID may trigger a sync.
export async function nonceHash(value,crypto=globalThis.crypto){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export class CalendarPush{
 constructor({admin,provider,store,owner,calendar,address,crypto=globalThis.crypto,now=Date.now}){Object.assign(this,{admin,provider,store,owner,calendar,address,crypto,now});const url=new URL(address);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('HTTPS push receiver required');}
 query(){return 'user_uuid=eq.'+encodeURIComponent(this.owner)+'&calendar_id=eq.'+encodeURIComponent(this.calendar);}
 async current(){return(await this.admin.request('worklog_google_channels?select=*&'+this.query()+'&limit=1'))[0]||null;}
 async ensure(){await this.store.assertLease();const old=await this.current();if(old&&Date.parse(old.expires_at)>this.now()+86400000)return {status:'active',expiresAt:old.expires_at};
  const id=this.crypto.randomUUID(),nonce=this.crypto.randomUUID()+this.crypto.randomUUID();
  const channel=await this.provider.watch(this.calendar,{id,token:nonce,type:'web_hook',address:this.address,params:{ttl:'604800'}});
  if(channel.id!==id||!channel.resourceId||!Number.isFinite(Number(channel.expiration))||Number(channel.expiration)<=this.now())throw new Error('Invalid Google watch response');
  try{await this.store.assertLease();await this.admin.request('worklog_google_channels?on_conflict=user_uuid,calendar_id',{method:'POST',prefer:'resolution=merge-duplicates',body:{user_uuid:this.owner,calendar_id:this.calendar,channel_id:id,last_message:'0',nonce_hash:await nonceHash(nonce,this.crypto),resource_id:channel.resourceId,expires_at:new Date(Number(channel.expiration)).toISOString(),updated_at:new Date(this.now()).toISOString()}});}catch(error){try{await this.provider.stop({id,resourceId:channel.resourceId});}catch{}throw error;}
  // New channel is durable before retiring old. A dropped overlap notification
  // is covered by the cycle immediately after registration and hourly safety run.
  if(old)try{await this.provider.stop({id:old.channel_id,resourceId:old.resource_id});}catch{}
  return{status:'active',expiresAt:new Date(Number(channel.expiration)).toISOString()};
 }
 async stop(){await this.store.assertLease();const old=await this.current();if(old)await this.provider.stop({id:old.channel_id,resourceId:old.resource_id});}
}
export function createPushReceiver({admin,calendarId,runOwner,defer,crypto=globalThis.crypto,now=Date.now}){
 return async request=>{if(request.method!=='POST'||request.headers.has('Origin'))return new Response(null,{status:403});const id=request.headers.get('X-Goog-Channel-ID')||'',nonce=request.headers.get('X-Goog-Channel-Token')||'',resource=request.headers.get('X-Goog-Resource-ID')||'',state=request.headers.get('X-Goog-Resource-State')||'',message=request.headers.get('X-Goog-Message-Number')||'';
  if(!/^[a-zA-Z0-9-]{1,64}$/.test(id)||!nonce||nonce.length>256||!resource||resource.length>256||!['sync','exists','not_exists'].includes(state)||!/^\d{1,30}$/.test(message))return new Response(null,{status:403});
  try{const row=(await admin.request('worklog_google_channels?select=*&channel_id=eq.'+encodeURIComponent(id)+'&limit=1'))[0];if(!row||row.calendar_id!==calendarId||row.resource_id!==resource||row.nonce_hash!==await nonceHash(nonce,crypto)||Date.parse(row.expires_at)<=now())return new Response(null,{status:403});
   const connection=await admin.connection(row.user_uuid);if(!connection?.enabled||connection.calendar_id!==calendarId)return new Response(null,{status:204});
   // Initial sync may arrive before watch response; ignoring it is documented.
   // Other messages are recorded before ack. Busy worker keeps its lease and
   // the hourly incremental safety cycle recovers any missed notification.
   if(state!=='sync'){const accepted=await admin.request('rpc/worklog_google_push_receipt',{method:'POST',body:{p_channel:id,p_message:message,p_now:new Date(now()).toISOString()}});if(accepted){const task=Promise.resolve().then(()=>runOwner(row.user_uuid)).catch(()=>{});if(defer)defer(task);else await task;}}
   return new Response(null,{status:204});
  }catch{return new Response(null,{status:503});}
 };
}
