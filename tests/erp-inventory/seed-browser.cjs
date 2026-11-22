/* Install a valid already-open isolated position round for non-inventory UI regression fixtures.
   Inventory opening/finalization itself is exercised against the real handler in browser.cjs. */
module.exports=function seedBrowserInventory({map,site,zone,seats,sessionId}){
 const store=ZgErpData.store;
 for(const seat of seats){const id='22222222-2222-4222-8222-'+String(seat).padStart(12,'0');
  if(store.seatRows.some(r=>r[0]===id))continue;
  store.seatRows.push([id,'inventory-open',map,site,zone,seat,'',JSON.stringify({schema:1,previous:'',baselineId:'',sessionId,command:{eventId:id,action:'open',confirmed:true,baselineId:''}}),'2026-11-22T00:00:00Z','fixture@example.invalid']);
 }
 store.db.seatRows=store.seatRows;
};
