import {RealtimeClient} from '@supabase/realtime-js';
import './live-feed.mjs';
import {candidateRuntime} from './runtime.mjs';
export function isolatedRealtimeClient(config){
 const realtime=new RealtimeClient(config.supabaseUrl+'/realtime/v1',{params:{apikey:config.supabaseAnonKey,eventsPerSecond:2}});
 return {realtime,channel:(topic,options)=>realtime.channel(topic,options),removeChannel:channel=>realtime.removeChannel(channel)};
}
if(window.ERP_PRIVATE_UPDATES_ENABLED===true)window.ErpUpdateCandidate=candidateRuntime(()=>isolatedRealtimeClient(AUTH_CONFIG));
