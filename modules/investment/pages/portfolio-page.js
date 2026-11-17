(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.InvestmentPortfolioPage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function render(state={},dependencies={}){
  const escape=dependencies.escape||(value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  if(state.activeFocus==='watchlist'){
   const items=Array.isArray(state.watchlist)?state.watchlist:[];
   return `<section class="investment-command-center" data-investment-readonly-portfolio="watchlist"><div class="investment-page-heading"><div><h1>觀察股</h1><p>觀察與實際持股分開；本頁不建立或同步任務。</p></div><button type="button" class="investment-refresh" data-investment-refresh>重新整理</button></div><section class="investment-command-panel">${items.length?`<ul class="investment-watchlist-readonly">${items.map(item=>`<li><strong>${escape(item.symbol)} ${escape(item.name)}</strong><span>${escape(item.market)} · ${escape(item.status||'觀察')}</span><p>${escape(item.reason||item.researchTheme||'尚未填寫觀察原因')}</p></li>`).join('')}</ul>`:'<p class="investment-panel-empty">目前沒有觀察股。</p>'}</section></section>`;
  }
  const list=globalThis.InvestmentHoldingsSimpleList;
  return `<section class="investment-command-center" data-investment-readonly-portfolio="holdings"><div class="investment-page-heading"><div><h1>我的持股</h1><p>成本列出全部持股；損益僅計入已驗證來源的同日收盤價。不將歷史快照估值當成現值。</p></div><button type="button" class="investment-refresh" data-investment-refresh>重新整理</button></div>${list?list.render(state,dependencies):'<p role="alert">持股清單尚未載入。</p>'}</section>`;
 }
 return Object.freeze({render});
});
