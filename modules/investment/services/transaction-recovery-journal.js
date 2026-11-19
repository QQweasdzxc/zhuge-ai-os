(function(global){
  'use strict';
  // Only an opaque operation identifier survives same-tab reload. Never a trade draft.
  function create(storage,owner){
    if(!owner)throw Error('交易恢復缺少目前帳號，未送出。');
    const slot='investment:pending-operation:v1:'+owner;
    function read(){
      try{const raw=storage.getItem(slot);if(raw===null)return null;const v=JSON.parse(raw);
        if(Object.keys(v).sort().join(',')!=='at,key'||typeof v.key!=='string'||v.key.length<8||v.key.length>200||!Number.isFinite(v.at))throw Error();
        return Object.freeze({key:v.key,at:v.at});
      }catch{throw Error('無法確認此分頁的交易恢復識別，暫停新增交易。請先核對交易紀錄。');}
    }
    function begin(key){
      if(read())throw Error('此分頁仍有待確認交易，未送出新交易。');
      try{storage.setItem(slot,JSON.stringify({key,at:Date.now()}));if(read()?.key!==key)throw Error();}
      catch{throw Error('無法安全保留交易恢復識別，未送出。');}
    }
    function clear(key){if(read()?.key!==key)throw Error('交易恢復識別已變更，暫停新增交易。');storage.removeItem(slot);if(read())throw Error('交易恢復識別未清除，暫停新增交易。');}
    return Object.freeze({read,begin,clear});
  }
  const api=Object.freeze({create});global.InvestmentTransactionRecoveryJournal=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
