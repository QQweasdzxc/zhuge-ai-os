import{installUpdates}from'./app-session.mjs';import{supabaseTransport}from'./supabase-transport.mjs';
export function candidateRuntime(newIsolatedClient){return{install:options=>installUpdates({...options,transport:supabaseTransport(newIsolatedClient)})}};
