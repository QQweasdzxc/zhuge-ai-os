import{HINT_TOPIC,HINT_EVENT}from'./private-hint.mjs';
import {VERIFIED_EVENT} from '../../supabase/functions/zg-ledger-bridge/live-event-core.mjs';
// newClient must return a fresh isolated client per channel, sharing no mutable auth with other apps.
export function supabaseTransport(newClient){return{async join({topic,private:isPrivate,token,receive,status}){
 if(topic!==HINT_TOPIC||isPrivate!==true||!token)throw Error('PRIVATE_ERP_CHANNEL_REQUIRED');
 const client=newClient();await client.realtime.setAuth(token);
 const channel=client.channel(topic,{config:{private:true,broadcast:{ack:true,self:false}}});
 channel.on('broadcast',{event:HINT_EVENT},message=>receive({topic,event:HINT_EVENT,payload:message.payload}));
 channel.on('broadcast',{event:VERIFIED_EVENT},message=>receive({topic,event:VERIFIED_EVENT,payload:message.payload}));
 channel.subscribe(state=>status(state));
 return{leave:async()=>{await client.removeChannel(channel);await client.realtime.disconnect()}};
}}}
