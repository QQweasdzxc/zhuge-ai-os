#!/usr/bin/env node
// Single-use official Product Build synchronization for P0 Pixel Office PR #61.
// Use existing governance synchronizer; do not modify Published C snapshot.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const governance = require('../../tools/release-governance.js');
const root = path.resolve(import.meta.dirname, '../..');
const old = '0.9.0-alpha.9.59';
const next = '0.9.0-alpha.9.74';
const build = process.argv[2];
if (!/^202\d{5}-\d{4}$/.test(build || '')) throw new Error('Missing approved new Taipei Build');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
if (identity.version !== old || identity.build !== '20261016-1536') throw new Error('Baseline identity changed: STOP');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
function rewrite(p, from, to) {
  const value = read(p);
  if (!value.includes(from)) throw new Error('Identity target absent: '+p);
  fs.writeFileSync(path.join(root,p),value.replace(from,to),'utf8');
}
const versionPaths = ['version.json', 'labs/investment/version.json'];
for (const dir of fs.readdirSync(path.join(root, 'modules'), { withFileTypes:true })) {
  if(dir.isDirectory() && fs.existsSync(path.join(root,'modules',dir.name,'version.json')))
    versionPaths.push('modules/'+dir.name+'/version.json');
}
for(const p of versionPaths)rewrite(p,'"version": "'+old+'"','"version": "'+next+'"');
rewrite('shared/app-config.js','const VERSION = "'+old+'"','const VERSION = "'+next+'"');
rewrite('shared/config/version.js','version: "'+old+'"','version: "'+next+'"');
rewrite('shared/config/template-release.js','"developmentVersion": "'+old+'"','"developmentVersion": "'+next+'"');
rewrite('app/dashboard/index.html','name="application-version" content="'+old+'"','name="application-version" content="'+next+'"');
rewrite('app/dashboard/zhuge-dashboard.js',' : "'+old+'"',' : "'+next+'"');
for(const p of ['index.html','docs/index.html','status-classic.html','docs/status-classic.html']) {
  const before=read(p);
  const after=before.replaceAll(old,next);
  if(after===before)throw new Error('Legacy route identity missing: '+p);
  fs.writeFileSync(path.join(root,p),after,'utf8');
}
const result = execFileSync(process.execPath, [
  'tools/release-governance.js','sync-build','--build',build
], { cwd:root,encoding:'utf8' });
const classicPaths=['docs/index.html','status-classic.html','docs/status-classic.html'];
for(const p of classicPaths){
  let v=read(p);
  if(!v.includes('20261016-1536')) continue;
  v=v.replaceAll('20261016-1536',build);
  fs.writeFileSync(path.join(root,p),v,'utf8');
}
const check=governance.assertSourceIdentity(governance.readIdentitySnapshot(root));
if(check.version!==next || check.build!==build)throw new Error('Official identity mismatch');
console.log(JSON.stringify({status:'FORMAL_IDENTITY_SYNCHRONIZED',version:next,build,governance:check.status,details:JSON.parse(result).changedFiles},null,2));
