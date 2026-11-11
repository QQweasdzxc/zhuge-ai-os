const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../apps/learning-adventure/supabase/index.ts'),'utf8');
const context=vm.createContext({Deno:{env:{get:()=>''},serve:()=>{}},console,Response,crypto:require('crypto').webcrypto});
vm.runInContext(source,context);
vm.runInContext(`db=async function(table){if(table==='learning_adventure_exam_bank')return [...new Set(Object.values(CHENGYU_STAGE_WORDS).flat())].map((word,i)=>({word,meaning:'意思'+i,example:word+'的自編例句'}));if(table==='vocab_family_units')return [{id:'unit',words:Array.from({length:globalThis.poolSize},(_,i)=>({en:'word'+i,zh:'中文'+i,sentence:'This is ____.'}))}];throw Error('unexpected '+table)}`,context);
(async()=>{for(let stage=1;stage<=7;stage++){context.stage=stage;const q=await vm.runInContext(`stageQuestions({sourceFamilyId:'f'},{id:'h'},'chengyu',stage,null)`,context);assert(q.length>=5);assert.equal(new Set(q.map(x=>x.kind)).size,3);for(const x of q)assert(x.choices[x.answerIndex]);}
for(const n of [3,4,10,20]){context.poolSize=n;for(let stage=1;stage<=7;stage++){context.stage=stage;const q=await vm.runInContext(`stageQuestions({sourceFamilyId:'f'},{id:'h'},'vocab',stage,'unit')`,context);assert(q.length>=6);assert.equal(new Set(q.map(x=>x.kind)).size,3);for(const x of q)assert(x.choices[x.answerIndex]);}}
console.log('PASS both islands all 7 summary stages:3 kinds,small unit 3/4 words reachable,answer keys valid')})().catch(e=>{console.error(e);process.exitCode=1});
