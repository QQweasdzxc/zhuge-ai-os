/* Explicit guided A/B clarification; original legacy row remains read-only. */
(function(root){'use strict';
function plan(legacy,db,draft,actor){
 if(!legacy?.recordKey||!legacy.code)throw Error('請先選定舊帳 A 的來源列');
 const code=String(draft.actualCode||'').trim(),actual=(db.assets||[]).find(a=>a.code===code);
 if(!actual)throw Error('請先以現場掃描登記實際 B；此流程不會猜建設備');
 if(code===legacy.code)throw Error('A、B 相同請使用原本釐清標示，不建立換機關係');
 const note=String(draft.note||'').trim(),evidence=String(draft.evidence||'').trim(),reason=String(draft.whereabouts||'').trim();
 if(!note)throw Error('請填寫本次差異說明');
 const confirmed=draft.confirmed===true;
 if(confirmed&&(!reason||!evidence||!actor))throw Error('確認換機需記錄舊 A 去向、依據與確認人');
 return {noRetry:true,recordKey:legacy.recordKey,code:legacy.code,provenance:legacy.provenance||'',snapshot:{code:legacy.code||'',name:legacy.name||'',model:legacy.model||'',siteLead:legacy.siteLead||'',zone:legacy.zone||''},progress:confirmed?'已確認換機':'疑似換機待查',conclusion:confirmed?'其他':'',reason,evidence,confirmer:actor||'',newAssetCode:code,note:JSON.stringify({kind:'A/B差異',confirmed,statement:note,oldWhereabouts:reason||'尚未查明',actual:{code:actual.code,site:actual.site||'',zone:actual.zone||''}})};
}
const api=Object.freeze({plan});root.ErpDifferenceCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
