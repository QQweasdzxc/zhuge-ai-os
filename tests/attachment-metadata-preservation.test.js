const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Service = require('../shared/board/board-read-service.js');
const runtime = fs.readFileSync(require.resolve('../shared/components/golden-master-runtime.js'), 'utf8');
// Execute the production metadata action block, including its real success/reload path.
const start = runtime.indexOf('if (action === "rename" || action === "note") {');
const end = runtime.indexOf('if (!url)', start);
assert.ok(start >= 0 && end > start);
const handler = runtime.slice(start, end);
function harness() {
  const row = {id:'attachment',task_id:'task',filename:'IMG_9354.png',display_name:null,note:null};
  const calls=[];
  const gateway = {
    async select(table, query) {
      assert.equal(table,'board_task_attachments');
      const fields = query.match(/select=([^&]+)/)[1].split(',');
      return [Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key)))];
    },
    async rpc(name, args) {
      assert.equal(name,'board_update_task_attachment_metadata');calls.push(args);
      if(args.p_display_name !== null) row.display_name=args.p_display_name===row.filename?null:args.p_display_name;
      if(args.p_note !== null) row.note=args.p_note || null;
      return {...row};
    }
  };
  let shown;
  async function act(action, value) {
    const item=(await Service.loadTaskAttachments('task',{gateway}))[0];
    const context={action,item,filename:item.filename,attachmentId:item.attachmentId,task:{id:'task'},window:{prompt:()=>value},
      actionContract:{execute:async(name,input,options)=>{assert.equal(name,'updateAttachmentMetadata');await Service.updateTaskAttachmentMetadata(input,{gateway});await options.onSuccess();}},
      refreshBoard:async()=>{},state:{taskById:new Map()},isArchiveTask:()=>false,
      openTaskDetail:async()=>{shown=(await Service.loadTaskAttachments('task',{gateway}))[0];},setBanner:()=>{},esc:x=>x};
    await vm.runInNewContext('(async()=>{'+handler+'})()', context);
    return shown;
  }
  return {row,calls,act,reload:()=>Service.loadTaskAttachments('task',{gateway})};
}
test('rename only preserves stored note and original filename',async()=>{const h=harness();h.row.note='existing note';const shown=await h.act('rename','New name');assert.equal(shown.filename,'New name');assert.equal(shown.note,'existing note');assert.equal(shown.originalFilename,'IMG_9354.png');assert.equal(h.calls[0].p_note,null);});
test('note only preserves stored display name',async()=>{const h=harness();h.row.display_name='Existing name';const shown=await h.act('note','New note');assert.equal(shown.filename,'Existing name');assert.equal(shown.note,'New note');assert.equal(h.calls[0].p_display_name,null);});
test('rename then note survives fresh projection and reload',async()=>{const h=harness();await h.act('rename','Renamed image');await h.act('note','Runtime QA metadata verification');const [row]=await h.reload();assert.equal(row.filename,'Renamed image');assert.equal(row.note,'Runtime QA metadata verification');assert.equal(row.originalFilename,'IMG_9354.png');assert.equal(h.row.filename,'IMG_9354.png');});
test('note then rename survives reload without erasing note',async()=>{const h=harness();await h.act('note','Evidence');await h.act('rename','Named evidence');const [row]=await h.reload();assert.equal(row.filename,'Named evidence');assert.equal(row.note,'Evidence');assert.equal(row.originalFilename,'IMG_9354.png');});
test('clearing note preserves rename',async()=>{const h=harness();h.row.display_name='Saved name';h.row.note='Old';const shown=await h.act('note','');assert.equal(shown.note,'');assert.equal(shown.filename,'Saved name');});
