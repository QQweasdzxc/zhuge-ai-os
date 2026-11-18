const {test}=require('node:test'),assert=require('node:assert/strict');
const Repository=require('../../modules/investment/services/supabase-investment-repository.js');
const Calc=require('../../modules/investment/services/portfolio-calculation-service.js');
const Position=require('../../modules/investment/models/position.js');
const Simple=require('../../modules/investment/components/holdings-simple-list.js');
const Transactions=require('../../modules/investment/pages/transactions-page.js');
const format=require('../../modules/investment/utils/formatters.js');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const user='11111111-1111-4111-8111-111111111111';
function repo(){const calls=[];return {calls,repository:Repository.create({userId:user,sessionSnapshot:{isAuthenticated:true,aal:'aal2'},data:{select:async(table,query)=>{calls.push({table,query});if(table==='app_users')return[{id:'owner-1'}];if(table==='transactions')return[{id:'tx-1',symbol:'SYN',market:'TW',currency:'TWD',created_at:'2026-11-17T01:02:03.123+00:00'}];return[];}}})};}
test('owner-scoped keyset pagination preserves all three ordering columns and validates untrusted cursor values',async()=>{
 const {repository,calls}=repo();await repository.loadTransactions();
 assert.match(calls.at(-1).query,/user_id=eq.owner-1.*order=trade_date.desc,created_at.desc,id.desc&limit=201/);
 const before={tradeDate:'2026-11-17',createdAt:'2026-11-17T01:02:03.123+00:00',id:'abc-123'};
 await repository.loadTransactions({before});const query=decodeURIComponent(calls.at(-1).query);
 assert.ok(query.includes('(trade_date.lt.2026-11-17,and(trade_date.eq.2026-11-17,created_at.lt.2026-11-17T01:02:03.123+00:00),and(trade_date.eq.2026-11-17,created_at.eq.2026-11-17T01:02:03.123+00:00,id.lt.abc-123))'));
 assert.doesNotMatch(query,/offset=/);
 const count=calls.length;await assert.rejects(repository.loadTransactions({before:{...before,id:'x),user_id.neq.a'}}),/分頁資訊無效/);assert.equal(calls.length,count);
});
test('readback of a backdated save is by exact owner-scoped id, not by the first ledger page',async()=>{
 const {repository,calls}=repo();const row=await repository.loadTransactionById('tx-1');assert.equal(row.id,'tx-1');assert.match(calls.at(-1).query,/user_id=eq.owner-1&id=eq.tx-1&limit=1/);
 await assert.rejects(repository.loadTransactionById('x&user_id=neq.any'),/交易識別無效/);
});
test('all-closed portfolio still shows realized by currency and history, not false current loss or deletion',()=>{
 const closed=Position.normalize({id:'closed-1',symbol:'SYN',name:'Synthetic',quantity:0,position_status:'history',realized_pnl:2200,currency:'TWD',market_value:0,unrealized_pnl:0});
 const deps={escape,format,calculation:Calc,holdingsView:'history'};
 const html=Simple.render({positions:[closed],intelligence:{}},deps);
 assert.match(html,/已實現損益/);assert.match(html,/2,200/);assert.match(html,/已平倉 1/);assert.match(html,/data-investment-symbol="SYN"/);assert.match(html,/登記再買入/);assert.doesNotMatch(html,/data-investment-stock-action="sell"/);
 const summary=Calc.summarize([closed]);assert.equal(summary.tw.realizedPnl,2200);assert.equal(summary.tw.cost,0);assert.equal(summary.tw.pnl,0);assert.equal(summary.historicalAssetCount,1);
});
test('individual transaction filtering requires market and currency as well as symbol and keeps earlier-page affordance',()=>{
 const html=Transactions.render({transactions:[{id:'tw',symbol:'SYN',market:'TW',currency:'TWD',tradeDate:'2026-11-17',tradeType:'BUY',quantity:1,price:10},{id:'us',symbol:'SYN',market:'US',currency:'USD',tradeDate:'2026-11-17',tradeType:'BUY',quantity:1,price:10}],transactionsHasMore:true},{escape,format,transactionFilter:{symbol:'SYN',market:'TW',currency:'TWD'},transactionWrite:{form:{idempotencyKey:'synthetic-key'}}});
 assert.match(html,/data-investment-transaction-id="tw"/);assert.doesNotMatch(html,/data-investment-transaction-id="us"/);assert.match(html,/data-investment-transactions-more/);assert.match(html,/只含已讀取部分/);
});
test('a saved form cannot reuse an old idempotency key to silently ignore an edited next transaction',()=>{
 const html=Transactions.render({}, {escape,format,transactionWrite:{status:'success',form:{idempotencyKey:'synthetic-key'}}});
 assert.match(html,/data-investment-new-buy/);assert.match(html,/name="quantity"[^>]*disabled/);assert.match(html,/name="idempotencyKey"[^>]*disabled/);
});
