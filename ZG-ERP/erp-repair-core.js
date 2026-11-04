/* Pure preparation only: no networking, no automatic business writes. */
(function(root){'use strict';
const stages=Object.freeze({send:{label:'送修',status:'待修'},start:{label:'維修中',status:'維修中'},return:{label:'修畢回庫',status:'備用'}});
function plan(asset,history,input){
 if(!asset?.code)throw Error('找不到設備');const stage=stages[input?.stage];if(!stage)throw Error('請選擇維修階段');
 const note=String(input.note||'').trim();if(!note)throw Error('請填寫故障、維修或修畢說明');
 if(asset.status==='已報廢')throw Error('已報廢設備不能直接送修，請先人工確認');
 const latest=(history||[]).filter(x=>x.code===asset.code&&['repair-send','repair-start','repair-end'].includes(x.type)).at(-1);
 if((history||[]).filter(x=>x.code===asset.code).at(-1)?.type==='repair-legacy')throw Error('既有維修紀錄未區分階段，請先人工核對，不自動續接');
 if(input.stage==='send'&&latest&&latest.type!=='repair-end')throw Error('已有未結束的維修，請接續處理');
 if(input.stage==='start'&&(!latest||latest.type!=='repair-send'))throw Error('請先登記送修');
 if(input.stage==='return'&&(!latest||latest.type!=='repair-start'))throw Error('請先登記維修中');
 const patch={status:stage.status};if(input.stage==='return'){const site=String(input.site||'').trim(),zone=String(input.zone||'').trim();if(!site||!zone)throw Error('請指定實際回庫據點與區域');patch.site=site;patch.zone=zone;}
 return {code:asset.code,stage:input.stage,label:stage.label,expected:{status:asset.status,site:asset.site||'',zone:asset.zone||''},patch,event:{type:input.stage==='send'?'repair-send':input.stage==='start'?'repair-start':'repair-end',code:asset.code,from:[asset.site,asset.zone].filter(Boolean).join(' '),to:input.stage==='return'?[patch.site,patch.zone].join(' '):'',note,source:'ERP 維修流程'}};
}
const api=Object.freeze({stages,plan});root.ErpRepairCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
