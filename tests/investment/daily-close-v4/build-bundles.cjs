const fs=require('node:fs'),path=require('node:path');
const root=__dirname;
const names=['daily-close.cjs','venue-readonly-join.cjs','source-policy.cjs','daily-snapshot-transport.cjs','readonly-adapter.cjs','daily-consumer.cjs','daily-edge-handler.cjs'];
let bundle='const __modules=Object.create(null),__cache=Object.create(null);\n';
for(const name of names)bundle+=`__modules[${JSON.stringify('./'+name)}]=function(module,exports,require){\n${fs.readFileSync(path.join(root,name),'utf8')}\n};\n`;
bundle+=`__modules['./calendar-manifest-2026.json']=function(module){module.exports=${fs.readFileSync(path.join(root,'calendar-manifest-2026.json'),'utf8')};};\n`;
bundle+='function __require(name){if(__cache[name])return __cache[name].exports;if(!__modules[name])throw Error("MODULE_NOT_BUNDLED");const module={exports:{}};__cache[name]=module;__modules[name](module,module.exports,__require);return module.exports;}\n';
fs.writeFileSync(path.join(root,'investment-daily-close-service.js'),'/* Build from reviewed close-only sources; no automatic effects at load. */\n(function(root){\n'+bundle+"root.InvestmentDailyCloseService=Object.freeze({...__require('./daily-consumer.cjs'),...__require('./readonly-adapter.cjs')});\n})(globalThis);\n");
const auth=`
const loadSnapshot=__require('./daily-snapshot-transport.cjs').createDailySnapshotLoader();
async function verifySession(request){
 const authorization=request.headers.get('authorization')||'';
 if(authorization.length>4096||!/^Bearer\\s+\\S+$/i.test(authorization))throw Error('AUTH_REQUIRED');
 const url=(Deno.env.get('SUPABASE_URL')||'').replace(/\\/$/,'');
 const apikey=Deno.env.get('SUPABASE_ANON_KEY')||'';
 if(!url||!apikey)throw Error('AUTH_NOT_CONFIGURED');
 const response=await fetch(url+'/auth/v1/user',{headers:{apikey,authorization},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('AUTH_REQUIRED');
 const user=await response.json();
 const raw=authorization.replace(/^Bearer\\s+/i,'').split('.')[1];
 const normalized=raw.replace(/-/g,'+').replace(/_/g,'/');
 const claims=JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'=')));
 if(!user.id||claims.sub!==user.id||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw Error('AUTH_REQUIRED');
 return {userId:user.id,aal:claims.aal};
}
Deno.serve(__require('./daily-edge-handler.cjs').createDailyHandler({loadSnapshot,verifySession}));
`;
fs.writeFileSync(path.join(root,'investment-daily-close-read.ts'),'/* Single-file authenticated read-only daily-close endpoint. No DB writes. */\n'+bundle+auth);
console.log('Built browser and Edge artifacts from',names.length,'source modules');
if(process.argv.includes('--sync-runtime')){fs.copyFileSync(path.join(root,'investment-daily-close-service.js'),path.resolve(root,'../../../modules/investment/services/investment-daily-close-service.js'));fs.copyFileSync(path.join(root,'investment-daily-close-read.ts'),path.resolve(root,'../../../supabase/functions/investment-daily-close-read/index.ts'));}
