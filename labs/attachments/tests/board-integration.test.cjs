const {test}=require('node:test');
const assert=require('node:assert/strict');
const board=require('../../../shared/board/board-read-service.js');
const adapters=require('../../../shared/components/task-action-adapters.js');
const worktodoUi=require('../../../modules/worklog/components/worktodo-task-adapter.js');

const attachment={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',attachmentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageBucket:'board-task-attachments',storagePath:'card/file.pdf',filename:'file.pdf'};
function gateway(overrides={}){
 const calls={invoke:[],signed:[],rpc:[],remove:[],select:[]};
 return {
  calls,
  invokeFunction:async(name,payload)=>{calls.invoke.push([name,payload]);if(overrides.invoke) return overrides.invoke(name,payload);return {enabled:true,url:'https://lifecycle.example/capability'};},
  createStorageSignedUrl:async(...args)=>{calls.signed.push(args);return 'https://legacy.example/signed';},
  select:async(...args)=>{calls.select.push(args);return overrides.select?overrides.select(...args):[];},
  rpc:async(name,args)=>{calls.rpc.push([name,args]);if(overrides.rpc) return overrides.rpc(name,args);if(name.includes('request_attachment_delete'))return {id:attachment.id,storage_bucket:attachment.storageBucket,storage_path:attachment.storagePath};return {id:attachment.id};},
  removeStorageObject:async(...args)=>{calls.remove.push(args);if(overrides.remove) return overrides.remove(...args);}
 };
}

test('managed Board and WorkTodo fail closed during lifecycle Edge outage; unmanaged consumers retain legacy reads and deletes',async()=>{
 const outage=gateway({invoke:async()=>{throw Error('Edge unavailable')}});
 await assert.rejects(board.taskAttachmentUrl(attachment,{gateway:outage,lifecycleModule:'worktodo'}),/Edge unavailable/);
 await assert.rejects(board.deleteTaskAttachment(attachment.id,{gateway:outage,lifecycleModule:'board'}),/Edge unavailable/);
 assert.equal(outage.calls.signed.length,0);assert.equal(outage.calls.rpc.length,0);assert.equal(outage.calls.remove.length,0);

 const unmanaged=gateway();
 assert.equal(await board.taskAttachmentUrl(attachment,{gateway:unmanaged}), 'https://legacy.example/signed');
 await board.deleteTaskAttachment(attachment.id,{gateway:unmanaged});
 assert.equal(unmanaged.calls.invoke.length,0,'Investment/WorkLog and other unmanaged attachments never call lifecycle Edge');
 assert.equal(unmanaged.calls.signed.length,1);assert.deepEqual(unmanaged.calls.rpc.map(call=>call[0]),['board_request_delete_task_attachment','board_finalize_delete_task_attachment']);
 assert.equal(unmanaged.calls.remove.length,1);
});

test('disabled lifecycle cleanly falls back while enabled managed routes bind the server capability',async()=>{
 const disabled=gateway({invoke:async()=>({enabled:false})});
 assert.equal(await board.taskAttachmentUrl(attachment,{gateway:disabled,lifecycleModule:'board'}),'https://legacy.example/signed');
 await board.deleteTaskAttachment(attachment.id,{gateway:disabled,lifecycleModule:'worktodo'});
 assert.equal(disabled.calls.invoke.length,2);assert.equal(disabled.calls.signed.length,1);
 assert.deepEqual(disabled.calls.rpc.map(call=>call[0]),['board_request_delete_task_attachment','board_finalize_delete_task_attachment']);

 const managed=gateway();
 assert.equal(await board.taskAttachmentUrl(attachment,{gateway:managed,lifecycleModule:'worktodo',intent:'download'}),'https://lifecycle.example/capability');
 await board.deleteTaskAttachment(attachment.id,{gateway:managed,lifecycleModule:'board'});
 assert.deepEqual(managed.calls.invoke.map(([,payload])=>[payload.action,payload.module,payload.intent]),[[undefined,'worktodo','download'],['delete','board',undefined]]);
 assert.equal(managed.calls.signed.length,0);assert.equal(managed.calls.rpc.length,0);
});

test('canonical scope resolves WorkTodo lifecycle and attachment status is surfaced without changing legacy scopes',async()=>{
 const status={enabled:true,module:'worktodo',state:'ready',completed_at:'2026-10-14T12:00:00Z',delete_due_at:'2026-10-17T12:00:00Z',preview_available:false,download_available:true};
 const g=gateway({
  select:async(table)=>table==='board_task_attachments'?[{...attachment,task_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',upload_status:'ready',deletion_status:'active'}]:[],
  invoke:async(_name,payload)=>payload.action==='status'?status:{enabled:true,url:'https://lifecycle.example/capability'}
 });
 const rows=await board.loadTaskAttachments('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{gateway:g,lifecycleModule:'worktodo'});
 assert.equal(rows[0].lifecycleModule,'worktodo');assert.equal(rows[0].lifecycleManaged,true);assert.equal(rows[0].lifecyclePreviewAvailable,false);assert.equal(rows[0].lifecycleDownloadAvailable,true);assert.equal(rows[0].lifecycleDeleteDueAt,status.delete_due_at);
 assert.equal(g.calls.invoke[0][1].module,'worktodo');

 const instanceGateway=gateway({select:async(table)=>table==='board_instances'?[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',legacy_application_scope:'worktodo',active:true}]:[]});
 const instance=board.createInstanceService({boardInstanceId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',gateway:instanceGateway});
 assert.equal(await instance.taskAttachmentUrl(attachment),'https://lifecycle.example/capability');
 await instance.deleteTaskAttachment(attachment.id);
 assert.deepEqual(instanceGateway.calls.invoke.map(([,payload])=>payload.module),['worktodo','worktodo'],'resolved Board Instance scope owns managed lifecycle routing');
 assert.equal(instanceGateway.calls.rpc.length,0);
});

test('WorkTodo card UI shows its scheduled purge time, hides expired preview, and blocks completed-card upload controls',()=>{
 const due='2030-01-02T03:04:05.000Z';
 const drawer={render:options=>`<div class="shared-task-drawer">${options.sections.map(section=>section.html).join('')}</div>`};
 const managed={...attachment,lifecycleManaged:true,lifecyclePreviewAvailable:false,lifecycleDownloadAvailable:true,lifecycleDeleteDueAt:due};
 const html=worktodoUi.render({id:'task-1',applicationScope:'worktodo',status:'completed',title:'Done'}, {drawer,capabilityData:{attachments:[managed]}});
 assert.ok(html.includes(new Date(due).toLocaleString('zh-TW',{hour12:false})),'drawer includes the actual server delete deadline');
 assert.ok(html.includes('目前仍可下載'));
 assert.ok(!html.includes('開啟／預覽'),'expired preview is unavailable in the card UI');
 assert.ok(html.includes('下載附件'),'download remains available before 72 hours');
 assert.ok(!html.includes('worktodoTaskAttachmentInput'),'completed WorkTodo card cannot add attachments');
 const unavailable=worktodoUi.render({id:'task-2',applicationScope:'worktodo',status:'in_progress'}, {drawer,capabilityData:{attachments:[{...managed,lifecycleStatusUnavailable:true}]}});
 assert.ok(unavailable.includes('附件期限資訊暫時無法取得'));
 assert.ok(!unavailable.includes('開啟／預覽'),'preview remains fail-closed while status is unavailable');
});

test('WorkTodo action adapter passes exact lifecycle scope for reads, URL access and delete',async()=>{
 const seen=[];const service={
  loadTaskChecklist:async()=>[],loadTaskAttachments:async(_id,options)=>{seen.push(['load',options.lifecycleModule]);return [];},
  taskAttachmentUrl:async(_item,options)=>{seen.push(['url',options.lifecycleModule]);return 'url';},
  deleteTaskAttachment:async(_id,options)=>seen.push(['delete',options.lifecycleModule]),
  loadActivity:async()=>[]
 };
 const adapter=adapters.createWorkTodoAdapter({task:{id:'task'},service});
 await adapter.read.capabilities({taskId:'task'});await adapter.read.attachmentUrl({attachment});await adapter.actions.deleteAttachment({attachmentId:attachment.id});
 assert.deepEqual(seen,[['load','worktodo'],['url','worktodo'],['delete','worktodo']]);
});
