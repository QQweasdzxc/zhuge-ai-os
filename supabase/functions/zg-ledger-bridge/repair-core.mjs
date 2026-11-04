/* Pure server planner. No client-provided status, actor, keys or row coordinates. */
export function repairPlan(asset,history,input,actor,at){
 const stages={send:['送修','待修'],start:['維修中','維修中'],return:['修畢回庫','備用']};
 if(!stages[input?.stage]||!Array.isArray(asset)||!asset[0]||asset[0]!==input.code)throw Error('REPAIR_INVALID');
 const note=String(input.note||'').trim();if(!note||note.length>2000)throw Error('REPAIR_NOTE_REQUIRED');
 if(asset[8]==='已報廢')throw Error('REPAIR_RETIRED');
 for(const [key,col]of[['status',8],['site',4],['zone',5]])if(String(asset[col]||'')!==String(input.expected?.[key]??''))throw Error('REPAIR_CONFLICT');
 const events=history.filter(r=>r[3]===asset[0]);
 if(events.at(-1)?.[2]==='維修')throw Error('REPAIR_LEGACY_AMBIGUOUS');
 const latest=events.filter(r=>['送修','維修中','修畢回庫'].includes(r[2])).at(-1);
 if(input.stage==='send'&&latest&&latest[2]!=='修畢回庫')throw Error('REPAIR_ALREADY_OPEN');
 if(input.stage==='start'&&latest?.[2]!=='送修')throw Error('REPAIR_NEEDS_SEND');
 if(input.stage==='return'&&latest?.[2]!=='維修中')throw Error('REPAIR_NEEDS_START');
 const [label,status]=stages[input.stage],changes={8:status,20:at};
 let to='';if(input.stage==='return'){const site=String(input.site||'').trim(),zone=String(input.zone||'').trim();if(!site||!zone||site.length>200||zone.length>200)throw Error('REPAIR_RETURN_LOCATION');changes[4]=site;changes[5]=zone;to=site+' '+zone;}
 const movement=['repair:'+input.operationId,at,label,asset[0],[asset[4],asset[5]].filter(Boolean).join(' '),to,1,actor,note,'ERP 維修流程'];
 return{changes,movement};
}
export function repairBatch(assetSheet,movementSheet,rowIndex,plan){
 if(![assetSheet,movementSheet,rowIndex].every(Number.isInteger)||rowIndex<1||assetSheet===movementSheet)throw Error('REPAIR_SHEET_INVALID');
 return{requests:[...Object.entries(plan.changes).map(([col,value])=>({updateCells:{start:{sheetId:assetSheet,rowIndex,columnIndex:Number(col)},rows:[{values:[{userEnteredValue:{stringValue:String(value)}}]}],fields:'userEnteredValue'}})),{appendCells:{sheetId:movementSheet,rows:[{values:plan.movement.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}}))}],fields:'userEnteredValue'}}]};
}
