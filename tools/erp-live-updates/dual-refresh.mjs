import {stageInventory,canCommitInventory,commitInventory} from './inventory-refresh.mjs';
// Full shared data on join/other mutations. Observation bursts read only the two inventory tabs.
export function dualRefresh({store,observations,identity,editGeneration,isSafe,isVisible,render,onState,onSnapshot,onReadStart}){
 let pending=0,done=0,fullPending=0,running=false,stopped=false,timer=null,burstAt=0,readyAt=0;
 const later=()=>{if(timer!==null)clearTimeout(timer);timer=setTimeout(()=>{timer=null;void flush()},Math.max(0,readyAt-Date.now()))};
 async function flush(){
  if(stopped||running||pending===done)return 'idle';
  const inventoryOnly=fullPending<=done;
  if(inventoryOnly&&Date.now()<readyAt){later();return 'deferred'}
  if(!identity()||!isVisible()||!isSafe()||observations.hasPending()){onState?.('deferred');return 'deferred'}
  const who=identity(),generation=editGeneration(),revision=pending,snapshotMark=onReadStart?.();
  const safe=()=>!stopped&&revision===pending&&who===identity()&&generation===editGeneration()&&isSafe()&&!observations.hasPending();
  if(inventoryOnly)burstAt=0;running=true;onState?.(inventoryOnly?'reading-inventory':'reading');
  try{
   const [assets,field]=await Promise.all([inventoryOnly?stageInventory(store,safe):store.stageShared(safe),observations.stageObservations()]);
   if(!safe()||!(inventoryOnly?canCommitInventory(store,assets,safe):store.canCommitShared(assets,safe))||!observations.canCommitObservations(field)){onState?.('deferred');return 'deferred'}
   // Both preflighted commits are synchronous assignments, with no interleaved events or I/O.
   if(inventoryOnly)commitInventory(store,assets,safe);else store.commitShared(assets,safe);
   observations.commitObservations(field);done=revision;burstAt=0;onSnapshot?.(field.rows,snapshotMark);render();onState?.(inventoryOnly?'updated-inventory':'updated');return 'updated';
  }catch(error){onState?.('failed',error);return 'failed'}finally{running=false;if(pending!==revision)queueMicrotask(flush)}
 }
 return{
  invalidate(){pending++;fullPending=pending;readyAt=0;if(timer!==null){clearTimeout(timer);timer=null}return flush()},
  invalidateInventory(){pending++;const now=Date.now();if(!burstAt)burstAt=now;readyAt=Math.min(now+800,burstAt+5000);onState?.('inventory-pending');later();},
  flush,stop(){stopped=true;if(timer!==null)clearTimeout(timer)},pending(){return pending!==done}
 };
}
