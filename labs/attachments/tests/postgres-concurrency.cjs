// Creates and destroys ONLY its own local, disposable PostgreSQL container.
const {execFileSync,spawn}=require('node:child_process');const fs=require('node:fs');const assert=require('node:assert/strict');const {fixtureSQL,card}=require('./fixture.cjs');
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const name='issue45-lifecycle-test-'+process.pid;
const container=execFileSync('docker',[...dockerArgs,'run','-d','--name',name,'-e','POSTGRES_PASSWORD=isolated-fixture','postgres:16-alpine'],{encoding:'utf8'}).trim();
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
const sql=text=>execFileSync('docker',[...dockerArgs,...args],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
(async()=>{try{
 for(let attempt=0;attempt<30;attempt++){try{execFileSync('docker',[...dockerArgs,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{stdio:'ignore'});break}catch{if(attempt===29)throw Error('isolated PostgreSQL not ready');await new Promise(r=>setTimeout(r,200))}}
 sql(fixtureSQL);sql(fs.readFileSync('labs/attachments/sql/lifecycle_candidate.sql','utf8'));sql('select attachment_lifecycle.activate()');
 sql("update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '72 hours' where module='worktodo'");
 const child=spawn('docker',[...dockerArgs,...args],{stdio:['pipe','pipe','pipe']});let out='',err='';
 const locked=new Promise((resolve,reject)=>{child.stdout.on('data',data=>{out+=data;if(out.includes('LOCKED'))resolve()});child.stderr.on('data',data=>err+=data);child.on('exit',code=>{if(!out.includes('LOCKED'))reject(Error(err||'parent update did not lock'))})});
 const finished=new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve():reject(Error(err))));
 child.stdin.end(`begin;update board_tasks set status='ready' where id='${card}';select 'LOCKED';select pg_sleep(1);commit;`);
 await locked;assert.equal(sql('select attachment_claim_expired() is null'),'t','cleanup skips concurrent reopen, never deletes prior generation');await finished;
 assert.equal(sql("select completed_at is null from attachment_lifecycle.cards where module='worktodo'"),'t');
 sql(`update board_tasks set status='done' where id='${card}'`);assert.equal(sql('select attachment_claim_expired() is null'),'t','new generation receives full grace');
 sql("update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '72 hours' where module='worktodo'");
 const claim=JSON.parse(sql('select attachment_claim_expired()'));assert.equal(claim.state,'deleting');assert.equal(claim.delete_generation,sql("select generation from attachment_lifecycle.cards where module='worktodo'"));
 assert.throws(()=>sql(`update board_tasks set status='ready' where id='${card}'`),/Command failed/);
 console.log('POSTGRES_CONCURRENT_REOPEN_CLAIM=PASS; fresh generation, locked owner, no bytes deleted');
}finally{execFileSync('docker',[...dockerArgs,'rm','-fv',container],{stdio:'ignore'})}})().catch(error=>{console.error(error.message);process.exitCode=1});
