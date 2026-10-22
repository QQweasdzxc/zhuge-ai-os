const test=require('node:test');const assert=require('node:assert/strict');
const helper=require('../labs/taskflow/taskflow-post-login.js');
function store(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
test('Office return rejects expiry, arbitrary intent and unapproved/unauthenticated runtime',()=>{
 for(const gate of ['authenticated','accessApproved','runtimeReady']){
  const storage=store();helper.capture({search:'?officeReturn=1&returnTo=https://evil.invalid'},storage,1000);
  const args={authenticated:true,accessApproved:true,runtimeReady:true,storage,location:{href:'https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/',replace(){throw Error('unauthorized navigation');}},now:1001};
  args[gate]=false;assert.equal(helper.complete(args),false);
 }
 const storage=store();helper.capture({search:'?officeReturn=1'},storage,1000);
 assert.equal(helper.complete({authenticated:true,accessApproved:true,runtimeReady:true,storage,location:{replace(){throw Error('expired return');}},now:1000+600001}),false);
});
