const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const names=['gas-vendor-bridge','investment-intelligence-read','zhuge-skyeye-read','task-attachment-ai-read','workspace-email-notification','investment-screenshot-recognition','card-progress-email-notification'];
function load(source,context){
 source=source.replace(/import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];/g,(_,bindings)=>{
 const named=bindings.match(/\{([\s\S]*?)\}/);if(named)for(const entry of named[1].split(',')){const name=entry.trim().split(/\s+as\s+/).at(-1);if(name&&!context[name])context[name]=()=>{throw new Error('Provider or data import used before gate: '+name);};}return '';});
 source=stripTypeScriptTypes(source,{mode:'transform'}).replace(/export /g,'');vm.runInContext(source,context);
}
const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'TEST-USER',exp:9999999999,aal:'aal2'})).toString('base64url')+'.TEST';
for(const name of names)test(`${name}: caller-JWT fail closed before data or provider`,async()=>{
 for(const decision of [false,null,{},'true','http','network','malformed','timeout',true]){
 let handler,reads=0,checks=0,used=false;
 const context=vm.createContext({Request,Response,Headers,URL,URLSearchParams,AbortController,TextDecoder,TextEncoder,atob,btoa,Buffer,console,setTimeout:fn=>setTimeout(fn,1),clearTimeout,crypto:globalThis.crypto,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'})[k]||''},serve:fn=>handler=fn},
 createClient:(url,key)=>({auth:{getUser:async()=>({data:{user:{id:'TEST-USER'}},error:null})},from:()=>{reads++;throw new Error('Data read');}}),
 fetch:async(url,init)=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({id:'TEST-USER'});if(String(url).endsWith('/rpc/is_app_access_approved')){
 checks++;assert.equal(init.headers.authorization,'Bearer '+token);assert.equal(init.headers.apikey,'anon-test');assert.equal(init.body,'{}');
 if(decision==='network')throw new Error('network');if(decision==='http')return new Response('',{status:503});if(decision==='malformed')return new Response('{');
 if(decision==='timeout')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout'))));return Response.json(decision);
 }reads++;throw new Error('Provider request before gate');}
 });
 Object.assign(context,await import('../supabase/functions/zhuge-skyeye-read/normalizers.mjs'),await import('../supabase/functions/zhuge-skyeye-read/weather-state.mjs'));
 load(fs.readFileSync('supabase/functions/_shared/app-access.ts','utf8'),context);
 const real=context.requireAppAccess;context.requireAppAccess=async req=>{await real(req);used=true;};
 load(fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8'),context);
 const result=await handler(new Request('https://fixture.invalid/',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'}));
 assert.equal(checks,1,name+' checks caller access exactly once');
 if(decision!==true){assert.equal(result.status,403,`${name}: ${JSON.stringify(decision)}`);assert.equal(reads,0);assert.equal(used,false);}else assert.equal(used,true,'approved caller continues to existing input validation');
 }
});
