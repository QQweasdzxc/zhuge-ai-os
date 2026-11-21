// Rebuildable runtime regression against the exact compiled copies, not editable sources.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),artifact=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('artifact directory required');
for(const n of ['erp-app.js','erp-sheets-adapter.js'])if(!fs.existsSync(path.join(artifact,'ZG-ERP',n)))throw Error('missing compiled '+n);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'erp-runtime-artifact-'));
try{fs.cpSync(path.join(root,'ZG-ERP'),path.join(temp,'ZG-ERP'),{recursive:true});for(const n of ['erp-app.js','erp-sheets-adapter.js'])fs.copyFileSync(path.join(artifact,'ZG-ERP',n),path.join(temp,'ZG-ERP',n));fs.symlinkSync(path.join(root,'supabase'),path.join(temp,'supabase'),'dir');fs.mkdirSync(path.join(temp,'tests'));
 const names=['zg-erp-department.test.js','zg-erp-difference-core.test.js','zg-erp-draft-core.test.js','zg-erp-edit-core.test.cjs','zg-erp-first-site.test.js','zg-erp-inbound-account.test.cjs','zg-erp-inbound-custody.test.cjs','zg-erp-inbound-result-check.test.cjs','zg-erp-repair-core.test.js','zg-erp-repair-adapter.test.js','zg-erp-seat-core.test.js','zg-erp-seat-cascade.test.js','zg-erp-seat-names.test.js','zg-erp-scan-intent-adapter.cjs','zg-erp-sheets-contract.test.js','zg-erp-token-refresh.test.js'];
 for(const n of names)fs.copyFileSync(path.join(root,'tests',n),path.join(temp,'tests',n));const r=spawnSync(process.execPath,['--test',...names.map(n=>path.join(temp,'tests',n))],{stdio:'inherit',env:process.env});if(r.status!==0)throw Error('compiled module runtime failed: '+r.status);
}finally{fs.rmSync(temp,{recursive:true,force:true})}
