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
const read = p => fs.readFileSync(path.join(root,p),'utf8');
if(identity.version !== '0.9.0-alpha.9.74')throw new Error('Release version changed: stop');
if(identity.build !== '20261018-1050')throw new Error('Unexpected previous Build: stop');
// This follow-up is a NEW Formal Build, because CI packaging workflow is material Source.
const result = execFileSync(process.execPath, [
  'tools/release-governance.js','sync-build','--build',build
], { cwd:root,encoding:'utf8' });
for(const p of ['docs/index.html','status-classic.html','docs/status-classic.html']){
  const before=read(p);
  if(before.includes(identity.build))fs.writeFileSync(path.join(root,p),before.replaceAll(identity.build,build),'utf8');
}
const check=governance.assertSourceIdentity(governance.readIdentitySnapshot(root));
if(check.version!==next || check.build!==build)throw new Error('Official identity mismatch');
console.log(JSON.stringify({status:'FORMAL_IDENTITY_SYNCHRONIZED',version:next,build,governance:check.status,details:JSON.parse(result).changedFiles},null,2));
